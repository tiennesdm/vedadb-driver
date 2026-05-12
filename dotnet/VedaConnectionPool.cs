using System.Collections.Concurrent;
using System;

namespace VedaDB;

/// <summary>
/// Configuration for the VedaDB connection pool.
/// </summary>
public class VedaPoolConfig
{
    /// <summary>
    /// Minimum number of connections in the pool. Default is 2.
    /// </summary>
    public int MinSize { get; set; } = 2;

    /// <summary>
    /// Maximum number of connections in the pool. Default is 20.
    /// </summary>
    public int MaxSize { get; set; } = 20;

    /// <summary>
    /// Timeout for acquiring a connection. Default is 10 seconds.
    /// </summary>
    public TimeSpan AcquireTimeout { get; set; } = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Maximum idle time before a connection is closed. Default is 5 minutes.
    /// </summary>
    public TimeSpan MaxIdleTime { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Interval for maintenance tasks. Default is 30 seconds.
    /// </summary>
    public TimeSpan MaintenanceInterval { get; set; } = TimeSpan.FromSeconds(30);
}

/// <summary>
/// Connection pool statistics.
/// </summary>
public class VedaPoolStats
{
    /// <summary>
    /// Number of idle connections.
    /// </summary>
    public int IdleCount { get; set; }

    /// <summary>
    /// Number of active (checked-out) connections.
    /// </summary>
    public int ActiveCount { get; set; }

    /// <summary>
    /// Total number of connections.
    /// </summary>
    public int TotalCount { get; set; }

    /// <summary>
    /// Maximum pool size.
    /// </summary>
    public int MaxSize { get; set; }

    /// <summary>
    /// Number of waiters blocked waiting for a connection.
    /// </summary>
    public int WaiterCount { get; set; }

    /// <summary>
    /// Total number of acquired connections.
    /// </summary>
    public long TotalAcquired { get; set; }

    /// <summary>
    /// Total number of released connections.
    /// </summary>
    public long TotalReleased { get; set; }

    /// <summary>
    /// Number of connection creations.
    /// </summary>
    public long TotalCreated { get; set; }

    /// <summary>
    /// Number of connection disposals.
    /// </summary>
    public long TotalDisposed { get; set; }
}

/// <summary>
/// Pooled connection wrapper that returns to pool on dispose.
/// </summary>
public class VedaPooledConnection : IDisposable, IAsyncDisposable
{
    private readonly VedaConnectionPool _pool;
    private readonly VedaClient _client;
    private bool _disposed;

    /// <summary>
    /// The underlying client.
    /// </summary>
    public VedaClient Client => _disposed
        ? throw new ObjectDisposedException(nameof(VedaPooledConnection))
        : _client;

    internal VedaPooledConnection(VedaConnectionPool pool, VedaClient client)
    {
        _pool = pool;
        _client = client;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _pool.Release(_client);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _pool.ReleaseAsync(_client);
    }
}

/// <summary>
/// Thread-safe async connection pool for VedaDB.
/// Supports min/max sizing, connection timeouts, idle reaping, and health validation.
/// </summary>
public class VedaConnectionPool : IDisposable, IAsyncDisposable
{
    private readonly VedaPoolConfig _config;
    private readonly ConcurrentQueue<VedaClient> _idle = new();
    private readonly SemaphoreSlim _semaphore;
    private readonly object _lock = new();
    private int _activeCount;
    private long _totalAcquired;
    private long _totalReleased;
    private long _totalCreated;
    private long _totalDisposed;
    private bool _disposed;
    private Timer? _maintenanceTimer;
    private readonly Func<Task<VedaClient>> _clientFactory;

    /// <summary>
    /// Minimum pool size.
    /// </summary>
    public int MinSize => _config.MinSize;

    /// <summary>
    /// Maximum pool size.
    /// </summary>
    public int MaxSize => _config.MaxSize;

    /// <summary>
    /// Timeout for acquiring a connection.
    /// </summary>
    public TimeSpan AcquireTimeout
    {
        get => _config.AcquireTimeout;
        set => _config.AcquireTimeout = value;
    }

    /// <summary>
    /// Current pool statistics.
    /// </summary>
    public VedaPoolStats Stats
    {
        get
        {
            var _ = _activeCount;
            return new VedaPoolStats
            {
                IdleCount = _idle.Count,
                ActiveCount = _activeCount,
                TotalCount = _idle.Count + _activeCount,
                MaxSize = _config.MaxSize,
                WaiterCount = _config.MaxSize - _semaphore.CurrentCount,
                TotalAcquired = Interlocked.Read(ref _totalAcquired),
                TotalReleased = Interlocked.Read(ref _totalReleased),
                TotalCreated = Interlocked.Read(ref _totalCreated),
                TotalDisposed = Interlocked.Read(ref _totalDisposed)
            };
        }
    }

    /// <summary>
    /// Create a connection pool with default configuration.
    /// </summary>
    public VedaConnectionPool(Func<Task<VedaClient>> clientFactory)
        : this(new VedaPoolConfig(), clientFactory) { }

