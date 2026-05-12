using System;
using System.Threading.Tasks;
using Xunit;

namespace VedaDB.Tests
{
    /// <summary>
    /// Retry policy tests for VedaDB .NET client
    /// </summary>
    public class RetryPolicyTests
    {
        #region Success Tests

        [Fact]
        public async Task Should_Succeed_On_First_Attempt()
        {
            var policy = new RetryPolicy(3, TimeSpan.FromMilliseconds(10), TimeSpan.FromSeconds(5), 2.0);
            var callCount = 0;

            var result = await policy.ExecuteAsync(() =>
            {
                callCount++;
                return Task.FromResult("success");
            });

            Assert.Equal("success", result);
            Assert.Equal(1, callCount);
        }

        [Fact]
        public async Task Should_Retry_And_Succeed()
        {
            var policy = new RetryPolicy(5, TimeSpan.FromMilliseconds(10), TimeSpan.FromSeconds(5), 2.0);
            var callCount = 0;

            var result = await policy.ExecuteAsync(() =>
            {
                callCount++;
                if (callCount < 3)
                    throw new TransientException("Temporary failure");
                return Task.FromResult("success");
            });

            Assert.Equal("success", result);
            Assert.Equal(3, callCount);
        }

        #endregion

        #region Exhaustion Tests

        [Fact]
        public async Task Should_Exhaust_Retries()
        {
            var policy = new RetryPolicy(2, TimeSpan.FromMilliseconds(1), TimeSpan.FromSeconds(1), 2.0);
            var callCount = 0;

            var ex = await Assert.ThrowsAsync<RetryExhaustedException>(() =>
                policy.ExecuteAsync(() =>
                {
                    callCount++;
                    throw new TransientException("Persistent failure");
                }));

            Assert.Contains("exhausted", ex.Message);
            Assert.Equal(3, callCount); // initial + 2 retries
        }

        [Fact]
        public async Task Should_Not_Retry_NonRetryable_Exception()
        {
            var policy = new RetryPolicy(5, TimeSpan.FromMilliseconds(10), TimeSpan.FromSeconds(5), 2.0);
            var callCount = 0;

            await Assert.ThrowsAsync<ArgumentException>(() =>
                policy.ExecuteAsync(() =>
                {
                    callCount++;
                    throw new ArgumentException("Fatal error");
                }));

            Assert.Equal(1, callCount);
        }

        #endregion

        #region Backoff Tests

        [Fact]
        public async Task Should_Use_Exponential_Backoff()
        {
            var policy = new RetryPolicy(3, TimeSpan.FromMilliseconds(50), TimeSpan.FromSeconds(1), 2.0);
            var delays = new System.Collections.Generic.List<TimeSpan>();
            var callCount = 0;

            policy.OnRetry += (delay) => delays.Add(delay);

            try
            {
                await policy.ExecuteAsync(() =>
                {
                    callCount++;
                    throw new TransientException("fail");
                });
            }
            catch (RetryExhaustedException) { /* expected */ }

            // Verify exponential pattern
            Assert.True(delays.Count >= 2);
            Assert.True(delays[1] > delays[0], "Second delay should be greater than first");
        }

        [Fact]
        public async Task Should_Cap_Delay_At_Max()
        {
            var policy = new RetryPolicy(5, TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(150), 10.0);
            var callCount = 0;

            var start = DateTime.UtcNow;
            try
            {
                await policy.ExecuteAsync(() =>
                {
                    callCount++;
                    throw new TransientException("fail");
                });
            }
            catch (RetryExhaustedException) { /* expected */ }
            var elapsed = DateTime.UtcNow - start;

            // Should complete quickly due to cap
            Assert.True(elapsed < TimeSpan.FromSeconds(2), $"Expected under 2s, got {elapsed.TotalSeconds}s");
        }

        #endregion

        #region Status Code Tests

        [Fact]
        public async Task Should_Retry_On_5xx()
        {
            var policy = new RetryPolicy(3, TimeSpan.FromMilliseconds(1), TimeSpan.FromSeconds(1), 2.0);
            var callCount = 0;

            var result = await policy.ExecuteAsync(() =>
            {
                callCount++;
                if (callCount < 2)
                    throw new HttpStatusCodeException(503, "Service Unavailable");
                return Task.FromResult("success");
            });

            Assert.Equal("success", result);
            Assert.Equal(2, callCount);
        }

