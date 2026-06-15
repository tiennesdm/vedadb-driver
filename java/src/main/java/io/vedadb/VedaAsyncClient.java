package io.vedadb;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
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
        return supplyAsync(() -> { try { return syncClient.query(sql); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Execute a statement asynchronously (INSERT/UPDATE/DELETE/DDL).
     */
    public CompletableFuture<String> execAsync(String sql) {
        return supplyAsync(() -> { try { return syncClient.exec(sql); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Insert a row asynchronously.
     */
    public CompletableFuture<String> insertAsync(String table, Map<String, Object> data) {
        return supplyAsync(() -> { try { return syncClient.insert(table, data); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Select rows asynchronously.
     */
    public CompletableFuture<VedaResult> selectAsync(String table, String columns,
                                                       String where, String orderBy, int limit) {
        return supplyAsync(() -> { try { return syncClient.select(table, columns, where, orderBy, limit); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Update rows asynchronously.
     */
    public CompletableFuture<String> updateAsync(String table, Map<String, Object> set, String where) {
        return supplyAsync(() -> { try { return syncClient.update(table, set, where); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Delete rows asynchronously.
     */
    public CompletableFuture<String> deleteAsync(String table, String where) {
        return supplyAsync(() -> { try { return syncClient.delete(table, where); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Show tables asynchronously.
     */
    public CompletableFuture<List<String>> showTablesAsync() {
        return supplyAsync(() -> { try { return syncClient.showTables(); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Ping the server asynchronously.
     */
    public CompletableFuture<Boolean> pingAsync() {
        return supplyAsync(() -> { try { return syncClient.ping(); } catch (Exception e) { throw new CompletionException(e); } });
    }

    // --- Transaction helpers ---

    /**
     * Begin a transaction asynchronously.
     */
    public CompletableFuture<Void> beginAsync() {
        return runAsync(() -> { try { syncClient.begin(); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Commit the current transaction asynchronously.
     */
    public CompletableFuture<Void> commitAsync() {
        return runAsync(() -> { try { syncClient.commit(); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Rollback the current transaction asynchronously.
     */
    public CompletableFuture<Void> rollbackAsync() {
        return runAsync(() -> { try { syncClient.rollback(); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Execute a function inside a transaction asynchronously.
     */
    public <T> CompletableFuture<T> transactionAsync(java.util.function.Function<VedaClient, T> fn) {
        return supplyAsync(() -> { try { return syncClient.transaction(fn); } catch (Exception e) { throw new CompletionException(e); } });
    }

    // --- Prepared statements ---

    /**
     * Prepare a statement asynchronously.
     */
    public CompletableFuture<VedaResult> prepareAsync(String name, String query) {
        return supplyAsync(() -> { try { return syncClient.prepare(name, query); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Execute a prepared statement asynchronously.
     */
    public CompletableFuture<VedaResult> executePreparedAsync(String name, String... params) {
        return supplyAsync(() -> { try { return syncClient.executePrepared(name, params); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Deallocate a prepared statement asynchronously.
     */
    public CompletableFuture<VedaResult> deallocateAsync(String name) {
        return supplyAsync(() -> { try { return syncClient.deallocate(name); } catch (Exception e) { throw new CompletionException(e); } });
    }

    // --- Cache operations ---

    /**
     * Set a cache key asynchronously.
     */
    public CompletableFuture<Void> cacheSetAsync(String key, String value, int ttl) {
        return runAsync(() -> { try { syncClient.cacheSet(key, value, ttl); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Get a cache key asynchronously.
     */
    public CompletableFuture<String> cacheGetAsync(String key) {
        return supplyAsync(() -> { try { return syncClient.cacheGet(key); } catch (Exception e) { throw new CompletionException(e); } });
    }

    /**
     * Delete a cache key asynchronously.
     */
    public CompletableFuture<Void> cacheDelAsync(String key) {
        return runAsync(() -> { try { syncClient.cacheDel(key); } catch (Exception e) { throw new CompletionException(e); } });
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

    /**
     * Wrap a checked-exception supplier for use in CompletableFuture.supplyAsync.
     * Re-throws as CompletionException so the future fails with the original cause.
     */
    private static <T> java.util.function.Supplier<T> wrap(java.util.function.Supplier<T> s) {
        return () -> { try { return s.get(); } catch (Exception e) { throw new CompletionException(e); } };
    }

    private static Runnable wrapRunnable(Runnable r) {
        return () -> { try { r.run(); } catch (Exception e) { throw new CompletionException(e); } };
    }

}
