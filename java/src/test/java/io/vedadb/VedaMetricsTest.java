package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;

import java.util.Map;

/**
 * Tests for VedaMetrics.
 */
public class VedaMetricsTest {

    @Test
    public void testCreate() {
        VedaMetrics metrics = new VedaMetrics("test");
        assertNotNull(metrics);
        assertEquals(0, metrics.getTotalQueries());
        assertEquals(0, metrics.getTotalErrors());
        assertEquals(0, metrics.getActiveConnections());
    }

    @Test
    public void testDefaultInstance() {
        VedaMetrics metrics = VedaMetrics.getDefault();
        assertNotNull(metrics);
        assertSame(metrics, VedaMetrics.getDefault());
    }

    @Test
    public void testIncrement() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.increment("requests");
        assertEquals(1, metrics.getCounter("requests"));
    }

    @Test
    public void testIncrementByAmount() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.increment("requests", 5);
        assertEquals(5, metrics.getCounter("requests"));
    }

    @Test
    public void testRecordQuery() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.recordQuery("SELECT", 150);
        assertEquals(1, metrics.getTotalQueries());
        assertEquals(1, metrics.getTimer("query_SELECT").getCount());
    }

    @Test
    public void testRecordTimer() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.recordTimer("connect", 50);
        assertEquals(1, metrics.getTimer("connect").getCount());
        assertEquals(50, metrics.getTimer("connect").getTotalMs());
    }

    @Test
    public void testRecordError() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.recordError("timeout");
        assertEquals(1, metrics.getTotalErrors());
        assertEquals(1, metrics.getCounter("errors_timeout"));
    }

    @Test
    public void testConnectionTracking() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.connectionAcquired();
        assertEquals(1, metrics.getActiveConnections());

        metrics.connectionAcquired();
        assertEquals(2, metrics.getActiveConnections());

        metrics.connectionReleased();
        assertEquals(1, metrics.getActiveConnections());
    }

    @Test
    public void testTimeRunnable() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.time("sleep", () -> {
            try { Thread.sleep(10); } catch (InterruptedException ignored) {}
        });
        assertEquals(1, metrics.getTimer("sleep").getCount());
        assertTrue(metrics.getTimer("sleep").getTotalMs() >= 0);
    }

    @Test
    public void testTimeCallable() throws Exception {
        VedaMetrics metrics = new VedaMetrics("test");
        Integer result = metrics.time("compute", () -> 42);
        assertEquals(Integer.valueOf(42), result);
        assertEquals(1, metrics.getTimer("compute").getCount());
    }

    @Test
    public void testHitRatio() {
        VedaMetrics metrics = new VedaMetrics("test");
        assertEquals(0.0, metrics.getHitRatio(), 0.001);
    }

    @Test
    public void testGetAllCounters() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.increment("a", 1);
        metrics.increment("b", 2);
        Map<String, Long> counters = metrics.getAllCounters();
        assertEquals(2, counters.size());
        assertEquals(Long.valueOf(1), counters.get("a"));
        assertEquals(Long.valueOf(2), counters.get("b"));
    }

    @Test
    public void testTimerStats() {
        VedaMetrics.Timer timer = new VedaMetrics.Timer();
        timer.record(100);
        timer.record(200);
        timer.record(300);

        assertEquals(3, timer.getCount());
        assertEquals(600, timer.getTotalMs());
        assertEquals(300, timer.getMaxMs());
        assertEquals(200.0, timer.getAvgMs(), 0.001);
    }

    @Test
    public void testEmptyTimer() {
        VedaMetrics.Timer timer = new VedaMetrics.Timer();
        assertEquals(0, timer.getCount());
        assertEquals(0, timer.getTotalMs());
        assertEquals(0, timer.getMaxMs());
        assertEquals(0.0, timer.getAvgMs(), 0.001);
    }

    @Test
    public void testPrometheusExport() {
        VedaMetrics metrics = new VedaMetrics("vedadb");
        metrics.increment("requests", 10);
        metrics.recordQuery("SELECT", 100);
        metrics.connectionAcquired();

        String exported = metrics.exportPrometheus();
        assertNotNull(exported);
        assertTrue(exported.contains("vedadb_requests_total"));
        assertTrue(exported.contains("vedadb_queries_total"));
        assertTrue(exported.contains("vedadb_active_connections"));
        assertTrue(exported.contains("vedadb_errors_total"));
    }

    @Test
    public void testReset() {
        VedaMetrics metrics = new VedaMetrics("test");
        metrics.increment("x", 5);
        metrics.recordQuery("SELECT", 100);

        metrics.reset();
        assertEquals(0, metrics.getAllCounters().size());
        assertEquals(0, metrics.getTotalQueries());
        assertEquals(0, metrics.getTotalErrors());
    }
}
