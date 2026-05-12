using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Xunit;

namespace VedaDB.Tests
{
    /// <summary>
    /// Core driver tests for VedaDB .NET client
    /// </summary>
    public class VedaClientTests : IDisposable
    {
        private readonly MockTransport _transport;
        private readonly VedaClient _client;

        public VedaClientTests()
        {
            _transport = new MockTransport();
            _client = new VedaClient("http://localhost:8080", _transport);
        }

        public void Dispose()
        {
            _client?.Dispose();
        }

        #region Connection Tests

        [Fact]
        public void Should_Construct_With_Defaults()
        {
            var client = new VedaClient("http://localhost:8080");
            Assert.Equal("http://localhost:8080", client.Endpoint);
            Assert.Equal(10000, client.Timeout);
            Assert.Equal(3, client.MaxRetries);
        }

        [Fact]
        public void Should_Configure_With_Options()
        {
            var client = new VedaClient("http://db:9999", options =>
            {
                options.Timeout = 5000;
                options.MaxRetries = 5;
                options.RetryDelayMs = 50;
            });

            Assert.Equal(5000, client.Timeout);
            Assert.Equal(5, client.MaxRetries);
            Assert.Equal(50, client.RetryDelayMs);
        }

        [Fact]
        public void Should_Set_Auth_Token()
        {
            var client = new VedaClient("http://localhost:8080", options =>
            {
                options.AuthToken = "test-token-123";
            });

            Assert.Equal("test-token-123", client.AuthToken);
        }

        #endregion

        #region Query Tests

        [Fact]
        public async Task Should_Query_Single_Row()
        {
            _transport.AddResponse(200, new Dictionary<string, object>
            {
                ["result"] = new List<Dictionary<string, object>>
                {
                    new Dictionary<string, object> { ["id"] = 1, ["name"] = "Alice" }
                }
            });

            var results = await _client.QueryAsync("SELECT * FROM users WHERE id = @p0", 1);

            Assert.Single(results);
            Assert.Equal("Alice", results[0]["name"]);
        }

        [Fact]
        public async Task Should_Query_Multiple_Rows()
        {
            _transport.AddResponse(200, new Dictionary<string, object>
            {
                ["result"] = new List<Dictionary<string, object>>
                {
                    new Dictionary<string, object> { ["id"] = 1, ["name"] = "Alice" },
                    new Dictionary<string, object> { ["id"] = 2, ["name"] = "Bob" },
                    new Dictionary<string, object> { ["id"] = 3, ["name"] = "Charlie" }
                }
            });

            var results = await _client.QueryAsync("SELECT * FROM users");

            Assert.Equal(3, results.Count);
        }

        [Fact]
        public async Task Should_Handle_Empty_Result()
        {
            _transport.AddResponse(200, new Dictionary<string, object>
            {
                ["result"] = new List<Dictionary<string, object>>()
            });

            var results = await _client.QueryAsync("SELECT * FROM empty_table");

            Assert.Empty(results);
        }

        [Fact]
        public async Task Should_Throw_On_Server_Error()
        {
            _transport.AddResponse(500, new Dictionary<string, object>
            {
                ["error"] = "database error"
            });

            await Assert.ThrowsAsync<VedaClientException>(() =>
                _client.QueryAsync("SELECT * FROM users"));
        }

        [Fact]
        public async Task Should_Retry_On_Transient_Failure()
        {
            _transport.SetFailureSequence(2, 503);
            _transport.AddResponse(200, new Dictionary<string, object>
            {
                ["result"] = new List<Dictionary<string, object>>
                {
                    new Dictionary<string, object> { ["id"] = 1, ["name"] = "Alice" }
                }
            });

            var results = await _client.QueryAsync("SELECT * FROM users");

            Assert.Single(results);
            Assert.True(_transport.RequestCount >= 3);
        }

