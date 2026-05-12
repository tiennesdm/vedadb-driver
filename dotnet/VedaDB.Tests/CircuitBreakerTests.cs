using System;
using System.Threading.Tasks;
using Xunit;

namespace VedaDB.Tests
{
    /// <summary>
    /// Circuit breaker tests for VedaDB .NET client
    /// </summary>
    public class CircuitBreakerTests
    {
        #region Closed State Tests

        [Fact]
        public void Should_Start_Closed()
        {
            var cb = new CircuitBreaker(5, 3, TimeSpan.FromSeconds(30));
            Assert.Equal(CircuitBreakerState.Closed, cb.State);
        }

        [Fact]
        public void Should_Allow_Requests_When_Closed()
        {
            var cb = new CircuitBreaker(5, 3, TimeSpan.FromSeconds(30));
            Assert.True(cb.Allow());
        }

        [Fact]
        public async Task Should_Execute_Successfully_When_Closed()
        {
            var cb = new CircuitBreaker(5, 3, TimeSpan.FromSeconds(30));
            var result = await cb.ExecuteAsync(() => Task.FromResult("success"));
            Assert.Equal("success", result);
        }

        [Fact]
        public void Should_Reset_Failure_Count_On_Success()
        {
            var cb = new CircuitBreaker(5, 3, TimeSpan.FromSeconds(30));
            cb.RecordFailure();
            cb.RecordFailure();
            cb.RecordSuccess();
            Assert.Equal(CircuitBreakerState.Closed, cb.State);
        }

        #endregion

        #region Open State Tests

        [Fact]
        public void Should_Open_After_Failure_Threshold()
        {
            var cb = new CircuitBreaker(3, 1, TimeSpan.FromMinutes(1));
            cb.RecordFailure();
            cb.RecordFailure();
            Assert.Equal(CircuitBreakerState.Closed, cb.State);
            cb.RecordFailure();
            Assert.Equal(CircuitBreakerState.Open, cb.State);
        }

        [Fact]
        public void Should_Reject_When_Open()
        {
            var cb = new CircuitBreaker(1, 1, TimeSpan.FromMinutes(1));
            cb.RecordFailure();
            Assert.False(cb.Allow());
        }

        [Fact]
        public async Task Should_Throw_When_Executing_While_Open()
        {
            var cb = new CircuitBreaker(1, 1, TimeSpan.FromMinutes(1));
            cb.RecordFailure();
            await Assert.ThrowsAsync<CircuitBreakerOpenException>(() =>
                cb.ExecuteAsync(() => Task.FromResult("should not run")));
        }

        [Fact]
        public void Should_Be_Exact_At_Threshold()
        {
            var cb = new CircuitBreaker(3, 1, TimeSpan.FromMinutes(1));
            cb.RecordFailure();
            cb.RecordFailure();
            Assert.Equal(CircuitBreakerState.Closed, cb.State);
            cb.RecordFailure();
            Assert.Equal(CircuitBreakerState.Open, cb.State);
        }

        #endregion

        #region Half-Open State Tests

        [Fact]
        public void Should_Transition_To_Half_Open_After_Timeout()
        {
            var cb = new CircuitBreaker(1, 1, TimeSpan.FromMilliseconds(50));
            cb.RecordFailure();
            Assert.Equal(CircuitBreakerState.Open, cb.State);
            System.Threading.Thread.Sleep(100);
            Assert.True(cb.Allow());
            Assert.Equal(CircuitBreakerState.HalfOpen, cb.State);
        }

        [Fact]
        public void Should_Close_After_Success_In_Half_Open()
        {
            var cb = new CircuitBreaker(5, 1, TimeSpan.FromMilliseconds(50));
            cb.RecordFailure();
            System.Threading.Thread.Sleep(100);
            cb.Allow();
            cb.RecordSuccess();
            Assert.Equal(CircuitBreakerState.Closed, cb.State);
        }

        [Fact]
        public void Should_Reopen_After_Failure_In_Half_Open()
        {
            var cb = new CircuitBreaker(5, 1, TimeSpan.FromMilliseconds(50));
            cb.RecordFailure();
            System.Threading.Thread.Sleep(100);
            cb.Allow();
            cb.RecordFailure();
            Assert.Equal(CircuitBreakerState.Open, cb.State);
        }

        [Fact]
        public void Should_Require_Multiple_Successes_To_Close()
        {
            var cb = new CircuitBreaker(5, 3, TimeSpan.FromMilliseconds(50));
            cb.RecordFailure();

            // First success
            System.Threading.Thread.Sleep(100);
            cb.Allow(); cb.RecordSuccess();
            Assert.Equal(CircuitBreakerState.HalfOpen, cb.State);

            // Second success
            System.Threading.Thread.Sleep(100);
            cb.Allow(); cb.RecordSuccess();
            Assert.Equal(CircuitBreakerState.HalfOpen, cb.State);

            // Third success should close
            System.Threading.Thread.Sleep(100);
            cb.Allow(); cb.RecordSuccess();
            Assert.Equal(CircuitBreakerState.Closed, cb.State);
        }

        #endregion

        #region Recovery Tests

