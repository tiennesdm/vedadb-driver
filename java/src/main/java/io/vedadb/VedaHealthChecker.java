package io.vedadb;

import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Health checker for VedaDB connections.
 *
 * <p>Performs periodic health checks via ping and tracks the last
 * successful ping timestamp. Can run in background monitoring mode.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaHealthChecker checker = new VedaHealthChecker();
 * boolean healthy = checker.isHealthy(client);
 * checker.startMonitoring(client, 5000); // check every 5s
 * // ... later
 * long lastPing = checker.getLastPingMs();
 * checker.stopMonitoring();
 * }</pre>
 */
public class VedaHealthChecker {
    private final AtomicBoolean healthy = new AtomicBoolean(false);
    private final AtomicLong lastPingMs = new AtomicLong(0);
    private final AtomicBoolean monitoring = new AtomicBoolean(false);
    private ScheduledExecutorService executor;

    /**
     * Check if the client connection is healthy by sending a ping.
     *
     * @param client the VedaClient to check
     * @return true if the client responds to ping
     */
    public boolean isHealthy(VedaClient client) {
        if (client == null) {
            healthy.set(false);
            return false;
        }
        try {
            boolean result = client.ping();
            if (result) {
                lastPingMs.set(System.currentTimeMillis());
            }
            healthy.set(result);
            return result;
        } catch (Exception e) {
            healthy.set(false);
            return false;
        }
    }

    /**
     * Start background health monitoring.
     *
     * @param client     the VedaClient to monitor
     * @param intervalMs interval between health checks in milliseconds
     */
    public void startMonitoring(VedaClient client, long intervalMs) {
        if (monitoring.get()) {
            return;
        }
        if (intervalMs <= 0) {
            throw new IllegalArgumentException("intervalMs must be > 0");
        }
        monitoring.set(true);
        executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "veda-health-checker");
            t.setDaemon(true);
            return t;
        });
        executor.scheduleAtFixedRate(() -> {
            if (!monitoring.get()) {
                return;
            }
            try {
                isHealthy(client);
            } catch (Exception e) {
                healthy.set(false);
            }
        }, intervalMs, intervalMs, TimeUnit.MILLISECONDS);
    }

    /**
     * Stop background health monitoring.
     */
    public void stopMonitoring() {
        monitoring.set(false);
        if (executor != null) {
            executor.shutdownNow();
            try {
                executor.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            executor = null;
        }
    }

    /**
     * Get the timestamp of the last successful ping.
     *
     * @return epoch millis of last successful ping, or 0 if never pinged
     */
    public long getLastPingMs() {
        return lastPingMs.get();
    }

    /**
     * Check if the last known health status was healthy.
     */
    public boolean isLastKnownHealthy() {
        return healthy.get();
    }

    /**
     * Check if background monitoring is active.
     */
    public boolean isMonitoring() {
        return monitoring.get();
    }
}