        [Fact]
        public async Task Should_Parse_Application_Error()
        {
            _transport.AddResponse(200, new Dictionary<string, object>
            {
                ["error"] = "syntax error at position 14"
            });

            var ex = await Assert.ThrowsAsync<VedaClientException>(() =>
                _client.QueryAsync("INVALID SQL"));

            Assert.Contains("syntax error", ex.Message);
        }

        #endregion

        #region Execute Tests

        [Fact]
        public async Task Should_Execute_Insert()
        {
            _transport.AddResponse(200, new Dictionary<string, object>
            {
                ["result"] = new Dictionary<string, object>
                {
                    ["rowsAffected"] = 1,
                    ["lastInsertId"] = 42L
                }
            });

            var result = await _client.ExecuteAsync(
                "INSERT INTO users (name, age) VALUES (@p0, @p1)", "Alice", 30);

            Assert.Equal(1, result.RowsAffected);
            Assert.Equal(42L, result.LastInsertId);
        }

        [Fact]
        public async Task Should_Execute_Update()
        {
            _transport.AddResponse(200, new Dictionary<string, object>
            {
                ["result"] = new Dictionary<string, object> { ["rowsAffected"] = 5 }
            });

            var result = await _client.ExecuteAsync(
                "UPDATE users SET active = @p0 WHERE last_login < @p1", false, "2023-01-01");

            Assert.Equal(5, result.RowsAffected);
        }

        [Fact]
        public async Task Should_Execute_Delete()
        {
            _transport.AddResponse(200, new Dictionary<string, object>
            {
                ["result"] = new Dictionary<string, object> { ["rowsAffected"] = 1 }
            });

            var result = await _client.ExecuteAsync(
                "DELETE FROM users WHERE id = @p0", 99);

            Assert.Equal(1, result.RowsAffected);
        }

        #endregion

        #region Close Tests

        [Fact]
        public void Should_Close_Client()
        {
            _client.Dispose();
            Assert.True(_client.IsDisposed);
        }

        [Fact]
        public void Close_Should_Be_Idempotent()
        {
            _client.Dispose();
            _client.Dispose(); // Should not throw
            Assert.True(_client.IsDisposed);
        }

        [Fact]
        public async Task Should_Throw_When_Querying_Closed_Client()
        {
            _client.Dispose();
            await Assert.ThrowsAsync<ObjectDisposedException>(() =>
                _client.QueryAsync("SELECT 1"));
        }

        #endregion
    }

    #region Test Support Classes

    /// <summary>
    /// Mock transport for testing
    /// </summary>
    public class MockTransport : ITransport
    {
        private readonly Queue<(int statusCode, Dictionary<string, object> body)> _responses = new();
        private int _failureCount = 0;
        private int _failureThreshold = 0;

        public int RequestCount { get; private set; } = 0;
        public Dictionary<string, object> LastRequest { get; private set; }

        public void AddResponse(int statusCode, Dictionary<string, object> body)
        {
            _responses.Enqueue((statusCode, body));
        }

        public void SetFailureSequence(int count, int statusCode)
        {
            _failureThreshold = count;
            _failureCount = count;
            for (int i = 0; i < count; i++)
            {
                _responses.Enqueue((statusCode, new Dictionary<string, object> { ["error"] = "temporary error" }));
            }
        }

        public Task<TransportResponse> SendAsync(Dictionary<string, object> request)
        {
            RequestCount++;
            LastRequest = request;

            if (_responses.Count > 0)
            {
                var (code, body) = _responses.Dequeue();
                return Task.FromResult(new TransportResponse(code, body));
            }

            return Task.FromResult(new TransportResponse(200, new Dictionary<string, object> { ["result"] = null }));
        }
    }

    public interface ITransport
    {
        Task<TransportResponse> SendAsync(Dictionary<string, object> request);
    }

    public class TransportResponse
    {
        public int StatusCode { get; }
        public Dictionary<string, object> Body { get; }

