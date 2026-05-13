package io.vedadb;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;

/**
 * ChangeStream subscribes to table changes (CDC) from VedaDB.
 *
 * <p>Supports filtering by operation type, resuming from checkpoint,
 * and streaming events to registered listeners.</p>
 *
 * <p>Example:
 * <pre>{@code
 * ChangeStream stream = client.watch("users")
 *     .filterOperations("INSERT", "UPDATE")
 *     .resumeFromLSN(12345)
 *     .start();
 *
 * stream.onEvent(event -> System.out.println(event.getOperation()));
 * }</pre>
 */
public class ChangeStream {

    private final VedaClient client;
    private final ChangeStreamConfig config;
    private final BlockingQueue<ChangeEvent> events;
    private final BlockingQueue<Exception> errors;
    private final AtomicBoolean active;
    private final AtomicLong lastLSN;
    private final List<java.util.function.Consumer<ChangeEvent>> listeners;
    private volatile Thread workerThread;

    /**
     * Configuration for a change stream.
     */
    public static class ChangeStreamConfig {
        private String table;
        private Set<String> operations = new HashSet<>();
        private long resumeFromLSN;
        private boolean includeBefore;
        private List<String> keyColumns = new ArrayList<>();

        public String getTable() { return table; }
        public void setTable(String table) { this.table = table; }
        public Set<String> getOperations() { return operations; }
        public void setOperations(Set<String> operations) { this.operations = operations; }
        public long getResumeFromLSN() { return resumeFromLSN; }
        public void setResumeFromLSN(long lsn) { this.resumeFromLSN = lsn; }
        public boolean isIncludeBefore() { return includeBefore; }
        public void setIncludeBefore(boolean v) { this.includeBefore = v; }
        public List<String> getKeyColumns() { return keyColumns; }
        public void setKeyColumns(List<String> cols) { this.keyColumns = cols; }
    }

    /**
     * A single change event.
     */
    public static class ChangeEvent {
        private String operation;
        private String table;
        private long timestamp;
        private long lsn;
        private Map<String, Object> before;
        private Map<String, Object> after;
        private Map<String, Object> keys;

        public String getOperation() { return operation; }
        public void setOperation(String op) { this.operation = op; }
        public String getTable() { return table; }
        public void setTable(String table) { this.table = table; }
        public long getTimestamp() { return timestamp; }
        public void setTimestamp(long ts) { this.timestamp = ts; }
        public long getLSN() { return lsn; }
        public void setLSN(long lsn) { this.lsn = lsn; }
        public Map<String, Object> getBefore() { return before; }
        public void setBefore(Map<String, Object> v) { this.before = v; }
        public Map<String, Object> getAfter() { return after; }
        public void setAfter(Map<String, Object> v) { this.after = v; }
        public Map<String, Object> getKeys() { return keys; }
        public void setKeys(Map<String, Object> v) { this.keys = v; }

        @Override
        public String toString() {
            return String.format("ChangeEvent{op=%s, table=%s, lsn=%d}", operation, table, lsn);
        }
    }

    ChangeStream(VedaClient client, ChangeStreamConfig config) {
        this.client = client;
        this.config = config;
        this.events = new LinkedBlockingQueue<>(100);
        this.errors = new LinkedBlockingQueue<>(10);
        this.active = new AtomicBoolean(false);
        this.lastLSN = new AtomicLong(config.getResumeFromLSN());
        this.listeners = new CopyOnWriteArrayList<>();
    }

    /**
     * Add an operation filter.
     */
    public ChangeStream filterOperations(String... ops) {
        config.getOperations().addAll(Arrays.asList(ops));
        return this;
    }

    /**
     * Resume from a specific LSN.
     */
    public ChangeStream resumeFromLSN(long lsn) {
        config.setResumeFromLSN(lsn);
        lastLSN.set(lsn);
        return this;
    }

    /**
     * Include before-images in UPDATE events.
     */
    public ChangeStream includeBefore(boolean v) {
        config.setIncludeBefore(v);
        return this;
    }

    /**
     * Start consuming change events.
     */
    public ChangeStream start() {
        if (active.compareAndSet(false, true)) {
            workerThread = new Thread(this::run);
            workerThread.setDaemon(true);
            workerThread.setName("vedadb-changestream-" + System.nanoTime());
            workerThread.start();
        }
        return this;
    }

    /**
     * Stop the change stream.
     */
    public void stop() {
        active.set(false);
        if (workerThread != null) {
            workerThread.interrupt();
        }
    }

    /**
     * Check if the stream is active.
     */
    public boolean isActive() {
        return active.get();
    }

    /**
     * Get the most recent processed LSN.
     */
    public long getLastLSN() {
        return lastLSN.get();
    }

    /**
     * Poll for the next event (blocks up to timeout).
     */
    public ChangeEvent pollEvent(long timeoutMs) throws InterruptedException {
        return events.poll(timeoutMs, TimeUnit.MILLISECONDS);
    }

    /**
     * Register a listener for change events.
     */
    public void onEvent(java.util.function.Consumer<ChangeEvent> listener) {
        listeners.add(listener);
    }

    private void run() {
        while (active.get() && !Thread.currentThread().isInterrupted()) {
            try {
                String sql = buildWatchSQL();
                VedaResult result = client.query(sql);

                for (Map<String, Object> row : result.toDicts()) {
                    ChangeEvent event = parseRow(row);
                    if (event == null || !matchesFilter(event)) {
                        continue;
                    }
                    lastLSN.set(event.getLSN());
                    events.offer(event, 1, TimeUnit.SECONDS);
                    for (java.util.function.Consumer<ChangeEvent> listener : listeners) {
                        try {
                            listener.accept(event);
                        } catch (Exception e) {
                            // Listener exceptions should not stop the stream
                        }
                    }
                }
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                errors.offer(e);
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    private String buildWatchSQL() {
        StringBuilder sb = new StringBuilder("WATCH");
        if (config.getTable() != null) {
            sb.append(" ").append(config.getTable());
        }
        if (config.getResumeFromLSN() > 0) {
            sb.append(" RESUME LSN ").append(config.getResumeFromLSN());
        }
        if (!config.getOperations().isEmpty()) {
            sb.append(" FILTER (");
            sb.append(String.join(",", config.getOperations()));
            sb.append(")");
        }
        sb.append(";");
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private ChangeEvent parseRow(Map<String, Object> row) {
        ChangeEvent event = new ChangeEvent();
        event.setOperation(String.valueOf(row.getOrDefault("operation", "")));
        event.setTable(String.valueOf(row.getOrDefault("table", "")));
        try {
            event.setTimestamp(Long.parseLong(String.valueOf(row.getOrDefault("timestamp", "0"))));
        } catch (NumberFormatException e) {
            event.setTimestamp(0);
        }
        try {
            event.setLSN(Long.parseLong(String.valueOf(row.getOrDefault("lsn", "0"))));
        } catch (NumberFormatException e) {
            event.setLSN(0);
        }
        Object before = row.get("before");
        if (config.isIncludeBefore() && before instanceof Map) {
            event.setBefore((Map<String, Object>) before);
        }
        Object after = row.get("after");
        if (after instanceof Map) {
            event.setAfter((Map<String, Object>) after);
        }
        Object keys = row.get("keys");
        if (keys instanceof Map) {
            event.setKeys((Map<String, Object>) keys);
        }
        return event;
    }

    private boolean matchesFilter(ChangeEvent event) {
        if (config.getOperations().isEmpty()) {
            return true;
        }
        return config.getOperations().stream()
            .anyMatch(op -> op.equalsIgnoreCase(event.getOperation()));
    }
}
