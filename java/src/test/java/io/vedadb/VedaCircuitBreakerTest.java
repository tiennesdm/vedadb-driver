package io.vedadb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import static org.junit.jupiter.api.Assertions.*;

import java.util.concurrent.*;
import java.util.stream.IntStream;

/**
 * Circuit breaker tests for VedaDB Java driver.
 */
class VedaCircuitBreakerTest {

    private CircuitBreaker circuitBreaker;

    @BeforeEach
    void setUp() {
        circuitBreaker = new CircuitBreaker(5, 3, 30000);
    }

    @Nested
    @DisplayName("Closed State Tests")
    class ClosedStateTests {

        @Test
        @DisplayName("Should start in closed state")
        void testInitialState() {
            assertEquals(CircuitBreaker.State.CLOSED, circuitBreaker.getState());
        }

        @Test
        @DisplayName("Should allow requests when closed")
        void testAllowsRequests() {
            assertTrue(circuitBreaker.allow());
        }

        @Test
        @DisplayName("Should execute function successfully")
        void testExecuteSuccess() {
            String result = circuitBreaker.execute(() -> "success");
            assertEquals("success", result);
        }

        @Test
        @DisplayName("Should reset failure count on success")
        void testResetOnSuccess() {
            circuitBreaker.recordFailure();
            circuitBreaker.recordFailure();
            circuitBreaker.recordSuccess();
            // Should still be closed after 2 failures and 1 success
            assertEquals(CircuitBreaker.State.CLOSED, circuitBreaker.getState());
        }
    }

    @Nested
    @DisplayName("Open State Tests")
    class OpenStateTests {

        @Test
        @DisplayName("Should open after failure threshold")
        void testOpenAfterFailures() {
            CircuitBreaker cb = new CircuitBreaker(3, 1, 60000);
            cb.recordFailure();
            cb.recordFailure();
            assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
            cb.recordFailure();
            assertEquals(CircuitBreaker.State.OPEN, cb.getState());
        }

        @Test
        @DisplayName("Should reject requests when open")
        void testRejectWhenOpen() {
            CircuitBreaker cb = new CircuitBreaker(1, 1, 60000);
            cb.recordFailure();
            assertFalse(cb.allow());
        }

        @Test
        @DisplayName("Should throw when executing while open")
        void testExecuteWhenOpen() {
            CircuitBreaker cb = new CircuitBreaker(1, 1, 60000);
            cb.recordFailure();
            assertThrows(CircuitBreakerOpenException.class, () -> {
                cb.execute(() -> "should not run");
            });
        }

        @Test
        @DisplayName("Should be exact at threshold")
        void testExactThreshold() {
            CircuitBreaker cb = new CircuitBreaker(3, 1, 60000);
            cb.recordFailure();
            cb.recordFailure();
            assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
            cb.recordFailure();
            assertEquals(CircuitBreaker.State.OPEN, cb.getState());
        }
    }

    @Nested
    @DisplayName("Half-Open State Tests")
    class HalfOpenStateTests {

        @Test
        @DisplayName("Should transition to half-open after timeout")
        void testTransitionToHalfOpen() throws InterruptedException {
            CircuitBreaker cb = new CircuitBreaker(1, 1, 50);
            cb.recordFailure();
            assertEquals(CircuitBreaker.State.OPEN, cb.getState());
            Thread.sleep(100);
            assertTrue(cb.allow());
            assertEquals(CircuitBreaker.State.HALF_OPEN, cb.getState());
        }

        @Test
        @DisplayName("Should close after success in half-open")
        void testCloseAfterSuccess() throws InterruptedException {
            CircuitBreaker cb = new CircuitBreaker(5, 1, 50);
            cb.recordFailure();
            Thread.sleep(100);
            cb.allow();
            cb.recordSuccess();
            assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
        }

        @Test
        @DisplayName("Should reopen after failure in half-open")
        void testReopenAfterFailure() throws InterruptedException {
            CircuitBreaker cb = new CircuitBreaker(5, 1, 50);
            cb.recordFailure();
            Thread.sleep(100);
            cb.allow();
            cb.recordFailure();
            assertEquals(CircuitBreaker.State.OPEN, cb.getState());
        }

        @Test
        @DisplayName("Should require multiple successes to close")
        void testMultipleSuccessesRequired() throws InterruptedException {
            CircuitBreaker cb = new CircuitBreaker(5, 3, 50);
            cb.recordFailure();
            Thread.sleep(100);
            
            // First success
            cb.allow(); cb.recordSuccess();
            assertEquals(CircuitBreaker.State.HALF_OPEN, cb.getState());
            
            // Second success
            Thread.sleep(100);
            cb.allow(); cb.recordSuccess();
            assertEquals(CircuitBreaker.State.HALF_OPEN, cb.getState());
            
            // Third success should close
            Thread.sleep(100);
            cb.allow(); cb.recordSuccess();
            assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
        }
    }

    @Nested
    @DisplayName("Recovery Tests")
    class RecoveryTests {