        public TransportResponse(int statusCode, Dictionary<string, object> body)
        {
            StatusCode = statusCode;
            Body = body;
        }
    }

    /// <summary>
    /// VedaClient implementation for tests
    /// </summary>
    public class VedaClient : IDisposable
    {
        public string Endpoint { get; }
        public int Timeout { get; set; } = 10000;
        public int MaxRetries { get; set; } = 3;
        public int RetryDelayMs { get; set; } = 100;
        public string AuthToken { get; set; }
        public bool IsDisposed { get; private set; }

        private readonly ITransport _transport;

        public VedaClient(string endpoint, ITransport transport = null)
        {
            Endpoint = endpoint;
            _transport = transport ?? new MockTransport();
        }

        public VedaClient(string endpoint, Action<VedaClientOptions> configure)
        {
            Endpoint = endpoint;
            var options = new VedaClientOptions();
            configure(options);
            Timeout = options.Timeout;
            MaxRetries = options.MaxRetries;
            RetryDelayMs = options.RetryDelayMs;
            AuthToken = options.AuthToken;
        }

        public async Task<List<Dictionary<string, object>>> QueryAsync(string sql, params object[] parameters)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(VedaClient));

            var request = new Dictionary<string, object>
            {
                ["sql"] = sql,
                ["params"] = parameters.ToList()
            };

            var response = await SendWithRetryAsync(request);
            if (response.Body.ContainsKey("error") && response.Body["error"] != null)
            {
                throw new VedaClientException(response.Body["error"].ToString());
            }

            return response.Body.ContainsKey("result")
                ? (List<Dictionary<string, object>>)response.Body["result"]
                : new List<Dictionary<string, object>>();
        }

        public async Task<ExecuteResult> ExecuteAsync(string sql, params object[] parameters)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(VedaClient));

            var request = new Dictionary<string, object>
            {
                ["sql"] = sql,
                ["params"] = parameters.ToList()
            };

            var response = await SendWithRetryAsync(request);
            if (response.Body.ContainsKey("error") && response.Body["error"] != null)
            {
                throw new VedaClientException(response.Body["error"].ToString());
            }

            var result = response.Body.ContainsKey("result")
                ? (Dictionary<string, object>)response.Body["result"]
                : new Dictionary<string, object>();

            return new ExecuteResult(
                Convert.ToInt32(result.GetValueOrDefault("rowsAffected", 0)),
                Convert.ToInt64(result.GetValueOrDefault("lastInsertId", 0L))
            );
        }

        private async Task<TransportResponse> SendWithRetryAsync(Dictionary<string, object> request)
        {
            Exception lastError = null;
            var delay = RetryDelayMs;

            for (int i = 0; i <= MaxRetries; i++)
            {
                if (i > 0)
                {
                    await Task.Delay(delay);
                    delay = Math.Min(delay * 2, 5000);
                }

                var response = await _transport.SendAsync(request);
                if (response.StatusCode >= 500 && response.StatusCode < 600)
                {
                    lastError = new VedaClientException($"HTTP {response.StatusCode}");
                    continue;
                }
                return response;
            }

            throw lastError ?? new VedaClientException("Request failed");
        }

        public void Dispose()
        {
            IsDisposed = true;
        }
    }

    public class VedaClientOptions
    {
        public int Timeout { get; set; } = 10000;
        public int MaxRetries { get; set; } = 3;
        public int RetryDelayMs { get; set; } = 100;
        public string AuthToken { get; set; }
    }

    public class ExecuteResult
    {
        public int RowsAffected { get; }
        public long LastInsertId { get; }

        public ExecuteResult(int rowsAffected, long lastInsertId)
        {
            RowsAffected = rowsAffected;
            LastInsertId = lastInsertId;
        }
    }

    public class VedaClientException : Exception
    {
        public VedaClientException(string message) : base(message) { }
    }

    #endregion
}
