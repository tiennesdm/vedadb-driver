package io.vedadb;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

/**
 * Async VedaDB client built on top of the synchronous {@link VedaClient}.
 * All operations return {@link CompletableFuture} for non-blocking usage.
 *
 * <p>Example:
 * <pre>{@code
 * VedaAsyncClient async = new VedaAsyncClient("localhost", 6380);
 * async.queryAsync("SELECT * FROM users;")
 *     .thenAccept(result -> System.out.println(result.getRows()));
 * }</pre>
 */
public class VedaAsyncClient implements AutoCloseable {

    private final VedaClient syncClient;
    private final ExecutorService executor;

    /**
     * Create an async client connecting to the given host and port.
     */
    public VedaAsyncClient(String host, int port) throws IOException, VedaException {
        this.syncClient = new VedaClient(host, port);
        this.executor = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "vedadb-async-" + System.nanoTime());
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * Create an async client with TLS and authentication.
     */
    public VedaAsyncClient(String host, int port, boolean useTls, String username, String password)
            throws IOException, VedaException {
        this.syncClient = new VedaClient(host, port, useTls, username, password);
        this.executor = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "vedadb-async-" + System.nanoTime());
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * Create an async client wrapping an existing synchronous client.
     */
    public VedaAsyncClient(VedaClient syncClient) {
        this.syncClient = syncClient;
        this.executor = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "vedadb-async-" + System.nanoTime());
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * Execute a query asynchronously.
     */
    public CompletableFuture<VedaResult> queryAsync(String sql) {
        return supplyAsync(() -> syncClient.query(sql));
    }

    /**
     * Execute a statement asynchronously (INSERT/UPDATE/DELETE/DDL).
     */
    public CompletableFuture<String> execAsync(String sql) {
        return supplyAsync(() -> syncClient.exec(sql));
    }

    /**
     * Insert a row asynchronously.
     */
    public CompletableFuture<String> insertAsync(String table, Map<String, Object> data) {
        return supplyAsync(() -> syncClient.insert(table, data));
    }

    /**
     * Select rows asynchronously.
     */
    public CompletableFuture<VedaResult> selectAsync(String table, String columns,
                                                       String where, String orderBy, int limit) {
        return supplyAsync(() -> syncClient.select(table, columns, where, orderBy, limit));
    }

    /**
     * Update rows asynchronously.
     */
    public CompletableFuture<String> updateAsync(String table, Map<String, Object> set, String where) {
        return supplyAsync(() -> syncClient.update(table, set, where));
    }

    /**
     * Delete rows asynchronously.
     */
    public CompletableFuture<String> deleteAsync(String table, String where) {
        return supplyAsync(() -> syncClient.delete(table, where));
    }

    /**
     * Show tables asynchronously.
     */
    public CompletableFuture<List<String>> showTablesAsync() {
        return supplyAsync(() -> syncClient.showTables());
    }

    /**
     * Ping the server asynchronously.
     */
    public CompletableFuture<Boolean> pingAsync() {
        return supplyAsync(() -> syncClient.ping());
    }

    // --- Transaction helpers ---

    /**
     * Begin a transaction asynchronously.
     */
    public CompletableFuture<Void> beginAsync() {
        return runAsync(() -> syncClient.begin());
    }

    /**
     * Commit the current transaction asynchronously.
     */
    public CompletableFuture<Void> commitAsync() {
        return runAsync(() -> syncClient.commit());
    }

    /**
     * Rollback the current transaction asynchronously.
     */
    public CompletableFuture<Void> rollbackAsync() {
        return runAsync(() -> syncClient.rollback());
    }

    /**
     * Execute a function inside a transaction asynchronously.
     */
    public <T> CompletableFuture<T> transactionAsync(java.util.function.Function<VedaClient, T> fn) {
        return supplyAsync(() -> syncClient.transaction(fn));
    }

    // --- Prepared statements ---

    /**
     * Prepare a statement asynchronously.
     */
    public CompletableFuture<VedaResult> prepareAsync(String name, String query) {
        return supplyAsync(() -> syncClient.prepare(name, query));
    }

    /**
     * Execute a prepared statement asynchronously.
     */
    public CompletableFuture<VedaResult> executePreparedAsync(String name, String... params) {
        return supplyAsync(() -> syncClient.executePrepared(name, params));
    }

    /**
     * Deallocate a prepared statement asynchronously.
     */
    public CompletableFuture<VedaResult> deallocateAsync(String name) {
        return supplyAsync(() -> syncClient.deallocate(name));
    }

    // --- Cache operations ---

    /**
     * Set a cache key asynchronously.
     */
    public CompletableFuture<Void> cacheSetAsync(String key, String value, int ttl) {
        return runAsync(() -> syncClient.cacheSet(key, value, ttl));
    }

    /**
     * Get a cache key asynchronously.
     */
    public CompletableFuture<String> cacheGetAsync(String key) {
        return supplyAsync(() -> syncClient.cacheGet(key));
    }

    /**
     * Delete a cache key asynchronously.
     */
    public CompletableFuture<Void> cacheDelAsync(String key) {
        return runAsync(() -> syncClient.cacheDel(key));
    }

    // --- Internal helpers ---

    private <T> CompletableFuture<T> supplyAsync(Supplier<T> supplier) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return supplier.get();
            } catch (RuntimeException e) {
                throw e;
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }, executor);
    }

    private CompletableFuture<Void> runAsync(VedaRunnable runnable) {
        return CompletableFuture.runAsync(() -> {
            try {
                runnable.run();
            } catch (RuntimeException e) {
                throw e;
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }, executor);
    }

    @FunctionalInterface
    private interface VedaRunnable {
        void run() throws Exception;
    }

    /**
     * Close the async client and shut down the executor.
     */
    @Override
    public void close() throws IOException {
        executor.shutdownNow();
        syncClient.close();
    }
}
