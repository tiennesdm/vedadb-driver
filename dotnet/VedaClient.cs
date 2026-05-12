using System;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace VedaDB;

/// <summary>
/// Event arguments for VedaDB connection events.
/// </summary>
public class VedaEventArgs : EventArgs
{
    /// <summary>Host of the connected server.</summary>
    public string Host { get; set; } = "";
    /// <summary>Port of the connected server.</summary>
    public int Port { get; set; }
    /// <summary>Timestamp of the event.</summary>
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Event arguments for VedaDB error events.
/// </summary>
public class VedaErrorEventArgs : EventArgs
{
    /// <summary>The exception that occurred.</summary>
    public Exception Exception { get; set; } = null!;
    /// <summary>The SQL command being executed when the error occurred.</summary>
    public string? Command { get; set; }
    /// <summary>Timestamp of the error.</summary>
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Event arguments for VedaDB query events.
/// </summary>
public class VedaQueryEventArgs : EventArgs
{
    /// <summary>The SQL command that was executed.</summary>
    public string Command { get; set; } = "";
    /// <summary>Parameters used in the query.</summary>
    public object[] Parameters { get; set; } = Array.Empty<object>();
    /// <summary>Duration of the query.</summary>
    public TimeSpan Duration { get; set; }
    /// <summary>Number of rows returned or affected.</summary>
    public int RowCount { get; set; }
    /// <summary>Whether the query was successful.</summary>
    public bool IsSuccess { get; set; }
    /// <summary>Timestamp of the query.</summary>
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Core VedaDB .NET client driver.
/// Supports TLS encryption, authentication, connection pooling, retries,
/// circuit breaker, query caching, and all 20 production features.
/// </summary>
public class VedaClient : IDisposable, IAsyncDisposable
{
    private readonly VedaProtocol _protocol;
    private readonly VedaConfig _config;
    private readonly VedaRetryPolicy? _retryPolicy;
    private readonly VedaCircuitBreaker? _circuitBreaker;
    private readonly VedaQueryCache? _queryCache;
    private readonly VedaInterceptorPipeline _interceptors = new();
    private bool _disposed;
    private bool _connected;

    /// <summary>Host of the connected server.</summary>
    public string? LastHost => _protocol?.Host;
    /// <summary>Port of the connected server.</summary>
    public int LastPort => _protocol?.Port ?? 0;
    /// <summary>Whether the client is connected.</summary>
    public bool IsConnected => _connected && _protocol?.IsConnected == true;
    /// <summary>Whether TLS is active.</summary>
    public bool IsTls => _protocol?.IsTls ?? false;
    /// <summary>Whether the client is authenticated.</summary>
    public bool IsAuthenticated => _protocol?.IsAuthenticated ?? false;
    /// <summary>The underlying protocol handler.</summary>
    internal VedaProtocol Protocol => _protocol;
    /// <summary>The circuit breaker instance (if configured).</summary>
    public VedaCircuitBreaker? CircuitBreaker => _circuitBreaker;
    /// <summary>The query cache instance (if configured).</summary>
    public VedaQueryCache? QueryCache => _queryCache;
    /// <summary>The retry policy instance (if configured).</summary>
    public VedaRetryPolicy? RetryPolicy => _retryPolicy;
    /// <summary>The interceptor pipeline.</summary>
    public VedaInterceptorPipeline Interceptors => _interceptors;

    /// <summary>Raised when the client connects to a server.</summary>
    public event EventHandler<VedaEventArgs>? Connected;
    /// <summary>Raised when an error occurs.</summary>
    public event EventHandler<VedaErrorEventArgs>? Error;
    /// <summary>Raised when a query is executed.</summary>
    public event EventHandler<VedaQueryEventArgs>? QueryExecuted;

