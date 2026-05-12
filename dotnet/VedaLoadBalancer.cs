using System.Collections.Concurrent;
using System;

namespace VedaDB;

/// <summary>
/// Strategy for selecting a node from the pool.
/// </summary>
public enum LoadBalanceStrategy
{
    /// <summary>Round-robin selection.</summary>
    RoundRobin,
    /// <summary>Random selection.</summary>
    Random,
    /// <summary>Least connections.</summary>
    LeastConnections,
    /// <summary>Weighted round-robin.</summary>
    WeightedRoundRobin,
    /// <summary>IP hash for sticky sessions.</summary>
    IPHash
}

/// <summary>
/// A node in the load balancer pool.
/// </summary>
public class VedaNode
{
    /// <summary>
    /// Node host.
    /// </summary>
    public string Host { get; set; } = "";

    /// <summary>
    /// Node port.
    /// </summary>
    public int Port { get; set; }

    /// <summary>
    /// Node weight (for weighted strategies).
    /// </summary>
    public int Weight { get; set; } = 1;

    /// <summary>
    /// Whether the node is currently healthy.
    /// </summary>
    public bool IsHealthy { get; set; } = true;

    /// <summary>
    /// Current number of active connections.
    /// </summary>
    public int ActiveConnections;

    /// <summary>
    /// Total requests handled.
    /// </summary>
    public long TotalRequests;

    /// <summary>
    /// Node identifier.
    /// </summary>
    public string Id => $"{Host}:{Port}";
}

/// <summary>
/// Load balancer for distributing requests across multiple VedaDB nodes.
/// </summary>
public class VedaLoadBalancer
{
    private readonly LoadBalanceStrategy _strategy;
    private readonly List<VedaNode> _nodes = new();
    private readonly object _nodeLock = new();
    private int _roundRobinIndex;
    private readonly Random _random = new();

    /// <summary>
    /// Create a load balancer.
    /// </summary>
    public VedaLoadBalancer(LoadBalanceStrategy strategy = LoadBalanceStrategy.RoundRobin)
    {
        _strategy = strategy;
    }

    /// <summary>
    /// Add a node to the pool.
    /// </summary>
    public void AddNode(string host, int port, int weight = 1)
    {
        lock (_nodeLock)
        {
            _nodes.Add(new VedaNode { Host = host, Port = port, Weight = weight });
        }
    }

    /// <summary>
    /// Remove a node from the pool.
    /// </summary>
    public void RemoveNode(string host, int port)
    {
        lock (_nodeLock)
        {
            _nodes.RemoveAll(n => n.Host == host && n.Port == port);
        }
    }

    /// <summary>
    /// Update node health status.
    /// </summary>
    public void SetNodeHealth(string host, int port, bool isHealthy)
    {
        lock (_nodeLock)
        {
            var node = _nodes.FirstOrDefault(n => n.Host == host && n.Port == port);
            if (node != null) node.IsHealthy = isHealthy;
        }
    }

    /// <summary>
    /// Get all registered nodes.
    /// </summary>
    public IReadOnlyList<VedaNode> GetNodes()
    {
        lock (_nodeLock) { return _nodes.ToList(); }
    }

    /// <summary>
    /// Get only healthy nodes.
    /// </summary>
    public List<VedaNode> GetHealthyNodes()
    {
        lock (_nodeLock) { return _nodes.Where(n => n.IsHealthy).ToList(); }
    }

    /// <summary>
    /// Select the next node based on the configured strategy.
    /// </summary>
    public VedaNode? SelectNode(string? clientKey = null)
    {
        var healthyNodes = GetHealthyNodes();
        if (healthyNodes.Count == 0) return null;

        VedaNode? selected;

        switch (_strategy)
        {
            case LoadBalanceStrategy.Random:
                selected = healthyNodes[_random.Next(healthyNodes.Count)];
                break;

            case LoadBalanceStrategy.LeastConnections:
                selected = healthyNodes.OrderBy(n => n.ActiveConnections).First();
                break;

            case LoadBalanceStrategy.WeightedRoundRobin:
                selected = WeightedSelection(healthyNodes);
                break;

            case LoadBalanceStrategy.IPHash:
                selected = IPHashSelection(healthyNodes, clientKey);
                break;

            case LoadBalanceStrategy.RoundRobin:
            default:
                selected = RoundRobinSelection(healthyNodes);
                break;
        }

        if (selected != null)
        {
            selected.TotalRequests++;
            selected.ActiveConnections++;
            VedaMetrics.Increment("vedadb_loadbalancer_selects", 1,
                new() { { "node", selected.Id }, { "strategy", _strategy.ToString() } });
        }

        return selected;
    }

    /// <summary>
    /// Release a connection back to the pool, decrementing active count.
    /// </summary>
    public void ReleaseNode(VedaNode node)
    {
        node.ActiveConnections--;
    }

    /// <summary>
    /// Execute an operation on a selected node.
    /// </summary>
    public async Task<T> ExecuteAsync<T>(Func<VedaNode, Task<T>> operation, string? clientKey = null)
    {
        var node = SelectNode(clientKey);
        if (node == null)
            throw new VedaConnectionException("No healthy nodes available in load balancer");

        try
        {
            return await operation(node);
        }
        catch (Exception ex)
        {
            VedaMetrics.Increment("vedadb_loadbalancer_errors", 1,
                new() { { "node", node.Id }, { "error", ex.GetType().Name } });
            throw;
        }
        finally
        {
            ReleaseNode(node);
        }
    }

    /// <summary>
    /// Get pool statistics.
    /// </summary>
    public VedaLoadBalancerStats GetStats()
    {
        var nodes = GetNodes();
        return new VedaLoadBalancerStats
        {
            TotalNodes = nodes.Count,
            HealthyNodes = nodes.Count(n => n.IsHealthy),
            UnhealthyNodes = nodes.Count(n => !n.IsHealthy),
            TotalRequests = nodes.Sum(n => n.TotalRequests),
            ActiveConnections = nodes.Sum(n => n.ActiveConnections)
        };
    }

    private VedaNode? RoundRobinSelection(List<VedaNode> nodes)
    {
        if (nodes.Count == 0) return null;
        var index = Interlocked.Increment(ref _roundRobinIndex);
        return nodes[Math.Abs(index) % nodes.Count];
    }

    private VedaNode? WeightedSelection(List<VedaNode> nodes)
    {
        if (nodes.Count == 0) return null;
        var totalWeight = nodes.Sum(n => n.Weight);
        var pick = _random.Next(totalWeight);
        var current = 0;
        foreach (var node in nodes)
        {
            current += node.Weight;
            if (pick < current) return node;
        }
        return nodes.Last();
    }

    private VedaNode? IPHashSelection(List<VedaNode> nodes, string? clientKey)
    {
        if (nodes.Count == 0) return null;
        var key = clientKey ?? Guid.NewGuid().ToString();
        var hash = key.GetHashCode();
        return nodes[Math.Abs(hash) % nodes.Count];
    }
}

/// <summary>
/// Statistics for the load balancer.
/// </summary>
public class VedaLoadBalancerStats
{
    public int TotalNodes { get; set; }
    public int HealthyNodes { get; set; }
    public int UnhealthyNodes { get; set; }
    public long TotalRequests;
    public int ActiveConnections;
}
