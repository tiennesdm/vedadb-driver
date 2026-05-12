using System;
namespace VedaDB;

/// <summary>
/// Bulk insert operation result.
/// </summary>
public class VedaBulkResult
{
    /// <summary>
    /// Total number of rows inserted.
    /// </summary>
    public int TotalInserted { get; set; }

    /// <summary>
    /// Number of batches processed.
    /// </summary>
    public int BatchCount { get; set; }

    /// <summary>
    /// Number of rows in the final partial batch (0 if none).
    /// </summary>
    public int PendingCount { get; set; }

    /// <summary>
    /// Total duration of the operation.
    /// </summary>
    public TimeSpan Duration { get; set; }

    /// <summary>
    /// Any errors encountered.
    /// </summary>
    public List<string> Errors { get; set; } = new();

    /// <summary>
    /// Whether the operation was successful.
    /// </summary>
    public bool IsSuccess => Errors.Count == 0;
}

/// <summary>
/// High-performance bulk inserter for VedaDB.
/// Buffers rows and flushes in configurable batch sizes.
/// </summary>
public class VedaBulkInserter : IDisposable, IAsyncDisposable
{
    private readonly VedaClient _client;
    private readonly string _table;
    private readonly string[] _columns;
    private readonly int _batchSize;
    private readonly List<Dictionary<string, object?>> _buffer = new();
    private bool _disposed;
    private int _totalInserted;
    private int _batchCount;
    private readonly List<string> _errors = new();

    /// <summary>
    /// Total rows inserted so far.
    /// </summary>
    public int TotalInserted => _totalInserted;

    /// <summary>
    /// Current buffer size.
    /// </summary>
    public int BufferSize => _buffer.Count;

    /// <summary>
    /// Number of batches flushed.
    /// </summary>
    public int BatchCount => _batchCount;

    /// <summary>
    /// Whether there are pending rows in the buffer.
    /// </summary>
    public bool HasPendingRows => _buffer.Count > 0;

    /// <summary>
    /// Create a bulk inserter.
    /// </summary>
    public VedaBulkInserter(VedaClient client, string table, string[] columns, int batchSize = 1000)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _table = table ?? throw new ArgumentNullException(nameof(table));
        _columns = columns ?? throw new ArgumentNullException(nameof(columns));
        _batchSize = batchSize;
    }

    /// <summary>
    /// Create a bulk inserter with columns inferred from the first row.
    /// </summary>
    public VedaBulkInserter(VedaClient client, string table, int batchSize = 1000)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _table = table ?? throw new ArgumentNullException(nameof(table));
        _columns = Array.Empty<string>();
        _batchSize = batchSize;
    }

    /// <summary>
    /// Add a row to the buffer. Flushes if buffer reaches batch size.
    /// </summary>
    public async Task AddAsync(Dictionary<string, object?> row, CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);

        if (_columns.Length == 0 && _buffer.Count == 0)
        {
            // Infer columns from first row
            var inferred = row.Keys.ToArray();
            typeof(VedaBulkInserter).GetField("_columns", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                ?.SetValue(this, inferred);
        }

        _buffer.Add(row);

        if (_buffer.Count >= _batchSize)
        {
            await FlushAsync(ct);
        }
    }

    /// <summary>
    /// Add a row from an anonymous object or typed object.
    /// </summary>
    public async Task AddAsync(object row, CancellationToken ct = default)
    {
        var dict = new Dictionary<string, object?>();
        foreach (var prop in row.GetType().GetProperties())
        {
            dict[prop.Name] = prop.GetValue(row);
        }
        await AddAsync(dict, ct);
    }

    /// <summary>
    /// Add multiple rows at once.
    /// </summary>
    public async Task AddRangeAsync(IEnumerable<Dictionary<string, object?>> rows, CancellationToken ct = default)
    {
        foreach (var row in rows)
        {
            await AddAsync(row, ct);
        }
    }

    /// <summary>
    /// Flush the current buffer to the database.
    /// </summary>
    public async Task<VedaResult> FlushAsync(CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        if (_buffer.Count == 0) return new VedaResult();

        var sw = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            var columns = _columns.Length > 0 ? _columns : _buffer[0].Keys.ToArray();
            var sql = BuildInsertSql(columns, _buffer);

            var result = await _client.QueryAsync(sql);

            _totalInserted += _buffer.Count;
            _batchCount++;
            _buffer.Clear();

            sw.Stop();
            VedaMetrics.Increment("vedadb_bulk_inserts", 1,
                new() { { "table", _table } });
            VedaMetrics.Histogram("vedadb_bulk_insert_duration", sw.Elapsed.TotalSeconds);

            return result;
        }
        catch (Exception ex)
        {
            _errors.Add(ex.Message);
            VedaMetrics.Increment("vedadb_bulk_insert_errors", 1,
                new() { { "table", _table }, { "error", ex.GetType().Name } });
            throw new VedaBulkInsertException($"Bulk insert failed for table '{_table}': {ex.Message}")
            {
                FailedBatchIndices = new List<int> { _batchCount }
            };
        }
    }

    /// <summary>
    /// Execute the entire bulk insert, flushing all pending rows.
    /// </summary>
    public async Task<VedaBulkResult> ExecuteAsync(CancellationToken ct = default)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        if (_buffer.Count > 0)
        {
            await FlushAsync(ct);
        }

        sw.Stop();

        return new VedaBulkResult
        {
            TotalInserted = _totalInserted,
            BatchCount = _batchCount,
            Duration = sw.Elapsed,
            Errors = new List<string>(_errors)
        };
    }

    private string BuildInsertSql(string[] columns, List<Dictionary<string, object?>> rows)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("INSERT INTO ").Append(_table).Append(" (");
        sb.Append(string.Join(", ", columns)).Append(") VALUES ");

        for (int i = 0; i < rows.Count; i++)
        {
            if (i > 0) sb.Append(", ");
            sb.Append('(');
            for (int j = 0; j < columns.Length; j++)
            {
                if (j > 0) sb.Append(", ");
                var value = rows[i].TryGetValue(columns[j], out var v) ? v : null;
                sb.Append(FormatValue(value));
            }
            sb.Append(')');
        }
        sb.Append(';');
        return sb.ToString();
    }

    private static string FormatValue(object? value) => value switch
    {
        null => "NULL",
        string s => $"'{s.Replace("'", "''")}'",
        bool b => b ? "TRUE" : "FALSE",
        DateTime dt => $"'{dt:yyyy-MM-dd HH:mm:ss}'",
        Guid g => $"'{g}'",
        _ => value.ToString() ?? "NULL"
    };

    /// <summary>
    /// Flush any remaining rows and dispose.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        try
        {
            if (_buffer.Count > 0)
                await FlushAsync();
        }
        catch { /* Best effort */ }

        GC.SuppressFinalize(this);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try
        {
            if (_buffer.Count > 0)
                FlushAsync().GetAwaiter().GetResult();
        }
        catch { /* Best effort */ }

        GC.SuppressFinalize(this);
    }
}
