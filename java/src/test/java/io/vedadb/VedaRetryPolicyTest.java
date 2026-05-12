package io.vedadb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/**
 * Retry policy tests for VedaDB Java driver.
 */
class VedaRetryPolicyTest {

    private RetryPolicy retryPolicy;

    @BeforeEach
    void setUp() {
        retryPolicy = new RetryPolicy(3, Duration.ofMillis(10), Duration.ofSeconds(5), 2.0);
    }

    @Test
    @DisplayName("Should succeed on first attempt")
    void testImmediateSuccess() {
        AtomicInteger callCount = new AtomicInteger(0);
        
        String result = retryPolicy.execute(() -> {
            callCount.incrementAndGet();
            return "success";
        });
        
        assertEquals("success", result);
        assertEquals(1, callCount.get());
    }

    @Test
    @DisplayName("Should retry on transient failure")
    void testRetryOnFailure() {
        AtomicInteger callCount = new AtomicInteger(0);
        
        String result = retryPolicy.execute(() -> {
            if (callCount.incrementAndGet() < 3) {
                throw new TransientException("Temporary failure");
            }
            return "success";
        });
        
        assertEquals("success", result);
        assertEquals(3, callCount.get());
    }

    @Test
    @DisplayName("Should throw when retries exhausted")
    void testRetryExhausted() {
        AtomicInteger callCount = new AtomicInteger(0);
        
        RetryExhaustedException ex = assertThrows(RetryExhaustedException.class, () -> {
            retryPolicy.execute(() -> {
                callCount.incrementAndGet();
                throw new TransientException("Persistent failure");
            });
        });
        
        assertTrue(ex.getMessage().contains("exhausted"));
        assertEquals(4, callCount.get()); // initial + 3 retries
    }

    @Test
    @DisplayName("Should not retry non-retryable exceptions")
    void testNonRetryableException() {
        AtomicInteger callCount = new AtomicInteger(0);
        
        assertThrows(IllegalArgumentException.class, () -> {
            retryPolicy.execute(() -> {
                callCount.incrementAndGet();
                throw new IllegalArgumentException("Fatal error");
            });
        });
        
        assertEquals(1, callCount.get());
    }

    @Test
    @DisplayName("Should use exponential backoff")
    void testExponentialBackoff() {
        RetryPolicy slowPolicy = new RetryPolicy(3, Duration.ofMillis(50), Duration.ofSeconds(1), 2.0);
        AtomicInteger callCount = new AtomicInteger(0);
        
        long startTime = System.currentTimeMillis();
        assertThrows(RetryExhaustedException.class, () -> {
            slowPolicy.execute(() -> {
                callCount.incrementAndGet();
                throw new TransientException("fail");
            });
        });
        long elapsed = System.currentTimeMillis() - startTime;
        
        // Minimum: 50 + 100 + 200 = 350ms
        assertTrue(elapsed >= 300, "Expected delay of at least 300ms, got " + elapsed);
    }

    @Test
    @DisplayName("Should cap delay at max")
    void testMaxDelayCap() {
        RetryPolicy cappedPolicy = new RetryPolicy(5, Duration.ofMillis(100), Duration.ofMillis(150), 10.0);
        AtomicInteger callCount = new AtomicInteger(0);
        
        long startTime = System.currentTimeMillis();
        assertThrows(RetryExhaustedException.class, () -> {
            cappedPolicy.execute(() -> {
                callCount.incrementAndGet();
                throw new TransientException("fail");
            });
        });
        long elapsed = System.currentTimeMillis() - startTime;
        
        // Should not exceed ~1s even with 5 retries due to cap
        assertTrue(elapsed < 2000, "Expected delay under 2s, got " + elapsed);
    }

    @Test
    @DisplayName("Should succeed with zero retries configured")
    void testZeroRetries() {
        RetryPolicy noRetry = new RetryPolicy(0, Duration.ZERO, Duration.ZERO, 1.0);
        AtomicInteger callCount = new AtomicInteger(0);
        
        String result = noRetry.execute(() -> {
            callCount.incrementAndGet();
            return "ok";
        });
        
        assertEquals("ok", result);
        assertEquals(1, callCount.get());
    }

