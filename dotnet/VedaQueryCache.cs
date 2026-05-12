using System.Collections.Concurrent;
using System;

namespace VedaDB;

/// <summary>
/// Configuration for the query cache.
/// </summary>
public class VedaQueryCacheConfig
{
    /// <summary>
    /// Maximum number of cached entries. Default is 1000.
    /// </summary>
    public int MaxEntries { get; set; } = 1000;

    /// <summary>
    /// Default TTL for cached entries. Default is 60 seconds.
    /// </summary>
    public TimeSpan DefaultTtl { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>
    /// Whether caching is enabled. Default is true.
    /// </summary>
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// A cached entry with expiration.
/// </summary>
internal class CacheEntry
{
    public VedaResult Result { get; set; } = null!;
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public int HitCount { get; set; }
}

/// <summary>
/// In-memory query cache for VedaDB results.
/// Provides time-based expiration and LRU eviction.
/// </summary>
public class VedaQueryCache
{
    private readonly VedaQueryCacheConfig _config;
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new();
    private readonly object _cleanupLock = new();
    private DateTime _lastCleanup = DateTime.UtcNow;

    /// <summary>
    /// Number of cache hits.
    /// </summary>
    public long HitCount { get; private set; }

    /// <summary>
    /// Number of cache misses.
    /// </summary>
    public long MissCount { get; private set; }

    /// <summary>
    /// Current number of entries.
    /// </summary>
    public int Count => _cache.Count;

    /// <summary>
    /// Cache hit rate (0.0 to 1.0).
    /// </summary>
    public double HitRate
    {
        get
        {
            var total = HitCount + MissCount;
            return total > 0 ? (double)HitCount / total : 0;
        }
    }

    /// <summary>
    /// Create a query cache with default configuration.
    /// </summary>
    public VedaQueryCache() : this(new VedaQueryCacheConfig()) { }

    /// <summary>
    /// Create a query cache with specified configuration.
    /// </summary>
    public VedaQueryCache(VedaQueryCacheConfig config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
    }

    /// <summary>
    /// Get a cached result if available and not expired.
    /// </summary>
    public VedaResult? Get(string sql, params object[] parameters)
    {
        if (!_config.Enabled) return null;

        var key = BuildKey(sql, parameters);
        if (_cache.TryGetValue(key, out var entry))
        {
            if (entry.ExpiresAt > DateTime.UtcNow)
            {
                entry.HitCount++;
                HitCount++;
                VedaMetrics.Increment("vedadb_cache_hit");
                return entry.Result;
            }
            _cache.TryRemove(key, out _);
        }

        MissCount++;
        VedaMetrics.Increment("vedadb_cache_miss");
        MaybeCleanup();
        return null;
    }

    /// <summary>
    /// Cache a result for the default TTL.
    /// </summary>
    public void Set(string sql, VedaResult result, params object[] parameters)
    {
        Set(sql, result, _config.DefaultTtl, parameters);
    }

    /// <summary>
    /// Cache a result with a specific TTL.
    /// </summary>
    public void Set(string sql, VedaResult result, TimeSpan ttl, params object[] parameters)
    {
        if (!_config.Enabled) return;
        if (_cache.Count >= _config.MaxEntries)
            EvictLRU();

        var key = BuildKey(sql, parameters);
        var entry = new CacheEntry
        {
            Result = result,
            ExpiresAt = DateTime.UtcNow.Add(ttl),
            CreatedAt = DateTime.UtcNow
        };
        _cache[key] = entry;
        VedaMetrics.Gauge("vedadb_cache_entries", _cache.Count);
    }

    /// <summary>
    /// Invalidate a cached entry.
    /// </summary>
    public bool Invalidate(string sql, params object[] parameters)
    {
        var key = BuildKey(sql, parameters);
        var removed = _cache.TryRemove(key, out _);
        if (removed)
            VedaMetrics.Gauge("vedadb_cache_entries", _cache.Count);
        return removed;
    }

    /// <summary>
    /// Invalidate all cache entries matching a pattern.
    /// </summary>
    public int InvalidatePattern(string pattern)
    {
        var keysToRemove = _cache.Keys.Where(k => k.Contains(pattern)).ToList();
        int removed = 0;
        foreach (var key in keysToRemove)
        {
            if (_cache.TryRemove(key, out _)) removed++;
        }
        if (removed > 0)
            VedaMetrics.Gauge("vedadb_cache_entries", _cache.Count);
        return removed;
    }

    /// <summary>
    /// Clear all cache entries.
    /// </summary>
    public void Clear()
    {
        _cache.Clear();
        HitCount = 0;
        MissCount = 0;
        VedaMetrics.Gauge("vedadb_cache_entries", 0);
    }

    /// <summary>
    /// Get cache statistics.
    /// </summary>
    public VedaQueryCacheStats GetStats() => new()
    {
        EntryCount = Count,
        HitCount = HitCount,
        MissCount = MissCount,
        HitRate = HitRate,
        MaxEntries = _config.MaxEntries,
        DefaultTtl = _config.DefaultTtl
    };

    private string BuildKey(string sql, object[] parameters)
    {
        if (parameters.Length == 0) return sql;
        var paramStr = string.Join("|", parameters.Select(p => p?.ToString() ?? "NULL"));
        return $"{sql}::{paramStr}";
    }

    private void EvictLRU()
    {
        var oldest = _cache.OrderBy(e => e.Value.CreatedAt).FirstOrDefault();
        if (oldest.Key != null)
            _cache.TryRemove(oldest.Key, out _);
    }

    private void MaybeCleanup()
    {
        if (DateTime.UtcNow - _lastCleanup < TimeSpan.FromMinutes(1)) return;
        lock (_cleanupLock)
        {
            if (DateTime.UtcNow - _lastCleanup < TimeSpan.FromMinutes(1)) return;
            var now = DateTime.UtcNow;
            var expired = _cache.Where(e => e.Value.ExpiresAt <= now).Select(e => e.Key).ToList();
            foreach (var key in expired)
                _cache.TryRemove(key, out _);
            _lastCleanup = now;
        }
    }
}

/// <summary>
/// Statistics for the query cache.
/// </summary>
public class VedaQueryCacheStats
{
    public int EntryCount { get; set; }
    public long HitCount { get; set; }
    public long MissCount { get; set; }
    public double HitRate { get; set; }
    public int MaxEntries { get; set; }
    public TimeSpan DefaultTtl { get; set; }
}