        @Test
        @DisplayName("Should complete full recovery cycle")
        void testFullRecovery() throws InterruptedException {
            CircuitBreaker cb = new CircuitBreaker(2, 1, 50);
            
            // Start closed
            assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
            
            // Failures open circuit
            cb.recordFailure();
            cb.recordFailure();
            assertEquals(CircuitBreaker.State.OPEN, cb.getState());
            
            // Wait for half-open
            Thread.sleep(100);
            assertTrue(cb.allow());
            assertEquals(CircuitBreaker.State.HALF_OPEN, cb.getState());
            
            // Success closes
            cb.recordSuccess();
            assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
        }
    }

    @Nested
    @DisplayName("Concurrency Tests")
    class ConcurrencyTests {

        @Test
        @DisplayName("Should handle concurrent failures")
        void testConcurrentFailures() throws InterruptedException {
            CircuitBreaker cb = new CircuitBreaker(100, 1, 60000);
            ExecutorService executor = Executors.newFixedThreadPool(50);
            CountDownLatch latch = new CountDownLatch(50);
            
            IntStream.range(0, 50).forEach(i -> executor.submit(() -> {
                cb.recordFailure();
                latch.countDown();
            }));
            
            assertTrue(latch.await(5, TimeUnit.SECONDS));
            executor.shutdown();
            assertEquals(CircuitBreaker.State.OPEN, cb.getState());
        }

        @Test
        @DisplayName("Should handle concurrent allows when open")
        void testConcurrentAllowsWhenOpen() throws InterruptedException {
            CircuitBreaker cb = new CircuitBreaker(1, 1, 60000);
            cb.recordFailure();
            
            ExecutorService executor = Executors.newFixedThreadPool(20);
            CountDownLatch latch = new CountDownLatch(20);
            java.util.concurrent.atomic.AtomicInteger allowedCount = new java.util.concurrent.atomic.AtomicInteger(0);
            
            IntStream.range(0, 20).forEach(i -> executor.submit(() -> {
                if (cb.allow()) allowedCount.incrementAndGet();
                latch.countDown();
            }));
            
            assertTrue(latch.await(5, TimeUnit.SECONDS));
            executor.shutdown();
            assertEquals(0, allowedCount.get());
        }
    }

    @Test
    @DisplayName("Should reset manually")
    void testManualReset() {
        CircuitBreaker cb = new CircuitBreaker(1, 1, 60000);
        cb.recordFailure();
        assertEquals(CircuitBreaker.State.OPEN, cb.getState());
        cb.reset();
        assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
        assertTrue(cb.allow());
    }

    @Test
    @DisplayName("State should have string representation")
    void testStateString() {
        assertEquals("CLOSED", CircuitBreaker.State.CLOSED.name());
        assertEquals("OPEN", CircuitBreaker.State.OPEN.name());
        assertEquals("HALF_OPEN", CircuitBreaker.State.HALF_OPEN.name());
    }
}

/** CircuitBreaker implementation */
class CircuitBreaker {
    enum State { CLOSED, OPEN, HALF_OPEN }
    
    private final int failureThreshold;
    private final int successThreshold;
    private final long timeoutMs;
    private State state = State.CLOSED;
    private int failureCount = 0;
    private int successCount = 0;
    private long lastFailureTime = 0;
    private int halfOpenCalls = 0;
    private final int halfOpenMax = 1;
    private final Object lock = new Object();

    CircuitBreaker(int failureThreshold, int successThreshold, long timeoutMs) {
        this.failureThreshold = failureThreshold;
        this.successThreshold = successThreshold;
        this.timeoutMs = timeoutMs;
    }

    State getState() {
        synchronized (lock) {
            return state;
        }
    }

    boolean allow() {
        synchronized (lock) {
            if (state == State.CLOSED) return true;
            if (state == State.OPEN) {
                if (System.currentTimeMillis() - lastFailureTime > timeoutMs) {
                    state = State.HALF_OPEN;
                    halfOpenCalls = 0;
                    successCount = 0;
                    return true;
                }
                return false;
            }
            // HALF_OPEN
            if (halfOpenCalls < halfOpenMax) {
                halfOpenCalls++;
                return true;
            }
            return false;
        }
    }

    void recordSuccess() {
        synchronized (lock) {
            if (state == State.HALF_OPEN) {
                successCount++;
                if (successCount >= successThreshold) {
                    state = State.CLOSED;
                    failureCount = 0;
                    halfOpenCalls = 0;
                }
            } else if (state == State.CLOSED) {
                failureCount = 0;
            }
        }
    }

    void recordFailure() {
        synchronized (lock) {
            lastFailureTime = System.currentTimeMillis();
            if (state == State.HALF_OPEN) {
                state = State.OPEN;
                halfOpenCalls = 0;
                return;
            }
            failureCount++;
            if (failureCount >= failureThreshold) {
                state = State.OPEN;
            }
        }
    }

    <T> T execute(java.util.function.Supplier<T> fn) {
        if (!allow()) throw new CircuitBreakerOpenException("Circuit breaker is OPEN");
        try {
            T result = fn.get();
            recordSuccess();
            return result;
        } catch (Exception e) {
            recordFailure();
            throw e;
        }
    }

    void reset() {
        synchronized (lock) {
            state = State.CLOSED;
            failureCount = 0;
            successCount = 0;
            halfOpenCalls = 0;
        }
    }
}

class CircuitBreakerOpenException extends RuntimeException {
    CircuitBreakerOpenException(String message) { super(message); }
}
