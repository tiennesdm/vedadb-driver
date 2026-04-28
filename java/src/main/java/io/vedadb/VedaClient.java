package io.vedadb;

import java.io.*;
import java.net.Socket;
import java.security.cert.X509Certificate;
import java.util.*;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * VedaDB Java Driver
 *
 * Supports TLS encryption via STARTTLS, AUTH authentication,
 * and server-side prepared statements.
 *
 * Usage:
 *   VedaClient db = new VedaClient("localhost", 6380);
 *   VedaResult result = db.query("SELECT * FROM users;");
 *   for (List<String> row : result.getRows()) {
 *       System.out.println(row);
 *   }
 *   db.close();
 *
 * With TLS and auth:
 *   VedaClient db = new VedaClient("localhost", 6380, true, "admin", "secret");
 */
public class VedaClient implements AutoCloseable {
    private Socket socket;
    private BufferedWriter writer;
    private BufferedReader reader;
    private final Object lock = new Object();
    private final String host;
    private final int port;
    private final boolean useTls;
    private final boolean tlsVerify;
    private final String username;
    private final String password;

    /**
     * Connect to VedaDB server with TLS (cert verification on) and authentication.
     */
    public VedaClient(String host, int port, boolean useTls, String username, String password) throws IOException, VedaException {
        this(host, port, useTls, true, username, password);
    }

