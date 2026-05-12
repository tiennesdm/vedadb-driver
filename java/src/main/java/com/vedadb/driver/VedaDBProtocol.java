package com.vedadb.driver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.vedadb.driver.VedaDBException.*;

import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.net.ssl.*;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * HTTP wire-protocol layer for the VedaDB REST API.
 *
 * <p>Handles JSON serialization, authentication headers, retry logic with
 * exponential back-off, connection pooling via OkHttp, and response parsing.
 */
public class VedaDBProtocol implements AutoCloseable {

    private static final Logger logger = LoggerFactory.getLogger(VedaDBProtocol.class);
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private final ObjectMapper mapper = new ObjectMapper();

    private final String baseUrl;
    private final String authHeader;
    private final String database;
    private final int maxRetries;
    private final long retryBackoffBaseMs;
    private final long retryMaxBackoffMs;
    private final OkHttpClient client;

    private volatile boolean closed = false;

    public VedaDBProtocol(VedaConfig config) {
        this.baseUrl = config.getBaseUrl();
        this.database = config.getDatabase();
        this.maxRetries = config.getMaxRetries();
        this.retryBackoffBaseMs = config.getRetryBackoffBaseMs();
        this.retryMaxBackoffMs = config.getRetryMaxBackoffMs();

        // Auth header
        if (config.getUsername() != null && config.getPassword() != null) {
            String token = Base64.getEncoder()
                    .encodeToString((config.getUsername() + ":" + config.getPassword()).getBytes());
            this.authHeader = "Bearer " + token;
        } else {
            this.authHeader = null;
        }

        // HTTP client with connection pooling
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .connectTimeout(Duration.ofMillis(config.getTimeoutMs()))
                .readTimeout(Duration.ofMillis(config.getTimeoutMs()))
                .writeTimeout(Duration.ofMillis(config.getTimeoutMs()))
                .connectionPool(new ConnectionPool(10, 5, TimeUnit.MINUTES))
                .retryOnConnectionFailure(true);

        // TLS configuration
        if (config.isTls()) {
            if (config.isTlsInsecure()) {
                builder.hostnameVerifier((hostname, session) -> true);
                try {
                    TrustManager[] trustAll = new TrustManager[]{
                            new X509TrustManager() {
                                public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                                public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                            }
                    };
                    SSLContext sslContext = SSLContext.getInstance("TLS");
                    sslContext.init(null, trustAll, new java.security.SecureRandom());
                    builder.sslSocketFactory(sslContext.getSocketFactory(), (X509TrustManager) trustAll[0]);
                } catch (GeneralSecurityException e) {
                    throw new ConnectionError("Failed to configure TLS", e);
                }
            }
        }

        this.client = builder.build();
    }

    /** Execute HTTP request with retries and error translation. */
    public JsonNode request(String method, String path, ObjectNode payload) throws VedaDBException {
        if (closed) throw new ConnectionError("protocol is closed");

        String url = baseUrl + path;
        int maxAttempts = 1 + maxRetries;
        VedaDBException lastError = null;

        for (int attempt = 0; attempt < maxAttempts; attempt++) {
            Request.Builder reqBuilder = new Request.Builder()
                    .url(url)
                    .header("Accept", "application/json")
                    .header("X-Client-Library", "vedadb-java/1.0.0");

            if (authHeader != null) reqBuilder.header("Authorization", authHeader);
            if (database != null) reqBuilder.header("X-VedaDB-Database", database);

            RequestBody body = null;
            if (payload != null) {
                body = RequestBody.create(payload.toString(), JSON);
                reqBuilder.header("Content-Type", "application/json");
            }

            reqBuilder.method(method, body);

            try (Response response = client.newCall(reqBuilder.build()).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                int code = response.code();

                if (code >= 200 && code < 300) {
                    return responseBody.isEmpty() ? mapper.createObjectNode() : mapper.readTree(responseBody);
                }

                // Parse error
                String errorMsg = responseBody;
                try {
                    JsonNode errNode = mapper.readTree(responseBody);
                    if (errNode.has("error")) errorMsg = errNode.get("error").asText();
                } catch (Exception ignored) {}

                if (code == 429) {
                    double retryAfter = retryBackoffBaseMs * Math.pow(2, attempt);
                    String ra = response.header("Retry-After");
                    if (ra != null) try { retryAfter = Double.parseDouble(ra) * 1000; } catch (NumberFormatException ignored) {}
                    if (attempt < maxAttempts - 1) {
                        sleep(Math.min((long) retryAfter, retryMaxBackoffMs));
                        continue;
                    }
                    throw new RateLimitError(errorMsg, retryAfter / 1000.0);
                }

                if (code == 401 || code == 403) throw new AuthError(errorMsg, code);
                if (code == 400) throw new QueryError(errorMsg);

                // 5xx retry
                if (code >= 500 && code < 600 && attempt < maxAttempts - 1) {
                    sleep(Math.min(retryBackoffBaseMs * (1L << attempt), retryMaxBackoffMs));
                    continue;
                }

                throw new ConnectionError("HTTP " + code + ": " + errorMsg);

            } catch (IOException e) {
                lastError = new ConnectionError(e.getMessage(), e);
                if (attempt < maxAttempts - 1) {
                    sleep(Math.min(retryBackoffBaseMs * (1L << attempt), retryMaxBackoffMs));
                }
            }
        }

        throw lastError != null ? lastError : new ConnectionError("request failed after all retries");
    }

    /** Execute a VedaQL query. */
    public JsonNode query(String sql, List<Object> params) throws VedaDBException {
        if (sql == null || sql.trim().isEmpty()) throw new ValidationError("query must not be empty");
        if (sql.length() > 1_000_000) throw new ValidationError("query exceeds 1MB maximum");

        ObjectNode payload = mapper.createObjectNode().put("query", sql);
        if (database != null) payload.put("database", database);
        if (params != null && !params.isEmpty()) {
            if (params.size() > 1024) throw new ValidationError("maximum 1024 params per query");
            ArrayNode arr = payload.putArray("params");
            for (Object p : params) arr.add(mapper.valueToTree(p).asText());
        }

        return request("POST", "/v1/query", payload);
    }

    /** GET /v1/health */
    public JsonNode health() throws VedaDBException {
        return request("GET", "/v1/health", null);
    }

    /** Ping the server. */
    public boolean ping() {
        try {
            JsonNode h = health();
            return "ok".equals(h.path("status").asText());
        } catch (Exception e) {
            return false;
        }
    }

    /** Execute a batch of operations. */
    public JsonNode batch(List<ObjectNode> operations) throws VedaDBException {
        if (operations == null || operations.isEmpty()) throw new ValidationError("operations list must not be empty");
        if (operations.size() > 100) throw new ValidationError("maximum 100 operations per batch");
        ObjectNode payload = mapper.createObjectNode();
        ArrayNode ops = payload.putArray("operations");
        for (ObjectNode op : operations) ops.add(op);
        return request("POST", "/v1/batch", payload);
    }

    @Override
    public void close() {
        closed = true;
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }

    public boolean isClosed() {
        return closed;
    }

    public ObjectMapper getMapper() {
        return mapper;
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
