package io.vedadb;

import java.io.IOException;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Thread-safe connection pool for VedaDB.
 *
 * Usage:
 *   VedaPool pool = new VedaPool("localhost", 6380, 10);
 *   VedaClient client = pool.acquire();
 *   try {
 *       VedaResult result = client.query("SELECT * FROM users;");
 *   } finally {
 *       pool.release(client);
 *   }
 *   pool.close();
 */
public class VedaPool {
    private final String host;
    private final int port;
    private final int maxSize;
    private final BlockingQueue<VedaClient> idle;
    private final AtomicInteger activeCount = new AtomicInteger(0);
    private final AtomicBoolean closed = new AtomicBoolean(false);

    /**
     * Create a connection pool.
     *
     * @param host    Server host
     * @param port    Server port
     * @param maxSize Maximum number of pooled (idle) connections
     */
    public VedaPool(String host, int port, int maxSize) {
        this.host = host;
        this.port = port;
        this.maxSize = maxSize;
        this.idle = new LinkedBlockingQueue<>(maxSize);
    }

    /**
     * Acquire a connected VedaClient from the pool.
     * Reuses an idle connection if available, otherwise creates a new one.
     *
     * @return a connected VedaClient
     * @throws IOException if connection fails
     */
    public VedaClient acquire() throws IOException, VedaException {
        if (closed.get()) {
            throw new IOException("Pool is closed");
        }

        // Try to reuse an idle connection.
        VedaClient client = idle.poll();
        if (client != null) {
            activeCount.incrementAndGet();
            return client;
        }

        // Create a new connection.
        client = new VedaClient(host, port);
        activeCount.incrementAndGet();
        return client;
    }

    /**
     * Release a client back to the pool.
     * If the pool is full or closed, the client is closed instead.
     *
     * @param client the client to release
     */
    public void release(VedaClient client) {
        if (client == null) {
            return;
        }

        activeCount.decrementAndGet();

        if (closed.get() || !idle.offer(client)) {
            try {
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    /**
     * Close all idle connections in the pool.
     */
    public void close() {
        closed.set(true);
        VedaClient client;
        while ((client = idle.poll()) != null) {
            try {
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    /**
     * @return the number of currently active (checked-out) connections
     */
    public int getActiveCount() {
        return activeCount.get();
    }

    /**
     * @return the number of idle connections in the pool
     */
    public int getIdleCount() {
        return idle.size();
    }

    /**
     * @return true if the pool has been closed
     */
    public boolean isClosed() {
        return closed.get();
    }
}