    /// <summary>Create a client with the specified configuration.</summary>
    public VedaClient(VedaConfig config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _protocol = new VedaProtocol(config.Host, config.Port, config.TimeoutMs);

        if (config.Retry != null)
            _retryPolicy = new VedaRetryPolicy(config.Retry);
        if (config.CircuitBreaker != null)
            _circuitBreaker = new VedaCircuitBreaker(config.CircuitBreaker);
        if (config.Cache != null)
            _queryCache = new VedaQueryCache(config.Cache);
    }

    /// <summary>Create a client with a connection string.</summary>
    public VedaClient(string host = "localhost", int port = 6380, int timeoutMs = 30000,
        bool useTls = false, string? username = null, string? password = null,
        bool validateCertificate = true)
    {
        _config = new VedaConfig
        {
            Host = host,
            Port = port,
            TimeoutMs = timeoutMs,
            Username = username,
            Password = password,
            Tls = useTls ? VedaTlsConfig.EnabledConfig() : VedaTlsConfig.DisabledConfig()
        };
        if (_config.Tls != null)
            _config.Tls.ValidateCertificate = validateCertificate;

        _protocol = new VedaProtocol(host, port, timeoutMs);
    }

    /// <summary>Connect to the server.</summary>
    public async Task ConnectAsync(CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);

        await _protocol.ConnectAsync(ct);
        _connected = true;

        if (_config.Tls?.Enabled == true)
            await _protocol.UpgradeToTlsAsync(_config.Host, _config.Tls.ValidateCertificate, ct);

        // SECURE: Enforce TLS when authentication is used (HIGH-008 fix)
        if (!string.IsNullOrEmpty(_config.Username) && (_config.Tls == null || !_config.Tls.Enabled))
            throw new VedaConnectionException("Authentication requires TLS. Enable TLS or use an encrypted connection.");

        if (!string.IsNullOrEmpty(_config.Username))
            await _protocol.AuthenticateAsync(_config.Username!, _config.Password, ct);

        Connected?.Invoke(this, new VedaEventArgs { Host = _config.Host, Port = _config.Port });
        VedaMetrics.Increment("vedadb_connections_total", 1, new() { { "host", _config.Host } });
    }

    /// <summary>Connect synchronously.</summary>
    public void Connect() => ConnectAsync().GetAwaiter().GetResult();

    /// <summary>Connect to a VedaDB server from a URI string.</summary>
    public static async Task<VedaClient> ConnectAsync(string uri)
    {
        var config = VedaUriParser.ParseToConfig(uri);
        var client = new VedaClient(config);
        await client.ConnectAsync();
        return client;
    }

    /// <summary>Create a client from a URI string (without connecting).</summary>
    public static VedaClient FromURI(string uri)
    {
        var config = VedaUriParser.ParseToConfig(uri);
        return new VedaClient(config);
    }

    /// <summary>Execute a SQL query and return the result set.</summary>
    public async Task<VedaResult> QueryAsync(string sql, params object[] parameters)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        EnsureConnected();

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var boundSql = parameters.Length > 0 ? BindParameters(sql, parameters) : sql;

        if (_queryCache != null)
        {
            var cached = _queryCache.Get(boundSql, parameters);
            if (cached != null) return cached;
        }

        var context = new VedaInterceptorContext { Command = boundSql, Parameters = parameters, Operation = "query" };

