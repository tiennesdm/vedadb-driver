using System;

namespace VedaDB;

/// <summary>
/// A single command in a pipeline.
/// </summary>
public class VedaPipelineCommand
{
    /// <summary>
    /// SQL command text.
    /// </summary>
    public string Sql { get; set; } = "";

    /// <summary>
    /// Parameters for the command.
    /// </summary>
    public object[] Parameters { get; set; } = Array.Empty<object>();

    /// <summary>
    /// Whether this is a write operation.
    /// </summary>
    public bool IsWrite { get; set; }
}

/// <summary>
/// Pipeline execution result.
/// </summary>
public class VedaPipelineResult
{
    /// <summary>
    /// Results for each command in order.
    /// </summary>
    public List<VedaResult> Results { get; set; } = new();

    /// <summary>
    /// Any errors that occurred.
    /// </summary>
    public List<(int Index, string Error)> Errors { get; set; } = new();

    /// <summary>
    /// Total number of commands.
    /// </summary>
    public int CommandCount { get; set; }

    /// <summary>
    /// Number of successful commands.
    /// </summary>
    public int SuccessCount { get; set; }

    /// <summary>
    /// Whether all commands succeeded.
    /// </summary>
    public bool AllSucceeded => Errors.Count == 0;

    /// <summary>
    /// Total duration of the pipeline.
    /// </summary>
    public TimeSpan Duration { get; set; }
}

/// <summary>
/// Command pipeline for batching multiple VedaDB operations.
/// Reduces round-trips by sending commands together.
/// </summary>
public class VedaPipeline
{
    private readonly VedaClient _client;
    private readonly List<VedaPipelineCommand> _commands = new();
    private bool _isAtomic;

    /// <summary>
    /// Number of commands in the pipeline.
    /// </summary>
    public int Count => _commands.Count;

    /// <summary>
    /// Whether to execute as a transaction (all or nothing).
    /// </summary>
    public bool IsAtomic => _isAtomic;

    /// <summary>
    /// Create a pipeline.
    /// </summary>
    public VedaPipeline(VedaClient client)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
    }

    /// <summary>
    /// Add a query command to the pipeline.
    /// </summary>
    public VedaPipeline AddQuery(string sql, params object[] parameters)
    {
        _commands.Add(new VedaPipelineCommand
        {
            Sql = sql,
            Parameters = parameters,
            IsWrite = false
        });
        return this;
    }

    /// <summary>
    /// Add a write command (INSERT/UPDATE/DELETE) to the pipeline.
    /// </summary>
    public VedaPipeline AddExecute(string sql, params object[] parameters)
    {
        _commands.Add(new VedaPipelineCommand
        {
            Sql = sql,
            Parameters = parameters,
            IsWrite = true
        });
        return this;
    }

    /// <summary>
    /// Add an INSERT command.
    /// </summary>
    public VedaPipeline AddInsert(string table, Dictionary<string, object?> data)
    {
        var cols = string.Join(", ", data.Keys);
        var vals = string.Join(", ", data.Values.Select(FormatValue));
        return AddExecute($"INSERT INTO {table} ({cols}) VALUES ({vals});");
    }

    /// <summary>
    /// Add an UPDATE command.
    /// </summary>
    public VedaPipeline AddUpdate(string table, Dictionary<string, object?> set, string? where = null)
    {
        var setClause = string.Join(", ", set.Select(kv => $"{kv.Key} = {FormatValue(kv.Value)}"));
        var sql = $"UPDATE {table} SET {setClause}";
        if (!string.IsNullOrEmpty(where)) sql += $" WHERE {where}";
        return AddExecute(sql + ";");
    }

    /// <summary>
    /// Add a DELETE command.
    /// </summary>
    public VedaPipeline AddDelete(string table, string? where = null)
    {
        var sql = $"DELETE FROM {table}";
        if (!string.IsNullOrEmpty(where)) sql += $" WHERE {where}";
        return AddExecute(sql + ";");
    }

    /// <summary>
    /// Mark this pipeline as atomic (transactional).
    /// </summary>
    public VedaPipeline Atomic()
    {
        _isAtomic = true;
        return this;
    }

    /// <summary>
    /// Clear all commands from the pipeline.
    /// </summary>
    public void Clear() => _commands.Clear();

    /// <summary>
    /// Execute all commands in the pipeline.
    /// </summary>
    public async Task<VedaPipelineResult> ExecuteAsync(CancellationToken ct = default)
    {
        if (_commands.Count == 0)
            return new VedaPipelineResult();

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var result = new VedaPipelineResult { CommandCount = _commands.Count };

        try
        {
            if (_isAtomic)
            {
                await _client.ExecuteAsync("BEGIN");
            }

            foreach (var (cmd, index) in _commands.Select((c, i) => (c, i)))
            {
                try
                {
                    var sql = cmd.Sql;
                    if (cmd.Parameters.Length > 0)
                        sql = BindParameters(sql, cmd.Parameters);

                    VedaResult cmdResult;
                    if (cmd.IsWrite)
                    {
                        var rowsAffected = await _client.ExecuteAsync(sql);
                        cmdResult = new VedaResult { Message = rowsAffected.ToString(), RowCount = rowsAffected };
                    }
                    else
                    {
                        cmdResult = await _client.QueryAsync(sql);
                    }

                    result.Results.Add(cmdResult);
                    result.SuccessCount++;
                }
                catch (Exception ex)
                {
                    result.Errors.Add((index, ex.Message));

                    if (_isAtomic)
                    {
                        await _client.ExecuteAsync("ROLLBACK");
                        sw.Stop();
                        result.Duration = sw.Elapsed;
                        return result;
                    }
                }
            }

            if (_isAtomic && result.AllSucceeded)
            {
                await _client.ExecuteAsync("COMMIT");
            }

            sw.Stop();
            result.Duration = sw.Elapsed;

            VedaMetrics.Increment("vedadb_pipeline_executions", 1,
                new() { { "atomic", _isAtomic.ToString() } });
            VedaMetrics.Histogram("vedadb_pipeline_duration", sw.Elapsed.TotalSeconds);
            VedaMetrics.Gauge("vedadb_pipeline_commands", _commands.Count);

            return result;
        }
        catch
        {
            if (_isAtomic)
            {
                try { await _client.ExecuteAsync("ROLLBACK"); } catch { /* Best effort */ }
            }
            throw;
        }
        finally
        {
            _commands.Clear();
        }
    }

    /// <summary>
    /// Execute and return results as a list.
    /// </summary>
    public async Task<List<VedaResult>> ExecuteAndGetResultsAsync(CancellationToken ct = default)
    {
        var pipelineResult = await ExecuteAsync(ct);
        return pipelineResult.Results;
    }

    private static string BindParameters(string sql, object[] parameters)
    {
        var result = sql;
        for (int i = 0; i < parameters.Length; i++)
        {
            result = result.Replace($"@{i}", FormatValue(parameters[i]));
        }
        return result;
    }

    private static string FormatValue(object? value) => value switch
    {
        null => "NULL",
        string s => $"'{s.Replace("'", "''")}'",
        bool b => b ? "TRUE" : "FALSE",
        DateTime dt => $"'{dt:yyyy-MM-dd HH:mm:ss}'",
        _ => value.ToString() ?? "NULL"
    };
}
