<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Client-side query cache with TTL support.
 */
class VedaQueryCache
{
    /** @var array<string, array{result: mixed, expires: float, sql: string}> */
    private array $cache = [];

    private float $defaultTtlMs;
    private int $maxEntries;
    private string $evictionPolicy;

    private int $hits = 0;
    private int $misses = 0;
    private int $evictions = 0;

    public function __construct(
        float $defaultTtlMs = 60000.0,
        int $maxEntries = 1000,
        string $evictionPolicy = 'lru', // lru, lfu, fifo
    ) {
        $this->defaultTtlMs     = $defaultTtlMs;
        $this->maxEntries       = max(1, $maxEntries);
        $this->evictionPolicy   = $evictionPolicy;
    }

    /**
     * Get a cached result.
     */
    public function get(string $key): ?VedaResult
    {
        if (!isset($this->cache[$key])) {
            $this->misses++;
            return null;
        }

        $entry = $this->cache[$key];
        if ($entry['expires'] > 0 && microtime(true) * 1000 > $entry['expires']) {
            unset($this->cache[$key]);
            $this->misses++;
            return null;
        }

        $this->hits++;
        // Update access time for LRU
        $this->cache[$key]['last_access'] = microtime(true) * 1000;
        $this->cache[$key]['access_count'] = ($this->cache[$key]['access_count'] ?? 0) + 1;

        return $entry['result'];
    }

    /**
     * Store a result in the cache.
     */
    public function set(string $key, VedaResult $result, ?float $ttlMs = null): void
    {
        $this->ensureCapacity();

        $ttl = $ttlMs ?? $this->defaultTtlMs;
        $this->cache[$key] = [
            'result'        => $result,
            'expires'       => $ttl > 0 ? microtime(true) * 1000 + $ttl : 0,
            'sql'           => $key,
            'created'       => microtime(true) * 1000,
            'last_access'   => microtime(true) * 1000,
            'access_count'  => 1,
        ];
    }

    /**
     * Execute a query with caching.
     *
     * @param callable(): VedaResult $execute
     */
    public function remember(string $sql, callable $execute, ?float $ttlMs = null): VedaResult
    {
        $key = $this->buildKey($sql);
        $cached = $this->get($key);

        if ($cached !== null) {
            return $cached;
        }

        $result = $execute();
        $this->set($key, $result, $ttlMs);
        return $result;
    }

    /**
     * Invalidate a cache entry.
     */
    public function invalidate(string $pattern): int
    {
        $count = 0;
        foreach (array_keys($this->cache) as $key) {
            if (fnmatch($pattern, $this->cache[$key]['sql'], FNM_CASEFOLD)) {
                unset($this->cache[$key]);
                $count++;
            }
        }
        return $count;
    }

    /**
     * Invalidate all entries matching a table name.
     */
    public function invalidateTable(string $table): int
    {
        return $this->invalidate("*{$table}*");
    }

    /**
     * Clear all cache entries.
     */
    public function clear(): void
    {
        $this->cache = [];
    }

    /**
     * Remove expired entries.
     */
    public function gc(): int
    {
        $now = microtime(true) * 1000;
        $removed = 0;

        foreach ($this->cache as $key => $entry) {
            if ($entry['expires'] > 0 && $now > $entry['expires']) {
                unset($this->cache[$key]);
                $removed++;
            }
        }

        return $removed;
    }

    /**
     * Ensure cache doesn't exceed max entries.
     */
    private function ensureCapacity(): void
    {
        if (count($this->cache) < $this->maxEntries) {
            return;
        }

        $this->evictions++;

        match ($this->evictionPolicy) {
            'lru'  => $this->evictLRU(),
            'lfu'  => $this->evictLFU(),
            'fifo' => $this->evictFIFO(),
            default => $this->evictLRU(),
        };
    }

    private function evictLRU(): void
    {
        $oldestKey = null;
        $oldestTime = PHP_FLOAT_MAX;

        foreach ($this->cache as $key => $entry) {
            if ($entry['last_access'] < $oldestTime) {
                $oldestTime = $entry['last_access'];
                $oldestKey = $key;
            }
        }

        if ($oldestKey !== null) {
            unset($this->cache[$oldestKey]);
        }
    }

    private function evictLFU(): void
    {
        $leastKey = null;
        $leastCount = PHP_INT_MAX;

        foreach ($this->cache as $key => $entry) {
            $count = $entry['access_count'] ?? 0;
            if ($count < $leastCount) {
                $leastCount = $count;
                $leastKey = $key;
            }
        }

        if ($leastKey !== null) {
            unset($this->cache[$leastKey]);
        }
    }

    private function evictFIFO(): void
    {
        $oldestKey = null;
        $oldestTime = PHP_FLOAT_MAX;

        foreach ($this->cache as $key => $entry) {
            if ($entry['created'] < $oldestTime) {
                $oldestTime = $entry['created'];
                $oldestKey = $key;
            }
        }

        if ($oldestKey !== null) {
            unset($this->cache[$oldestKey]);
        }
    }

    /**
     * Build a cache key from SQL.
     */
    public function buildKey(string $sql): string
    {
        return md5($sql);
    }

    /**
     * Get cache statistics.
     */
    public function getStats(): array
    {
        return [
            'entries'    => count($this->cache),
            'max_entries'=> $this->maxEntries,
            'hits'       => $this->hits,
            'misses'     => $this->misses,
            'evictions'  => $this->evictions,
            'hit_rate'   => $this->hits + $this->misses > 0
                ? round($this->hits / ($this->hits + $this->misses), 4)
                : 0.0,
        ];
    }

    /**
     * Get cache size.
     */
    public function size(): int
    {
        return count($this->cache);
    }
}
