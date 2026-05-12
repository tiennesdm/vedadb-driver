package io.vedadb;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Middleware interceptor chain for VedaDB operations.
 *
 * <p>Allows registering interceptors that can inspect and transform
 * queries before execution and results after execution. Follows the
 * chain-of-responsibility pattern.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
 * chain.addInterceptor(new VedaInterceptor() {
 *     public void beforeQuery(String sql) { System.out.println("Before: " + sql); }
 *     public void afterQuery(String sql, VedaResult result) { System.out.println("After: " + result); }
 * });
 * VedaResult result = chain.query("SELECT * FROM users;");
 * }</pre>
 */
public class VedaInterceptor {

    /**
     * Interface for intercepting VedaDB operations.
     */
    public interface Interceptor {
        /**
         * Called before a query is executed.
         *
         * @param sql the SQL query about to be executed
         * @return the (possibly modified) SQL to execute, or null to cancel
         */
        default String beforeQuery(String sql) {
            return sql;
        }

        /**
         * Called after a query is executed.
         *
         * @param sql    the SQL that was executed
         * @param result the query result
         */
        default void afterQuery(String sql, VedaResult result) {
        }

        /**
         * Called when an exception occurs during query execution.
         *
         * @param sql       the SQL that failed
         * @param exception the exception that occurred
         */
        default void onError(String sql, Exception exception) {
        }
    }

    /**
     * Chain of interceptors that wraps a VedaClient.
     */
    public static class Chain {
        private final VedaClient client;
        private final List<Interceptor> interceptors = new ArrayList<>();

        public Chain(VedaClient client) {
            this.client = Objects.requireNonNull(client, "client cannot be null");
        }

        /**
         * Add an interceptor to the chain.
         */
        public Chain addInterceptor(Interceptor interceptor) {
            interceptors.add(Objects.requireNonNull(interceptor, "interceptor cannot be null"));
            return this;
        }

        /**
         * Remove an interceptor from the chain.
         */
        public Chain removeInterceptor(Interceptor interceptor) {
            interceptors.remove(interceptor);
            return this;
        }

        /**
         * Execute a query through the interceptor chain.
         */
        public VedaResult query(String sql) throws IOException, VedaException {
            String currentSql = sql;

            // Before phase
            for (Interceptor interceptor : interceptors) {
                currentSql = interceptor.beforeQuery(currentSql);
                if (currentSql == null) {
                    throw new VedaException("Query cancelled by interceptor");
                }
            }

            // Execute
            VedaResult result;
            try {
                result = client.query(currentSql);
            } catch (IOException | VedaException e) {
                // Error phase
                for (Interceptor interceptor : interceptors) {
                    interceptor.onError(currentSql, e);
                }
                throw e;
            }

            // After phase (reverse order)
            List<Interceptor> reversed = new ArrayList<>(interceptors);
            java.util.Collections.reverse(reversed);
            for (Interceptor interceptor : reversed) {
                interceptor.afterQuery(currentSql, result);
            }

            return result;
        }

        /**
         * Execute a command through the interceptor chain.
         */
        public String exec(String sql) throws IOException, VedaException {
            VedaResult result = query(sql);
            return result.getMessage();
        }

        public int getInterceptorCount() {
            return interceptors.size();
        }
    }

    // ── Built-in Interceptors ─────────────────────────────────────

    /**
     * Logging interceptor that prints queries and results.
     */
    public static class LoggingInterceptor implements Interceptor {
        private final java.util.logging.Logger logger;

        public LoggingInterceptor() {
            this(java.util.logging.Logger.getLogger(VedaInterceptor.class.getName()));
        }

        public LoggingInterceptor(java.util.logging.Logger logger) {
            this.logger = logger;
        }

        @Override
        public String beforeQuery(String sql) {
            logger.info("[VedaDB] Query: " + sql);
            return sql;
        }

        @Override
        public void afterQuery(String sql, VedaResult result) {
            logger.info("[VedaDB] Result: " + result.getRowCount() + " rows");
        }

        @Override
        public void onError(String sql, Exception exception) {
            logger.severe("[VedaDB] Error executing query: " + sql + " - " + exception.getMessage());
        }
    }

    /**
     * Metrics interceptor that records query timing.
     */
    public static class MetricsInterceptor implements Interceptor {
        private final VedaMetrics metrics;

        public MetricsInterceptor(VedaMetrics metrics) {
            this.metrics = Objects.requireNonNull(metrics, "metrics cannot be null");
        }

        @Override
        public String beforeQuery(String sql) {
            return sql;
        }

        @Override
        public void afterQuery(String sql, VedaResult result) {
            metrics.increment("queries_success");
        }

        @Override
        public void onError(String sql, Exception exception) {
            metrics.recordError("query");
        }
    }

    /**
     * Query sanitization interceptor that prevents destructive operations.
     */
    public static class SanitizationInterceptor implements Interceptor {
        private final boolean allowDrop;
        private final boolean allowTruncate;

        public SanitizationInterceptor() {
            this(false, false);
        }

        public SanitizationInterceptor(boolean allowDrop, boolean allowTruncate) {
            this.allowDrop = allowDrop;
            this.allowTruncate = allowTruncate;
        }

        @Override
        public String beforeQuery(String sql) {
            String upper = sql.toUpperCase().trim();
            if (!allowDrop && upper.startsWith("DROP ")) {
                throw new SecurityException("DROP operations are not allowed");
            }
            if (!allowTruncate && upper.startsWith("TRUNCATE ")) {
                throw new SecurityException("TRUNCATE operations are not allowed");
            }
            return sql;
        }
    }
}
