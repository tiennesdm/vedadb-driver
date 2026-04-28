using System.Net.Sockets;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

namespace VedaDB;

/// <summary>
/// VedaDB .NET client driver.
/// Supports TLS encryption via STARTTLS, AUTH authentication,
/// and server-side prepared statements.
/// </summary>
/// <example>
/// using var db = new VedaClient("localhost", 6380);
/// var result = await db.QueryAsync("SELECT * FROM users;");
/// foreach (var row in result.ToDicts())
///     Console.WriteLine(row["name"]);
///
/// // With TLS and auth:
/// using var secureDb = new VedaClient("localhost", 6380, useTls: true, username: "admin", password: "secret");
/// </example>
public class VedaClient : IDisposable, IAsyncDisposable
{
    private TcpClient _tcp;
    private StreamReader _reader;
    private StreamWriter _writer;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private bool _disposed;
    private Stream _stream;
    private readonly string _host;
    private readonly int _port;
    private readonly int _timeoutMs;
    private readonly bool _useTls;
    private readonly string? _username;
    private readonly string? _password;
    private readonly bool _validateCertificate;

    /// <summary>
    /// Whether this connection is using TLS encryption.
    /// </summary>
    public bool IsTls { get; private set; }

    /// <summary>
    /// Connect to a VedaDB server with optional TLS and authentication.
    /// </summary>
    /// <param name="host">Server hostname (default: localhost)</param>
    /// <param name="port">Server port (default: 6380)</param>
    /// <param name="timeoutMs">Socket timeout in milliseconds (default: 30000)</param>
    /// <param name="useTls">If true, perform STARTTLS upgrade</param>
    /// <param name="username">Username for AUTH (null to skip)</param>
    /// <param name="password">Password for AUTH (null to skip)</param>
    /// <param name="validateCertificate">If false, skip TLS certificate validation (dev only)</param>
    public VedaClient(string host = "localhost", int port = 6380, int timeoutMs = 30000,
        bool useTls = false, string? username = null, string? password = null,
        bool validateCertificate = true)
    {
        _host = host;
        _port = port;
        _timeoutMs = timeoutMs;
        _useTls = useTls;
        _username = username;
        _password = password;
        _validateCertificate = validateCertificate;

        _tcp = new TcpClient();
        _tcp.SendTimeout = timeoutMs;
        _tcp.ReceiveTimeout = timeoutMs;
        _tcp.Connect(host, port);

        _stream = _tcp.GetStream();
        _reader = new StreamReader(_stream);
        _writer = new StreamWriter(_stream) { AutoFlush = true };

        // Read and discard welcome banner
        _reader.ReadLine();

        // STARTTLS upgrade
        if (useTls)
        {
            UpgradeToTls(host, validateCertificate);
        }

        // AUTH
        if (!string.IsNullOrEmpty(username))
        {
            Authenticate(username, password ?? "");
        }
    }

    /// <summary>
    /// Perform STARTTLS handshake and upgrade the connection to TLS.
    /// </summary>
    private void UpgradeToTls(string host, bool validateCertificate)
    {
        // Send STARTTLS command
        _writer.WriteLine("STARTTLS");

        // Read server response
        var response = _reader.ReadLine()
            ?? throw new VedaConnectionException("Connection closed during STARTTLS");

        // Check for error
        if (response.Contains("\"error\""))
        {
            throw new VedaConnectionException($"STARTTLS failed: {response}");
        }

        // Create SslStream wrapping the network stream
        RemoteCertificateValidationCallback? certCallback = null;
        if (!validateCertificate)
        {
            certCallback = (sender, certificate, chain, sslPolicyErrors) => true;
        }

        var sslStream = new SslStream(_tcp.GetStream(), leaveInnerStreamOpen: false, certCallback);
        sslStream.AuthenticateAsClient(host);

        // Replace stream and reader/writer
        _stream = sslStream;
        _reader = new StreamReader(_stream);
        _writer = new StreamWriter(_stream) { AutoFlush = true };
        IsTls = true;
    }

    /// <summary>
    /// Authenticate with the server using AUTH command.
    /// </summary>
    private void Authenticate(string username, string password)
    {
        _writer.WriteLine($"AUTH {username} {password}");

        var response = _reader.ReadLine()
            ?? throw new VedaConnectionException("Connection closed during AUTH");

        if (response.Contains("\"error\""))
        {
            throw new VedaConnectionException($"Authentication failed: {response}");
        }
    }

