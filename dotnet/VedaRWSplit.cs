using System;
namespace VedaDB;

/// <summary>
/// Read/Write splitting configuration.
/// </summary>
public class VedaRWSplitConfig
{
    /// <summary>
    /// Primary (write) node host.
    /// </summary>
    public string PrimaryHost { get; set; } = "localhost";

    /// <summary>
    /// Primary (write) node port.
    /// </summary>
    public int PrimaryPort { get; set; } = 6380;

    /// <summary>
    /// Replica (read) nodes.
    /// </summary>
    public List<(string Host, int Port)> Replicas { get; set; } = new();

    /// <summary>
    /// Whether to fallback to primary for reads if no replicas are available.
    /// </summary>
    public bool FallbackToPrimary { get; set; } = true;

    /// <summary>
    /// Replication lag threshold in milliseconds. 0 means no check.
    /// </summary>
    public int MaxReplicationLagMs { get; set; } = 0;
}

/// <summary>
/// Read/Write splitter for VedaDB.
/// Routes write operations to the primary and read operations to replicas.
/// </summary>
public class VedaRWSplit : IDisposable
{
    private readonly VedaRWSplitConfig _config;
    private readonly VedaClient _primary;
    private readonly List<VedaClient> _replicas = new();
    private readonly VedaLoadBalancer _replicaBalancer;
    private readonly object _lock = new();
    private int _replicaIndex;
    private bool _disposed;

    /// <summary>
    /// The primary (write) client.
    /// </summary>
    public VedaClient Primary => _primary;

    /// <summary>
    /// Create a read/write splitter.
    /// </summary>
    public VedaRWSplit(VedaRWSplitConfig config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _primary = new VedaClient(config.PrimaryHost, config.PrimaryPort);
        _replicaBalancer = new VedaLoadBalancer(LoadBalanceStrategy.RoundRobin);

        foreach (var (host, port) in config.Replicas)
        {
            try
            {
                var client = new VedaClient(host, port);
                _replicas.Add(client);
                _replicaBalancer.AddNode(host, port);
            }
            catch { /* Skip unhealthy replicas */ }
        }
    }

    /// <summary>
    /// Create a read/write splitter with explicit clients.
    /// </summary>
    public VedaRWSplit(VedaClient primary, IEnumerable<VedaClient> replicas)
    {
        _config = new VedaRWSplitConfig();
        _primary = primary ?? throw new ArgumentNullException(nameof(primary));
        _replicaBalancer = new VedaLoadBalancer(LoadBalanceStrategy.RoundRobin);

        foreach (var replica in replicas)
        {
            _replicas.Add(replica);
            _replicaBalancer.AddNode(replica.LastHost ?? "unknown", replica.LastPort);
        }
    }

    /// <summary>
    /// Execute a write operation on the primary.
    /// </summary>
    public async Task<VedaResult> WriteAsync(Func<VedaClient, Task<VedaResult>> operation)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        VedaMetrics.Increment("vedadb_rw_writes");
        return await operation(_primary);
    }

    /// <summary>
    /// Execute a read operation on a replica (or primary if no replicas).
    /// </summary>
    public async Task<VedaResult> ReadAsync(Func<VedaClient, Task<VedaResult>> operation)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        VedaMetrics.Increment("vedadb_rw_reads");

        if (_replicas.Count == 0 && _config.FallbackToPrimary)
            return await operation(_primary);

        var node = _replicaBalancer.SelectNode();
        if (node == null)
        {
            if (_config.FallbackToPrimary)
                return await operation(_primary);
            throw new VedaConnectionException("No replica nodes available");
        }

        try
        {
            var client = _replicas.FirstOrDefault(r => (r.LastHost ?? "") == node.Host);
            if (client != null)
                return await operation(client);

            return await operation(_primary);
        }
        catch
        {
            if (_config.FallbackToPrimary)
                return await operation(_primary);
            throw;
        }
        finally
        {
            _replicaBalancer.ReleaseNode(node);
        }
    }

    /// <summary>
    /// Execute a write operation that returns a different type.
    /// </summary>
    public async Task<T> WriteAsync<T>(Func<VedaClient, Task<T>> operation)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        VedaMetrics.Increment("vedadb_rw_writes");
        return await operation(_primary);
    }

    /// <summary>
    /// Execute a read operation that returns a different type.
    /// </summary>
    public async Task<T> ReadAsync<T>(Func<VedaClient, Task<T>> operation)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        VedaMetrics.Increment("vedadb_rw_reads");

        if (_replicas.Count == 0 && _config.FallbackToPrimary)
            return await operation(_primary);

        var node = _replicaBalancer.SelectNode();
        if (node == null)
        {
            if (_config.FallbackToPrimary)
                return await operation(_primary);
            throw new VedaConnectionException("No replica nodes available");
        }

        try
        {
            var client = _replicas.FirstOrDefault(r => (r.LastHost ?? "") == node.Host);
            if (client != null)
                return await operation(client);
            return await operation(_primary);
        }
        catch
        {
            if (_config.FallbackToPrimary)
                return await operation(_primary);
            throw;
        }
        finally
        {
            _replicaBalancer.ReleaseNode(node);
        }
    }

    /// <summary>
    /// Add a new replica dynamically.
    /// </summary>
    public void AddReplica(string host, int port)
    {
        var client = new VedaClient(host, port);
        _replicas.Add(client);
        _replicaBalancer.AddNode(host, port);
    }

    /// <summary>
    /// Remove a replica.
    /// </summary>
    public void RemoveReplica(string host, int port)
    {
        _replicaBalancer.RemoveNode(host, port);
        var toRemove = _replicas.FirstOrDefault(r => (r.LastHost ?? "") == host && r.LastPort == port);
        if (toRemove != null)
        {
            _replicas.Remove(toRemove);
            toRemove.Dispose();
        }
    }

    /// <summary>
    /// Check replication lag on all replicas.
    /// </summary>
    public async Task<Dictionary<string, TimeSpan>> GetReplicationLagAsync()
    {
        var results = new Dictionary<string, TimeSpan>();
        foreach (var replica in _replicas)
        {
            try
            {
                var start = DateTime.UtcNow;
                await replica.PingAsync();
                var lag = DateTime.UtcNow - start;
                results[replica.LastHost ?? "unknown"] = lag;
            }
            catch
            {
                results[replica.LastHost ?? "unknown"] = TimeSpan.MaxValue;
            }
        }
        return results;
    }

    /// <summary>
    /// Number of configured replicas.
    /// </summary>
    public int ReplicaCount => _replicas.Count;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _primary.Dispose();
        foreach (var replica in _replicas)
        {
            try { replica.Dispose(); } catch { /* Best effort */ }
        }
        _replicas.Clear();
    }
}
