using System;
namespace VedaDB;

/// <summary>
/// Type of change event.
/// </summary>
public enum ChangeEventType
{
    /// <summary>A row was inserted.</summary>
    Insert,
    /// <summary>A row was updated.</summary>
    Update,
    /// <summary>A row was deleted.</summary>
    Delete,
    /// <summary>Table schema changed.</summary>
    Schema,
    /// <summary>Unknown change type.</summary>
    Unknown
}

/// <summary>
/// A change event from a watched table.
/// </summary>
public class VedaChangeEvent
{
    /// <summary>
    /// Type of change.
    /// </summary>
    public ChangeEventType Type { get; set; }

    /// <summary>
    /// Table name.
    /// </summary>
    public string Table { get; set; } = "";

    /// <summary>
    /// Changed row data.
    /// </summary>
    public Dictionary<string, string?>? Row { get; set; }

    /// <summary>
    /// Previous row data (for updates).
    /// </summary>
    public Dictionary<string, string?>? PreviousRow { get; set; }

    /// <summary>
    /// Timestamp of the change.
    /// </summary>
    public DateTime Timestamp { get; set; }

    /// <summary>
    /// Transaction ID if applicable.
    /// </summary>
    public string? TransactionId { get; set; }

    /// <summary>
    /// Position in the change stream.
    /// </summary>
    public long Position { get; set; }
}

/// <summary>
/// Configuration for change streams.
/// </summary>
public class VedaChangeStreamConfig
{
    /// <summary>
    /// Polling interval. Default is 1 second.
    /// </summary>
    public TimeSpan PollInterval { get; set; } = TimeSpan.FromSeconds(1);

    /// <summary>
    /// Maximum events to return per batch. Default is 100.
    /// </summary>
    public int BatchSize { get; set; } = 100;

    /// <summary>
    /// Event types to filter for. Empty means all types.
    /// </summary>
    public List<ChangeEventType>? FilterTypes { get; set; }

    /// <summary>
    /// Start from a specific position. 0 means from the beginning.
    /// </summary>
    public long StartPosition { get; set; }
}

/// <summary>
/// Change stream for watching table changes in real-time.
/// Implements IAsyncEnumerable for streaming consumption.
/// </summary>
public class VedaChangeStream : IAsyncEnumerable<VedaChangeEvent>, IDisposable
{
    private readonly VedaClient _client;
    private readonly string _table;
    private readonly VedaChangeStreamConfig _config;
    private bool _disposed;
    private long _lastPosition;

    /// <summary>
    /// Create a change stream.
    /// </summary>
    public VedaChangeStream(VedaClient client, string table, VedaChangeStreamConfig? config = null)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _table = table ?? throw new ArgumentNullException(nameof(table));
        _config = config ?? new VedaChangeStreamConfig();
        _lastPosition = _config.StartPosition;
    }

    /// <summary>
    /// Poll for changes once and return events.
    /// </summary>
    public async Task<List<VedaChangeEvent>> PollOnceAsync(CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);

        var result = await _client.QueryAsync(
            $"WATCH {_table} FROM {_lastPosition} LIMIT {_config.BatchSize}");

        var events = new List<VedaChangeEvent>();
        foreach (var dict in result.ToDicts())
        {
            var evt = ParseChangeEvent(dict);
            if (evt != null)
            {
                events.Add(evt);
                _lastPosition = evt.Position;
            }
        }

        if (events.Count > 0)
        {
            VedaMetrics.Increment("vedadb_changestream_events", events.Count,
                new() { { "table", _table } });
        }

        return events;
    }

    /// <summary>
    /// Get the IAsyncEnumerator for streaming changes.
    /// </summary>
    public IAsyncEnumerator<VedaChangeEvent> GetAsyncEnumerator(CancellationToken ct = default)
    {
        return new ChangeStreamEnumerator(this, ct);
    }

    private VedaChangeEvent? ParseChangeEvent(Dictionary<string, string?> dict)
    {
        try
        {
            var evt = new VedaChangeEvent
            {
                Table = _table,
                Timestamp = dict.TryGetValue("timestamp", out var ts) && DateTime.TryParse(ts, out var dt)
                    ? dt : DateTime.UtcNow,
                TransactionId = dict.GetValueOrDefault("txid")
            };

            if (dict.TryGetValue("type", out var typeStr))
            {
                evt.Type = typeStr?.ToLowerInvariant() switch
                {
                    "insert" => ChangeEventType.Insert,
                    "update" => ChangeEventType.Update,
                    "delete" => ChangeEventType.Delete,
                    "schema" => ChangeEventType.Schema,
                    _ => ChangeEventType.Unknown
                };
            }

            if (dict.TryGetValue("position", out var posStr) && long.TryParse(posStr, out var pos))
                evt.Position = pos;

            if (dict.TryGetValue("row", out var rowJson) && !string.IsNullOrEmpty(rowJson))
            {
                try
                {
                    evt.Row = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string?>>(rowJson);
                }
                catch { /* Best effort */ }
            }

            if (dict.TryGetValue("previous", out var prevJson) && !string.IsNullOrEmpty(prevJson))
            {
                try
                {
                    evt.PreviousRow = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string?>>(prevJson);
                }
                catch { /* Best effort */ }
            }

            if (_config.FilterTypes != null && _config.FilterTypes.Count > 0 && !_config.FilterTypes.Contains(evt.Type))
                return null;

            return evt;
        }
        catch
        {
            return null;
        }
    }

    private class ChangeStreamEnumerator : IAsyncEnumerator<VedaChangeEvent>
    {
        private readonly VedaChangeStream _stream;
        private readonly CancellationToken _ct;
        private Queue<VedaChangeEvent> _buffer = new();

        public ChangeStreamEnumerator(VedaChangeStream stream, CancellationToken ct)
        {
            _stream = stream;
            _ct = ct;
        }

        public VedaChangeEvent Current { get; private set; } = null!;

        public async ValueTask<bool> MoveNextAsync()
        {
            while (! _ct.IsCancellationRequested)
            {
                if (_buffer.Count > 0)
                {
                    Current = _buffer.Dequeue();
                    return true;
                }

                var events = await _stream.PollOnceAsync(_ct);
                foreach (var evt in events)
                    _buffer.Enqueue(evt);

                if (_buffer.Count == 0)
                {
                    try
                    {
                        await Task.Delay(_stream._config.PollInterval, _ct);
                    }
                    catch (OperationCanceledException) { break; }
                }
            }

            return false;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        GC.SuppressFinalize(this);
    }
}
