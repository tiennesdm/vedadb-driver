package com.vedadb.driver;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;
import org.junit.jupiter.api.*;

import java.io.*;
import java.net.InetSocketAddress;
import java.sql.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Comprehensive tests for the VedaDB JDBC driver.
 *
 * Uses a local mock HTTP server to simulate VedaDB responses.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public class VedaDriverTest {

    private HttpServer server;
    private int port;

    @BeforeAll
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 10);
        server.createContext("/v1/health", exchange -> {
            writeJson(exchange, 200, "{\"status\":\"ok\",\"timestamp\":\"2024-01-01T00:00:00Z\"}");
        });
        server.createContext("/v1/query", exchange -> {
            if (!"POST".equals(exchange.getRequestMethod())) {
                writeJson(exchange, 405, "{\"error\":\"method not allowed\"}");
                return;
            }
            String body = readBody(exchange);
            String query = body.contains("\"query\"") ? body.replaceAll(".*\"query\"\\s*:\\s*\"([^\"]+)\".*", "$1") : "";

            if ("ERROR".equals(query)) {
                writeJson(exchange, 400, "{\"error\":\"syntax error\"}");
                return;
            }
            if (query.contains("SELECT 1 WHERE 1=0")) {
                writeJson(exchange, 200, "{\"columns\":[],\"rows\":[],\"row_count\":0}");
                return;
            }
            writeJson(exchange, 200, "{\"columns\":[\"result\"],\"rows\":[[\"42\"]],\"row_count\":1,\"message\":\"\"}");
        });
        server.createContext("/v1/tables", exchange -> {
            writeJson(exchange, 200, "{\"tables\":[{\"name\":\"users\"}]}");
        });
        server.start();
        port = server.getAddress().getPort();
    }

    @AfterAll
    void stopServer() {
        server.stop(0);
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        InputStream is = exchange.getRequestBody();
        byte[] buf = new byte[4096];
        int n;
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        while ((n = is.read(buf)) > 0) baos.write(buf, 0, n);
        return baos.toString("UTF-8");
    }

    private static void writeJson(HttpExchange exchange, int code, String json) throws IOException {
        byte[] bytes = json.getBytes("UTF-8");
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) { os.write(bytes); }
    }

    // ------------------------------------------------------------------
    // DSN parsing
    // ------------------------------------------------------------------

    @Test
    void testParseDSN() {
        VedaConfig cfg = VedaConfig.fromUrl("jdbc:vedadb://admin:secret@localhost:8080/mydb?tls=true&timeout=60");
        assertEquals("localhost", cfg.getHost());
        assertEquals(8080, cfg.getPort());
        assertEquals("admin", cfg.getUsername());
        assertEquals("secret", cfg.getPassword());
        assertEquals("mydb", cfg.getDatabase());
        assertTrue(cfg.isTls());
        assertEquals(60000, cfg.getTimeoutMs());
    }

    @Test
    void testParseDSNMinimal() {
        VedaConfig cfg = VedaConfig.fromUrl("jdbc:vedadb://localhost:8080");
        assertEquals("localhost", cfg.getHost());
        assertEquals(8080, cfg.getPort());
    }

    // ------------------------------------------------------------------
    // Driver registration
    // ------------------------------------------------------------------

    @Test
    void testDriverAcceptsURL() throws SQLException {
        VedaDriver driver = new VedaDriver();
        assertTrue(driver.acceptsURL("jdbc:vedadb://localhost:8080"));
        assertFalse(driver.acceptsURL("jdbc:postgresql://localhost:5432"));
    }

    @Test
    void testDriverPropertyInfo() throws SQLException {
        VedaDriver driver = new VedaDriver();
        DriverPropertyInfo[] props = driver.getPropertyInfo("jdbc:vedadb://localhost", null);
        assertTrue(props.length > 0);
    }

    // ------------------------------------------------------------------
    // Connection
    // ------------------------------------------------------------------

    @Test
    void testConnectionOpen() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url)) {
            assertNotNull(conn);
            assertFalse(conn.isClosed());
        }
    }

    @Test
    void testConnectionPing() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url)) {
            assertTrue(conn.isValid(5));
        }
    }

    @Test
    void testAutoCommitDefault() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url)) {
            assertTrue(conn.getAutoCommit());
        }
    }

    @Test
    void testTransaction() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            Statement stmt = conn.createStatement();
            ResultSet rs = stmt.executeQuery("SELECT 42");
            assertTrue(rs.next());
            assertEquals("42", rs.getString(1));
            conn.commit();
        }
    }

    @Test
    void testRollback() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            conn.rollback();
        }
    }

    // ------------------------------------------------------------------
    // Statement
    // ------------------------------------------------------------------

    @Test
    void testExecuteQuery() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT 42")) {
            assertTrue(rs.next());
            assertEquals("42", rs.getString(1));
            assertFalse(rs.next());
        }
    }

    @Test
    void testExecuteUpdate() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement()) {
            int count = stmt.executeUpdate("INSERT INTO t VALUES (1)");
            assertEquals(1, count);
        }
    }

    // ------------------------------------------------------------------
    // PreparedStatement
    // ------------------------------------------------------------------

    @Test
    void testPreparedStatementQuery() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("SELECT ?")) {
            ps.setInt(1, 42);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                assertEquals("42", rs.getString(1));
            }
        }
    }

    @Test
    void testPreparedStatementStringParam() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("SELECT ?")) {
            ps.setString(1, "hello");
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
            }
        }
    }

    @Test
    void testPreparedStatementNullParam() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("SELECT ?")) {
            ps.setNull(1, Types.VARCHAR);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
            }
        }
    }

    @Test
    void testPreparedStatementUpdate() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("INSERT INTO t VALUES (?)")) {
            ps.setInt(1, 100);
            int count = ps.executeUpdate();
            assertEquals(1, count);
        }
    }

    @Test
    void testParameterMetaData() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("SELECT ?, ?, ?")) {
            ParameterMetaData pmd = ps.getParameterMetaData();
            assertEquals(3, pmd.getParameterCount());
            assertEquals(ParameterMetaData.parameterModeIn, pmd.getParameterMode(1));
        }
    }

    // ------------------------------------------------------------------
    // ResultSet
    // ------------------------------------------------------------------

    @Test
    void testResultSetNavigation() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT 42")) {
            assertTrue(rs.isBeforeFirst());
            assertTrue(rs.next());
            assertTrue(rs.isFirst());
            assertEquals("42", rs.getString("result"));
            assertFalse(rs.next());
            assertTrue(rs.isAfterLast());
        }
    }

    @Test
    void testResultSetMetaData() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT 42")) {
            ResultSetMetaData md = rs.getMetaData();
            assertEquals(1, md.getColumnCount());
            assertEquals("result", md.getColumnName(1));
            assertEquals(Types.VARCHAR, md.getColumnType(1));
        }
    }

    // ------------------------------------------------------------------
    // DatabaseMetaData
    // ------------------------------------------------------------------

    @Test
    void testDatabaseMetaData() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url)) {
            DatabaseMetaData md = conn.getMetaData();
            assertEquals("VedaDB", md.getDatabaseProductName());
            assertEquals("VedaDB JDBC Driver", md.getDriverName());
            assertTrue(md.supportsTransactions());
            assertFalse(md.supportsStoredProcedures());
        }
    }

    // ------------------------------------------------------------------
    // Error handling
    // ------------------------------------------------------------------

    @Test
    void testQueryErrorThrows() throws SQLException {
        String url = "jdbc:vedadb://127.0.0.1:" + port;
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement()) {
            assertThrows(SQLException.class, () -> stmt.executeQuery("ERROR"));
        }
    }

    // ------------------------------------------------------------------
    // Config from properties
    // ------------------------------------------------------------------

    @Test
    void testConfigFromProperties() {
        java.util.Properties props = new java.util.Properties();
        props.setProperty("host", "db.example.com");
        props.setProperty("port", "9090");
        props.setProperty("database", "prod");

        VedaConfig cfg = VedaConfig.fromProperties(props);
        assertEquals("db.example.com", cfg.getHost());
        assertEquals(9090, cfg.getPort());
        assertEquals("prod", cfg.getDatabase());
    }
}
