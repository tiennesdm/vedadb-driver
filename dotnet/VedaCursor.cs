using System;
namespace VedaDB;

/// <summary>
/// Streaming cursor for large result sets.
/// Fetches rows in batches to minimize memory usage.
/// </summary>
public class VedaCursor : IAsyncEnumerable<Dictionary<string, string?>>, IAsyncDisposable, IDisposable
{
    private readonly VedaClient _client;
    private readonly string _sql;
    private readonly object[] _parameters;
    private readonly int _batchSize;
    private VedaResult? _currentBatch;
    private int _currentRowIndex;
    private bool _disposed;
    private bool _finished;
    private int _totalRowsReturned;

    /// <summary>
    /// Total rows returned so far.
    /// </summary>
    public int TotalRowsReturned => _totalRowsReturned;

    /// <summary>
    /// Whether the cursor has finished reading.
    /// </summary>
    public bool IsFinished => _finished;

    /// <summary>
    /// Create a streaming cursor.
    /// </summary>
    /// <param name="client">VedaDB client.</param>
    /// <param name="sql">SQL query.</param>
    /// <param name="parameters">Query parameters.</param>
    /// <param name="batchSize">Number of rows to fetch per batch.</param>
    public VedaCursor(VedaClient client, string sql, object[] parameters, int batchSize = 100)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _sql = sql ?? throw new ArgumentNullException(nameof(sql));
        _parameters = parameters ?? Array.Empty<object>();
        _batchSize = batchSize;
    }

    /// <summary>
    /// Read the next batch of rows.
    /// </summary>
    public async Task<bool> ReadNextBatchAsync(CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);
        if (_finished) return false;

        var offset = _currentBatch?.Rows?.Count ?? 0;
        var sql = _sql;

        if (!_sql.Contains("LIMIT", StringComparison.OrdinalIgnoreCase))
        {
            sql = $"{_sql} LIMIT {_batchSize} OFFSET {offset}";
        }

        if (_parameters.Length > 0)
            sql = BindParameters(sql, _parameters);

        _currentBatch = await _client.QueryAsync(sql);
        _currentRowIndex = 0;

        if (_currentBatch.Rows == null || _currentBatch.Rows.Count == 0)
        {
            _finished = true;
            return false;
        }

        if (_currentBatch.Rows.Count < _batchSize)
        {
            _finished = true;
        }

        return true;
    }

    /// <summary>
    /// Read all remaining rows into a list.
    /// </summary>
    public async Task<List<Dictionary<string, string?>>> ReadAllAsync(CancellationToken ct = default)
    {
        var result = new List<Dictionary<string, string?>>();

        await foreach (var row in this.WithCancellation(ct))
        {
            result.Add(row);
        }

        return result;
    }

    /// <summary>
    /// Get the IAsyncEnumerator for streaming.
    /// </summary>
    public IAsyncEnumerator<Dictionary<string, string?>> GetAsyncEnumerator(CancellationToken ct = default)
    {
        return new CursorEnumerator(this, ct);
    }

    private class CursorEnumerator : IAsyncEnumerator<Dictionary<string, string?>>
    {
        private readonly VedaCursor _cursor;
        private readonly CancellationToken _ct;

        public CursorEnumerator(VedaCursor cursor, CancellationToken ct)
        {
            _cursor = cursor;
            _ct = ct;
        }

        public Dictionary<string, string?> Current { get; private set; } = new();

        public async ValueTask<bool> MoveNextAsync()
        {
            if (_cursor._disposed)
                return false;

            while (true)
            {
                if (_cursor._currentBatch?.Rows != null &&
                    _cursor._currentRowIndex < _cursor._currentBatch.Rows.Count)
                {
                    var row = _cursor._currentBatch.Rows[_cursor._currentRowIndex];
                    var columns = _cursor._currentBatch.Columns;
                    var dict = new Dictionary<string, string?>();

                    if (columns != null)
                    {
                        for (int i = 0; i < Math.Min(columns.Count, row.Count); i++)
                        {
                            dict[columns[i]] = row[i].ValueKind == System.Text.Json.JsonValueKind.Null
                                ? null : row[i].ToString();
                        }
                    }

                    Current = dict;
                    _cursor._currentRowIndex++;
                    _cursor._totalRowsReturned++;
                    return true;
                }

                if (!await _cursor.ReadNextBatchAsync(_ct))
                    return false;
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
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
        _ => value.ToString() ?? "NULL"
    };

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    public async ValueTask DisposeAsync()
    {
        Dispose();
    }
}