        [Fact]
        public async Task Should_Not_Retry_On_4xx()
        {
            var policy = new RetryPolicy(5, TimeSpan.FromMilliseconds(1), TimeSpan.FromSeconds(1), 2.0);
            var callCount = 0;

            await Assert.ThrowsAsync<HttpStatusCodeException>(() =>
                policy.ExecuteAsync(() =>
                {
                    callCount++;
                    throw new HttpStatusCodeException(400, "Bad Request");
                }));

            Assert.Equal(1, callCount);
        }

        #endregion

        #region Edge Cases

        [Fact]
        public async Task Should_Work_With_Zero_Retries()
        {
            var policy = new RetryPolicy(0, TimeSpan.Zero, TimeSpan.FromSeconds(1), 1.0);
            var callCount = 0;

            var result = await policy.ExecuteAsync(() =>
            {
                callCount++;
                return Task.FromResult("ok");
            });

            Assert.Equal("ok", result);
            Assert.Equal(1, callCount);
        }

        [Fact]
        public async Task Should_Fail_Fast_With_Zero_Retries()
        {
            var policy = new RetryPolicy(0, TimeSpan.FromMilliseconds(1), TimeSpan.FromSeconds(1), 1.0);

            await Assert.ThrowsAsync<RetryExhaustedException>(() =>
                policy.ExecuteAsync(() =>
                    throw new TransientException("fail")));
        }

        [Theory]
        [InlineData(1)]
        [InlineData(2)]
        [InlineData(3)]
        [InlineData(5)]
        public async Task Should_Configurable_MaxRetries(int maxRetries)
        {
            var policy = new RetryPolicy(maxRetries, TimeSpan.FromMilliseconds(1), TimeSpan.FromSeconds(1), 1.0);
            var callCount = 0;

            try
            {
                await policy.ExecuteAsync(() =>
                {
                    callCount++;
                    throw new TransientException("fail");
                });
            }
            catch (RetryExhaustedException) { /* expected */ }

            Assert.Equal(maxRetries + 1, callCount);
        }

        #endregion
    }

    #region Retry Policy Implementation

    public class RetryPolicy
    {
        private readonly int _maxRetries;
        private readonly TimeSpan _baseDelay;
        private readonly TimeSpan _maxDelay;
        private readonly double _multiplier;

        public event Action<TimeSpan> OnRetry;

        public RetryPolicy(int maxRetries, TimeSpan baseDelay, TimeSpan maxDelay, double multiplier)
        {
            _maxRetries = maxRetries;
            _baseDelay = baseDelay;
            _maxDelay = maxDelay;
            _multiplier = multiplier;
        }

        public async Task<T> ExecuteAsync<T>(Func<Task<T>> operation)
        {
            var delay = _baseDelay;
            Exception lastError = null;

            for (int attempt = 0; attempt <= _maxRetries; attempt++)
            {
                if (attempt > 0)
                {
                    OnRetry?.Invoke(delay);
                    await Task.Delay(delay);
                    delay = TimeSpan.FromMilliseconds(
                        Math.Min(delay.TotalMilliseconds * _multiplier, _maxDelay.TotalMilliseconds));
                }

                try
                {
                    return await operation();
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    if (!IsRetryable(ex))
                        throw;
                }
            }

            throw new RetryExhaustedException($"Retry exhausted after {_maxRetries} attempts", lastError);
        }

        private bool IsRetryable(Exception ex)
        {
            if (ex is TransientException) return true;
            if (ex is HttpStatusCodeException hse && hse.StatusCode >= 500) return true;
            return false;
        }
    }

    public class TransientException : Exception
    {
        public TransientException(string message) : base(message) { }
    }

    public class RetryExhaustedException : Exception
    {
        public RetryExhaustedException(string message) : base(message) { }
        public RetryExhaustedException(string message, Exception inner) : base(message, inner) { }
    }

    public class HttpStatusCodeException : Exception
    {
        public int StatusCode { get; }
        public HttpStatusCodeException(int statusCode, string message) : base(message)
        {
            StatusCode = statusCode;
        }
    }

    #endregion
}
