package com.vedadb.driver;

import java.util.Properties;

/**
 * Configuration for a VedaDB connection.
 *
 * <p>Supports construction via builder pattern or from JDBC connection
 * properties / DSN URL.
 */
public class VedaConfig {

    private String host = "localhost";
    private int port = 8080;
    private String baseUrl;
    private String username;
    private String password;
    private String database;
    private long timeoutMs = 30000;
    private boolean tls = false;
    private boolean tlsInsecure = false;
    private int maxRetries = 3;
    private long retryBackoffBaseMs = 500;
    private long retryMaxBackoffMs = 30000;

    // Pool config
    private int poolMaxSize = 10;
    private int poolMaxOverflow = 5;
    private long poolMaxLifetimeMs = 3600_000;
    private long poolMaxIdleMs = 600_000;
    private long poolTimeoutMs = 30_000;

    public static VedaConfig fromUrl(String url) {
        VedaConfig cfg = new VedaConfig();
        if (url == null || url.isEmpty()) return cfg;

        // jdbc:vedadb://host:port/database?param=value
        String clean = url;
        if (clean.startsWith("jdbc:")) clean = clean.substring(5);

        java.net.URI uri;
        try {
            uri = new java.net.URI(clean);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid JDBC URL: " + url, e);
        }

        cfg.host = uri.getHost() != null ? uri.getHost() : cfg.host;
        cfg.port = uri.getPort() > 0 ? uri.getPort() : cfg.port;
        String path = uri.getPath();
        if (path != null && path.length() > 1) {
            cfg.database = path.substring(1);
        }

        if (uri.getUserInfo() != null) {
            String[] parts = uri.getUserInfo().split(":", 2);
            cfg.username = parts[0];
            if (parts.length > 1) cfg.password = parts[1];
        }

        // Query parameters
        String query = uri.getQuery();
        if (query != null) {
            for (String param : query.split("&")) {
                String[] kv = param.split("=", 2);
                if (kv.length == 2) {
                    cfg.setParam(kv[0], kv[1]);
                }
            }
        }

        return cfg;
    }

    public static VedaConfig fromProperties(Properties props) {
        VedaConfig cfg = new VedaConfig();
        if (props.containsKey("host")) cfg.host = props.getProperty("host");
        if (props.containsKey("port")) cfg.port = Integer.parseInt(props.getProperty("port"));
        if (props.containsKey("database")) cfg.database = props.getProperty("database");
        if (props.containsKey("username")) cfg.username = props.getProperty("username");
        if (props.containsKey("password")) cfg.password = props.getProperty("password");
        if (props.containsKey("timeout")) cfg.timeoutMs = Long.parseLong(props.getProperty("timeout"));
        if (props.containsKey("tls")) cfg.tls = Boolean.parseBoolean(props.getProperty("tls"));
        if (props.containsKey("tls.insecure")) cfg.tlsInsecure = Boolean.parseBoolean(props.getProperty("tls.insecure"));
        if (props.containsKey("maxRetries")) cfg.maxRetries = Integer.parseInt(props.getProperty("maxRetries"));
        if (props.containsKey("pool.maxSize")) cfg.poolMaxSize = Integer.parseInt(props.getProperty("pool.maxSize"));
        if (props.containsKey("pool.maxOverflow")) cfg.poolMaxOverflow = Integer.parseInt(props.getProperty("pool.maxOverflow"));
        return cfg;
    }

    private void setParam(String key, String value) {
        switch (key) {
            case "tls" -> tls = Boolean.parseBoolean(value);
            case "tls_insecure", "tls.insecure" -> tlsInsecure = Boolean.parseBoolean(value);
            case "timeout" -> timeoutMs = Long.parseLong(value) * 1000;
            case "max_retries", "maxRetries" -> maxRetries = Integer.parseInt(value);
            default -> { /* ignore unknown */ }
        }
    }

    public String getBaseUrl() {
        if (baseUrl != null) return baseUrl;
        String scheme = tls ? "https" : "http";
        return scheme + "://" + host + ":" + port;
    }

    // Getters
    public String getHost() { return host; }
    public int getPort() { return port; }
    public String getUsername() { return username; }
    public String getPassword() { return password; }
    public String getDatabase() { return database; }
    public long getTimeoutMs() { return timeoutMs; }
    public boolean isTls() { return tls; }
    public boolean isTlsInsecure() { return tlsInsecure; }
    public int getMaxRetries() { return maxRetries; }
    public long getRetryBackoffBaseMs() { return retryBackoffBaseMs; }
    public long getRetryMaxBackoffMs() { return retryMaxBackoffMs; }
    public int getPoolMaxSize() { return poolMaxSize; }
    public int getPoolMaxOverflow() { return poolMaxOverflow; }
    public long getPoolMaxLifetimeMs() { return poolMaxLifetimeMs; }
    public long getPoolMaxIdleMs() { return poolMaxIdleMs; }
    public long getPoolTimeoutMs() { return poolTimeoutMs; }

    // Setters (builder style)
    public VedaConfig host(String h) { this.host = h; return this; }
    public VedaConfig port(int p) { this.port = p; return this; }
    public VedaConfig baseUrl(String u) { this.baseUrl = u; return this; }
    public VedaConfig username(String u) { this.username = u; return this; }
    public VedaConfig password(String p) { this.password = p; return this; }
    public VedaConfig database(String d) { this.database = d; return this; }
    public VedaConfig timeoutMs(long t) { this.timeoutMs = t; return this; }
    public VedaConfig tls(boolean t) { this.tls = t; return this; }
    public VedaConfig tlsInsecure(boolean t) { this.tlsInsecure = t; return this; }
    public VedaConfig maxRetries(int r) { this.maxRetries = r; return this; }
    public VedaConfig poolMaxSize(int s) { this.poolMaxSize = s; return this; }
    public VedaConfig poolMaxOverflow(int o) { this.poolMaxOverflow = o; return this; }
}