        try
        {
            VedaResult result;

            if (_circuitBreaker != null && _retryPolicy != null)
            {
                result = await _circuitBreaker.ExecuteAsync(
                    () => _interceptors.ExecuteAsync(context,
                        _ => _retryPolicy.ExecuteAsync(() => _protocol.SendAsync(boundSql), CancellationToken.None), CancellationToken.None));
            }
            else if (_circuitBreaker != null)
            {
                result = await _circuitBreaker.ExecuteAsync(
                    () => _interceptors.ExecuteAsync(context,
                        _ => _protocol.SendAsync(boundSql), CancellationToken.None));
            }
            else if (_retryPolicy != null)
            {
                result = await _interceptors.ExecuteAsync(context,
                    _ => _retryPolicy.ExecuteAsync(() => _protocol.SendAsync(boundSql), CancellationToken.None), default);
            }
            else
            {
                result = await _interceptors.ExecuteAsync(context,
                    _ => _protocol.SendAsync(boundSql), default);
            }

            sw.Stop();
            _queryCache?.Set(boundSql, result, parameters);

            QueryExecuted?.Invoke(this, new VedaQueryEventArgs { Command = boundSql, Parameters = parameters, Duration = sw.Elapsed, RowCount = result.RowCount, IsSuccess = true });
            VedaMetrics.Histogram("vedadb_query_duration_seconds", sw.Elapsed.TotalSeconds);
            VedaMetrics.Increment("vedadb_queries_total", 1, new() { { "operation", "query" } });

            return result;
        }
        catch (Exception ex)
        {
            sw.Stop();
            Error?.Invoke(this, new VedaErrorEventArgs { Exception = ex, Command = boundSql });
            VedaMetrics.Increment("vedadb_query_errors", 1, new() { { "operation", "query" } });
            throw;
        }
    }

    /// <summary>Execute a non-query command (INSERT/UPDATE/DELETE/DDL). Returns the number of affected rows.</summary>
    public async Task<int> ExecuteAsync(string sql, params object[] parameters)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        EnsureConnected();

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var boundSql = parameters.Length > 0 ? BindParameters(sql, parameters) : sql;
        var context = new VedaInterceptorContext { Command = boundSql, Parameters = parameters, Operation = "execute" };

        try
        {
            var result = await _interceptors.ExecuteAsync(context, _ => _protocol.SendAsync(boundSql), default);
            sw.Stop();
            QueryExecuted?.Invoke(this, new VedaQueryEventArgs { Command = boundSql, Parameters = parameters, Duration = sw.Elapsed, RowCount = result.RowCount, IsSuccess = true });
            VedaMetrics.Increment("vedadb_queries_total", 1, new() { { "operation", "execute" } });
            _queryCache?.InvalidatePattern(boundSql);
            return result.RowCount;
        }
        catch (Exception ex)
        {
            Error?.Invoke(this, new VedaErrorEventArgs { Exception = ex, Command = boundSql });
            VedaMetrics.Increment("vedadb_query_errors", 1, new() { { "operation", "execute" } });
            throw;
        }
    }

    /// <summary>Execute a query synchronously.</summary>
    public VedaResult Query(string sql, params object[] parameters) => QueryAsync(sql, parameters).GetAwaiter().GetResult();

