using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace VedaDB
{
    /// <summary>
    /// ChangeStream subscribes to table changes (CDC) from VedaDB.
    /// Supports filtering by operation type and resuming from checkpoint.
    /// </summary>
    public class ChangeStream : IDisposable
    {
        private readonly VedaClient _client;
        private readonly ChangeStreamConfig _config;
        private readonly BlockingQueue<ChangeEvent> _events;
        private readonly BlockingQueue<Exception> _errors;
        private long _lastLSN;
        private volatile bool _active;
        private Thread _worker;
        private readonly List<Action<ChangeEvent>> _listeners;

        /// <summary>
        /// Configuration for a change stream.
        /// </summary>
        public class ChangeStreamConfig
        {
            public string Table { get; set; }
            public HashSet<string> Operations { get; set; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            public long ResumeFromLSN { get; set; }
            public bool IncludeBefore { get; set; }
        }

        /// <summary>
        /// A single change event.
        /// </summary>
        public class ChangeEvent
        {
            public string Operation { get; set; }
            public string Table { get; set; }
            public long Timestamp { get; set; }
            public long LSN { get; set; }
            public Dictionary<string, object> Before { get; set; }
            public Dictionary<string, object> After { get; set; }
            public Dictionary<string, object> Keys { get; set; }

            public override string ToString() =>
                $"ChangeEvent{{op={Operation}, table={Table}, lsn={LSN}}}";
        }

        public ChangeStream(VedaClient client, ChangeStreamConfig config)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _config = config ?? new ChangeStreamConfig();
            _lastLSN = config.ResumeFromLSN;
            _events = new BlockingQueue<ChangeEvent>(100);
            _errors = new BlockingQueue<Exception>(10);
            _listeners = new List<Action<ChangeEvent>>();
        }

        /// <summary>
        /// Start consuming change events.
        /// </summary>
        public ChangeStream Start()
        {
            if (_active) return this;
            _active = true;
            _worker = new Thread(Run) { IsBackground = true, Name = "vedadb-cs-" + Guid.NewGuid().ToString("N")[0..8] };
            _worker.Start();
            return this;
        }

        /// <summary>
        /// Stop the change stream.
        /// </summary>
        public void Stop()
        {
            _active = false;
            _worker?.Join(2000);
        }

        /// <summary>
        /// Check if the stream is active.
        /// </summary>
        public bool IsActive => _active;

        /// <summary>
        /// Get the most recent processed LSN.
        /// </summary>
        public long LastLSN => Interlocked.Read(ref _lastLSN);

        /// <summary>
        /// Poll for the next event.
        /// </summary>
        public ChangeEvent Poll(int timeoutMs = 5000)
        {
            _events.TryTake(out var evt, timeoutMs);
            return evt;
        }

        /// <summary>
        /// Register an event listener.
        /// </summary>
        public void OnEvent(Action<ChangeEvent> listener)
        {
            _listeners.Add(listener);
        }

        /// <summary>
        /// Get a resume token for the current position.
        /// </summary>
        public string GetResumeToken()
        {
            return System.Text.Json.JsonSerializer.Serialize(new
            {
                lsn = LastLSN,
                table = _config.Table,
                time = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            });
        }

        public void Dispose()
        {
            Stop();
        }

        private void Run()
        {
            while (_active)
            {
                try
                {
                    string sql = BuildWatchSQL();
                    VedaResult result = _client.Query(sql);

                    foreach (var row in result.ToDicts())
                    {
                        var evt = ParseRow(row);
                        if (evt == null || !MatchesFilter(evt)) continue;

                        Interlocked.Exchange(ref _lastLSN, evt.LSN);
                        _events.TryAdd(evt, 1000);

                        foreach (var listener in _listeners)
                        {
                            try { listener(evt); } catch { }
                        }
                    }
                    Thread.Sleep(100);
                }
                catch (Exception ex)
                {
                    _errors.TryAdd(ex, 1000);
                    Thread.Sleep(1000);
                }
            }
        }

        private string BuildWatchSQL()
        {
            var sb = new StringBuilder("WATCH");
            if (!string.IsNullOrEmpty(_config.Table))
                sb.Append(" ").Append(_config.Table);
            if (_config.ResumeFromLSN > 0)
                sb.Append(" RESUME LSN ").Append(_config.ResumeFromLSN);
            if (_config.Operations.Count > 0)
                sb.Append(" FILTER (").Append(string.Join(",", _config.Operations)).Append(")");
            sb.Append(";");
            return sb.ToString();
        }

        private ChangeEvent ParseRow(Dictionary<string, object> row)
        {
            var evt = new ChangeEvent();
            if (row.TryGetValue("operation", out var op)) evt.Operation = op?.ToString();
            if (row.TryGetValue("table", out var tbl)) evt.Table = tbl?.ToString();
            if (row.TryGetValue("timestamp", out var ts) && long.TryParse(ts?.ToString(), out var tsv)) evt.Timestamp = tsv;
            if (row.TryGetValue("lsn", out var lsn) && long.TryParse(lsn?.ToString(), out var lsnv)) evt.LSN = lsnv;
            if (_config.IncludeBefore && row.TryGetValue("before", out var before) && before is Dictionary<string, object> bdict) evt.Before = bdict;
            if (row.TryGetValue("after", out var after) && after is Dictionary<string, object> adict) evt.After = adict;
            if (row.TryGetValue("keys", out var keys) && keys is Dictionary<string, object> kdict) evt.Keys = kdict;
            return evt;
        }

        private bool MatchesFilter(ChangeEvent evt)
        {
            if (_config.Operations.Count == 0) return true;
            return _config.Operations.Contains(evt.Operation);
        }
    }
}
