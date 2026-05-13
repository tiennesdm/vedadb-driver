package io.vedadb;

import java.io.IOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Async connection pool for VedaDB with CompletableFuture return types.
 *
 * <p>Manages a pool of {@link VedaClient} instances and provides
 * async acquire/release semantics.</p>
 */
public class VedaAsyncPool implements AutoCloseable {

    private final BlockingQueue<VedaClient> pool;
    private final VedaPoolConfig config;
    private volatile boolean closed = false;

    /**
     * Pool configuration.
     */
    public static class VedaPoolConfig {
        public final String host;
        public final int port;
        public final boolean useTls;
        public final String username;
        public final String password;
        public final int maxSize;
        public final long acquireTimeoutMs;

        public VedaPoolConfig(String host, int port, boolean useTls,
                              String username, String password,
                              int maxSize, long acquireTimeoutMs) {
            this.host = host;
            this.port = port;
            this.useTls = useTls;
            this.username = username;
            this.password = password;
            this.maxSize = maxSize;
            this.acquireTimeoutMs = acquireTimeoutMs;
        }

        public VedaPoolConfig(String host, int port, int maxSize) {
            this(host, port, false, null, null, maxSize, 30000L);
        }
    }

    /**
     * Create a new async connection pool.
     */
    public VedaAsyncPool(VedaPoolConfig config) throws IOException, VedaException {
        this.config = config;
        this.pool = new ArrayBlockingQueue<>(config.maxSize);
        for (int i = 0; i < config.maxSize; i++) {
            VedaClient client;
            if (config.useTls || config.username != null) {
                client = new VedaClient(config.host, config.port,
                        config.useTls, config.username, config.password);
            } else {
                client = new VedaClient(config.host, config.port);
            }
            pool.offer(client);
        }
    }

    /**
     * Acquire a client from the pool asynchronously.
     */
    public CompletableFuture<VedaClient> acquireAsync() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                VedaClient client = pool.poll(config.acquireTimeoutMs, TimeUnit.MILLISECONDS);
                if (client == null) {
                    throw new RuntimeException(new TimeoutException(
                        "Pool exhausted: could not acquire connection within "
                            + config.acquireTimeoutMs + "ms"));
                }
                return client;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException("Interrupted while acquiring connection", e);
            }
        });
    }

    /**
     * Release a client back to the pool.
     */
    public CompletableFuture<Void> releaseAsync(VedaClient client) {
        return CompletableFuture.runAsync(() -> {
            if (client != null && !closed) {
                pool.offer(client);
            }
        });
    }

    /**
     * Execute an operation with a pooled client.
     */
    public <T> CompletableFuture<T> withClientAsync(java.util.function.Function<VedaClient, T> fn) {
        return acquireAsync().thenApply(client -> {
            try {
                return fn.apply(client);
            } finally {
                releaseAsync(client);
            }
        });
    }

    /**
     * Get current pool statistics.
     */
    public PoolStats stats() {
        return new PoolStats(pool.size(), config.maxSize, closed);
    }

    @Override
    public void close() {
        closed = true;
        VedaClient client;
        while ((client = pool.poll()) != null) {
            try {
                client.close();
            } catch (IOException ignored) {}
        }
    }

    /**
     * Pool statistics snapshot.
     */
    public static class PoolStats {
        public final int available;
        public final int maxSize;
        public final boolean closed;

        public PoolStats(int available, int maxSize, boolean closed) {
            this.available = available;
            this.maxSize = maxSize;
            this.closed = closed;
        }

        @Override
        public String toString() {
            return "PoolStats{available=" + available + ", max=" + maxSize + ", closed=" + closed + "}";
        }
    }
}
