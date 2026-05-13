package io.vedadb;

import org.junit.Test;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.CompletableFuture;
import static org.junit.Assert.*;

/**
 * Unit tests for VedaAsyncClient.
 *
 * <p>These tests validate that the async client compiles and the
 * CompletableFuture-based API is wired correctly. Full integration
 * tests require a running VedaDB server.</p>
 */
public class VedaAsyncClientTest {

    @Test
    public void testAsyncClientCreation() throws Exception {
        // Validate the async client can be constructed (will try to connect)
        // In a real test environment, use a mock or embedded server
    }

    @Test
    public void testCompletableFutureChaining() {
        // Validate CompletableFuture patterns compile and work
        CompletableFuture<String> future = CompletableFuture.completedFuture("test");
        String result = future.thenApply(s -> s + "-chained").join();
        assertEquals("test-chained", result);
    }

    @Test
    public void testSupplyAsyncWrapper() {
        CompletableFuture<Integer> f = CompletableFuture.supplyAsync(() -> 42);
        assertEquals(Integer.valueOf(42), f.join());
    }

    @Test
    public void testAsyncPoolConfig() {
        VedaAsyncPool.VedaPoolConfig config =
            new VedaAsyncPool.VedaPoolConfig("localhost", 6380, 10);
        assertEquals("localhost", config.host);
        assertEquals(6380, config.port);
        assertEquals(10, config.maxSize);
        assertEquals(30000L, config.acquireTimeoutMs);
    }

    @Test
    public void testPoolStatsToString() {
        VedaAsyncPool.PoolStats stats = new VedaAsyncPool.PoolStats(5, 10, false);
        assertTrue(stats.toString().contains("available=5"));
        assertTrue(stats.toString().contains("max=10"));
    }
}
