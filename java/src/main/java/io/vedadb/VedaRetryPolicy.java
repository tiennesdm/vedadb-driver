package io.vedadb;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Retry policy with exponential backoff and jitter for VedaDB operations.
 *
 * <p>Configures maximum retry attempts, base delay, maximum delay cap,
 * optional jitter, and a set of retryable exception types. Non-retryable
 * exceptions fail fast on the first attempt.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaRetryPolicy policy = new VedaRetryPolicy(3, 100L, 5000L, true)
 *     .withRetryableException(IOException.class)
 *     .withRetryableException(VedaException.class);
 *
 * VedaResult result = policy.execute(() -> client.query("SELECT * FROM users;"));
 * }</pre>
 */
public class VedaRetryPolicy {
    private final int maxRetries;
    private final long baseDelayMs;
    private final long maxDelayMs;
    private final boolean jitter;
    private final Set<Class<? extends Exception>> retryableExceptions;

    /**
     * Create a retry policy.
     *
     * @param maxRetries   Maximum number of retry attempts (0 = no retries)
     * @param baseDelayMs  Initial delay between retries in milliseconds
     * @param maxDelayMs   Maximum delay cap in milliseconds
     * @param jitter       If true, add random jitter to delay
     */
    public VedaRetryPolicy(int maxRetries, long baseDelayMs, long maxDelayMs, boolean jitter) {
        if (maxRetries < 0) throw new IllegalArgumentException("maxRetries must be >= 0");
        if (baseDelayMs <= 0) throw new IllegalArgumentException("baseDelayMs must be > 0");
        if (maxDelayMs < baseDelayMs) throw new IllegalArgumentException("maxDelayMs must be >= baseDelayMs");
        this.maxRetries = maxRetries;
        this.baseDelayMs = baseDelayMs;
        this.maxDelayMs = maxDelayMs;
        this.jitter = jitter;
        this.retryableExceptions = new HashSet<>();
    }

    /**
     * Create a default retry policy: 3 retries, 100ms base delay, 5s max, jitter on.
     */
    public static VedaRetryPolicy defaults() {
        return new VedaRetryPolicy(3, 100L, 5000L, true);
    }

    /**
     * Add an exception type that should trigger a retry.
     */
    public VedaRetryPolicy withRetryableException(Class<? extends Exception> exceptionClass) {
        this.retryableExceptions.add(exceptionClass);
        return this;
    }

    /**
     * Execute a callable with retry logic.
     *
     * @param callable the operation to execute
     * @param <T>      return type
     * @return the result of the callable
     * @throws Exception the last exception after all retries are exhausted,
     *                   or the original exception if it is not retryable
     */
    public <T> T execute(Callable<T> callable) throws Exception {
        int attempt = 0;
        Exception lastException = null;

        while (attempt <= maxRetries) {
            try {
                return callable.call();
            } catch (Exception e) {
                lastException = e;

                // Fail fast for non-retryable exceptions
                if (!isRetryable(e)) {
                    throw e;
                }

                if (attempt < maxRetries) {
                    long delay = calculateDelay(attempt);
                    try {
                        Thread.sleep(delay);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new VedaException("Retry interrupted: " + ie.getMessage());
                    }
                }
            }
            attempt++;
        }

        throw lastException;
    }

    /**
     * Check if an exception is retryable.
     */
    private boolean isRetryable(Exception e) {
        if (retryableExceptions.isEmpty()) {
            // Default: retry all exceptions
            return true;
        }
        for (Class<? extends Exception> clazz : retryableExceptions) {
            if (clazz.isInstance(e)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Calculate delay for the given attempt using exponential backoff.
     */
    private long calculateDelay(int attempt) {
        long delay = baseDelayMs * (1L << attempt);
        if (delay > maxDelayMs || delay < 0) {
            delay = maxDelayMs;
        }
        if (jitter) {
            long jitterAmount = ThreadLocalRandom.current().nextLong(0, delay / 2 + 1);
            delay = delay + jitterAmount;
        }
        return Math.min(delay, maxDelayMs);
    }

    public int getMaxRetries() { return maxRetries; }
    public long getBaseDelayMs() { return baseDelayMs; }
    public long getMaxDelayMs() { return maxDelayMs; }
    public boolean isJitter() { return jitter; }
    public Set<Class<? extends Exception>> getRetryableExceptions() {
        return new HashSet<>(retryableExceptions);
    }
}