    @Test
    @DisplayName("Should fail fast with zero retries")
    void testZeroRetriesFail() {
        RetryPolicy noRetry = new RetryPolicy(0, Duration.ZERO, Duration.ZERO, 1.0);
        
        assertThrows(RetryExhaustedException.class, () -> {
            noRetry.execute(() -> {
                throw new TransientException("fail");
            });
        });
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 2, 3, 5})
    @DisplayName("Should configure different retry counts")
    void testDifferentRetryCounts(int maxRetries) {
        RetryPolicy policy = new RetryPolicy(maxRetries, Duration.ZERO, Duration.ofSeconds(1), 1.0);
        AtomicInteger callCount = new AtomicInteger(0);
        
        assertThrows(RetryExhaustedException.class, () -> {
            policy.execute(() -> {
                callCount.incrementAndGet();
                throw new TransientException("fail");
            });
        });
        
        assertEquals(maxRetries + 1, callCount.get());
    }

    @Test
    @DisplayName("Should support custom retry predicate")
    void testCustomRetryPredicate() {
        RetryPolicy customPolicy = new RetryPolicy(3, Duration.ZERO, Duration.ofSeconds(1), 1.0);
        customPolicy.setRetryablePredicate(e -> e.getMessage().equals("retryable"));
        AtomicInteger callCount = new AtomicInteger(0);
        
        String result = customPolicy.execute(() -> {
            if (callCount.incrementAndGet() < 2) {
                throw new RuntimeException("retryable");
            }
            return "success";
        });
        
        assertEquals("success", result);
        assertEquals(2, callCount.get());
    }

    @Test
    @DisplayName("Should respect custom predicate rejecting non-matching")
    void testCustomPredicateRejection() {
        RetryPolicy customPolicy = new RetryPolicy(5, Duration.ZERO, Duration.ofSeconds(1), 1.0);
        customPolicy.setRetryablePredicate(e -> e.getMessage().equals("retryable"));
        AtomicInteger callCount = new AtomicInteger(0);
        
        assertThrows(RuntimeException.class, () -> {
            customPolicy.execute(() -> {
                callCount.incrementAndGet();
                throw new RuntimeException("not-retryable");
            });
        });
        
        assertEquals(1, callCount.get());
    }
}

/** Retry policy implementation */
class RetryPolicy {
    private final int maxRetries;
    private final Duration baseDelay;
    private final Duration maxDelay;
    private final double multiplier;
    private java.util.function.Predicate<Throwable> retryablePredicate;

    RetryPolicy(int maxRetries, Duration baseDelay, Duration maxDelay, double multiplier) {
        this.maxRetries = maxRetries;
        this.baseDelay = baseDelay;
        this.maxDelay = maxDelay;
        this.multiplier = multiplier;
        this.retryablePredicate = e -> e instanceof TransientException;
    }

    void setRetryablePredicate(java.util.function.Predicate<Throwable> predicate) {
        this.retryablePredicate = predicate;
    }

    <T> T execute(Supplier<T> operation) {
        Duration delay = baseDelay;
        Throwable lastError = null;

        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                try {
                    Thread.sleep(delay.toMillis());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new RetryExhaustedException("Interrupted during retry");
                }
                delay = Duration.ofMillis((long) Math.min(delay.toMillis() * multiplier, maxDelay.toMillis()));
            }

            try {
                return operation.get();
            } catch (Exception e) {
                lastError = e;
                if (!retryablePredicate.test(e)) {
                    throw e;
                }
            }
        }

        throw new RetryExhaustedException("Retry exhausted after " + maxRetries + " attempts", lastError);
    }
}

class TransientException extends RuntimeException {
    TransientException(String message) { super(message); }
}

class RetryExhaustedException extends RuntimeException {
    RetryExhaustedException(String message) { super(message); }
    RetryExhaustedException(String message, Throwable cause) { super(message, cause); }
}
