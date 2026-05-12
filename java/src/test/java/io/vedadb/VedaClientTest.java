package io.vedadb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import java.util.concurrent.*;

/**
 * Core driver tests for VedaDB Java client.
 */
class VedaClientTest {

    private MockVedaServer mockServer;
    private VedaClient client;

    @BeforeEach
    void setUp() {
        mockServer = new MockVedaServer();
        client = new VedaClient("http://localhost:8080", mockServer::handle);
    }

    @Nested
    @DisplayName("Connection Tests")
    class ConnectionTests {

        @Test
        @DisplayName("Should connect successfully")
        void testConnectSuccess() {
            mockServer.setResponse(200, Map.of("result", "connected"));
            
            VedaClient newClient = client.connect();
            
            assertNotNull(newClient);
            assertTrue(client.isHealthy());
        }

        @Test
        @DisplayName("Should fail with invalid URL")
        void testConnectInvalidUrl() {
            assertThrows(VedaClientException.class, () -> {
                new VedaClient("://invalid-url", mockServer::handle);
            });
        }

        @Test
        @DisplayName("Should configure with custom timeout")
        void testCustomTimeout() {
            VedaClient customClient = new VedaClient.Builder("http://db:8080")
                .timeout(5000)
                .maxRetries(5)
                .build();
            
            assertEquals(5000, customClient.getTimeout());
            assertEquals(5, customClient.getMaxRetries());
        }

        @Test
        @DisplayName("Should connect with authentication")
        void testConnectWithAuth() {
            mockServer.setResponse(200, Map.of("result", "connected"));
            
            VedaClient authClient = new VedaClient.Builder("http://db:8080")
                .authToken("test-token-123")
                .build();
            
            assertEquals("test-token-123", authClient.getAuthToken());
        }

        @Test
        @DisplayName("Should handle connection timeout")
        void testConnectionTimeout() {
            mockServer.setDelay(10000);
            mockServer.setResponse(200, Map.of("result", "ok"));
            
            VedaClient fastClient = new VedaClient.Builder("http://db:8080")
                .timeout(50)
                .build();
            
            assertThrows(VedaClientException.class, fastClient::connect);
        }
    }

    @Nested
    @DisplayName("Query Tests")
    class QueryTests {

        @Test
        @DisplayName("Should query single row")
        void testQuerySingleRow() {
            mockServer.setResponse(200, Map.of(
                "result", List.of(Map.of("id", 1, "name", "Alice"))
            ));
            
            List<Map<String, Object>> results = client.query("SELECT * FROM users WHERE id = ?", 1);
            
            assertEquals(1, results.size());
            assertEquals("Alice", results.get(0).get("name"));
        }

        @Test
        @DisplayName("Should query multiple rows")
        void testQueryMultipleRows() {
            mockServer.setResponse(200, Map.of(
                "result", List.of(
                    Map.of("id", 1, "name", "Alice"),
                    Map.of("id", 2, "name", "Bob"),
                    Map.of("id", 3, "name", "Charlie")
                )
            ));
            
            List<Map<String, Object>> results = client.query("SELECT * FROM users");
            
            assertEquals(3, results.size());
        }

        @Test
        @DisplayName("Should handle empty result")
        void testEmptyResult() {
            mockServer.setResponse(200, Map.of("result", List.of()));
            
            List<Map<String, Object>> results = client.query("SELECT * FROM empty_table");
            
            assertTrue(results.isEmpty());
        }

        @Test
        @DisplayName("Should throw on server error")
        void testServerError() {
            mockServer.setResponse(500, Map.of("error", "database error"));
            
            assertThrows(VedaClientException.class, () -> {
                client.query("SELECT * FROM users");
            });
        }

        @Test
        @DisplayName("Should retry on transient failure")
        void testRetryOnFailure() {
            mockServer.setFailureSequence(2, 503);
            mockServer.setResponse(200, Map.of(
                "result", List.of(Map.of("id", 1, "name", "Alice"))
            ));
            
            List<Map<String, Object>> results = client.query("SELECT * FROM users");
            
            assertEquals(1, results.size());
            assertTrue(mockServer.getRequestCount() >= 3);
        }

        @Test
        @DisplayName("Should handle query with multiple parameters")
        void testQueryWithParams() {
            mockServer.setResponse(200, Map.of(
                "result", List.of(Map.of("id", 1, "name", "Alice"))
            ));
            
            client.query("SELECT * FROM users WHERE id = ? AND active = ?", 1, true);
            
            Map<String, Object> lastRequest = mockServer.getLastRequest();
            assertNotNull(lastRequest);
        }

