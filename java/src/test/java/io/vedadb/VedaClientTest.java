package io.vedadb;

import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

class VedaClientTest {

    private ServerSocket mockServer;
    private int port;

    @BeforeEach
    void setUp() throws IOException {
        mockServer = new ServerSocket(0);
        port = mockServer.getLocalPort();
    }

    @AfterEach
    void tearDown() throws IOException {
        mockServer.close();
    }

    private void respondWith(String response) {
        new Thread(() -> {
            try {
                Socket client = mockServer.accept();
                BufferedWriter out = new BufferedWriter(new OutputStreamWriter(client.getOutputStream()));
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream()));

                // Send welcome banner
                out.write("VedaDB v0.2.0 ready.\n");
                out.flush();

                // Read query
                String query = in.readLine();
                if (query != null) {
                    out.write(response + "\n");
                    out.flush();
                }

                // Wait for QUIT or close
                try { in.readLine(); } catch (Exception ignored) {}
                client.close();
            } catch (Exception e) {
                // Server thread error - test will fail on client side
            }
        }).start();
    }

    @Test
    void connectAndQuery() throws Exception {
        respondWith("{\"columns\":[\"id\",\"name\"],\"rows\":[[\"1\",\"Alice\"]],\"row_count\":1}");

        try (VedaClient db = new VedaClient("localhost", port)) {
            VedaResult result = db.query("SELECT * FROM users;");
            assertEquals(1, result.getRowCount());
            assertEquals("Alice", result.getRows().get(0).get(1));
        }
    }

    @Test
    void execReturnsMessage() throws Exception {
        respondWith("{\"message\":\"Table created\",\"row_count\":0}");

        try (VedaClient db = new VedaClient("localhost", port)) {
            String msg = db.exec("CREATE TABLE test (id INT);");
            assertEquals("Table created", msg);
        }
    }

    @Test
    void queryErrorThrowsVedaException() throws Exception {
        respondWith("{\"error\":\"Syntax error near 'SELEC'\"}");

        try (VedaClient db = new VedaClient("localhost", port)) {
            assertThrows(VedaException.class, () -> db.query("SELEC * FROM users;"));
        }
    }

    @Test
    void insertFormatsValues() throws Exception {
        AtomicReference<String> captured = new AtomicReference<>();

        new Thread(() -> {
            try {
                Socket client = mockServer.accept();
                BufferedWriter out = new BufferedWriter(new OutputStreamWriter(client.getOutputStream()));
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream()));

                out.write("VedaDB v0.2.0 ready.\n");
                out.flush();

                String query = in.readLine();
                captured.set(query);
                out.write("{\"message\":\"1 row inserted\",\"row_count\":1}\n");
                out.flush();

                try { in.readLine(); } catch (Exception ignored) {}
                client.close();
            } catch (Exception ignored) {}
        }).start();

        try (VedaClient db = new VedaClient("localhost", port)) {
            db.insert("users", Map.of("name", "Alice", "age", 30));
        }

        String sql = captured.get();
        assertNotNull(sql);
        assertTrue(sql.startsWith("INSERT INTO users"));
        assertTrue(sql.contains("'Alice'"));
        assertTrue(sql.contains("30"));
    }

    @Test
    void pingReturnsTrueOnSuccess() throws Exception {
        // Respond to SHOW TABLES query
        new Thread(() -> {
            try {
                Socket client = mockServer.accept();
                BufferedWriter out = new BufferedWriter(new OutputStreamWriter(client.getOutputStream()));
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream()));

                out.write("VedaDB v0.2.0 ready.\n");
                out.flush();

                String query = in.readLine();
                out.write("{\"columns\":[\"table_name\"],\"rows\":[[\"users\"]],\"row_count\":1}\n");
                out.flush();

                try { in.readLine(); } catch (Exception ignored) {}
                client.close();
            } catch (Exception ignored) {}
        }).start();

        try (VedaClient db = new VedaClient("localhost", port)) {
            assertTrue(db.ping());
        }
    }
}
