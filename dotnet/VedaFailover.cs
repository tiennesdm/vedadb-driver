using System;
namespace VedaDB;

/// <summary>
/// Configuration for failover behavior.
/// </summary>
public class VedaFailoverConfig
{
    /// <summary>
    /// List of failover nodes in priority order.
    /// </summary>
    public List<(string Host, int Port)> FailoverNodes { get; set; } = new();

    /// <summary>
    /// Maximum number of failover attempts. Default is 3.
    /// </summary>
    public int MaxFailoverAttempts { get; set; } = 3;

    /// <summary>
    /// Delay between failover attempts. Default is 5 seconds.
    /// </summary>
    public TimeSpan FailoverDelay { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Whether to automatically fail back to the primary when it recovers.
    /// </summary>
    public bool AutoFailback { get; set; } = false;

    /// <summary>
    /// Health check interval for failback detection. Default is 30 seconds.
    /// </summary>
    public TimeSpan FailbackCheckInterval { get; set; } = TimeSpan.FromSeconds(30);
}

/// <summary>
/// Failover manager for VedaDB connections.
/// Automatically switches to backup nodes when the primary fails.
/// </summary>
public class VedaFailover : IDisposable
{
    private readonly VedaFailoverConfig _config;
    private readonly string _primaryHost;
    private readonly int _primaryPort;
    private VedaClient? _currentClient;
    private int _currentNodeIndex = -1;
    private readonly object _lock = new();
    private bool _disposed;
    private Timer? _failbackTimer;

    /// <summary>
    /// The currently active client.
    /// </summary>
    public VedaClient CurrentClient
    {
        get
        {
            if (_currentClient == null)
                throw new VedaFailoverException("No active connection - failover not initialized");
            return _currentClient;
        }
    }

    /// <summary>
    /// Whether the connection is using a failover node (not primary).
    /// </summary>
    public bool IsFailoverActive => _currentNodeIndex > 0;

    /// <summary>
    /// Index of the current node (0 = primary).
    /// </summary>
    public int CurrentNodeIndex => _currentNodeIndex;

    /// <summary>
    /// Event raised when failover occurs.
    /// </summary>
    public event EventHandler<(string OldHost, string NewHost)>? FailoverOccurred;

    /// <summary>
    /// Event raised when failback to primary occurs.
    /// </summary>
    public event EventHandler<string>? FailbackOccurred;

    /// <summary>
    /// Create a failover manager.
    /// </summary>
    public VedaFailover(VedaFailoverConfig config, string primaryHost, int primaryPort)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _primaryHost = primaryHost;
        _primaryPort = primaryPort;

        if (config.AutoFailback)
        {
            _failbackTimer = new Timer(_ => _ = CheckFailbackAsync(), null,
                config.FailbackCheckInterval, config.FailbackCheckInterval);
        }
    }

    /// <summary>
    /// Initialize the failover manager, connecting to the primary.
    /// </summary>
    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await ConnectToNodeAsync(0, ct);
    }

    /// <summary>
    /// Execute an operation with automatic failover.
    /// </summary>
    public async Task<T> ExecuteAsync<T>(Func<VedaClient, Task<T>> operation, CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);

        if (_currentClient == null)
            await InitializeAsync(ct);

        var lastException = default(Exception);

        for (int attempt = 0; attempt < _config.MaxFailoverAttempts; attempt++)
        {
            try
            {
                return await operation(_currentClient!);
            }
            catch (VedaConnectionException ex)
            {
                lastException = ex;
                VedaMetrics.Increment("vedadb_failover_attempts");

                var failoverResult = await TryFailoverAsync(ct);
                if (!failoverResult)
                    break;

                if (_config.FailoverDelay > TimeSpan.Zero)
                    await Task.Delay(_config.FailoverDelay, ct);
            }
        }

        throw new VedaFailoverException(
            $"All failover attempts exhausted after {_config.MaxFailoverAttempts} tries", lastException!);
    }

    /// <summary>
    /// Execute an operation without return value with automatic failover.
    /// </summary>
    public async Task ExecuteAsync(Func<VedaClient, Task> operation, CancellationToken ct = default)
    {
        await ExecuteAsync(async (client) => { await operation(client); return true; }, ct);
    }

    /// <summary>
    /// Manually trigger failover to the next available node.
    /// </summary>
    public async Task<bool> FailoverAsync(CancellationToken ct = default)
    {
        var nextIndex = _currentNodeIndex + 1;
        if (nextIndex > _config.FailoverNodes.Count)
            return false;

        var oldHost = _currentClient?.LastHost ?? "unknown";
        await ConnectToNodeAsync(nextIndex, ct);
        var newHost = _currentClient?.LastHost ?? "unknown";

        FailoverOccurred?.Invoke(this, (oldHost, newHost));
        VedaMetrics.Increment("vedadb_failover_switches");

        return true;
    }

    /// <summary>
    /// Manually failback to the primary node.
    /// </summary>
    public async Task<bool> FailbackAsync(CancellationToken ct = default)
    {
        if (_currentNodeIndex == 0) return true; // Already on primary

        try
        {
            var testClient = new VedaClient(_primaryHost, _primaryPort);
            await testClient.PingAsync();
            testClient.Dispose();

            await ConnectToNodeAsync(0, ct);
            FailbackOccurred?.Invoke(this, _primaryHost);
            VedaMetrics.Increment("vedadb_failback_success");
            return true;
        }
        catch
        {
            VedaMetrics.Increment("vedadb_failback_failures");
            return false;
        }
    }

    private async Task<bool> TryFailoverAsync(CancellationToken ct)
    {
        return await FailoverAsync(ct);
    }

    private async Task CheckFailbackAsync()
    {
        if (_disposed || _currentNodeIndex == 0) return;
        await FailbackAsync();
    }

    private async Task ConnectToNodeAsync(int nodeIndex, CancellationToken ct)
    {
        lock (_lock)
        {
            _currentClient?.Dispose();
        }

        string host;
        int port;

        if (nodeIndex == 0)
        {
            host = _primaryHost;
            port = _primaryPort;
        }
        else if (nodeIndex - 1 < _config.FailoverNodes.Count)
        {
            (host, port) = _config.FailoverNodes[nodeIndex - 1];
        }
        else
        {
            throw new VedaFailoverException($"No failover node at index {nodeIndex}");
        }

        var client = new VedaClient(host, port);
        await client.PingAsync();

        lock (_lock)
        {
            _currentClient = client;
            _currentNodeIndex = nodeIndex;
        }

        VedaMetrics.Gauge("vedadb_failover_current_node", nodeIndex);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _failbackTimer?.Dispose();
        _currentClient?.Dispose();
    }
}
