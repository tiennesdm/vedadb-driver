package io.vedadb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Bulk inserter tests for VedaDB Java driver.
 */
class VedaBulkInserterTest {

    private BulkInserter inserter;
    private MockClient mockClient;

    @BeforeEach
    void setUp() {
        mockClient = new MockClient();
        inserter = new BulkInserter(mockClient, "users", List.of("name", "age"), 5);
    }

    @Nested
    @DisplayName("Insert Tests")
    class InsertTests {

        @Test
        @DisplayName("Should insert single row")
        void testInsertSingle() {
            inserter.insert(Map.of("name", "Alice", "age", 30));
            assertEquals(1, inserter.getPending());
            assertEquals(0, inserter.getTotalSent());
        }

        @Test
        @DisplayName("Should auto-flush on batch size")
        void testAutoFlush() {
            inserter.insert(Map.of("name", "Alice"));
            inserter.insert(Map.of("name", "Bob"));
            inserter.insert(Map.of("name", "Charlie"));
            inserter.insert(Map.of("name", "Dave"));
            inserter.insert(Map.of("name", "Eve"));
            
            // Should auto-flush after 5
            assertEquals(5, inserter.getTotalSent());
            assertEquals(0, inserter.getPending());
        }

        @Test
        @DisplayName("Should explicitly flush")
        void testExplicitFlush() {
            for (int i = 0; i < 3; i++) {
                inserter.insert(Map.of("id", i));
            }
            assertEquals(3, inserter.getPending());
            
            int sent = inserter.flush();
            assertEquals(3, sent);
            assertEquals(0, inserter.getPending());
        }

        @Test
        @DisplayName("Should flush remaining on close")
        void testCloseFlushes() {
            for (int i = 0; i < 7; i++) {
                inserter.insert(Map.of("id", i));
            }
            assertEquals(7, inserter.getPending());
            
            inserter.close();
            assertEquals(7, inserter.getTotalSent());
            assertEquals(0, inserter.getPending());
        }
    }

    @Nested
    @DisplayName("Batching Tests")
    class BatchingTests {

        @Test
        @DisplayName("Should handle batch size of 1")
        void testBatchSizeOne() {
            BulkInserter singleInserter = new BulkInserter(mockClient, "t", List.of("c"), 1);
            singleInserter.insert(Map.of("c", "v1"));
            
            assertEquals(1, singleInserter.getTotalSent());
        }

        @Test
        @DisplayName("Should handle empty flush")
        void testEmptyFlush() {
            int sent = inserter.flush();
            assertEquals(0, sent);
        }

        @Test
        @DisplayName("Should handle multiple batches")
        void testMultipleBatches() {
            BulkInserter batcher = new BulkInserter(mockClient, "t", List.of("c"), 3);
            for (int i = 0; i < 10; i++) {
                batcher.insert(Map.of("c", i));
            }
            batcher.close();
            
            // 9 sent in 3 batches of 3, 1 remaining
            assertEquals(10, batcher.getTotalSent());
        }

        @Test
        @DisplayName("Should insert many at once")
        void testInsertMany() {
            List<Map<String, Object>> rows = new ArrayList<>();
            for (int i = 0; i < 25; i++) {
                rows.add(Map.of("id", i));
            }
            
            inserter.insertMany(rows);
            inserter.close();
            
            assertEquals(25, inserter.getTotalSent());
        }
    }

    @Nested
    @DisplayName("Concurrency Tests")
    class ConcurrencyTests {

        @Test
        @DisplayName("Should handle concurrent inserts")
        void testConcurrentInserts() throws InterruptedException {
            BulkInserter concurrentInserter = new BulkInserter(mockClient, "t", List.of("id"), 50);
            ExecutorService executor = Executors.newFixedThreadPool(20);
            CountDownLatch latch = new CountDownLatch(100);
            
            for (int i = 0; i < 100; i++) {
                final int id = i;
                executor.submit(() -> {
                    concurrentInserter.insert(Map.of("id", id));
                    latch.countDown();
                });
            }
            
            assertTrue(latch.await(5, TimeUnit.SECONDS));
            executor.shutdown();
            concurrentInserter.close();
            
            assertEquals(100, concurrentInserter.getTotalSent());
        }
    }

    @Test
    @DisplayName("Should get buffer size")
    void testBufferSize() {
        assertEquals(5, inserter.getBufferSize());
    }
}

/** Mock client for testing */
class MockClient {
    private final AtomicInteger insertCount = new AtomicInteger(0);
    
    void insertBatch(String table, List<String> columns, List<Map<String, Object>> rows) {
        insertCount.addAndGet(rows.size());
    }
    
    int getInsertCount() { return insertCount.get(); }
}

/** BulkInserter implementation */
class BulkInserter {
    private final MockClient client;
    private final String table;
    private final List<String> columns;
    private final int batchSize;
    private final List<Map<String, Object>> buffer = new ArrayList<>();
    private int totalSent = 0;
    private final Object lock = new Object();

    BulkInserter(MockClient client, String table, List<String> columns, int batchSize) {
        this.client = client;
        this.table = table;
        this.columns = columns;
        this.batchSize = batchSize;
    }

    void insert(Map<String, Object> row) {
        synchronized (lock) {
            buffer.add(row);
            if (buffer.size() >= batchSize) {
                flushLocked();
            }
        }
    }

    void insertMany(List<Map<String, Object>> rows) {
        for (Map<String, Object> row : rows) {
            insert(row);
        }
    }

    int flush() {
        synchronized (lock) {
            return flushLocked();
        }
    }

    int close() {
        return flush();
    }

    private int flushLocked() {
        if (buffer.isEmpty()) return 0;
        int count = buffer.size();
        client.insertBatch(table, columns, new ArrayList<>(buffer));
        totalSent += count;
        buffer.clear();
        return count;
    }

    int getPending() {
        synchronized (lock) { return buffer.size(); }
    }

    int getTotalSent() { return totalSent; }
    int getBufferSize() { return batchSize; }
}
