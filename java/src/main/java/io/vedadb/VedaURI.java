package io.vedadb;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

/**
 * URI parser for VedaDB connection strings.
 *
 * <p>Parses URIs of the form:
 * {@code vedadb://admin:pass@localhost:7480/db?pool_size=20&timeout=30}
 *
 * <p>Supported query parameters:
 * <ul>
 *   <li>{@code pool_size} - connection pool maximum size</li>
 *   <li>{@code timeout}   - connection timeout in seconds</li>
 *   <li>{@code tls}       - enable TLS (true/false)</li>
 *   <li>{@code tls_insecure} - skip TLS verification (true/false)</li>
 *   <li>{@code retries}   - max retry attempts</li>
 *   <li>{@code database}  - database name (overrides path)</li>
 * </ul>
 *
 * <p>Usage:
 * <pre>{@code
 * VedaConfig config = VedaURI.parse("vedadb://admin:pass@localhost:7480/mydb?pool_size=20");
 * }</pre>
 */
public class VedaURI {

    /**
     * Parsed VedaDB configuration from a URI.
     */
    public static class VedaConfig {
        private String host = "localhost";
        private int port = 6380;
        private String username;
        private String password;
        private String database;
        private int poolSize = 10;
        private int timeoutSec = 30;
        private boolean tls = false;
        private boolean tlsInsecure = false;
        private int maxRetries = 3;
        private final Map<String, String> extraParams = new HashMap<>();

        public String getHost() { return host; }
        public int getPort() { return port; }
        public String getUsername() { return username; }
        public String getPassword() { return password; }
        public String getDatabase() { return database; }
        public int getPoolSize() { return poolSize; }
        public int getTimeoutSec() { return timeoutSec; }
        public boolean isTls() { return tls; }
        public boolean isTlsInsecure() { return tlsInsecure; }
        public int getMaxRetries() { return maxRetries; }
        public Map<String, String> getExtraParams() { return new HashMap<>(extraParams); }

        @Override
        public String toString() {
            return String.format(
                "VedaConfig{host=%s, port=%d, db=%s, pool=%d, tls=%s}",
                host, port, database, poolSize, tls);
        }
    }

    /**
     * Parse a VedaDB URI into a configuration object.
     *
     * @param uriString the URI string to parse
     * @return parsed configuration
     * @throws IllegalArgumentException if the URI is invalid
     */
    public static VedaConfig parse(String uriString) {
        if (uriString == null || uriString.isEmpty()) {
            throw new IllegalArgumentException("URI cannot be null or empty");
        }

        VedaConfig config = new VedaConfig();

        // Ensure proper scheme
        String normalized = uriString;
        if (!normalized.contains("://")) {
            normalized = "vedadb://" + normalized;
        }

        URI uri;
        try {
            uri = new URI(normalized);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid URI: " + uriString, e);
        }

        // Validate scheme
        String scheme = uri.getScheme();
        if (!"vedadb".equals(scheme)) {
            throw new IllegalArgumentException("Unsupported scheme: " + scheme + ", expected 'vedadb'");
        }

        // Host
        if (uri.getHost() != null) {
            config.host = uri.getHost();
        }

        // Port
        if (uri.getPort() > 0) {
            config.port = uri.getPort();
        }

        // User info
        if (uri.getUserInfo() != null) {
            String userInfo = uri.getUserInfo();
            int colonIdx = userInfo.indexOf(':');
            if (colonIdx >= 0) {
                config.username = decode(userInfo.substring(0, colonIdx));
                config.password = decode(userInfo.substring(colonIdx + 1));
            } else {
                config.username = decode(userInfo);
            }
        }

        // Database from path
        String path = uri.getPath();
        if (path != null && path.length() > 1) {
            config.database = path.substring(1);
        }

        // Query parameters
        if (uri.getQuery() != null) {
            parseQueryParams(uri.getQuery(), config);
        }

        return config;
    }

    /**
     * Build a connection URI from components.
     *
     * @param host     server host
     * @param port     server port
     * @param username optional username
     * @param password optional password
     * @param database optional database name
     * @return a properly formatted VedaDB URI
     */
    public static String build(String host, int port, String username,
                                String password, String database) {
        StringBuilder sb = new StringBuilder();
        sb.append("vedadb://");
        if (username != null && !username.isEmpty()) {
            sb.append(encode(username));
            if (password != null && !password.isEmpty()) {
                sb.append(":").append(encode(password));
            }
            sb.append("@");
        }
        sb.append(host).append(":").append(port);
        if (database != null && !database.isEmpty()) {
            sb.append("/").append(database);
        }
        return sb.toString();
    }

    /**
     * Parse query parameters from the query string.
     */
    private static void parseQueryParams(String query, VedaConfig config) {
        for (String param : query.split("&")) {
            String[] kv = param.split("=", 2);
            if (kv.length != 2) continue;
            String key = decode(kv[0]);
            String value = decode(kv[1]);

            switch (key) {
                case "pool_size":
                    config.poolSize = parseInt(value, "pool_size");
                    break;
                case "timeout":
                    config.timeoutSec = parseInt(value, "timeout");
                    break;
                case "tls":
                    config.tls = Boolean.parseBoolean(value);
                    break;
                case "tls_insecure":
                case "tls.insecure":
                    config.tlsInsecure = Boolean.parseBoolean(value);
                    break;
                case "retries":
                case "max_retries":
                    config.maxRetries = parseInt(value, key);
                    break;
                case "database":
                    config.database = value;
                    break;
                default:
                    config.extraParams.put(key, value);
                    break;
            }
        }
    }

    private static int parseInt(String value, String name) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Invalid integer for " + name + ": " + value);
        }
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            return s;
        }
    }

    private static String encode(String s) {
        return s.replace("%", "%25")
                .replace(":", "%3A")
                .replace("@", "%40")
                .replace("/", "%2F");
    }
}