        [Fact]
        public void Should_Complete_Full_Recovery_Cycle()
        {
            var cb = new CircuitBreaker(2, 1, TimeSpan.FromMilliseconds(50));

            // Start closed
            Assert.Equal(CircuitBreakerState.Closed, cb.State);

            // Failures open circuit
            cb.RecordFailure();
            cb.RecordFailure();
            Assert.Equal(CircuitBreakerState.Open, cb.State);

            // Wait for half-open
            System.Threading.Thread.Sleep(100);
            Assert.True(cb.Allow());
            Assert.Equal(CircuitBreakerState.HalfOpen, cb.State);

            // Success closes
            cb.RecordSuccess();
            Assert.Equal(CircuitBreakerState.Closed, cb.State);
        }

        #endregion

        #region Reset Tests

        [Fact]
        public void Should_Reset_Manually()
        {
            var cb = new CircuitBreaker(1, 1, TimeSpan.FromMinutes(1));
            cb.RecordFailure();
            Assert.Equal(CircuitBreakerState.Open, cb.State);
            cb.Reset();
            Assert.Equal(CircuitBreakerState.Closed, cb.State);
            Assert.True(cb.Allow());
        }

        #endregion

        #region Event Tests

        [Fact]
        public void Should_Raise_State_Changed_Event()
        {
            var cb = new CircuitBreaker(1, 1, TimeSpan.FromMinutes(1));
            CircuitBreakerState? newState = null;
            cb.StateChanged += (s, e) => newState = e.NewState;

            cb.RecordFailure();
            Assert.NotNull(newState);
            Assert.Equal(CircuitBreakerState.Open, newState);
        }

        #endregion

        #region Concurrency Tests

        [Fact]
        public void Should_Handle_Concurrent_Failures()
        {
            var cb = new CircuitBreaker(100, 1, TimeSpan.FromMinutes(1));
            Parallel.For(0, 50, _ => cb.RecordFailure());
            Assert.Equal(CircuitBreakerState.Open, cb.State);
        }

        #endregion
    }

    #region Implementation

    public enum CircuitBreakerState { Closed, Open, HalfOpen }

    public class CircuitBreaker
    {
        private readonly int _failureThreshold;
        private readonly int _successThreshold;
        private readonly TimeSpan _timeout;
        private CircuitBreakerState _state = CircuitBreakerState.Closed;
        private int _failureCount;
        private int _successCount;
        private DateTime _lastFailureTime;
        private int _halfOpenCalls;
        private readonly int _halfOpenMax = 1;
        private readonly object _lock = new object();

        public event EventHandler<StateChangedEventArgs> StateChanged;

        public CircuitBreaker(int failureThreshold, int successThreshold, TimeSpan timeout)
        {
            _failureThreshold = failureThreshold;
            _successThreshold = successThreshold;
            _timeout = timeout;
        }

        public CircuitBreakerState State
        {
            get { lock (_lock) { return _state; } }
        }

        public bool Allow()
        {
            lock (_lock)
            {
                if (_state == CircuitBreakerState.Closed) return true;
                if (_state == CircuitBreakerState.Open)
                {
                    if (DateTime.UtcNow - _lastFailureTime > _timeout)
                    {
                        _state = CircuitBreakerState.HalfOpen;
                        _halfOpenCalls = 0;
                        _successCount = 0;
                        OnStateChanged(CircuitBreakerState.HalfOpen);
                        return true;
                    }
                    return false;
                }
                if (_halfOpenCalls < _halfOpenMax)
                {
                    _halfOpenCalls++;
                    return true;
                }
                return false;
            }
        }

        public void RecordSuccess()
        {
            lock (_lock)
            {
                if (_state == CircuitBreakerState.HalfOpen)
                {
                    _successCount++;
                    if (_successCount >= _successThreshold)
                    {
                        _state = CircuitBreakerState.Closed;
                        _failureCount = 0;
                        _halfOpenCalls = 0;
                        OnStateChanged(CircuitBreakerState.Closed);
                    }
                }
                else if (_state == CircuitBreakerState.Closed)
                {
                    _failureCount = 0;
                }
            }
        }

        public void RecordFailure()
        {
            lock (_lock)
            {
                _lastFailureTime = DateTime.UtcNow;
                if (_state == CircuitBreakerState.HalfOpen)
                {
                    _state = CircuitBreakerState.Open;
                    _halfOpenCalls = 0;
                    OnStateChanged(CircuitBreakerState.Open);
                    return;
                }
                _failureCount++;
                if (_failureCount >= _failureThreshold)
                {
                    _state = CircuitBreakerState.Open;
                    OnStateChanged(CircuitBreakerState.Open);
                }
            }
        }

        public async Task<T> ExecuteAsync<T>(Func<Task<T>> fn)
        {
            if (!Allow()) throw new CircuitBreakerOpenException("Circuit breaker is OPEN");
            try
            {
                var result = await fn();
                RecordSuccess();
                return result;
            }
            catch
            {
                RecordFailure();
                throw;
            }
        }

        public void Reset()
        {
            lock (_lock)
            {
                _state = CircuitBreakerState.Closed;
                _failureCount = 0;
                _successCount = 0;
                _halfOpenCalls = 0;
                OnStateChanged(CircuitBreakerState.Closed);
            }
        }

        private void OnStateChanged(CircuitBreakerState newState)
        {
            StateChanged?.Invoke(this, new StateChangedEventArgs(newState));
        }
    }

    public class StateChangedEventArgs : EventArgs
    {
        public CircuitBreakerState NewState { get; }
        public StateChangedEventArgs(CircuitBreakerState newState) { NewState = newState; }
    }

    public class CircuitBreakerOpenException : Exception
    {
        public CircuitBreakerOpenException(string message) : base(message) { }
    }

    #endregion
}
