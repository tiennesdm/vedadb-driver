package io.vedadb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/**
 * Connection pool tests for VedaDB Java driver.
 */
class VedaConnectionPoolTest {

    private ConnectionPool pool;
    private AtomicInteger connectionCounter;

    @BeforeEach
    void setUp() {
        connectionCounter = new AtomicInteger(0);
        Supplier<MockConnection> factory = () -> new MockConnection(connectionCounter.incrementAndGet());
        pool = new ConnectionPool(factory, 10, 5, 1000);
    }

    @Nested
    @DisplayName("Acquire Tests")
    class AcquireTests {

        @Test
        @DisplayName("Should acquire new connection")
        void testAcquireNew() throws Exception {
            PooledConnection conn = pool.acquire();
            assertNotNull(conn);
            assertTrue(conn.isInUse());
            conn.release();
        }

        @Test
        @DisplayName("Should reuse released connection")
        void testReuseConnection() throws Exception {
            PooledConnection conn1 = pool.acquire();
            int id1 = conn1.getConnectionId();
            conn1.release();
            
            PooledConnection conn2 = pool.acquire();
            int id2 = conn2.getConnectionId();
            conn2.release();
            
            assertEquals(id1, id2);
        }

        @Test
        @DisplayName("Should track active count")
        void testActiveCount() throws Exception {
            assertEquals(0, pool.getActiveCount());
            PooledConnection conn = pool.acquire();
            assertTrue(pool.getActiveCount() > 0);
            conn.release();
        }
    }

    @Nested
    @DisplayName("Pool Exhaustion Tests")
    class ExhaustionTests {

        @Test
        @DisplayName("Should timeout when pool exhausted")
        void testTimeoutWhenExhausted() throws Exception {
            ConnectionPool smallPool = new ConnectionPool(
                () -> new MockConnection(1), 1, 1, 50
            );
            PooledConnection conn = smallPool.acquire();
            assertThrows(TimeoutException.class, () -> smallPool.acquire());
            conn.release();
        }

        @Test
        @DisplayName("Should enforce max connections")
        void testMaxConnections() throws Exception {
            AtomicInteger counter = new AtomicInteger(0);
            ConnectionPool smallPool = new ConnectionPool(
                () -> new MockConnection(counter.incrementAndGet()), 3, 3, 1000
            );
            
            List<PooledConnection> conns = new ArrayList<>();
            for (int i = 0; i < 3; i++) {
                conns.add(smallPool.acquire());
            }
            
            assertEquals(3, smallPool.getTotalCreated());
            for (PooledConnection c : conns) c.release();
        }
    }

    @Nested
    @DisplayName("Release Tests")
    class ReleaseTests {

        @Test
        @DisplayName("Should return connection to pool")
        void testRelease() throws Exception {
            PooledConnection conn = pool.acquire();
            conn.release();
            
            PooledConnection conn2 = pool.acquire();
            assertNotNull(conn2);
            conn2.release();
        }
    }

    @Nested
    @DisplayName("Concurrency Tests")
    class ConcurrencyTests {

        @Test
        @DisplayName("Should handle concurrent acquire/release")
        void testConcurrentAcquireRelease() throws Exception {
            ExecutorService executor = Executors.newFixedThreadPool(20);
            CountDownLatch latch = new CountDownLatch(20);
            AtomicInteger successCount = new AtomicInteger(0);
            AtomicInteger errorCount = new AtomicInteger(0);
            
            for (int i = 0; i < 20; i++) {
                executor.submit(() -> {
                    try {
                        PooledConnection conn = pool.acquire();
                        Thread.sleep(1);
                        conn.release();
                        successCount.incrementAndGet();
                    } catch (Exception e) {
                        errorCount.incrementAndGet();
                    } finally {
                        latch.countDown();
                    }
                });
            }
            
            assertTrue(latch.await(5, TimeUnit.SECONDS));
            executor.shutdown();
            assertEquals(20, successCount.get());
            assertEquals(0, errorCount.get());
        }