    /// <summary>Ping the server to check connectivity.</summary>
    public async Task PingAsync()
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        if (!_connected) throw new VedaConnectionException("Not connected");
        await _protocol.SendAsync("SELECT 1;");
    }

    /// <summary>Close the connection gracefully.</summary>
    public async Task CloseAsync()
    {
        if (_disposed) return;
        await _protocol.CloseAsync();
        _connected = false;
    }

    /// <summary>Create a command pipeline for batching operations.</summary>
    public VedaPipeline CreatePipeline() => new VedaPipeline(this);

    /// <summary>Create a bulk inserter for the specified table.</summary>
    public VedaBulkInserter CreateBulkInserter(string table, int batchSize = 1000) => new VedaBulkInserter(this, table, batchSize);

    /// <summary>Create a streaming cursor for large result sets.</summary>
    public VedaCursor CreateCursor(string sql, params object[] parameters) => new VedaCursor(this, sql, parameters);

    /// <summary>Create a Pub/Sub messaging instance.</summary>
    public VedaPubSub CreatePubSub() => new VedaPubSub(this);

    /// <summary>Watch a table for changes, returning an async enumerable of change events.</summary>
    public IAsyncEnumerable<VedaChangeEvent> WatchAsync(string table) => new VedaChangeStream(this, table);

    /// <summary>Create a fluent query builder for a table.</summary>
    public VedaQueryBuilder Table(string name) => new VedaQueryBuilder(this, name);

    /// <summary>Insert a row into a table.</summary>
    public async Task<int> InsertAsync(string table, Dictionary<string, object?> data)
    {
        // SECURE: Validate identifiers to prevent SQL injection (HIGH-005 fix)
        ValidateIdentifier(table, "table");
        foreach (var key in data.Keys)
            ValidateIdentifier(key, "column");
        var cols = string.Join(", ", data.Keys);
        var vals = string.Join(", ", data.Values.Select(FormatValue));
        return await ExecuteAsync($"INSERT INTO {table} ({cols}) VALUES ({vals});");
    }

    /// <summary>Select rows from a table.</summary>
    public async Task<VedaResult> SelectAsync(string table, string columns = "*",
        string? where = null, string? orderBy = null, int limit = 0)
    {
        // SECURE: Validate identifiers to prevent SQL injection (HIGH-005 fix)
        ValidateIdentifier(table, "table");
        var sql = $"SELECT {columns} FROM {table}";
        if (!string.IsNullOrEmpty(where)) sql += $" WHERE {where}";
        if (!string.IsNullOrEmpty(orderBy)) sql += $" ORDER BY {orderBy}";
        if (limit > 0) sql += $" LIMIT {limit}";
        return await QueryAsync(sql + ";");
    }

    /// <summary>Update rows in a table.</summary>
    public async Task<int> UpdateAsync(string table, Dictionary<string, object?> set, string? where = null)
    {
        // SECURE: Validate identifiers to prevent SQL injection (HIGH-005 fix)
        ValidateIdentifier(table, "table");
        foreach (var key in set.Keys)
            ValidateIdentifier(key, "column");
        var setClause = string.Join(", ", set.Select(kv => $"{kv.Key} = {FormatValue(kv.Value)}"));
        var sql = $"UPDATE {table} SET {setClause}";
        if (!string.IsNullOrEmpty(where)) sql += $" WHERE {where}";
        return await ExecuteAsync(sql + ";");
    }

    /// <summary>Delete rows from a table.</summary>
    public async Task<int> DeleteAsync(string table, string? where = null)
    {
        // SECURE: Validate identifiers to prevent SQL injection (HIGH-005 fix)
        ValidateIdentifier(table, "table");
        var sql = $"DELETE FROM {table}";
        if (!string.IsNullOrEmpty(where)) sql += $" WHERE {where}";
        return await ExecuteAsync(sql + ";");
    }

    /// <summary>Begin a transaction.</summary>
    public Task BeginAsync() => ExecuteAsync("BEGIN");
    /// <summary>Commit the current transaction.</summary>
    public Task CommitAsync() => ExecuteAsync("COMMIT");
    /// <summary>Rollback the current transaction.</summary>
    public Task RollbackAsync() => ExecuteAsync("ROLLBACK");

    /// <summary>Execute a function inside a transaction.</summary>
    public async Task<T> TransactionAsync<T>(Func<VedaClient, Task<T>> fn)
    {
        await BeginAsync();
        try { var r = await fn(this); await CommitAsync(); return r; }
        catch { await RollbackAsync(); throw; }
    }

    /// <summary>Prepare a named statement on the server.</summary>
    public async Task<VedaResult> PrepareAsync(string name, string query)
        => await QueryAsync($"PREPARE {name} AS {query}");

    /// <summary>Execute a prepared statement.</summary>
    public async Task<VedaResult> ExecutePreparedAsync(string name, params string[] parameters)
    {
        ValidatePreparedArgs(parameters);
        var paramList = string.Join(", ", parameters.Select(p => FormatValue(p)));
        return await QueryAsync($"EXECUTE {name} ({paramList})");
    }

    /// <summary>Set a cache key with TTL.</summary>
    public async Task CacheSetAsync(string key, string value, int ttlSeconds)
        => await ExecuteAsync($"CACHE SET {key} '{value.Replace("'", "''")}' TTL {ttlSeconds}");

    /// <summary>Get a cached value.</summary>
    public async Task<string?> CacheGetAsync(string key) => (await QueryAsync($"CACHE GET {key}")).Scalar();

    /// <summary>Delete a cached value.</summary>
    public async Task CacheDelAsync(string key) => await ExecuteAsync($"CACHE DEL {key}");

    /// <summary>Perform a fuzzy search on a table.</summary>
    public async Task<VedaResult> SearchAsync(string table, string query, int fuzzy = 0)
        => await QueryAsync($"SEARCH {table} '{query.Replace("'", "''")}' FUZZY {fuzzy}");

    /// <summary>Add a node to the graph.</summary>
    public async Task GraphAddNodeAsync(string id, string label)
        => await ExecuteAsync($"GRAPH ADD NODE '{id.Replace("'", "''")}' LABEL '{label.Replace("'", "''")}'");

    /// <summary>Perform a breadth-first search on the graph.</summary>
    public async Task<VedaResult> GraphBFSAsync(string start, int depth)
        => await QueryAsync($"GRAPH BFS '{start.Replace("'", "''")}' DEPTH {depth}");

    /// <summary>List all tables.</summary>
    public async Task<List<string>> ShowTablesAsync()
    {
        var result = await QueryAsync("SHOW TABLES;");
        return result.Rows?.Select(r => r[0].ToString() ?? "").Where(s => !string.IsNullOrEmpty(s)).ToList() ?? new();
    }

    /// <summary>Reconnect to the server with backoff.</summary>
    public async Task ReconnectAsync(int maxRetries = 3)
    {
        for (int i = 0; i < maxRetries; i++)
        {
            try
            {
                _connected = false;
                await _protocol.ReconnectAsync(CancellationToken.None);
                if (_config.Tls?.Enabled == true)
                    await _protocol.UpgradeToTlsAsync(_config.Host, _config.Tls.ValidateCertificate);
                if (!string.IsNullOrEmpty(_config.Username))
                    await _protocol.AuthenticateAsync(_config.Username!, _config.Password);
                _connected = true;
                Connected?.Invoke(this, new VedaEventArgs { Host = _config.Host, Port = _config.Port });
                return;
            }
            catch { if (i < maxRetries - 1) await Task.Delay((i + 1) * 1000); }
        }
        throw new VedaConnectionException($"Reconnect failed after {maxRetries} attempts");
    }

    private void EnsureConnected()
    {
        if (!_connected) throw new VedaConnectionException("Not connected. Call ConnectAsync() first.");
    }

    private static string BindParameters(string sql, object[] parameters)
    {
        var result = sql;
        for (int i = 0; i < parameters.Length; i++)
        {
            var ph = $"@{i}";
            if (result.Contains(ph)) result = result.Replace(ph, FormatValue(parameters[i]));
        }
        return result;
    }

    // SECURE: SQL identifier validation to prevent injection (HIGH-005 fix)
    private static readonly Regex _validIdentifier = new Regex("^[a-zA-Z_][a-zA-Z0-9_]*$", RegexOptions.Compiled);

    internal static void ValidateIdentifier(string ident, string label)
    {
        if (string.IsNullOrEmpty(ident) || !_validIdentifier.IsMatch(ident))
            throw new VedaException($"Invalid {label}: \"{ident}\". Only alphanumeric and underscores allowed.");
    }

    internal static string FormatValue(object? value) => value switch
    {
        null => "NULL",
        string s => $"'{s.Replace("'", "''")}'",
        bool b => b ? "TRUE" : "FALSE",
        DateTime dt => $"'{dt:yyyy-MM-dd HH:mm:ss}'",
        Guid g => $"'{g}'",
        byte[] bytes => $"X'{Convert.ToHexString(bytes)}'",
        _ => value.ToString() ?? "NULL"
    };

    internal static void ValidatePreparedArgs(string[] parameters)
    {
        for (int i = 0; i < parameters.Length; i++)
            if (parameters[i] != null && parameters[i].IndexOf('\0') >= 0)
                throw new VedaException($"vedadb: prepared arg {i} contains NUL byte");
    }

    /// <summary>Dispose the client and release all resources.</summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _protocol.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Dispose the client asynchronously.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _protocol.DisposeAsync();
        GC.SuppressFinalize(this);
    }
}
