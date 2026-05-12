package io.vedadb;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Bulk inserter for VedaDB with batching support.
 *
 * <p>Accumulates rows in a buffer and flushes when the batch size is reached
 * or on explicit {@link #flush()} call. Implements {@link AutoCloseable} to
 * ensure remaining rows are flushed on close.
 *
 * <p>Usage:
 * <pre>{@code
 * try (VedaBulkInserter inserter = new VedaBulkInserter(client, "users", 100)) {
 *     Map<String, Object> row = new LinkedHashMap<>();
 *     row.put("name", "Alice");
 *     row.put("age", 30);
 *     inserter.add(row);
 *     // ... more rows
 * }
 * }</pre>
 */
public class VedaBulkInserter implements AutoCloseable {
    private final VedaClient client;
    private final String table;
    private final int batchSize;
    private final List<Map<String, Object>> buffer;
    private final Object lock = new Object();
    private boolean closed = false;
    private long totalFlushed = 0;

    /**
     * Create a bulk inserter.
     *
     * @param client    the VedaClient to use
     * @param table     target table name
     * @param batchSize number of rows to accumulate before flushing
     */
    public VedaBulkInserter(VedaClient client, String table, int batchSize) {
        if (client == null) throw new IllegalArgumentException("client cannot be null");
        if (table == null || table.isEmpty()) throw new IllegalArgumentException("table cannot be null or empty");
        if (batchSize <= 0) throw new IllegalArgumentException("batchSize must be > 0");
        this.client = client;
        this.table = table;
        this.batchSize = batchSize;
        this.buffer = new ArrayList<>();
    }

    /**
     * Add a row to the buffer. Flushes automatically if buffer reaches batch size.
     *
     * @param row column name to value mapping
     * @throws IOException    on I/O error
     * @throws VedaException  on VedaDB error
     */
    public void add(Map<String, Object> row) throws IOException, VedaException {
        if (closed) {
            throw new IllegalStateException("BulkInserter is closed");
        }
        if (row == null || row.isEmpty()) {
            return;
        }
        synchronized (lock) {
            buffer.add(new LinkedHashMap<>(row));
            if (buffer.size() >= batchSize) {
                flush();
            }
        }
    }

    /**
     * Flush all buffered rows to the database in a batch INSERT.
     *
     * @throws IOException   on I/O error
     * @throws VedaException on VedaDB error
     */
    public void flush() throws IOException, VedaException {
        synchronized (lock) {
            if (buffer.isEmpty()) {
                return;
            }

            StringBuilder sql = new StringBuilder();
            sql.append("INSERT INTO ").append(table).append(" ");

            // Build column list from first row
            List<String> columns = new ArrayList<>(buffer.get(0).keySet());
            sql.append("(").append(String.join(", ", columns)).append(") VALUES ");

            for (int r = 0; r < buffer.size(); r++) {
                if (r > 0) sql.append(", ");
                sql.append("(");
                Map<String, Object> row = buffer.get(r);
                for (int c = 0; c < columns.size(); c++) {
                    if (c > 0) sql.append(", ");
                    sql.append(formatValue(row.get(columns.get(c))));
                }
                sql.append(")");
            }
            sql.append(";");

            client.exec(sql.toString());
            totalFlushed += buffer.size();
            buffer.clear();
        }
    }

    /**
     * Flush remaining rows and mark as closed.
     */
    @Override
    public void close() throws IOException, VedaException {
        if (closed) return;
        synchronized (lock) {
            flush();
            closed = true;
        }
    }

    /**
     * Get the number of rows currently buffered (not yet flushed).
     */
    public int getBufferedCount() {
        synchronized (lock) {
            return buffer.size();
        }
    }

    /**
     * Get the total number of rows flushed so far.
     */
    public long getTotalFlushed() {
        return totalFlushed;
    }

    public boolean isClosed() {
        return closed;
    }

    public String getTable() {
        return table;
    }

    public int getBatchSize() {
        return batchSize;
    }

    /**
     * Format a value for SQL insertion.
     */
    private static String formatValue(Object value) {
        if (value == null) return "NULL";
        if (value instanceof String) return "'" + ((String) value).replace("'", "''") + "'";
        if (value instanceof Boolean) return ((Boolean) value) ? "TRUE" : "FALSE";
        return value.toString();
    }
}
