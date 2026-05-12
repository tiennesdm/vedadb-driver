package io.vedadb;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Streaming cursor over a VedaDB query result set.
 *
 * <p>Provides {@link Iterator}-style access to rows, fetching in pages
 * to minimize memory usage for large result sets. Implements
 * {@link AutoCloseable} for proper resource cleanup.
 *
 * <p>Usage:
 * <pre>{@code
 * try (VedaCursor cursor = new VedaCursor(client, "SELECT * FROM large_table;", 100)) {
 *     while (cursor.hasNext()) {
 *         VedaResult.Row row = cursor.next();
 *         System.out.println(row);
 *     }
 * }
 * }</pre>
 */
public class VedaCursor implements Iterator<VedaCursor.CursorRow>, AutoCloseable {

    /**
     * Represents a single row from the cursor with named column access.
     */
    public static class CursorRow {
        private final List<String> columns;
        private final List<String> values;

        CursorRow(List<String> columns, List<String> values) {
            this.columns = columns;
            this.values = values;
        }

        /**
         * Get the value at the given column index.
         */
        public String get(int index) {
            if (index < 0 || index >= values.size()) {
                throw new IndexOutOfBoundsException("Column index " + index + " out of range");
            }
            return values.get(index);
        }

        /**
         * Get the value for the given column name.
         */
        public String get(String columnName) {
            int index = columns.indexOf(columnName);
            if (index < 0) {
                throw new IllegalArgumentException("Column not found: " + columnName);
            }
            return values.get(index);
        }

        /**
         * Check if the row has a column.
         */
        public boolean hasColumn(String columnName) {
            return columns.contains(columnName);
        }

        public List<String> getColumns() { return new ArrayList<>(columns); }
        public List<String> getValues() { return new ArrayList<>(values); }

        @Override
        public String toString() {
            return values.toString();
        }
    }

    private final VedaClient client;
    private final String baseQuery;
    private final int pageSize;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    private List<String> columns = new ArrayList<>();
    private List<CursorRow> currentPage = new ArrayList<>();
    private int currentIndex = 0;
    private long offset = 0;
    private boolean exhausted = false;

    /**
     * Create a cursor with default page size of 100.
     */
    public VedaCursor(VedaClient client, String query) {
        this(client, query, 100);
    }

    /**
     * Create a cursor.
     *
     * @param client   the VedaClient to use for fetching
     * @param query    the base SQL query (ORDER BY is strongly recommended)
     * @param pageSize number of rows to fetch per page
     */
    public VedaCursor(VedaClient client, String query, int pageSize) {
        this.client = Objects.requireNonNull(client, "client cannot be null");
        if (query == null || query.trim().isEmpty()) {
            throw new IllegalArgumentException("query cannot be null or empty");
        }
        if (pageSize <= 0) {
            throw new IllegalArgumentException("pageSize must be > 0");
        }
        // Remove trailing semicolon for appending LIMIT/OFFSET
        this.baseQuery = query.trim().replaceAll(";\\s*$", "");
        this.pageSize = pageSize;
    }

    @Override
    public boolean hasNext() {
        if (closed.get()) {
            return false;
        }

        // Still rows in current page
        if (currentIndex < currentPage.size()) {
            return true;
        }

        // Need to fetch next page
        if (!exhausted) {
            fetchPage();
            return currentIndex < currentPage.size();
        }

        return false;
    }

    @Override
    public CursorRow next() {
        if (!hasNext()) {
            throw new NoSuchElementException("No more rows in cursor");
        }
        return currentPage.get(currentIndex++);
    }

    /**
     * Fetch the next page of results.
     */
    private void fetchPage() {
        if (exhausted || closed.get()) {
            return;
        }

        try {
            String pagedQuery = baseQuery + " LIMIT " + pageSize + " OFFSET " + offset;
            VedaResult result = client.query(pagedQuery);

            if (result.getColumns() != null && !result.getColumns().isEmpty()) {
                columns = result.getColumns();
            }

            currentPage.clear();
            currentIndex = 0;

            List<List<String>> rows = result.getRows();
            if (rows == null || rows.isEmpty()) {
                exhausted = true;
                return;
            }

            for (List<String> row : rows) {
                currentPage.add(new CursorRow(columns, row));
            }

            offset += rows.size();

            // If we got fewer rows than pageSize, we've exhausted the results
            if (rows.size() < pageSize) {
                exhausted = true;
            }

        } catch (IOException | VedaException e) {
            exhausted = true;
            throw new RuntimeException("Cursor fetch failed at offset " + offset, e);
        }
    }

    /**
     * Close the cursor and free resources.
     */
    @Override
    public void close() {
        closed.set(true);
        currentPage.clear();
        columns.clear();
    }

    /**
     * Get the column names from the result set.
     */
    public List<String> getColumns() {
        return new ArrayList<>(columns);
    }

    /**
     * Get the current offset (number of rows already consumed).
     */
    public long getOffset() {
        return offset;
    }

    public boolean isClosed() {
        return closed.get();
    }

    public boolean isExhausted() {
        return exhausted;
    }
}
