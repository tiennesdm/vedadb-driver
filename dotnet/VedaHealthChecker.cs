using System.Collections.Concurrent;
using System;

namespace VedaDB;

/// <summary>
/// Health status of a VedaDB node.
/// </summary>
public class VedaHealthStatus
{
    /// <summary>
    /// Whether the node is healthy.
    /// </summary>
    public bool IsHealthy { get; set; }

    /// <summary>
    /// Server host.
    /// </summary>
    public string Host { get; set; } = "";

    /// <summary>
    /// Server port.
    /// </summary>
    public int Port { get; set; }

    /// <summary>
    /// Response time of the last health check.
    /// </summary>
    public TimeSpan ResponseTime { get; set; }

    /// <summary>
    /// Timestamp of the last health check.
    /// </summary>
    public DateTime LastChecked { get; set; }

    /// <summary>
    /// Error message if unhealthy.
    /// </summary>
    public string? Error { get; set; }

    /// <summary>
    /// Number of consecutive failures.
    /// </summary>
    public int ConsecutiveFailures { get; set; }

    /// <summary>
    /// Number of consecutive successes.
    /// </summary>
    public int ConsecutiveSuccesses { get; set; }
}

/// <summary>
/// Configuration for health checking.
/// </summary>
public class VedaHealthCheckerConfig
{
    /// <summary>
    /// Interval between health checks. Default is 10 seconds.
    /// </summary>
    public TimeSpan CheckInterval { get; set; } = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Timeout for each health check. Default is 5 seconds.
    /// </summary>
    public TimeSpan CheckTimeout { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Number of consecutive failures before marking unhealthy. Default is 3.
    /// </summary>
    public int UnhealthyThreshold { get; set; } = 3;

    /// <summary>
    /// Number of consecutive successes before marking healthy. Default is 2.
    /// </summary>
    public int HealthyThreshold { get; set; } = 2;
}

/// <summary>
/// Health checker for VedaDB nodes. Periodically pings servers and tracks health status.
/// </summary>
public class VedaHealthChecker : IDisposable
{
    private readonly VedaHealthCheckerConfig _config;
    private readonly ConcurrentDictionary<string, VedaHealthStatus> _statuses = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _checkers = new();
    private bool _disposed;

    /// <summary>
    /// Event raised when a node's health status changes.
    /// </summary>
    public event EventHandler<VedaHealthStatus>? StatusChanged;

    /// <summary>
    /// Create a health checker with default configuration.
    /// </summary>
    public VedaHealthChecker() : this(new VedaHealthCheckerConfig()) { }

    /// <summary>
    /// Create a health checker with specified configuration.
    /// </summary>
    public VedaHealthChecker(VedaHealthCheckerConfig config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
    }

    /// <summary>
    /// Register a node for health checking.
    /// </summary>
    public void RegisterNode(string host, int port)
    {
        var key = NodeKey(host, port);
        _statuses[key] = new VedaHealthStatus { Host = host, Port = port, IsHealthy = true };

        var cts = new CancellationTokenSource();
        if (_checkers.TryAdd(key, cts))
        {
            _ = RunHealthChecksAsync(host, port, cts.Token);
        }
    }

    /// <summary>
    /// Unregister a node from health checking.
    /// </summary>
    public void UnregisterNode(string host, int port)
    {
        var key = NodeKey(host, port);
        if (_checkers.TryRemove(key, out var cts))
        {
            cts.Cancel();
            cts.Dispose();
        }
        _statuses.TryRemove(key, out _);
    }

    /// <summary>
    /// Get the health status of a node.
    /// </summary>
    public VedaHealthStatus? GetStatus(string host, int port)
    {
        _statuses.TryGetValue(NodeKey(host, port), out var status);
        return status;
    }

    /// <summary>
    /// Get all health statuses.
    /// </summary>
    public IReadOnlyCollection<VedaHealthStatus> GetAllStatuses() => _statuses.Values.ToList();

    /// <summary>
    /// Get only healthy nodes.
    /// </summary>
    public IEnumerable<VedaHealthStatus> GetHealthyNodes()
        => _statuses.Values.Where(s => s.IsHealthy);

    /// <summary>
    /// Check if a node is currently healthy.
    /// </summary>
    public bool IsHealthy(string host, int port)
        => GetStatus(host, port)?.IsHealthy ?? false;

    /// <summary>
    /// Perform a single health check on a node.
    /// </summary>
    public async Task<VedaHealthStatus> CheckAsync(string host, int port, CancellationToken ct = default)
    {
        var key = NodeKey(host, port);
        var status = _statuses.GetValueOrDefault(key) ?? new VedaHealthStatus { Host = host, Port = port };

        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(_config.CheckTimeout);

            var protocol = new VedaProtocol(host, port);
            await protocol.ConnectAsync(cts.Token);
            await protocol.SendAsync("SELECT 1;", cts.Token);
            await protocol.CloseAsync();

            sw.Stop();
            status.ResponseTime = sw.Elapsed;
            status.LastChecked = DateTime.UtcNow;
            status.ConsecutiveSuccesses++;
            status.ConsecutiveFailures = 0;

            if (status.ConsecutiveSuccesses >= _config.HealthyThreshold)
            {
                var wasHealthy = status.IsHealthy;
                status.IsHealthy = true;
                status.Error = null;
                if (!wasHealthy)
                    StatusChanged?.Invoke(this, status);
            }
        }
        catch (Exception ex)
        {
            sw.Stop();
            status.ResponseTime = _config.CheckTimeout;
            status.LastChecked = DateTime.UtcNow;
            status.ConsecutiveFailures++;
            status.ConsecutiveSuccesses = 0;

            if (status.ConsecutiveFailures >= _config.UnhealthyThreshold)
            {
                var wasHealthy = status.IsHealthy;
                status.IsHealthy = false;
                status.Error = ex.Message;
                if (wasHealthy)
                    StatusChanged?.Invoke(this, status);
            }
        }

        VedaMetrics.Gauge("vedadb_health_status", status.IsHealthy ? 1 : 0,
            new() { { "host", host }, { "port", port.ToString() } });
        VedaMetrics.Histogram("vedadb_health_response_seconds", status.ResponseTime.TotalSeconds,
            new() { { "host", host } });

        _statuses[key] = status;
        return status;
    }

    private async Task RunHealthChecksAsync(string host, int port, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await CheckAsync(host, port, ct);
                await Task.Delay(_config.CheckInterval, ct);
            }
        }
        catch (OperationCanceledException) { /* Normal shutdown */ }
    }

    private static string NodeKey(string host, int port) => $"{host}:{port}";

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        foreach (var cts in _checkers.Values)
        {
            cts.Cancel();
            cts.Dispose();
        }
        _checkers.Clear();
    }
}