        @Test
        @DisplayName("Should parse application error in response")
        void testApplicationError() {
            mockServer.setResponse(200, Map.of("error", "syntax error at position 14"));
            
            VedaClientException ex = assertThrows(VedaClientException.class, () -> {
                client.query("INVALID SQL");
            });
            
            assertTrue(ex.getMessage().contains("syntax error"));
        }
    }

    @Nested
    @DisplayName("Execute Tests")
    class ExecuteTests {

        @Test
        @DisplayName("Should execute INSERT")
        void testExecuteInsert() {
            mockServer.setResponse(200, Map.of(
                "result", Map.of("rowsAffected", 1, "lastInsertId", 42)
            ));
            
            ExecuteResult result = client.execute("INSERT INTO users (name) VALUES (?)", "Alice");
            
            assertEquals(1, result.getRowsAffected());
            assertEquals(42L, result.getLastInsertId());
        }

        @Test
        @DisplayName("Should execute UPDATE")
        void testExecuteUpdate() {
            mockServer.setResponse(200, Map.of(
                "result", Map.of("rowsAffected", 5)
            ));
            
            ExecuteResult result = client.execute("UPDATE users SET active = false");
            
            assertEquals(5, result.getRowsAffected());
        }

        @Test
        @DisplayName("Should execute DELETE")
        void testExecuteDelete() {
            mockServer.setResponse(200, Map.of(
                "result", Map.of("rowsAffected", 1)
            ));
            
            ExecuteResult result = client.execute("DELETE FROM users WHERE id = ?", 99);
            
            assertEquals(1, result.getRowsAffected());
        }

        @Test
        @DisplayName("Should throw on execute error")
        void testExecuteError() {
            mockServer.setResponse(400, Map.of("error", "syntax error"));
            
            assertThrows(VedaClientException.class, () -> {
                client.execute("INVALID SQL");
            });
        }
    }

    @Nested
    @DisplayName("Close Tests")
    class CloseTests {

        @Test
        @DisplayName("Should close client")
        void testClose() {
            client.close();
            
            assertTrue(client.isClosed());
        }

        @Test
        @DisplayName("Close should be idempotent")
        void testCloseIdempotent() {
            client.close();
            client.close();
            
            assertTrue(client.isClosed());
        }

        @Test
        @DisplayName("Should throw when querying closed client")
        void testQueryAfterClose() {
            client.close();
            
            assertThrows(IllegalStateException.class, () -> {
                client.query("SELECT 1");
            });
        }

        @Test
        @DisplayName("Should throw when executing on closed client")
        void testExecuteAfterClose() {
            client.close();
            
            assertThrows(IllegalStateException.class, () -> {
                client.execute("INSERT INTO t VALUES (1)");
            });
        }
    }

    @Nested
    @DisplayName("Concurrency Tests")
    class ConcurrencyTests {

        @Test
        @DisplayName("Should handle concurrent queries")
        void testConcurrentQueries() throws InterruptedException {
            mockServer.setResponse(200, Map.of(
                "result", List.of(Map.of("id", 1))
            ));
            
            ExecutorService executor = Executors.newFixedThreadPool(10);
            CountDownLatch latch = new CountDownLatch(10);
            List<Future<List<Map<String, Object>>>> futures = new ArrayList<>();
            
            for (int i = 0; i < 10; i++) {
                futures.add(executor.submit(() -> {
                    try {
                        return client.query("SELECT 1");
                    } finally {
                        latch.countDown();
                    }
                }));
            }
            
            assertTrue(latch.await(5, TimeUnit.SECONDS));
            executor.shutdown();
            
            for (Future<List<Map<String, Object>>> f : futures) {
                assertDoesNotThrow(() -> assertEquals(1, f.get().size()));
            }
        }
    }
}

/** Mock server for testing */
class MockVedaServer {
    private int statusCode = 200;
    private Map<String, Object> responseBody = Map.of();
    private int failureCount = 0;
    private int failureThreshold = 0;
    private int requestCount = 0;
    private long delayMs = 0;
    private Map<String, Object> lastRequest;

    void setResponse(int statusCode, Map<String, Object> body) {
        this.statusCode = statusCode;
        this.responseBody = body;
    }

    void setFailureSequence(int count, int errorCode) {
        this.failureCount = count;
        this.failureThreshold = count;
        this.statusCode = errorCode;
    }

