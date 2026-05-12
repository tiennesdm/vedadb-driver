package io.vedadb;

import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Circuit breaker pattern for VedaDB operations.
 *
 * <p>States:
 * <ul>
 *   <li>{@code CLOSED}  - Normal operation, requests pass through</li>
 *   <li>{@code OPEN}    - Failure threshold exceeded, requests fail fast</li>
 *   <li>{@code HALF_OPEN} - Testing if service has recovered</li>
 * </ul>
 *
 * <p>Usage:
 * <pre>{@code
 * VedaCircuitBreaker cb = new VedaCircuitBreaker(5, 30000);
 * VedaResult result = cb.call(() -> client.query("SELECT * FROM users;"));
 * }</pre>
 */
public class VedaCircuitBreaker {

    public enum State { CLOSED, OPEN, HALF_OPEN }

    private final int failureThreshold;
    private final long recoveryTimeoutMs;
    private final AtomicInteger failureCount = new AtomicInteger(0);
    private final AtomicInteger halfOpenAttempts = new AtomicInteger(0);
    private final AtomicLong lastFailureTime = new AtomicLong(0);
    private final AtomicReference<State> state = new AtomicReference<>(State.CLOSED);

    /**
     * Create a circuit breaker.
     *
     * @param failureThreshold   Number of consecutive failures before opening
     * @param recoveryTimeoutMs  Time in ms before transitioning from OPEN to HALF_OPEN
     */
    public VedaCircuitBreaker(int failureThreshold, long recoveryTimeoutMs) {
        if (failureThreshold <= 0) {
            throw new IllegalArgumentException("failureThreshold must be > 0");
        }
        if (recoveryTimeoutMs <= 0) {
            throw new IllegalArgumentException("recoveryTimeoutMs must be > 0");
        }
        this.failureThreshold = failureThreshold;
        this.recoveryTimeoutMs = recoveryTimeoutMs;
    }

    /**
     * Create with defaults: 5 failures, 30s recovery.
     */
    public static VedaCircuitBreaker defaults() {
        return new VedaCircuitBreaker(5, 30000);
    }

    /**
     * Execute a callable under circuit breaker protection.
     *
     * @param callable the operation to execute
     * @param <T>      return type
     * @return the result of the callable
     * @throws Exception if the circuit is OPEN or the operation fails
     */
    public <T> T call(Callable<T> callable) throws Exception {
        if (state.get() == State.OPEN) {
            if (System.currentTimeMillis() - lastFailureTime.get() >= recoveryTimeoutMs) {
                // Try to transition to HALF_OPEN
                if (state.compareAndSet(State.OPEN, State.HALF_OPEN)) {
                    halfOpenAttempts.set(0);
                }
            } else {
                throw new VedaException("Circuit breaker is OPEN - too many failures, try again later");
            }
        }

        try {
            T result = callable.call();
            onSuccess();
            return result;
        } catch (Exception e) {
            onFailure();
            throw e;
        }
    }

    /**
     * Get the current state of the circuit breaker.
     */
    public State getState() {
        // Check if OPEN should transition to HALF_OPEN
        if (state.get() == State.OPEN) {
            if (System.currentTimeMillis() - lastFailureTime.get() >= recoveryTimeoutMs) {
                return State.HALF_OPEN;
            }
        }
        return state.get();
    }

    /**
     * Handle a successful call.
     */
    private void onSuccess() {
        if (state.get() == State.HALF_OPEN) {
            // In HALF_OPEN, need consecutive successes to close
            if (halfOpenAttempts.incrementAndGet() >= 2) {
                if (state.compareAndSet(State.HALF_OPEN, State.CLOSED)) {
                    failureCount.set(0);
                    halfOpenAttempts.set(0);
                }
            }
        } else {
            failureCount.set(0);
        }
    }

    /**
     * Handle a failed call.
     */
    private void onFailure() {
        lastFailureTime.set(System.currentTimeMillis());

        if (state.get() == State.HALF_OPEN) {
            // Failed in HALF_OPEN, go back to OPEN
            state.set(State.OPEN);
            halfOpenAttempts.set(0);
            return;
        }

        int failures = failureCount.incrementAndGet();
        if (failures >= failureThreshold) {
            state.compareAndSet(State.CLOSED, State.OPEN);
        }
    }

    public int getFailureThreshold() { return failureThreshold; }
    public long getRecoveryTimeoutMs() { return recoveryTimeoutMs; }
    public int getFailureCount() { return failureCount.get(); }
}