    /**
     * Connect to VedaDB server with TLS, optional cert-verification toggle, and auth.
     *
     * @param host      Server hostname
     * @param port      Server port
     * @param useTls    If true, perform STARTTLS upgrade
     * @param tlsVerify If true (default), verify the server certificate and hostname
     *                  against the JVM trust store. Pass false only for development.
     * @param username  Username for AUTH (null to skip)
     * @param password  Password for AUTH (null to skip)
     */
    public VedaClient(String host, int port, boolean useTls, boolean tlsVerify,
                      String username, String password) throws IOException, VedaException {
        this.host = host;
        this.port = port;
        this.useTls = useTls;
        this.tlsVerify = tlsVerify;
        this.username = username;
        this.password = password;

        this.socket = new Socket(host, port);
        this.writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream()));
        this.reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));

        // Read welcome message
        reader.readLine();

        // STARTTLS upgrade
        if (useTls) {
            upgradeToTls();
        }

        // AUTH
        if (username != null && !username.isEmpty()) {
            authenticate(username, password != null ? password : "");
        }
    }

    /**
     * Connect to VedaDB server.
     */
    public VedaClient(String host, int port) throws IOException, VedaException {
        this(host, port, false, null, null);
    }

    /**
     * Connect to localhost:6380.
     */
    public VedaClient() throws IOException, VedaException {
        this("localhost", 6380);
    }

    /**
     * Perform STARTTLS handshake and upgrade the socket to SSL.
     */
    private void upgradeToTls() throws IOException, VedaException {
        // Send STARTTLS command
        writer.write("STARTTLS\n");
        writer.flush();

        // Read server response
        String response = reader.readLine();
        if (response == null) {
            throw new IOException("Connection closed during STARTTLS");
        }

        // Check for error in response
        if (response.contains("\"error\"")) {
            throw new VedaException("STARTTLS failed: " + response);
        }

        // Wrap socket with SSL.
        SSLSocketFactory sslFactory;
        if (tlsVerify) {
            sslFactory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        } else {
            // Dev-only opt-out: trust everything. Loud name on purpose.
            try {
                SSLContext insecureCtx = SSLContext.getInstance("TLS");
                insecureCtx.init(null, new TrustManager[] { new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    public void checkClientTrusted(X509Certificate[] c, String a) {}
                    public void checkServerTrusted(X509Certificate[] c, String a) {}
                }}, new java.security.SecureRandom());
                sslFactory = insecureCtx.getSocketFactory();
            } catch (Exception e) {
                throw new VedaException("Failed to build insecure TLS context: " + e.getMessage());
            }
        }
        SSLSocket sslSocket = (SSLSocket) sslFactory.createSocket(socket, host, port, true);
        if (tlsVerify) {
            // SSLSocketFactory.getDefault() does NOT enable hostname verification by
            // default. Set the HTTPS endpoint identification algorithm so that the
            // handshake fails if the cert's CN/SAN doesn't match `host`.
            SSLParameters params = sslSocket.getSSLParameters();
            params.setEndpointIdentificationAlgorithm("HTTPS");
            sslSocket.setSSLParameters(params);
        }
        sslSocket.startHandshake();

        // Replace socket and update reader/writer
        this.socket = sslSocket;
        this.writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream()));
        this.reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
    }

    /**
     * Authenticate with the server using AUTH command.
     */
    private void authenticate(String user, String pass) throws IOException, VedaException {
        writer.write("AUTH " + user + " " + pass + "\n");
        writer.flush();

        String response = reader.readLine();
        if (response == null) {
            throw new IOException("Connection closed during AUTH");
        }

        if (response.contains("\"error\"")) {
            throw new VedaException("Authentication failed: " + response);
        }
    }

    /**
     * Execute a VedaQL query.
     */
    public VedaResult query(String sql) throws IOException, VedaException {
        synchronized (lock) {
            writer.write(sql + "\n");
            writer.flush();

            String response = reader.readLine();
            if (response == null) {
                throw new IOException("Connection closed");
            }

            return VedaResult.parse(response);
        }
    }

    /**
     * Execute a query that doesn't return rows.
     */
    public String exec(String sql) throws IOException, VedaException {
        VedaResult result = query(sql);
        return result.getMessage();
    }

    /**
     * Prepare a named statement on the server.
     *
     * @param name  Statement name
     * @param query SQL query to prepare
     * @return Server response
     */
    public VedaResult prepare(String name, String query) throws IOException, VedaException {
        return query("PREPARE " + name + " AS " + query);
    }

    /**
     * Execute a previously prepared statement with parameter values.
     *
     * @param name   Statement name
     * @param params Parameter values
     * @return Query result
     */
    public VedaResult executePrepared(String name, String... params) throws IOException, VedaException {
        StringBuilder paramList = new StringBuilder();
        for (int i = 0; i < params.length; i++) {
            if (i > 0) paramList.append(", ");
            paramList.append(formatValue(params[i]));
        }
        return query("EXECUTE " + name + " (" + paramList + ")");
    }

    /**
     * Deallocate (remove) a previously prepared statement from the server.
     *
     * @param name Statement name
     * @return Server response
     */
    public VedaResult deallocate(String name) throws IOException, VedaException {
        return query("DEALLOCATE " + name);
    }

    /**
     * Insert a row.
     */
    public String insert(String table, Map<String, Object> data) throws IOException, VedaException {
        StringBuilder cols = new StringBuilder();
        StringBuilder vals = new StringBuilder();

        int i = 0;
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            if (i > 0) {
                cols.append(", ");
                vals.append(", ");
            }
            cols.append(entry.getKey());
            vals.append(formatValue(entry.getValue()));
            i++;
        }

        return exec(String.format("INSERT INTO %s (%s) VALUES (%s);", table, cols, vals));
    }

    /**
     * Select rows.
     */
    public VedaResult select(String table, String columns, String where,
                              String orderBy, int limit) throws IOException, VedaException {
        StringBuilder sql = new StringBuilder("SELECT ");
        sql.append(columns != null ? columns : "*");
        sql.append(" FROM ").append(table);

        if (where != null && !where.isEmpty()) {
            sql.append(" WHERE ").append(where);
        }
        if (orderBy != null && !orderBy.isEmpty()) {
            sql.append(" ORDER BY ").append(orderBy);
        }
        if (limit > 0) {
            sql.append(" LIMIT ").append(limit);
        }
        sql.append(";");

        return query(sql.toString());
    }

    /**
     * Select all rows.
     */
    public VedaResult selectAll(String table) throws IOException, VedaException {
        return select(table, "*", null, null, 0);
    }

    /**
     * Update rows.
     */
    public String update(String table, Map<String, Object> set, String where)
            throws IOException, VedaException {
        StringBuilder setClause = new StringBuilder();
        int i = 0;
        for (Map.Entry<String, Object> entry : set.entrySet()) {
            if (i > 0) setClause.append(", ");
            setClause.append(entry.getKey()).append(" = ").append(formatValue(entry.getValue()));
            i++;
        }

        String sql = "UPDATE " + table + " SET " + setClause;
        if (where != null && !where.isEmpty()) {
            sql += " WHERE " + where;
        }
        return exec(sql + ";");
    }

    /**
     * Delete rows.
     */
    public String delete(String table, String where) throws IOException, VedaException {
        String sql = "DELETE FROM " + table;
        if (where != null && !where.isEmpty()) {
            sql += " WHERE " + where;
        }
        return exec(sql + ";");
    }

    /**
     * Show all tables.
     */
    public List<String> showTables() throws IOException, VedaException {
        VedaResult result = query("SHOW TABLES;");
        List<String> tables = new ArrayList<>();
        if (result.getRows() != null) {
            for (List<String> row : result.getRows()) {
                tables.add(row.get(0));
            }
        }
        return tables;
    }

    /**
     * Ping the server.
     */
    public boolean ping() {
        try {
            query("SHOW TABLES;");
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Close the connection.
     */
    @Override
    public void close() throws IOException {
        try {
            writer.write("QUIT\n");
            writer.flush();
        } catch (Exception ignored) {}
        socket.close();
    }

    // ── Transactions ──────────────────────────────────────────────

    /**
     * Begin a transaction.
     */
    public void begin() throws IOException, VedaException {
        exec("BEGIN");
    }

    /**
     * Commit the current transaction.
     */
    public void commit() throws IOException, VedaException {
        exec("COMMIT");
    }

    /**
     * Rollback the current transaction.
     */
    public void rollback() throws IOException, VedaException {
        exec("ROLLBACK");
    }

    /**
     * Execute a function inside a transaction. Commits on success, rolls back on failure.
     *
     * @param fn  Function that receives this client and returns a result
     * @param <T> Return type
     * @return The value returned by fn
     */
    public <T> T transaction(java.util.function.Function<VedaClient, T> fn) throws Exception {
        begin();
        try {
            T result = fn.apply(this);
            commit();
            return result;
        } catch (Exception e) {
            rollback();
            throw e;
        }
    }

    // ── Auto-Reconnect ──────────────────────────────────────────

    /**
     * Reconnect to the server with exponential back-off.
     *
     * @param maxRetries Maximum number of reconnection attempts
     */
    public void reconnect(int maxRetries) throws Exception {
        for (int i = 0; i < maxRetries; i++) {
            try {
                close();
                // Re-create connection using stored parameters
                this.socket = new Socket(host, port);
                this.writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream()));
                this.reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                reader.readLine(); // welcome
                if (useTls) { upgradeToTls(); }
                if (username != null && !username.isEmpty()) { authenticate(username, password != null ? password : ""); }
                return;
            } catch (Exception e) {
                Thread.sleep((i + 1) * 1000L);
            }
        }
        throw new Exception("Reconnect failed after " + maxRetries + " attempts");
    }

    // ── Batch Insert ────────────────────────────────────────────

    /**
     * Insert multiple rows in a single statement.
     *
     * @param table   Table name
     * @param columns Column names
     * @param rows    Row data (each inner array corresponds to one row)
     * @return Query result
     */
    public VedaResult insertMany(String table, String[] columns, String[][] rows) throws IOException, VedaException {
        StringBuilder sb = new StringBuilder();
        sb.append("INSERT INTO ").append(table).append(" (");
        sb.append(String.join(", ", columns)).append(") VALUES ");
        for (int i = 0; i < rows.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append("(");
            for (int j = 0; j < rows[i].length; j++) {
                if (j > 0) sb.append(", ");
                sb.append("'").append(rows[i][j].replace("'", "''")).append("'");
            }
            sb.append(")");
        }
        sb.append(";");
        return query(sb.toString());
    }

    // ── Cache ───────────────────────────────────────────────────

    /**
     * Set a cache key with a TTL in seconds.
     */
    public void cacheSet(String key, String value, int ttl) throws IOException, VedaException {
        exec("CACHE SET " + key + " '" + value.replace("'", "''") + "' TTL " + ttl);
    }

    /**
     * Get the value for a cache key. Returns null if the key does not exist.
     */
    public String cacheGet(String key) throws IOException, VedaException {
        VedaResult result = query("CACHE GET " + key);
        if (result.getRows() != null && !result.getRows().isEmpty()) {
            return result.getRows().get(0).get(0);
        }
        return null;
    }

    /**
     * Delete a cache key.
     */
    public void cacheDel(String key) throws IOException, VedaException {
        exec("CACHE DEL " + key);
    }

    // ── Search ──────────────────────────────────────────────────

    /**
     * Perform a fuzzy search on a table.
     *
     * @param table Table name
     * @param query Search query string
     * @param fuzzy Fuzziness level (0 = exact)
     * @return Query result with matching rows
     */
    public VedaResult search(String table, String query, int fuzzy) throws IOException, VedaException {
        return query("SEARCH " + table + " '" + query.replace("'", "''") + "' FUZZY " + fuzzy);
    }

    // ── Graph ───────────────────────────────────────────────────

    /**
     * Add a node to the graph.
     *
     * @param id    Node identifier
     * @param label Node label
     */
    public void graphAddNode(String id, String label) throws IOException, VedaException {
        exec("GRAPH ADD NODE '" + id.replace("'", "''") + "' LABEL '" + label.replace("'", "''") + "'");
    }

    /**
     * Perform a breadth-first search on the graph.
     *
     * @param start Starting node id
     * @param depth Maximum traversal depth
     * @return Query result with discovered nodes
     */
    public VedaResult graphBFS(String start, int depth) throws IOException, VedaException {
        return query("GRAPH BFS '" + start.replace("'", "''") + "' DEPTH " + depth);
    }

    /**
     * Escape a value for safe inclusion in a VedaQL string literal using
     * SQL-standard single-quote doubling (`''`). Earlier revisions used
     * `\'` backslash escaping which VedaDB does not parse, turning every
     * `O'Brien` into a syntax error.
     */
    private String formatValue(Object value) {
        if (value == null) return "NULL";
        if (value instanceof String) return "'" + ((String) value).replace("'", "''") + "'";
        if (value instanceof Boolean) return ((Boolean) value) ? "TRUE" : "FALSE";
        return value.toString();
    }
}