    /// <summary>
    /// Execute a query and return the result.
    /// </summary>
    public async Task<VedaResult> QueryAsync(string sql)
    {
        await _lock.WaitAsync();
        try
        {
            await _writer.WriteLineAsync(sql);

            var response = await _reader.ReadLineAsync()
                ?? throw new VedaConnectionException("Connection closed");

            return VedaResult.Parse(response);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Execute a query synchronously.
    /// </summary>
    public VedaResult Query(string sql)
    {
        _lock.Wait();
        try
        {
            _writer.WriteLine(sql);

            var response = _reader.ReadLine()
                ?? throw new VedaConnectionException("Connection closed");

            return VedaResult.Parse(response);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Execute a DDL/DML statement, returns the status message.
    /// </summary>
    public async Task<string> ExecAsync(string sql)
    {
        var result = await QueryAsync(sql);
        return result.Message ?? $"{result.RowCount} rows";
    }

    /// <summary>
    /// Execute a DDL/DML statement synchronously.
    /// </summary>
    public string Exec(string sql)
    {
        var result = Query(sql);
        return result.Message ?? $"{result.RowCount} rows";
    }

    /// <summary>
    /// Prepare a named statement on the server.
    /// </summary>
    /// <param name="name">Statement name</param>
    /// <param name="query">SQL query to prepare</param>
    public async Task<VedaResult> PrepareAsync(string name, string query)
    {
        return await QueryAsync($"PREPARE {name} AS {query}");
    }

    /// <summary>
    /// Execute a previously prepared statement with parameter values.
    /// </summary>
    /// <param name="name">Statement name</param>
    /// <param name="parameters">Parameter values</param>
    public async Task<VedaResult> ExecutePreparedAsync(string name, params string[] parameters)
    {
        var paramList = string.Join(", ", parameters.Select(p => FormatValue(p)));
        return await QueryAsync($"EXECUTE {name} ({paramList})");
    }

    /// <summary>
    /// Deallocate (remove) a previously prepared statement from the server.
    /// </summary>
    /// <param name="name">Statement name</param>
    public async Task<VedaResult> DeallocateAsync(string name)
    {
        return await QueryAsync($"DEALLOCATE {name}");
    }

    /// <summary>
    /// Prepare a named statement on the server (synchronous).
    /// </summary>
    public VedaResult Prepare(string name, string query)
    {
        return Query($"PREPARE {name} AS {query}");
    }

    /// <summary>
    /// Execute a previously prepared statement (synchronous).
    /// </summary>
    public VedaResult ExecutePrepared(string name, params string[] parameters)
    {
        var paramList = string.Join(", ", parameters.Select(p => FormatValue(p)));
        return Query($"EXECUTE {name} ({paramList})");
    }

    /// <summary>
    /// Deallocate a previously prepared statement (synchronous).
    /// </summary>
    public VedaResult Deallocate(string name)
    {
        return Query($"DEALLOCATE {name}");
    }

    /// <summary>
    /// Insert a row into a table.
    /// </summary>
    public async Task<string> InsertAsync(string table, Dictionary<string, object?> data)
    {
        var cols = string.Join(", ", data.Keys);
        var vals = string.Join(", ", data.Values.Select(FormatValue));
        return await ExecAsync($"INSERT INTO {table} ({cols}) VALUES ({vals});");
    }

    /// <summary>
    /// Select rows from a table.
    /// </summary>
    public async Task<VedaResult> SelectAsync(string table, string columns = "*",
        string? where = null, string? orderBy = null, int limit = 0)
    {
        var sql = $"SELECT {columns} FROM {table}";
        if (!string.IsNullOrEmpty(where)) sql += $" WHERE {where}";
        if (!string.IsNullOrEmpty(orderBy)) sql += $" ORDER BY {orderBy}";
        if (limit > 0) sql += $" LIMIT {limit}";
        return await QueryAsync(sql + ";");
    }

    /// <summary>
    /// Update rows in a table.
    /// </summary>
    public async Task<string> UpdateAsync(string table, Dictionary<string, object?> set, string? where = null)
    {
        var setClause = string.Join(", ", set.Select(kv => $"{kv.Key} = {FormatValue(kv.Value)}"));
        var sql = $"UPDATE {table} SET {setClause}";
        if (!string.IsNullOrEmpty(where)) sql += $" WHERE {where}";
        return await ExecAsync(sql + ";");
    }

    /// <summary>
    /// Delete rows from a table.
    /// </summary>
    public async Task<string> DeleteAsync(string table, string? where = null)
    {
        var sql = $"DELETE FROM {table}";
        if (!string.IsNullOrEmpty(where)) sql += $" WHERE {where}";
        return await ExecAsync(sql + ";");
    }

    /// <summary>
    /// List all tables.
    /// </summary>
    public async Task<List<string>> ShowTablesAsync()
    {
        var result = await QueryAsync("SHOW TABLES;");
        return result.Rows?.Select(r => r[0].ToString()).ToList() ?? new List<string>();
    }

    /// <summary>
    /// Health check.
    /// </summary>
    public async Task<bool> PingAsync()
    {
        try
        {
            await QueryAsync("SHOW TABLES;");
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Synchronous health check.
    /// </summary>
    public bool Ping()
    {
        try
        {
            Query("SHOW TABLES;");
            return true;
        }
        catch
        {
            return false;
        }
    }

    // ── Transactions ──────────────────────────────────────────────

    /// <summary>Begin a transaction.</summary>
    public void Begin() => Query("BEGIN");

    /// <summary>Commit the current transaction.</summary>
    public void Commit() => Query("COMMIT");

    /// <summary>Rollback the current transaction.</summary>
    public void Rollback() => Query("ROLLBACK");

    /// <summary>Begin a transaction (async).</summary>
    public async Task BeginAsync() => await QueryAsync("BEGIN");

    /// <summary>Commit the current transaction (async).</summary>
    public async Task CommitAsync() => await QueryAsync("COMMIT");

    /// <summary>Rollback the current transaction (async).</summary>
    public async Task RollbackAsync() => await QueryAsync("ROLLBACK");

    /// <summary>
    /// Execute a function inside a transaction. Commits on success, rolls back on failure.
    /// </summary>
    public async Task<T> TransactionAsync<T>(Func<VedaClient, Task<T>> fn)
    {
        await BeginAsync();
        try
        {
            var result = await fn(this);
            await CommitAsync();
            return result;
        }
        catch
        {
            await RollbackAsync();
            throw;
        }
    }

    // ── Auto-Reconnect ──────────────────────────────────────────

    /// <summary>
    /// Reconnect to the server with linear back-off (async).
    /// Tears down the existing socket/streams without disposing the
    /// instance lock (which is readonly) so the client stays usable.
    /// </summary>
    public async Task ReconnectAsync(int maxRetries = 3)
    {
        for (int i = 0; i < maxRetries; i++)
        {
            try
            {
                // Tear down old socket/streams. Do NOT call Dispose() —
                // that disposes _lock which is readonly and would leave
                // every subsequent QueryAsync throwing ObjectDisposedException.
                try { _writer?.WriteLine("QUIT"); } catch { }
                try { _reader?.Dispose(); } catch { }
                try { _writer?.Dispose(); } catch { }
                try { _tcp?.Dispose(); } catch { }

                _tcp = new TcpClient();
                _tcp.SendTimeout = _timeoutMs;
                _tcp.ReceiveTimeout = _timeoutMs;
                await _tcp.ConnectAsync(_host, _port);
                _stream = _tcp.GetStream();
                _reader = new StreamReader(_stream);
                _writer = new StreamWriter(_stream) { AutoFlush = true };
                _reader.ReadLine(); // welcome
                if (_useTls) UpgradeToTls(_host, _validateCertificate);
                if (!string.IsNullOrEmpty(_username)) Authenticate(_username!, _password ?? "");
                return;
            }
            catch
            {
                await Task.Delay((i + 1) * 1000);
            }
        }
        throw new VedaConnectionException("Reconnect failed after " + maxRetries + " attempts");
    }

    // ── Batch Insert ────────────────────────────────────────────

    /// <summary>Insert multiple rows in a single statement (async).</summary>
    public async Task<VedaResult> InsertManyAsync(string table, string[] columns, string[][] rows)
    {
        var sql = BuildInsertMany(table, columns, rows);
        return await QueryAsync(sql);
    }

    /// <summary>Insert multiple rows in a single statement (sync).</summary>
    public VedaResult InsertMany(string table, string[] columns, string[][] rows)
    {
        var sql = BuildInsertMany(table, columns, rows);
        return Query(sql);
    }

    private static string BuildInsertMany(string table, string[] columns, string[][] rows)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("INSERT INTO ").Append(table).Append(" (");
        sb.Append(string.Join(", ", columns)).Append(") VALUES ");
        for (int i = 0; i < rows.Length; i++)
        {
            if (i > 0) sb.Append(", ");
            sb.Append('(');
            for (int j = 0; j < rows[i].Length; j++)
            {
                if (j > 0) sb.Append(", ");
                sb.Append('\'').Append(rows[i][j].Replace("'", "''")).Append('\'');
            }
            sb.Append(')');
        }
        sb.Append(';');
        return sb.ToString();
    }

    // ── Cache ───────────────────────────────────────────────────

    /// <summary>Set a cache key with a TTL in seconds (async).</summary>
    public async Task CacheSetAsync(string key, string value, int ttl)
        => await ExecAsync($"CACHE SET {key} '{value.Replace("'", "''")}' TTL {ttl}");

    /// <summary>Set a cache key with a TTL in seconds (sync).</summary>
    public void CacheSet(string key, string value, int ttl)
        => Exec($"CACHE SET {key} '{value.Replace("'", "''")}' TTL {ttl}");

    /// <summary>Get the value for a cache key (async). Returns null if not found.</summary>
    public async Task<string?> CacheGetAsync(string key)
    {
        var result = await QueryAsync($"CACHE GET {key}");
        return result.Rows?.FirstOrDefault()?.FirstOrDefault()?.ToString();
    }

    /// <summary>Get the value for a cache key (sync). Returns null if not found.</summary>
    public string? CacheGet(string key)
    {
        var result = Query($"CACHE GET {key}");
        return result.Rows?.FirstOrDefault()?.FirstOrDefault()?.ToString();
    }

    /// <summary>Delete a cache key (async).</summary>
    public async Task CacheDelAsync(string key)
        => await ExecAsync($"CACHE DEL {key}");

    /// <summary>Delete a cache key (sync).</summary>
    public void CacheDel(string key)
        => Exec($"CACHE DEL {key}");

    // ── Search ──────────────────────────────────────────────────

    /// <summary>Perform a fuzzy search on a table (async).</summary>
    public async Task<VedaResult> SearchAsync(string table, string query, int fuzzy = 0)
        => await QueryAsync($"SEARCH {table} '{query.Replace("'", "''")}' FUZZY {fuzzy}");

    /// <summary>Perform a fuzzy search on a table (sync).</summary>
    public VedaResult Search(string table, string query, int fuzzy = 0)
        => Query($"SEARCH {table} '{query.Replace("'", "''")}' FUZZY {fuzzy}");

    // ── Graph ───────────────────────────────────────────────────

    /// <summary>Add a node to the graph (async).</summary>
    public async Task GraphAddNodeAsync(string id, string label)
        => await ExecAsync($"GRAPH ADD NODE '{id.Replace("'", "''")}' LABEL '{label.Replace("'", "''")}'");

    /// <summary>Add a node to the graph (sync).</summary>
    public void GraphAddNode(string id, string label)
        => Exec($"GRAPH ADD NODE '{id.Replace("'", "''")}' LABEL '{label.Replace("'", "''")}'");

    /// <summary>Perform a breadth-first search on the graph (async).</summary>
    public async Task<VedaResult> GraphBFSAsync(string start, int depth)
        => await QueryAsync($"GRAPH BFS '{start.Replace("'", "''")}' DEPTH {depth}");

    /// <summary>Perform a breadth-first search on the graph (sync).</summary>
    public VedaResult GraphBFS(string start, int depth)
        => Query($"GRAPH BFS '{start.Replace("'", "''")}' DEPTH {depth}");

    // SQL-standard single-quote doubling (`''`). Earlier revisions used
    // `\'` backslash escaping which VedaDB does not parse — turning every
    // `O'Brien` into a syntax error.
    private static string FormatValue(object? value) => value switch
    {
        null => "NULL",
        string s => $"'{s.Replace("'", "''")}'",
        bool b => b ? "TRUE" : "FALSE",
        _ => value.ToString() ?? "NULL"
    };

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _writer.WriteLine("QUIT"); } catch { }
        _reader.Dispose();
        _writer.Dispose();
        _tcp.Dispose();
        _lock.Dispose();
        GC.SuppressFinalize(this);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        try { await _writer.WriteLineAsync("QUIT"); } catch { }
        _reader.Dispose();
        await _writer.DisposeAsync();
        _tcp.Dispose();
        _lock.Dispose();
        GC.SuppressFinalize(this);
    }
}
