using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Xunit;

namespace VedaDB.Tests
{
    /// <summary>
    /// Connection pool tests for VedaDB .NET client
    /// </summary>
    public class ConnectionPoolTests : IDisposable
    {
        private ConnectionPool _pool;

        public ConnectionPoolTests()
        {
            _pool = new ConnectionPool(() => new MockConnection(), 10, 5, 1000);
        }

        public void Dispose()
        {
            _pool?.Dispose();
        }

        #region Acquire Tests

        [Fact]
        public async Task Should_Acquire_New_Connection()
        {
            var conn = await _pool.AcquireAsync();
            Assert.NotNull(conn);
            Assert.True(conn.IsInUse);
            conn.Release();
        }

        [Fact]
        public async Task Should_Reuse_Released_Connection()
        {
            var conn1 = await _pool.AcquireAsync();
            var id1 = conn1.Id;
            conn1.Release();

            var conn2 = await _pool.AcquireAsync();
            Assert.Equal(id1, conn2.Id);
            conn2.Release();
        }

        [Fact]
        public async Task Should_Track_Total_Created()
        {
            Assert.Equal(0, _pool.TotalCreated);
            var conn = await _pool.AcquireAsync();
            Assert.Equal(1, _pool.TotalCreated);
            conn.Release();
        }

        #endregion

        #region Pool Exhaustion Tests

        [Fact]
        public async Task Should_Timeout_When_Exhausted()
        {
            var smallPool = new ConnectionPool(() => new MockConnection(), 1, 1, 50);
            var conn = await smallPool.AcquireAsync();
            await Assert.ThrowsAsync<TimeoutException>(() => smallPool.AcquireAsync());
            conn.Release();
            smallPool.Dispose();
        }

        [Fact]
        public async Task Should_Enforce_Max_Connections()
        {
            var smallPool = new ConnectionPool(() => new MockConnection(), 3, 3, 1000);
            var conns = new List<PooledConnection>();
            for (int i = 0; i < 3; i++)
            {
                conns.Add(await smallPool.AcquireAsync());
            }
            Assert.Equal(3, smallPool.TotalCreated);
            foreach (var c in conns) c.Release();
            smallPool.Dispose();
        }

        #endregion

        #region Release Tests

        [Fact]
        public async Task Should_Return_Connection_To_Pool()
        {
            var conn = await _pool.AcquireAsync();
            conn.Release();
            var conn2 = await _pool.AcquireAsync();
            Assert.NotNull(conn2);
            conn2.Release();
        }

        #endregion

        #region Close Tests

        [Fact]
        public void Should_Close_Pool()
        {
            _pool.Dispose();
            Assert.True(_pool.IsDisposed);
        }

        [Fact]
        public void Close_Should_Be_Idempotent()
        {
            _pool.Dispose();
            _pool.Dispose(); // Should not throw
            Assert.True(_pool.IsDisposed);
        }

        [Fact]
        public async Task Should_Reject_Acquire_After_Close()
        {
            _pool.Dispose();
            await Assert.ThrowsAsync<ObjectDisposedException>(() => _pool.AcquireAsync());
        }

        #endregion

        #region Concurrency Tests

        [Fact]
        public async Task Should_Handle_Concurrent_Acquire_Release()
        {
            var tasks = Enumerable.Range(0, 20).Select(async _ =>
            {
                var conn = await _pool.AcquireAsync();
                await Task.Delay(1);
                conn.Release();
            });

            await Task.WhenAll(tasks);
        }

        [Fact]
        public async Task Should_Handle_Stress_Test()
        {
            var stressPool = new ConnectionPool(() => new MockConnection(), 5, 5, 2000);
            var acquired = 0;
            var locker = new object();

            var tasks = Enumerable.Range(0, 50).Select(async _ =>
            {
                try
                {
                    var conn = await stressPool.AcquireAsync();
                    lock (locker) acquired++;
                    await Task.Delay(1);
                    conn.Release();
                }
                catch (TimeoutException)
                {
                    // Expected for some threads
                }
            });

            await Task.WhenAll(tasks);
            Assert.True(acquired > 0);
            stressPool.Dispose();
        }

        #endregion
    }

    #region Implementation

    public class MockConnection : IDisposable
    {
        public bool IsDisposed { get; private set; }
        public void Dispose() { IsDisposed = true; }
    }

    public class PooledConnection
    {
        private readonly ConnectionPool _pool;
        public int Id { get; }
        public bool IsInUse { get; private set; }
        public MockConnection Connection { get; }

        public PooledConnection(MockConnection connection, int id, ConnectionPool pool)
        {
            Connection = connection;
            Id = id;
            _pool = pool;
        }

        public void SetInUse(bool inUse) { IsInUse = inUse; }

        public void Release()
        {
            _pool.Release(this);
        }
    }

    public class ConnectionPool : IDisposable
    {
        private readonly Func<MockConnection> _factory;
        private readonly int _maxSize;
        private readonly long _waitTimeoutMs;
        private readonly Stack<PooledConnection> _available = new();
        private readonly List<PooledConnection> _allConnections = new();
        private readonly object _lock = new object();

        public int TotalCreated { get; private set; }
        public bool IsDisposed { get; private set; }

        public ConnectionPool(Func<MockConnection> factory, int maxSize, int maxIdle, long waitTimeoutMs)
        {
            _factory = factory;
            _maxSize = maxSize;
            _waitTimeoutMs = waitTimeoutMs;
        }

        public Task<PooledConnection> AcquireAsync()
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(ConnectionPool));

            lock (_lock)
            {
                if (_available.Count > 0)
                {
                    var conn = _available.Pop();
                    conn.SetInUse(true);
                    return Task.FromResult(conn);
                }

                if (TotalCreated < _maxSize)
                {
                    TotalCreated++;
                    var raw = _factory();
                    var pooled = new PooledConnection(raw, TotalCreated, this);
                    pooled.SetInUse(true);
                    _allConnections.Add(pooled);
                    return Task.FromResult(pooled);
                }
            }

            // Wait for available connection
            var start = DateTime.UtcNow;
            while (DateTime.UtcNow - start < TimeSpan.FromMilliseconds(_waitTimeoutMs))
            {
                lock (_lock)
                {
                    if (_available.Count > 0)
                    {
                        var conn = _available.Pop();
                        conn.SetInUse(true);
                        return Task.FromResult(conn);
                    }
                }
                System.Threading.Thread.Sleep(10);
            }

            throw new TimeoutException("Pool exhausted: wait timeout");
        }

        public void Release(PooledConnection conn)
        {
            conn.SetInUse(false);
            lock (_lock)
            {
                _available.Push(conn);
            }
        }

        public void Dispose()
        {
            IsDisposed = true;
            foreach (var conn in _allConnections)
            {
                conn.Connection?.Dispose();
            }
            _available.Clear();
        }
    }

    #endregion
}
