using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace VedaDB
{
    /// <summary>
    /// Async VedaDB client built on top of the synchronous VedaClient.
    /// All operations use async/await with CancellationToken support.
    /// </summary>
    public class VedaDBAsyncClient : IDisposable
    {
        private readonly VedaClient _syncClient;

        public VedaDBAsyncClient(string host, int port)
        {
            _syncClient = new VedaClient(host, port);
        }

        public VedaDBAsyncClient(string host, int port, bool useTls, string username, string password)
        {
            _syncClient = new VedaClient(host, port, useTls, username, password);
        }

        public VedaDBAsyncClient(VedaClient syncClient)
        {
            _syncClient = syncClient ?? throw new ArgumentNullException(nameof(syncClient));
        }

        public Task<VedaResult> QueryAsync(string sql, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Query(sql), ct);

        public Task<string> ExecAsync(string sql, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Exec(sql), ct);

        public Task<bool> PingAsync(CancellationToken ct = default)
            => Task.Run(() => _syncClient.Ping(), ct);

        public Task<string> InsertAsync(string table, Dictionary<string, object> data, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Insert(table, data), ct);

        public Task<VedaResult> SelectAsync(string table, string columns, string where, string orderBy, int limit, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Select(table, columns, where, orderBy, limit), ct);

        public Task<string> UpdateAsync(string table, Dictionary<string, object> set, string where, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Update(table, set, where), ct);

        public Task<string> DeleteAsync(string table, string where, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Delete(table, where), ct);

        public Task<List<string>> ShowTablesAsync(CancellationToken ct = default)
            => Task.Run(() => _syncClient.ShowTables(), ct);

        public Task<VedaResult> GraphAsync(string sql, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Graph(sql), ct);

        public Task<VedaResult> CacheSetAsync(string key, string value, int ttl, CancellationToken ct = default)
            => Task.Run(() => _syncClient.CacheSet(key, value, ttl), ct);

        public Task<VedaResult> CacheGetAsync(string key, CancellationToken ct = default)
            => Task.Run(() => _syncClient.CacheGet(key), ct);

        public Task<VedaResult> CacheDelAsync(string key, CancellationToken ct = default)
            => Task.Run(() => _syncClient.CacheDel(key), ct);

        public Task<string> BeginAsync(CancellationToken ct = default)
            => Task.Run(() => _syncClient.Begin(), ct);

        public Task<string> CommitAsync(CancellationToken ct = default)
            => Task.Run(() => _syncClient.Commit(), ct);

        public Task<string> RollbackAsync(CancellationToken ct = default)
            => Task.Run(() => _syncClient.Rollback(), ct);

        public Task<T> TransactionAsync<T>(Func<VedaClient, T> fn, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Transaction(fn), ct);

        public Task<VedaResult> PrepareAsync(string name, string query, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Prepare(name, query), ct);

        public Task<VedaResult> ExecutePreparedAsync(string name, params string[] parameters)
            => Task.Run(() => _syncClient.ExecutePrepared(name, parameters));

        public Task<VedaResult> DeallocateAsync(string name, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Deallocate(name), ct);

        public Task<List<VedaResult>> PipelineAsync(List<string> commands, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Pipeline(commands), ct);

        public Task<string> BulkInsertAsync(string table, List<List<string>> rows, CancellationToken ct = default)
            => Task.Run(() => _syncClient.BulkInsert(table, rows), ct);

        public Task<VedaResult> CursorAsync(string sql, List<string> parameters, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Cursor(sql, parameters), ct);

        public Task<ChangeStream> WatchAsync(string table = null, CancellationToken ct = default)
            => Task.Run(() => _syncClient.Watch(table), ct);

        public void Dispose()
        {
            _syncClient.Close();
        }

        public VedaClient SyncClient => _syncClient;
    }
}
