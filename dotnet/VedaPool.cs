using System.Collections.Concurrent;

namespace VedaDB;

/// <summary>
/// Thread-safe connection pool for VedaDB.
/// </summary>
public class VedaPool : IDisposable
{
    private readonly string _host;
    private readonly int _port;
    private readonly int _maxSize;
    private readonly int _timeoutMs;
    private readonly ConcurrentBag<VedaClient> _idle = new();
    private int _activeCount;
    private bool _closed;

    /// <summary>
    /// Create a connection pool.
    /// </summary>
    public VedaPool(string host = "localhost", int port = 6380, int maxSize = 10, int timeoutMs = 30000)
    {
        _host = host;
        _port = port;
        _maxSize = maxSize;
        _timeoutMs = timeoutMs;
    }

    /// <summary>
    /// Acquire a client from the pool.
    /// </summary>
    public VedaClient Acquire()
    {
        if (_closed) throw new VedaException("Pool is closed");

        if (_idle.TryTake(out var client))
        {
            Interlocked.Increment(ref _activeCount);
            return client;
        }

        var newClient = new VedaClient(_host, _port, _timeoutMs);
        Interlocked.Increment(ref _activeCount);
        return newClient;
    }

    /// <summary>
    /// Release a client back to the pool.
    /// </summary>
    public void Release(VedaClient client)
    {
        Interlocked.Decrement(ref _activeCount);

        if (_closed || _idle.Count >= _maxSize)
        {
            client.Dispose();
            return;
        }

        _idle.Add(client);
    }

    /// <summary>Number of active (checked-out) connections.</summary>
    public int ActiveCount => _activeCount;

    /// <summary>Number of idle connections in the pool.</summary>
    public int IdleCount => _idle.Count;

    public void Dispose()
    {
        _closed = true;
        while (_idle.TryTake(out var client))
        {
            client.Dispose();
        }
        GC.SuppressFinalize(this);
    }
}
