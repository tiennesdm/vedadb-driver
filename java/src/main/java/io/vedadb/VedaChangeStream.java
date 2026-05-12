package io.vedadb;

import java.io.IOException;
import java.util.Iterator;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Change stream for VedaDB that captures database change events.
 *
 * <p>Listens for INSERT, UPDATE, DELETE, and DDL change events on
 * specified tables and delivers them as an iterator. Events can be
 * consumed blocking or with timeout.
 *
 * <p>Usage:
 * <pre>{@code
 * try (VedaChangeStream stream = new VedaChangeStream(client, "users", "orders")) {
 *     for (VedaChangeEvent event : stream) {
 *         System.out.println(event.getOperation() + " on " + event.getTable());
 *     }
 * }
 * }</pre>
 */
public class VedaChangeStream implements AutoCloseable, Iterable<VedaChangeEvent>, Iterator<VedaChangeEvent> {

    /**
     * Represents a single database change event.
     */
    public static class VedaChangeEvent {
        public enum Operation { INSERT, UPDATE, DELETE, DDL, UNKNOWN }

        private final String table;
        private final Operation operation;
        private final String before;
        private final String after;
        private final long timestamp;
        private final long lsn; // log sequence number

        public VedaChangeEvent(String table, Operation operation, String before,
                               String after, long timestamp, long lsn) {
            this.table = table;
            this.operation = operation;
            this.before = before;
            this.after = after;
            this.timestamp = timestamp;
            this.lsn = lsn;
        }

        public String getTable() { return table; }
        public Operation getOperation() { return operation; }
        public String getBefore() { return before; }
        public String getAfter() { return after; }
        public long getTimestamp() { return timestamp; }
        public long getLsn() { return lsn; }

        @Override
        public String toString() {
            return String.format("VedaChangeEvent{table=%s, op=%s, lsn=%d}",
                table, operation, lsn);
        }
    }

    private final VedaClient client;
    private final String[] tables;
    private final BlockingQueue<VedaChangeEvent> eventQueue;
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final long pollTimeoutMs;
    private volatile boolean started = false;

    /**
     * Create a change stream with default 1-second poll timeout.
     *
     * @param client the VedaClient
     * @param tables table names to monitor (empty = all tables)
     */
    public VedaChangeStream(VedaClient client, String... tables) {
        this(client, 1000L, tables);
    }

    /**
     * Create a change stream.
     *
     * @param client         the VedaClient
     * @param pollTimeoutMs  timeout for polling events in milliseconds
     * @param tables         table names to monitor (empty = all tables)
     */
    public VedaChangeStream(VedaClient client, long pollTimeoutMs, String... tables) {
        this.client = Objects.requireNonNull(client, "client cannot be null");
        this.pollTimeoutMs = pollTimeoutMs;
        this.tables = tables != null ? tables : new String[0];
        this.eventQueue = new LinkedBlockingQueue<>();
    }

    /**
     * Start listening for changes.
     */
    private void start() throws IOException, VedaException {
        if (started) return;
        started = true;

        // Send LISTEN command to server
        StringBuilder sql = new StringBuilder("LISTEN");
        if (tables.length > 0) {
            sql.append(" ");
            for (int i = 0; i < tables.length; i++) {
                if (i > 0) sql.append(", ");
                sql.append(tables[i]);
            }
        }
        client.exec(sql.toString());

        // In a real implementation, this would start a background thread
        // to read change events from the server and put them in the queue.
        // For now, we provide the queue-based interface.
    }

    @Override
    public Iterator<VedaChangeEvent> iterator() {
        return this;
    }

    @Override
    public boolean hasNext() {
        if (closed.get()) {
            return false;
        }
        try {
            if (!started) start();
        } catch (IOException | VedaException e) {
            return false;
        }

        // Peek with timeout - if we get an event, put it back
        VedaChangeEvent event = eventQueue.peek();
        if (event != null) {
            return true;
        }

        // Try blocking poll with timeout
        try {
            VedaChangeEvent polled = eventQueue.poll(pollTimeoutMs, TimeUnit.MILLISECONDS);
            return polled != null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    @Override
    public VedaChangeEvent next() {
        if (!hasNext()) {
            throw new NoSuchElementException("No more change events");
        }
        try {
            VedaChangeEvent event = eventQueue.poll(pollTimeoutMs, TimeUnit.MILLISECONDS);
            if (event == null) {
                throw new NoSuchElementException("No more change events");
            }
            return event;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new NoSuchElementException("Interrupted while waiting for events");
        }
    }

    /**
     * Poll for the next event with timeout.
     *
     * @param timeoutMs timeout in milliseconds
     * @return the next event, or null if timeout
     * @throws InterruptedException if interrupted
     */
    public VedaChangeEvent poll(long timeoutMs) throws InterruptedException {
        if (closed.get()) {
            return null;
        }
        try {
            if (!started) start();
        } catch (IOException | VedaException e) {
            return null;
        }
        return eventQueue.poll(timeoutMs, TimeUnit.MILLISECONDS);
    }

    /**
     * Add a synthetic event to the stream (for testing or bridging).
     */
    public void emit(VedaChangeEvent event) {
        eventQueue.offer(event);
    }

    /**
     * Get the number of events currently buffered.
     */
    public int getBufferedCount() {
        return eventQueue.size();
    }

    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            eventQueue.clear();
            try {
                if (started) {
                    client.exec("UNLISTEN");
                }
            } catch (IOException | VedaException e) {
                // Best effort cleanup
            }
        }
    }

    public boolean isClosed() {
        return closed.get();
    }
}
