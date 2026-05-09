package com.vedadb.driver;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.*;
import java.util.Properties;
import java.util.logging.Logger;

/**
 * JDBC Driver for VedaDB.
 *
 * <p>Implements {@link java.sql.Driver} with full support for:
 * <ul>
 *   <li>Connection pooling (via HikariCP or any DataSource)</li>
 *   <li>Prepared statements with parameter binding</li>
 *   <li>Transactions (BEGIN / COMMIT / ROLLBACK)</li>
 *   <li>Batch execution</li>
 *   <li>Result set metadata</li>
 * </ul>
 *
 * <p><strong>URL format:</strong>
 * <pre>{@code jdbc:vedadb://[username[:password]@]host[:port][/database][?param=value&...]}</pre>
 *
 * <p><strong>Example:</strong>
 * <pre>{@code
 * // Direct driver usage
 * Connection conn = DriverManager.getConnection("jdbc:vedadb://admin:secret@localhost:8080/mydb");
 *
 * // With HikariCP
 * HikariConfig config = new HikariConfig();
 * config.setJdbcUrl("jdbc:vedadb://localhost:8080/mydb");
 * config.setUsername("admin");
 * config.setPassword("secret");
 * config.setMaximumPoolSize(20);
 * DataSource ds = new HikariDataSource(config);
 * }</pre>
 */
public class VedaDriver implements java.sql.Driver {

    private static final Logger logger = LoggerFactory.getLogger(VedaDriver.class);
    public static final String URL_PREFIX = "jdbc:vedadb:";

    static {
        try {
            DriverManager.registerDriver(new VedaDriver());
        } catch (SQLException e) {
            throw new RuntimeException("Failed to register VedaDB JDBC driver", e);
        }
    }

    @Override
    public Connection connect(String url, Properties info) throws SQLException {
        if (!acceptsURL(url)) return null;
        logger.debug("Connecting to {}", url);
        VedaConfig config = VedaConfig.fromUrl(url);
        VedaConfig fromProps = VedaConfig.fromProperties(info);
        merge(config, fromProps, info);
        return new VedaConnection(config);
    }

    @Override
    public boolean acceptsURL(String url) throws SQLException {
        return url != null && url.startsWith(URL_PREFIX);
    }

    @Override
    public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) throws SQLException {
        return new DriverPropertyInfo[]{
                prop("host", "localhost"),
                prop("port", "8080"),
                prop("database", ""),
                prop("timeout", "30"),
                prop("tls", "false"),
                prop("maxRetries", "3"),
        };
    }

    @Override
    public int getMajorVersion() {
        return 1;
    }

    @Override
    public int getMinorVersion() {
        return 0;
    }

    @Override
    public boolean jdbcCompliant() {
        return false; // VedaDB is not a full relational database
    }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        throw new SQLFeatureNotSupportedException();
    }

    private DriverPropertyInfo prop(String name, String value) {
        DriverPropertyInfo p = new DriverPropertyInfo(name, value);
        p.required = false;
        return p;
    }

    private void merge(VedaConfig target, VedaConfig fromProps, Properties raw) {
        if (fromProps != null) {
            if (raw.containsKey("user")) target.host(raw.getProperty("user"));
            if (raw.containsKey("password")) target.password(raw.getProperty("password"));
        }
    }
}
