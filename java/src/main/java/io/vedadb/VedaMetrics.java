package io.vedadb;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

/**
 * Metrics collection for VedaDB driver operations.
 *
 * <p>Collects counters, timers, and histograms for driver operations.
 * Can be exported to Prometheus or other monitoring systems via
 * {@link #exportPrometheus()}.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaMetrics metrics = VedaMetrics.getDefault();
 * metrics.recordQuery("SELECT", 150); // 150ms
 * metrics.recordError("connection_timeout");
 * String prometheus = metrics.exportPrometheus();
 * }</pre>
 */
public class VedaMetrics {

    /**
     * Timer for measuring operation durations.
     */
    public static class Timer {
        private final LongAdder count = new LongAdder();
        private final LongAdder totalMs = new LongAdder();
        private final AtomicLong maxMs = new AtomicLong(0);

        public void record(long durationMs) {
            count.increment();
            totalMs.add(durationMs);
            long currentMax;
            do {
                currentMax = maxMs.get();
            } while (durationMs > currentMax && !maxMs.compareAndSet(currentMax, durationMs));
        }

        public long getCount() { return count.sum(); }
        public long getTotalMs() { return totalMs.sum(); }
        public double getAvgMs() { return count.sum() == 0 ? 0 : (double) totalMs.sum() / count.sum(); }
        public long getMaxMs() { return maxMs.get(); }
    }

    // Singleton default instance
    private static final VedaMetrics DEFAULT = new VedaMetrics("vedadb");

    private final String namespace;
    private final Map<String, AtomicLong> counters = new ConcurrentHashMap<>();
    private final Map<String, Timer> timers = new ConcurrentHashMap<>();
    private final LongAdder totalQueries = new LongAdder();
    private final LongAdder totalErrors = new LongAdder();
    private final AtomicLong activeConnections = new AtomicLong(0);

    /**
     * Create a metrics collector.
     *
     * @param namespace Prometheus namespace prefix
     */
    public VedaMetrics(String namespace) {
        this.namespace = namespace;
    }

    /**
     * Get the default singleton metrics instance.
     */
    public static VedaMetrics getDefault() {
        return DEFAULT;
    }

    // ── Counters ──────────────────────────────────────────────────

    /**
     * Increment a counter by 1.
     */
    public void increment(String name) {
        counters.computeIfAbsent(name, k -> new AtomicLong(0)).incrementAndGet();
    }

    /**
     * Increment a counter by a given amount.
     */
    public void increment(String name, long amount) {
        counters.computeIfAbsent(name, k -> new AtomicLong(0)).addAndGet(amount);
    }

    /**
     * Record an error occurrence.
     */
    public void recordError(String errorType) {
        totalErrors.increment();
        increment("errors_" + errorType);
    }

    // ── Timers ────────────────────────────────────────────────────

    /**
     * Record a query execution time.
     */
    public void recordQuery(String queryType, long durationMs) {
        totalQueries.increment();
        timers.computeIfAbsent("query_" + queryType, k -> new Timer()).record(durationMs);
    }

    /**
     * Record a timer for any operation.
     */
    public void recordTimer(String name, long durationMs) {
        timers.computeIfAbsent(name, k -> new Timer()).record(durationMs);
    }

    /**
     * Time a runnable and record its duration.
     */
    public void time(String name, Runnable runnable) {
        long start = System.currentTimeMillis();
        try {
            runnable.run();
        } finally {
            recordTimer(name, System.currentTimeMillis() - start);
        }
    }

    /**
     * Time a callable and record its duration.
     */
    public <T> T time(String name, java.util.concurrent.Callable<T> callable) throws Exception {
        long start = System.currentTimeMillis();
        try {
            return callable.call();
        } finally {
            recordTimer(name, System.currentTimeMillis() - start);
        }
    }

    // ── Connection tracking ───────────────────────────────────────

    /**
     * Increment active connection count.
     */
    public void connectionAcquired() {
        activeConnections.incrementAndGet();
    }

    /**
     * Decrement active connection count.
     */
    public void connectionReleased() {
        activeConnections.decrementAndGet();
    }

    // ── Getters ───────────────────────────────────────────────────

    public long getCounter(String name) {
        AtomicLong counter = counters.get(name);
        return counter != null ? counter.get() : 0;
    }

    public Timer getTimer(String name) {
        return timers.getOrDefault(name, new Timer());
    }

    public long getTotalQueries() {
        return totalQueries.sum();
    }

    public long getTotalErrors() {
        return totalErrors.sum();
    }

    public long getActiveConnections() {
        return activeConnections.get();
    }

    public Map<String, Long> getAllCounters() {
        Map<String, Long> result = new ConcurrentHashMap<>();
        for (Map.Entry<String, AtomicLong> entry : counters.entrySet()) {
            result.put(entry.getKey(), entry.getValue().get());
        }
        return result;
    }

    // ── Prometheus Export ─────────────────────────────────────────

    /**
     * Export metrics in Prometheus text format.
     */
    public String exportPrometheus() {
        StringBuilder sb = new StringBuilder();
        String ns = namespace;

        // Counters
        for (Map.Entry<String, AtomicLong> entry : counters.entrySet()) {
            String name = ns + "_" + sanitizeName(entry.getKey()) + "_total";
            sb.append("# TYPE ").append(name).append(" counter\n");
            sb.append(name).append(" ").append(entry.getValue().get()).append("\n");
        }

        // Query total
        sb.append("# TYPE ").append(ns).append("_queries_total counter\n");
        sb.append(ns).append("_queries_total ").append(totalQueries.sum()).append("\n");

        // Errors total
        sb.append("# TYPE ").append(ns).append("_errors_total counter\n");
        sb.append(ns).append("_errors_total ").append(totalErrors.sum()).append("\n");

        // Active connections gauge
        sb.append("# TYPE ").append(ns).append("_active_connections gauge\n");
        sb.append(ns).append("_active_connections ").append(activeConnections.get()).append("\n");

        // Timers
        for (Map.Entry<String, Timer> entry : timers.entrySet()) {
            String name = ns + "_" + sanitizeName(entry.getKey()) + "_ms";
            Timer timer = entry.getValue();
            sb.append("# TYPE ").append(name).append(" summary\n");
            sb.append(name).append("_count ").append(timer.getCount()).append("\n");
            sb.append(name).append("_sum ").append(timer.getTotalMs()).append("\n");
            sb.append(name).append("_max ").append(timer.getMaxMs()).append("\n");
            sb.append(name).append("_avg ").append(String.format("%.2f", timer.getAvgMs())).append("\n");
        }

        return sb.toString();
    }

    /**
     * Reset all metrics.
     */
    public void reset() {
        counters.clear();
        timers.clear();
        totalQueries.reset();
        totalErrors.reset();
    }

    private static String sanitizeName(String name) {
        return name.replaceAll("[^a-zA-Z0-9_]", "_").toLowerCase();
    }
}
