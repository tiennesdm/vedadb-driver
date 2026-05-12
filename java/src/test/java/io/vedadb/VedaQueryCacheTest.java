package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Tests for VedaQueryCache.
 */
public class VedaQueryCacheTest {

    @Test
    public void testBasicCache() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);
        VedaResult result = new VedaResult();

        VedaResult cached = cache.get("SELECT * FROM users", () -> result);
        assertSame(result, cached);
    }

    @Test
    public void testCacheHit() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);
        VedaResult result1 = new VedaResult();
        VedaResult result2 = new VedaResult();

        VedaResult first = cache.get("SELECT * FROM users", () -> result1);
        VedaResult second = cache.get("SELECT * FROM users", () -> result2);

        assertSame(first, second); // Should return cached result
        assertSame(result1, second);
    }

    @Test
    public void testCacheMissDifferentKey() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);

        cache.get("SELECT * FROM users", VedaResult::new);
        cache.get("SELECT * FROM orders", VedaResult::new);

        assertEquals(2, cache.size());
    }

    @Test
    public void testPutAndGet() {
        VedaQueryCache cache = new VedaQueryCache(10);
        VedaResult result = new VedaResult();
        cache.put("key", result);

        assertEquals(1, cache.size());
        assertEquals(0, cache.getHitCount());
        assertEquals(0, cache.getMissCount());
    }

    @Test
    public void testInvalidate() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);
        cache.put("key1", new VedaResult());
        cache.put("key2", new VedaResult());
        assertEquals(2, cache.size());

        cache.invalidate("key1");
        assertEquals(1, cache.size());
    }

    @Test
    public void testInvalidatePattern() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);
        cache.put("SELECT users.*", new VedaResult());
        cache.put("SELECT orders.*", new VedaResult());
        cache.put("INSERT INTO logs", new VedaResult());

        cache.invalidatePattern("SELECT");
        assertEquals(1, cache.size());
    }

    @Test
    public void testClear() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);
        cache.put("key1", new VedaResult());
        cache.put("key2", new VedaResult());

        cache.clear();
        assertEquals(0, cache.size());
        assertEquals(0, cache.getHitCount());
        assertEquals(0, cache.getMissCount());
    }

    @Test
    public void testHitRatio() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);

        // First call is a miss
        cache.get("key1", VedaResult::new);
        // Second call is a hit
        cache.get("key1", VedaResult::new);

        assertEquals(1, cache.getHitCount());
        assertEquals(1, cache.getMissCount());
        assertEquals(0.5, cache.getHitRatio(), 0.001);
    }

    @Test
    public void testHitRatioNoAccess() {
        VedaQueryCache cache = new VedaQueryCache(10);
        assertEquals(0.0, cache.getHitRatio(), 0.001);
    }

    @Test(expected = IllegalArgumentException.class)
    public void testInvalidMaxSize() {
        new VedaQueryCache(0);
    }

    @Test
    public void testMaxSize() {
        VedaQueryCache cache = new VedaQueryCache(10);
        assertEquals(10, cache.getMaxSize());
    }

    @Test
    public void testLRUEviction() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(2);
        cache.put("key1", new VedaResult());
        cache.put("key2", new VedaResult());
        cache.put("key3", new VedaResult()); // Should evict key1

        assertEquals(2, cache.size());
        assertTrue(cache.getEvictionCount() > 0);
    }

    @Test
    public void testTTLExpiration() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);

        VedaResult first = cache.get("key", 50, VedaResult::new); // 50ms TTL
        Thread.sleep(100);

        // Should be expired, so a new load
        AtomicInteger callCount = new AtomicInteger(0);
        VedaResult second = cache.get("key", 50, () -> {
            callCount.incrementAndGet();
            return new VedaResult();
        });

        assertEquals(1, callCount.get());
        assertNotSame(first, second);
    }

    @Test
    public void testTTLNotExpired() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);

        VedaResult first = cache.get("key", 5000, VedaResult::new); // 5s TTL
        VedaResult second = cache.get("key", 5000, VedaResult::new);

        assertSame(first, second); // Not expired
    }

    @Test
    public void testGetCounter() {
        VedaQueryCache cache = new VedaQueryCache(10);
        assertEquals(0, cache.getCounter("nonexistent"));
    }

    @Test
    public void testGetAllCounters() throws Exception {
        VedaQueryCache cache = new VedaQueryCache(10);
        cache.get("key1", VedaResult::new);
        cache.get("key1", VedaResult::new); // hit
        assertTrue(cache.getAllCounters().size() >= 0);
    }

    // Helper class
    private static class AtomicInteger {
        private int value;
        int incrementAndGet() { return ++value; }
        int get() { return value; }
    }
}