        @Test
        @DisplayName("Should handle stress test")
        void testStress() throws Exception {
            ConnectionPool stressPool = new ConnectionPool(
                () -> new MockConnection(1), 5, 5, 2000
            );
            ExecutorService executor = Executors.newFixedThreadPool(50);
            CountDownLatch latch = new CountDownLatch(50);
            AtomicInteger acquired = new AtomicInteger(0);
            
            for (int i = 0; i < 50; i++) {
                executor.submit(() -> {
                    try {
                        PooledConnection conn = stressPool.acquire();
                        acquired.incrementAndGet();
                        Thread.sleep(1);
                        conn.release();
                    } catch (Exception e) {
                        // Expected for some threads
                    } finally {
                        latch.countDown();
                    }
                });
            }
            
            assertTrue(latch.await(10, TimeUnit.SECONDS));
            executor.shutdown();
            assertTrue(acquired.get() > 0);
        }
    }

    @Test
    @DisplayName("Should close pool")
    void testClose() throws Exception {
        PooledConnection conn = pool.acquire();
        conn.release();
        pool.close();
        assertThrows(RuntimeException.class, () -> pool.acquire());
    }

    @Test
    @DisplayName("Close should be idempotent")
    void testCloseIdempotent() {
        pool.close();
        assertDoesNotThrow(() -> pool.close());
    }

    @Test
    @DisplayName("Should track total created")
    void testTotalCreated() throws Exception {
        assertEquals(0, pool.getTotalCreated());
        PooledConnection conn = pool.acquire();
        assertEquals(1, pool.getTotalCreated());
        conn.release();
    }
}

/** Mock connection for testing */
class MockConnection {
    private final int id;
    private boolean closed = false;
    private boolean valid = true;

    MockConnection(int id) { this.id = id; }
    int getId() { return id; }
    boolean isValid() { return valid && !closed; }
    void close() { closed = true; }
}

/** Pooled connection wrapper */
class PooledConnection {
    private final MockConnection connection;
    private final ConnectionPool pool;
    private boolean inUse = false;

    PooledConnection(MockConnection connection, ConnectionPool pool) {
        this.connection = connection;
        this.pool = pool;
    }

    int getConnectionId() { return connection.getId(); }
    boolean isInUse() { return inUse; }
    boolean isValid() { return connection.isValid(); }
    void release() { pool.release(this); }
    void setInUse(boolean inUse) { this.inUse = inUse; }
}

/** Connection pool implementation */
class ConnectionPool {
    private final Supplier<MockConnection> factory;
    private final int maxSize;
    private final long waitTimeoutMs;
    private final BlockingQueue<PooledConnection> available;
    private final List<PooledConnection> allConnections = new ArrayList<>();
    private final AtomicInteger totalCreated = new AtomicInteger(0);
    private boolean closed = false;

    ConnectionPool(Supplier<MockConnection> factory, int maxSize, int maxIdle, long waitTimeoutMs) {
        this.factory = factory;
        this.maxSize = maxSize;
        this.waitTimeoutMs = waitTimeoutMs;
        this.available = new LinkedBlockingQueue<>(maxSize);
    }

    PooledConnection acquire() throws Exception {
        if (closed) throw new RuntimeException("Pool is closed");
        
        PooledConnection conn = available.poll();
        if (conn != null) {
            conn.setInUse(true);
            return conn;
        }
        
        synchronized (this) {
            if (totalCreated.get() < maxSize) {
                totalCreated.incrementAndGet();
                MockConnection raw = factory.get();
                PooledConnection pooled = new PooledConnection(raw, this);
                pooled.setInUse(true);
                allConnections.add(pooled);
                return pooled;
            }
        }
        
        conn = available.poll(waitTimeoutMs, TimeUnit.MILLISECONDS);
        if (conn == null) throw new TimeoutException("Pool exhausted");
        conn.setInUse(true);
        return conn;
    }

    void release(PooledConnection conn) {
        conn.setInUse(false);
        available.offer(conn);
    }

    int getActiveCount() { return totalCreated.get() - available.size(); }
    int getTotalCreated() { return totalCreated.get(); }
    
    void close() {
        closed = true;
        for (PooledConnection conn : allConnections) {
            // cleanup
        }
    }
}
