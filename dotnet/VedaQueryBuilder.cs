using System;
namespace VedaDB;

/// <summary>
/// Fluent query builder for VedaDB.
/// Provides a type-safe, chainable API for constructing SQL queries.
/// </summary>
public class VedaQueryBuilder
{
    private readonly VedaClient _client;
    private readonly string _table;
    private readonly List<string> _columns = new();
    private readonly List<string> _whereClauses = new();
    private readonly List<string> _orderBy = new();
    private readonly List<string> _joins = new();
    private readonly List<string> _groupBy = new();
    private readonly List<string> _having = new();
    private int? _limit;
    private int? _offset;
    private bool _forUpdate;
    private bool _distinct;

    /// <summary>
    /// Create a query builder for a table.
    /// </summary>
    public VedaQueryBuilder(VedaClient client, string table)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _table = table ?? throw new ArgumentNullException(nameof(table));
    }

    /// <summary>
    /// Select specific columns.
    /// </summary>
    public VedaQueryBuilder Select(params string[] columns)
    {
        _columns.AddRange(columns);
        return this;
    }

    /// <summary>
    /// Add DISTINCT modifier.
    /// </summary>
    public VedaQueryBuilder Distinct()
    {
        _distinct = true;
        return this;
    }

    /// <summary>
    /// Add WHERE clause.
    /// </summary>
    public VedaQueryBuilder Where(string condition)
    {
        _whereClauses.Add($"({condition})");
        return this;
    }

    /// <summary>
    /// Add WHERE column = value.
    /// </summary>
    public VedaQueryBuilder Where(string column, object value)
    {
        _whereClauses.Add($"({column} = {FormatValue(value)})");
        return this;
    }

    /// <summary>
    /// Add WHERE column operator value.
    /// </summary>
    public VedaQueryBuilder Where(string column, string op, object value)
    {
        _whereClauses.Add($"({column} {op} {FormatValue(value)})");
        return this;
    }

    /// <summary>
    /// Add WHERE IN clause.
    /// </summary>
    public VedaQueryBuilder WhereIn(string column, IEnumerable<object> values)
    {
        var vals = string.Join(", ", values.Select(FormatValue));
        _whereClauses.Add($"({column} IN ({vals}))");
        return this;
    }

    /// <summary>
    /// Add WHERE LIKE clause.
    /// </summary>
    public VedaQueryBuilder WhereLike(string column, string pattern)
    {
        _whereClauses.Add($"({column} LIKE '{pattern.Replace("'", "''")}')");
        return this;
    }

    /// <summary>
    /// Add WHERE NULL check.
    /// </summary>
    public VedaQueryBuilder WhereNull(string column)
    {
        _whereClauses.Add($"({column} IS NULL)");
        return this;
    }

    /// <summary>
    /// Add WHERE NOT NULL check.
    /// </summary>
    public VedaQueryBuilder WhereNotNull(string column)
    {
        _whereClauses.Add($"({column} IS NOT NULL)");
        return this;
    }

    /// <summary>
    /// Add ORDER BY clause.
    /// </summary>
    public VedaQueryBuilder OrderBy(string column, bool descending = false)
    {
        _orderBy.Add(descending ? $"{column} DESC" : $"{column} ASC");
        return this;
    }

    /// <summary>
    /// Add LIMIT clause.
    /// </summary>
    public VedaQueryBuilder Limit(int limit)
    {
        _limit = limit;
        return this;
    }

    /// <summary>
    /// Add OFFSET clause.
    /// </summary>
    public VedaQueryBuilder Offset(int offset)
    {
        _offset = offset;
        return this;
    }

    /// <summary>
    /// Add INNER JOIN.
    /// </summary>
    public VedaQueryBuilder Join(string table, string onCondition, string? alias = null)
    {
        var tableRef = alias != null ? $"{table} AS {alias}" : table;
        _joins.Add($"INNER JOIN {tableRef} ON {onCondition}");
        return this;
    }

    /// <summary>
    /// Add LEFT JOIN.
    /// </summary>
    public VedaQueryBuilder LeftJoin(string table, string onCondition, string? alias = null)
    {
        var tableRef = alias != null ? $"{table} AS {alias}" : table;
        _joins.Add($"LEFT JOIN {tableRef} ON {onCondition}");
        return this;
    }

    /// <summary>
    /// Add GROUP BY clause.
    /// </summary>
    public VedaQueryBuilder GroupBy(params string[] columns)
    {
        _groupBy.AddRange(columns);
        return this;
    }

    /// <summary>
    /// Add HAVING clause.
    /// </summary>
    public VedaQueryBuilder Having(string condition)
    {
        _having.Add(condition);
        return this;
    }

    /// <summary>
    /// Add FOR UPDATE clause.
    /// </summary>
    public VedaQueryBuilder ForUpdate()
    {
        _forUpdate = true;
        return this;
    }

    /// <summary>
    /// Build the SQL query string.
    /// </summary>
    public string BuildSql()
    {
        var sb = new System.Text.StringBuilder();

        sb.Append("SELECT ");
        if (_distinct) sb.Append("DISTINCT ");
        sb.Append(_columns.Count > 0 ? string.Join(", ", _columns) : "*");
        sb.Append(" FROM ").Append(_table);

        foreach (var join in _joins)
        {
            sb.Append(" ").Append(join);
        }

        if (_whereClauses.Count > 0)
        {
            sb.Append(" WHERE ").Append(string.Join(" AND ", _whereClauses));
        }

        if (_groupBy.Count > 0)
        {
            sb.Append(" GROUP BY ").Append(string.Join(", ", _groupBy));
        }

        if (_having.Count > 0)
        {
            sb.Append(" HAVING ").Append(string.Join(" AND ", _having));
        }

        if (_orderBy.Count > 0)
        {
            sb.Append(" ORDER BY ").Append(string.Join(", ", _orderBy));
        }

        if (_limit.HasValue)
            sb.Append(" LIMIT ").Append(_limit.Value);

        if (_offset.HasValue)
            sb.Append(" OFFSET ").Append(_offset.Value);

        if (_forUpdate)
            sb.Append(" FOR UPDATE");

        sb.Append(";");
        return sb.ToString();
    }

    /// <summary>
    /// Execute the built query.
    /// </summary>
    public async Task<VedaResult> ExecuteAsync(CancellationToken ct = default)
    {
        var sql = BuildSql();
        VedaMetrics.Increment("vedadb_querybuilder_executions", 1, new() { { "table", _table } });
        return await _client.QueryAsync(sql);
    }

    /// <summary>
    /// Execute and get first row, or null if empty.
    /// </summary>
    public async Task<Dictionary<string, string?>?> FirstAsync(CancellationToken ct = default)
    {
        _limit = 1;
        var result = await ExecuteAsync(ct);
        return result.First();
    }

    /// <summary>
    /// Execute and get a single scalar value.
    /// </summary>
    public async Task<string?> ScalarAsync(CancellationToken ct = default)
    {
        var result = await ExecuteAsync(ct);
        return result.Scalar();
    }

    /// <summary>
    /// Execute and get mapped results.
    /// </summary>
    public async Task<List<T>> MapAsync<T>(Func<Dictionary<string, string?>, T> mapper, CancellationToken ct = default)
    {
        var result = await ExecuteAsync(ct);
        return result.Map(mapper);
    }

    /// <summary>
    /// Execute and get results as dictionaries.
    /// </summary>
    public async Task<List<Dictionary<string, string?>>> ToDictsAsync(CancellationToken ct = default)
    {
        var result = await ExecuteAsync(ct);
        return result.ToDicts();
    }

    /// <summary>
    /// Count rows matching the current filters.
    /// </summary>
    public async Task<long> CountAsync(CancellationToken ct = default)
    {
        var savedColumns = new List<string>(_columns);
        _columns.Clear();
        _columns.Add("COUNT(*)");

        var result = await ExecuteAsync(ct);

        _columns.Clear();
        _columns.AddRange(savedColumns);

        var scalar = result.Scalar();
        return long.TryParse(scalar, out var count) ? count : 0;
    }

    /// <summary>
    /// Check if any rows match the current filters.
    /// </summary>
    public async Task<bool> ExistsAsync(CancellationToken ct = default)
    {
        _limit = 1;
        _columns.Clear();
        _columns.Add("1");

        var result = await ExecuteAsync(ct);
        return result.HasRows;
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
    /// Build an INSERT query for this table.
    /// </summary>
    public async Task<VedaResult> InsertAsync(Dictionary<string, object?> data, CancellationToken ct = default)
    {
        var cols = string.Join(", ", data.Keys);
        var vals = string.Join(", ", data.Values.Select(FormatValue));
        var sql = $"INSERT INTO {_table} ({cols}) VALUES ({vals});";
        return await _client.QueryAsync(sql);
    }

    /// <summary>
    /// Build an UPDATE query from current filters.
    /// </summary>
    public async Task<VedaResult> UpdateAsync(Dictionary<string, object?> set, CancellationToken ct = default)
    {
        var setClause = string.Join(", ", set.Select(kv => $"{kv.Key} = {FormatValue(kv.Value)}"));
        var sb = new System.Text.StringBuilder();
        sb.Append($"UPDATE {_table} SET {setClause}");

        if (_whereClauses.Count > 0)
            sb.Append(" WHERE ").Append(string.Join(" AND ", _whereClauses));

        sb.Append(";");
        return await _client.QueryAsync(sb.ToString());
    }

    /// <summary>
    /// Build a DELETE query from current filters.
    /// </summary>
    public async Task<VedaResult> DeleteAsync(CancellationToken ct = default)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append($"DELETE FROM {_table}");

        if (_whereClauses.Count > 0)
            sb.Append(" WHERE ").Append(string.Join(" AND ", _whereClauses));

        sb.Append(";");
        return await _client.QueryAsync(sb.ToString());
    }
}