    void setDelay(long ms) {
        this.delayMs = ms;
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> handle(Map<String, Object> request) {
        requestCount++;
        lastRequest = request;
        
        if (delayMs > 0) {
            try { Thread.sleep(delayMs); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        
        if (failureCount > 0) {
            failureCount--;
            return Map.of("statusCode", statusCode, "error", "temporary error");
        }
        
        return Map.of("statusCode", 200, "body", responseBody);
    }

    int getRequestCount() { return requestCount; }
    Map<String, Object> getLastRequest() { return lastRequest; }
}

/** VedaClient implementation for tests */
class VedaClient {
    private final String endpoint;
    private final java.util.function.Function<Map<String,Object>, Map<String,Object>> transport;
    private int timeout = 10000;
    private int maxRetries = 3;
    private String authToken;
    private boolean healthy = false;
    private boolean closed = false;

    VedaClient(String endpoint, java.util.function.Function<Map<String,Object>, Map<String,Object>> transport) {
        this.endpoint = endpoint;
        this.transport = transport;
    }

    private VedaClient(Builder builder) {
        this.endpoint = builder.endpoint;
        this.transport = builder.transport;
        this.timeout = builder.timeout;
        this.maxRetries = builder.maxRetries;
        this.authToken = builder.authToken;
    }

    VedaClient connect() {
        healthy = true;
        return this;
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> query(String sql, Object... params) {
        if (closed) throw new IllegalStateException("Client is closed");
        Map<String, Object> request = Map.of("sql", sql, "params", List.of(params));
        Map<String, Object> response = sendWithRetry(request);
        Map<String, Object> body = (Map<String, Object>) response.get("body");
        if (body != null && body.containsKey("error")) {
            throw new VedaClientException((String) body.get("error"));
        }
        return body != null ? (List<Map<String, Object>>) body.getOrDefault("result", List.of()) : List.of();
    }

    @SuppressWarnings("unchecked")
    ExecuteResult execute(String sql, Object... params) {
        if (closed) throw new IllegalStateException("Client is closed");
        Map<String, Object> request = Map.of("sql", sql, "params", List.of(params));
        Map<String, Object> response = sendWithRetry(request);
        Map<String, Object> body = (Map<String, Object>) response.get("body");
        if (body != null && body.containsKey("error")) {
            throw new VedaClientException((String) body.get("error"));
        }
        Map<String, Object> result = body != null ? (Map<String, Object>) body.get("result") : Map.of();
        return new ExecuteResult(
            ((Number) result.getOrDefault("rowsAffected", 0)).intValue(),
            ((Number) result.getOrDefault("lastInsertId", 0)).longValue()
        );
    }

    void close() { closed = true; }
    boolean isClosed() { return closed; }
    boolean isHealthy() { return healthy && !closed; }
    int getTimeout() { return timeout; }
    int getMaxRetries() { return maxRetries; }
    String getAuthToken() { return authToken; }

    private Map<String, Object> sendWithRetry(Map<String, Object> request) {
        VedaClientException lastError = null;
        for (int i = 0; i <= maxRetries; i++) {
            Map<String, Object> response = transport.apply(request);
            int code = ((Number) response.getOrDefault("statusCode", 200)).intValue();
            if (code >= 200 && code < 300) {
                return response;
            }
            lastError = new VedaClientException("HTTP " + code);
            if (code >= 500 && code < 600) {
                try { Thread.sleep(10); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                continue;
            }
            break;
        }
        if (lastError != null) throw lastError;
        return Map.of();
    }

    static class Builder {
        private final String endpoint;
        private java.util.function.Function<Map<String,Object>, Map<String,Object>> transport;
        private int timeout = 10000;
        private int maxRetries = 3;
        private String authToken;

        Builder(String endpoint) {
            if (endpoint == null || endpoint.startsWith("://")) {
                throw new VedaClientException("Invalid endpoint URL");
            }
            this.endpoint = endpoint;
        }

        Builder timeout(int ms) { this.timeout = ms; return this; }
        Builder maxRetries(int n) { this.maxRetries = n; return this; }
        Builder authToken(String token) { this.authToken = token; return this; }
        Builder transport(java.util.function.Function<Map<String,Object>, Map<String,Object>> t) { this.transport = t; return this; }

        VedaClient build() {
            if (transport == null) {
                transport = req -> Map.of("statusCode", 200, "body", Map.of("result", List.of()));
            }
            return new VedaClient(this);
        }
    }
}

class ExecuteResult {
    private final int rowsAffected;
    private final long lastInsertId;

    ExecuteResult(int rowsAffected, long lastInsertId) {
        this.rowsAffected = rowsAffected;
        this.lastInsertId = lastInsertId;
    }

    int getRowsAffected() { return rowsAffected; }
    long getLastInsertId() { return lastInsertId; }
}

class VedaClientException extends RuntimeException {
    VedaClientException(String message) { super(message); }
}
