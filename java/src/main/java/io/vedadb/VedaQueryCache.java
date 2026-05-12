package io.vedadb;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Thread-safe LRU query result cache for VedaDB.
 *
 * <p>Caches query results with a configurable maximum size.
 * When the cache is full, the least recently used entry is evicted.
 * Entries can also have a TTL (time-to-live) for expiration.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaQueryCache cache = new VedaQueryCache(100); // max 100 entries
 * VedaResult result = cache.get("SELECT * FROM users", () -> client.query("SELECT * FROM users"));
 * }</pre>
 */
public class VedaQueryCache {

    /**
     * Cached entry with result and timestamp.
     */
    private static class CacheEntry {
        final VedaResult result;
        final long cachedAt;
        final long ttlMs;

        CacheEntry(VedaResult result, long ttlMs) {
            this.result = result;
            this.cachedAt = System.currentTimeMillis();
            this.ttlMs = ttlMs;
        }

        boolean isExpired() {
            return ttlMs > 0 && System.currentTimeMillis() - cachedAt > ttlMs;
        }
    }

    private final int maxSize;
    private final Map<String, CacheEntry> cache;
    private final ReadWriteLock lock = new ReentrantReadWriteLock();
    private long hitCount = 0;
    private long missCount = 0;
    private long evictionCount = 0;

    /**
     * Create an LRU query cache.
     *
     * @param maxSize maximum number of cached entries
     */
    public VedaQueryCache(int maxSize) {
        if (maxSize <= 0) {
            throw new IllegalArgumentException("maxSize must be > 0");
        }
        this.maxSize = maxSize;
        this.cache = new LinkedHashMap<String, CacheEntry>(maxSize, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, CacheEntry> eldest) {
                boolean evict = size() > maxSize;
                if (evict) evictionCount++;
                return evict;
            }
        };
    }

    /**
     * Get a cached result or compute it if not present.
     *
     * @param key      cache key (typically the SQL query)
     * @param loader   function to compute the result if not cached
     * @return the cached or computed result
     * @throws Exception if loading fails
     */
    public VedaResult get(String key, CacheLoader loader) throws Exception {
        lock.readLock().lock();
        try {
            CacheEntry entry = cache.get(key);
            if (entry != null && !entry.isExpired()) {
                hitCount++;
                return entry.result;
            }
        } finally {
            lock.readLock().unlock();
        }

        // Not found or expired - load with write lock
        lock.writeLock().lock();
        try {
            // Double-check
            CacheEntry entry = cache.get(key);
            if (entry != null && !entry.isExpired()) {
                hitCount++;
                return entry.result;
            }

            missCount++;
            VedaResult result = loader.load();
            cache.put(key, new CacheEntry(result, 0));
            return result;
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * Get a cached result with TTL or compute it if not present.
     *
     * @param key      cache key
     * @param ttlMs    time-to-live in milliseconds
     * @param loader   function to compute the result if not cached
     * @return the cached or computed result
     * @throws Exception if loading fails
     */
    public VedaResult get(String key, long ttlMs, CacheLoader loader) throws Exception {
        lock.readLock().lock();
        try {
            CacheEntry entry = cache.get(key);
            if (entry != null && !entry.isExpired()) {
                hitCount++;
                return entry.result;
            }
        } finally {
            lock.readLock().unlock();
        }

        lock.writeLock().lock();
        try {
            CacheEntry entry = cache.get(key);
            if (entry != null && !entry.isExpired()) {
                hitCount++;
                return entry.result;
            }

            missCount++;
            VedaResult result = loader.load();
            cache.put(key, new CacheEntry(result, ttlMs));
            return result;
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * Put a result directly into the cache.
     */
    public void put(String key, VedaResult result) {
        lock.writeLock().lock();
        try {
            cache.put(key, new CacheEntry(result, 0));
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * Invalidate a cached entry.
     */
    public void invalidate(String key) {
        lock.writeLock().lock();
        try {
            cache.remove(key);
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * Invalidate all entries matching a pattern (simple contains check).
     */
    public void invalidatePattern(String pattern) {
        lock.writeLock().lock();
        try {
            cache.entrySet().removeIf(e -> e.getKey().contains(pattern));
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * Clear all cached entries.
     */
    public void clear() {
        lock.writeLock().lock();
        try {
            cache.clear();
            hitCount = 0;
            missCount = 0;
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * Get the number of entries in the cache.
     */
    public int size() {
        lock.readLock().lock();
        try {
            return cache.size();
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * Get cache hit count.
     */
    public long getHitCount() {
        lock.readLock().lock();
        try {
            return hitCount;
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * Get cache miss count.
     */
    public long getMissCount() {
        lock.readLock().lock();
        try {
            return missCount;
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * Get cache hit ratio (0.0 to 1.0).
     */
    public double getHitRatio() {
        lock.readLock().lock();
        try {
            long total = hitCount + missCount;
            return total == 0 ? 0.0 : (double) hitCount / total;
        } finally {
            lock.readLock().unlock();
        }
    }

    public long getEvictionCount() {
        return evictionCount;
    }

    public int getMaxSize() {
        return maxSize;
    }

    /**
     * Functional interface for loading cache entries.
     */
    @FunctionalInterface
    public interface CacheLoader {
        VedaResult load() throws Exception;
    }
}
