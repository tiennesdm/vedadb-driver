package io.vedadb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import static org.junit.jupiter.api.Assertions.*;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Health checker tests for VedaDB Java driver.
 */
class VedaHealthCheckerTest {

    @Nested
    @DisplayName("Check Tests")
    class CheckTests {

        @Test
        @DisplayName("Should pass health check")
        void testCheckPass() {
            HealthChecker checker = new HealthChecker(() -> { /* success */ }, 1000, 3);
            boolean result = checker.check();
            
            assertTrue(result);
            assertTrue(checker.isHealthy());
        }

        @Test
        @DisplayName("Should fail health check")
        void testCheckFail() {
            HealthChecker checker = new HealthChecker(
                () -> { throw new RuntimeException("fail"); },
                1000, 1
            );
            boolean result = checker.check();
            
            assertFalse(result);
            assertFalse(checker.isHealthy());
        }

        @Test
        @DisplayName("Should maintain health until threshold")
        void testThreshold() {
            AtomicInteger callCount = new AtomicInteger(0);
            HealthChecker checker = new HealthChecker(
                () -> {
                    if (callCount.incrementAndGet() <= 2) {
                        throw new RuntimeException("fail");
                    }
                },
                1000, 3
            );
            
            assertTrue(checker.check()); // 1 fail, still healthy
            assertTrue(checker.check()); // 2 fails, still healthy
            assertFalse(checker.check()); // 3 fails, unhealthy
        }

        @Test
        @DisplayName("Should recover after success")
        void testRecovery() {
            AtomicInteger callCount = new AtomicInteger(0);
            HealthChecker checker = new HealthChecker(
                () -> {
                    if (callCount.incrementAndGet() <= 2) {
                        throw new RuntimeException("fail");
                    }
                },
                1000, 5
            );
            
            checker.check(); // fail
            checker.check(); // fail
            callCount.set(0); // reset to succeed
            boolean result = checker.check();
            
            assertTrue(result);
            assertTrue(checker.isHealthy());
        }
    }

    @Nested
    @DisplayName("Periodic Check Tests")
    class PeriodicTests {

        @Test
        @DisplayName("Should run periodic checks")
        void testPeriodicChecks() throws InterruptedException {
            AtomicInteger callCount = new AtomicInteger(0);
            HealthChecker checker = new HealthChecker(
                callCount::incrementAndGet,
                50, 3
            );
            
            checker.start();
            Thread.sleep(130);
            checker.stop();
            
            assertTrue(callCount.get() >= 2, "Expected at least 2 checks, got " + callCount.get());
        }

        @Test
        @DisplayName("Should stop cleanly")
        void testStop() {
            HealthChecker checker = new HealthChecker(() -> {}, 50, 3);
            
            checker.start();
            assertDoesNotThrow(checker::stop);
        }
    }

    @Nested
    @DisplayName("Concurrency Tests")
    class ConcurrencyTests {

        @Test
        @DisplayName("Should be thread-safe for isHealthy")
        void testThreadSafeHealthy() throws InterruptedException {
            HealthChecker checker = new HealthChecker(() -> {}, 1000, 3);
            
            ExecutorService executor = Executors.newFixedThreadPool(10);
            CountDownLatch latch = new CountDownLatch(10);
            
            for (int i = 0; i < 10; i++) {
                executor.submit(() -> {
                    for (int j = 0; j < 100; j++) {
                        checker.isHealthy();
                    }
                    latch.countDown();
                });
            }
            
            assertTrue(latch.await(5, TimeUnit.SECONDS));
            executor.shutdown();
        }

        @Test
        @DisplayName("Should track consecutive fails correctly")
        void testConsecutiveFails() {
            AtomicInteger callCount = new AtomicInteger(0);
            HealthChecker checker = new HealthChecker(
                () -> {
                    callCount.incrementAndGet();
                    throw new RuntimeException("fail");
                },
                1000, 10
            );
            
            checker.check();
            checker.check();
            checker.check();
            
            assertEquals(3, checker.getConsecutiveFails());
        }
    }

    @Test
    @DisplayName("Should handle slow response")
    void testSlowResponse() {
        HealthChecker checker = new HealthChecker(
            () -> {
                try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            },
            1000, 1
        );
        
        assertDoesNotThrow(() -> checker.check());
    }

    @Test
    @DisplayName("Should reset consecutive fails on success")
    void testResetConsecutiveFails() {
        AtomicInteger fails = new AtomicInteger(0);
        HealthChecker checker = new HealthChecker(
            () -> {
                if (fails.incrementAndGet() <= 1) {
                    throw new RuntimeException("fail");
                }
            },
            1000, 5
        );
        
        checker.check(); // fail
        fails.set(1); // next will succeed
        checker.check(); // success
        
        assertEquals(0, checker.getConsecutiveFails());
    }
}

/** HealthChecker implementation */
class HealthChecker {
    private final Runnable checkFn;
    private final long intervalMs;
    private final int failThreshold;
    private boolean healthy = true;
    private int consecutiveFails = 0;
    private volatile boolean running = false;
    private Thread checkThread;

    HealthChecker(Runnable checkFn, long intervalMs, int failThreshold) {
        this.checkFn = checkFn;
        this.intervalMs = intervalMs;
        this.failThreshold = failThreshold;
    }

    boolean check() {
        try {
            checkFn.run();
            synchronized (this) {
                healthy = true;
                consecutiveFails = 0;
            }
            return true;
        } catch (Exception e) {
            synchronized (this) {
                consecutiveFails++;
                if (consecutiveFails >= failThreshold) {
                    healthy = false;
                }
            }
            return false;
        }
    }

    boolean isHealthy() {
        synchronized (this) {
            return healthy;
        }
    }

    int getConsecutiveFails() {
        synchronized (this) {
            return consecutiveFails;
        }
    }

    void start() {
        running = true;
        checkThread = new Thread(() -> {
            while (running) {
                check();
                try { Thread.sleep(intervalMs); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
        });
        checkThread.setDaemon(true);
        checkThread.start();
    }

    void stop() {
        running = false;
        if (checkThread != null) {
            try { checkThread.join(1000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
    }
}