    /// <summary>
    /// Create a connection pool with specified configuration.
    /// </summary>
    public VedaConnectionPool(VedaPoolConfig config, Func<Task<VedaClient>> clientFactory)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _clientFactory = clientFactory ?? throw new ArgumentNullException(nameof(clientFactory));
        _semaphore = new SemaphoreSlim(config.MaxSize, config.MaxSize);

        // Start maintenance timer
        _maintenanceTimer = new Timer(_ => RunMaintenance(), null, config.MaintenanceInterval, config.MaintenanceInterval);

        // Pre-warm minimum connections
        _ = PreWarmAsync();
    }

    /// <summary>
    /// Create a connection pool from a VedaConfig.
    /// </summary>
    public static VedaConnectionPool FromConfig(VedaConfig config)
    {
        return new VedaConnectionPool(
            new VedaPoolConfig
            {
                MinSize = config.PoolMinSize,
                MaxSize = config.PoolMaxSize,
                AcquireTimeout = config.PoolAcquireTimeout,
                MaxIdleTime = config.PoolMaxIdleTime
            },
            async () =>
            {
                var client = new VedaClient(config);
                await client.ConnectAsync();
                return client;
            });
    }

    private async Task PreWarmAsync()
    {
        for (int i = 0; i < _config.MinSize; i++)
        {
            try
            {
                var client = await _clientFactory();
                _idle.Enqueue(client);
                Interlocked.Increment(ref _totalCreated);
            }
            catch { break; }
        }
    }

    /// <summary>
    /// Acquire a connection from the pool.
    /// </summary>
    public async Task<VedaClient> AcquireAsync(CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);

        var timeoutCts = new CancellationTokenSource(_config.AcquireTimeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        await _semaphore.WaitAsync(linkedCts.Token);

        try
        {
            while (_idle.TryDequeue(out var client))
            {
                if (await ValidateConnectionAsync(client))
                {
                    Interlocked.Increment(ref _activeCount);
                    Interlocked.Increment(ref _totalAcquired);
                    VedaMetrics.Gauge("vedadb_pool_active", _activeCount);
                    VedaMetrics.Gauge("vedadb_pool_idle", _idle.Count);
                    return client;
                }
                else
                {
                    await DisposeClientAsync(client);
                }
            }

            // No idle connections, create a new one
            var newClient = await _clientFactory();
            Interlocked.Increment(ref _activeCount);
            Interlocked.Increment(ref _totalAcquired);
            Interlocked.Increment(ref _totalCreated);
            VedaMetrics.Gauge("vedadb_pool_active", _activeCount);
            return newClient;
        }
        catch
        {
            _semaphore.Release();
            throw;
        }
    }

    /// <summary>
    /// Acquire a connection with automatic return on dispose.
    /// </summary>
    public async Task<VedaPooledConnection> AcquirePooledAsync(CancellationToken ct = default)
    {
        var client = await AcquireAsync(ct);
        return new VedaPooledConnection(this, client);
    }

    /// <summary>
    /// Release a connection back to the pool.
    /// </summary>
    public void Release(VedaClient client)
    {
        _ = ReleaseAsync(client);
    }

    /// <summary>
    /// Release a connection back to the pool asynchronously.
    /// </summary>
    public async Task ReleaseAsync(VedaClient client)
    {
        Interlocked.Decrement(ref _activeCount);
        Interlocked.Increment(ref _totalReleased);

        if (_disposed)
        {
            await DisposeClientAsync(client);
            return;
        }

        if (await ValidateConnectionAsync(client))
        {
            _idle.Enqueue(client);
            _semaphore.Release();
        }
        else
        {
            await DisposeClientAsync(client);
        }

        VedaMetrics.Gauge("vedadb_pool_active", _activeCount);
        VedaMetrics.Gauge("vedadb_pool_idle", _idle.Count);
    }

    /// <summary>
    /// Drain all connections from the pool.
    /// </summary>
    public async Task DrainAsync()
    {
        while (_idle.TryDequeue(out var client))
        {
            await DisposeClientAsync(client);
        }
    }

    private async Task<bool> ValidateConnectionAsync(VedaClient client)
    {
        try
        {
            await client.PingAsync();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private async Task DisposeClientAsync(VedaClient client)
    {
        try { await client.CloseAsync(); } catch { /* Best effort */ }
        try { client.Dispose(); } catch { /* Best effort */ }
        Interlocked.Increment(ref _totalDisposed);
    }

    private void RunMaintenance()
    {
        if (_disposed) return;

        // Remove excess idle connections
        while (_idle.Count > _config.MinSize)
        {
            if (_idle.TryDequeue(out var client))
            {
                _ = DisposeClientAsync(client);
            }
            else break;
        }

        VedaMetrics.Gauge("vedadb_pool_idle", _idle.Count);
        VedaMetrics.Gauge("vedadb_pool_active", _activeCount);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        _maintenanceTimer?.Dispose();
        await DrainAsync();
        _semaphore.Dispose();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _maintenanceTimer?.Dispose();
        while (_idle.TryDequeue(out var client))
        {
            try { client.Dispose(); } catch { /* Best effort */ }
        }
        _semaphore.Dispose();
    }
}
