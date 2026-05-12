package com.vedadb.driver;

import java.sql.SQLException;

/**
 * Base exception for all VedaDB JDBC driver errors.
 */
public class VedaDBException extends SQLException {

    private final String operation;

    public VedaDBException(String message) {
        super(message);
        this.operation = null;
    }

    public VedaDBException(String message, String operation) {
        super("[" + operation + "] " + message);
        this.operation = operation;
    }

    public VedaDBException(String message, Throwable cause) {
        super(message, cause);
        this.operation = null;
    }

    public VedaDBException(String message, String sqlState, int vendorCode) {
        super(message, sqlState, vendorCode);
        this.operation = null;
    }

    public String getOperation() {
        return operation;
    }

    /** Connection-level error. */
    public static class ConnectionError extends VedaDBException {
        public ConnectionError(String message) {
            super(message, "conn");
        }
        public ConnectionError(String message, Throwable cause) {
            super(message + ": " + cause.getMessage(), cause);
        }
    }

    /** Authentication error (HTTP 401/403). */
    public static class AuthError extends VedaDBException {
        public AuthError(String message, int statusCode) {
            super(message, "auth", "28000", statusCode);
        }
    }

    /** Query rejected by server (HTTP 400). */
    public static class QueryError extends VedaDBException {
        public QueryError(String message) {
            super(message, "query", "42000", 400);
        }
    }

    /** Rate limit exceeded (HTTP 429). */
    public static class RateLimitError extends VedaDBException {
        private final double retryAfter;
        public RateLimitError(String message, double retryAfter) {
            super(message, "ratelimit", null, 429);
            this.retryAfter = retryAfter;
        }
        public double getRetryAfter() {
            return retryAfter;
        }
    }

    /** Client-side validation failure. */
    public static class ValidationError extends VedaDBException {
        public ValidationError(String message) {
            super(message, "validate", "22023", 0);
        }
    }

    /** Pool exhausted. */
    public static class PoolExhaustedError extends VedaDBException {
        public PoolExhaustedError(int maxSize, int maxOverflow) {
            super("Pool exhausted: max=" + maxSize + ", overflow=" + maxOverflow, "pool");
        }
    }
}
