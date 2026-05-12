using System.Text.Json;
using System.Text.Json.Serialization;

namespace VedaDB;

/// <summary>
/// Represents the result of a VedaDB query.
/// </summary>
public class VedaResult
{
    [JsonPropertyName("columns")]
    public List<string>? Columns { get; set; }

    [JsonPropertyName("rows")]
    public List<List<JsonElement>>? Rows { get; set; }

    [JsonPropertyName("row_count")]
    public int RowCount { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    /// <summary>
    /// Convert rows to a list of dictionaries keyed by column name.
    /// </summary>
    public List<Dictionary<string, string?>> ToDicts()
    {
        var result = new List<Dictionary<string, string?>>();
        if (Columns == null || Rows == null) return result;

        foreach (var row in Rows)
        {
            var dict = new Dictionary<string, string?>();
            for (int i = 0; i < Columns.Count && i < row.Count; i++)
            {
                dict[Columns[i]] = row[i].ValueKind == JsonValueKind.Null
                    ? null
                    : row[i].ToString();
            }
            result.Add(dict);
        }
        return result;
    }

    /// <summary>
    /// Get the first row as a dictionary, or null if empty.
    /// </summary>
    public Dictionary<string, string?>? First()
    {
        var dicts = ToDicts();
        return dicts.Count > 0 ? dicts[0] : null;
    }

    /// <summary>
    /// Extract a single column's values as a list.
    /// </summary>
    public List<string?> Pluck(string column)
    {
        var result = new List<string?>();
        if (Columns == null || Rows == null) return result;

        int idx = Columns.IndexOf(column);
        if (idx < 0) return result;

        foreach (var row in Rows)
        {
            if (idx < row.Count)
            {
                result.Add(row[idx].ValueKind == JsonValueKind.Null
                    ? null
                    : row[idx].ToString());
            }
        }
        return result;
    }

    /// <summary>
    /// Get a single scalar value from the first row, first column.
    /// </summary>
    public string? Scalar()
    {
        if (Rows == null || Rows.Count == 0) return null;
        if (Rows[0].Count == 0) return null;
        return Rows[0][0].ValueKind == JsonValueKind.Null
            ? null
            : Rows[0][0].ToString();
    }

    /// <summary>
    /// Check if the result has any rows.
    /// </summary>
    public bool HasRows => Rows != null && Rows.Count > 0;

    /// <summary>
    /// Check if the result is empty (no rows).
    /// </summary>
    public bool IsEmpty => !HasRows;

    /// <summary>
    /// Get rows as a list of strongly-typed objects using a mapper function.
    /// </summary>
    public List<T> Map<T>(Func<Dictionary<string, string?>, T> mapper)
    {
        return ToDicts().Select(mapper).ToList();
    }

    /// <summary>
    /// Get the first row mapped to a strongly-typed object, or default if empty.
    /// </summary>
    public T? MapFirst<T>(Func<Dictionary<string, string?>, T> mapper)
    {
        var dicts = ToDicts();
        return dicts.Count > 0 ? mapper(dicts[0]) : default;
    }

    internal static VedaResult Parse(string json)
    {
        var result = JsonSerializer.Deserialize<VedaResult>(json)
            ?? throw new VedaException("Failed to parse response");

        if (!string.IsNullOrEmpty(result.Error))
        {
            throw new VedaQueryException(result.Error);
        }

        return result;
    }
}
