package com.vedadb.driver;

import com.vedadb.driver.VedaDBException.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.*;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.Executor;

/**
 * JDBC Connection implementation for VedaDB.
 *
 * <p>Wraps a {@link VedaDBProtocol} and provides standard JDBC connection
 * semantics including transactions, prepared statements, and metadata.
 */
public class VedaConnection implements Connection {

    private static final Logger logger = LoggerFactory.getLogger(VedaConnection.class);

    private final VedaDBProtocol protocol;
    private final VedaConfig config;
    private volatile boolean closed = false;
    private volatile boolean autoCommit = true;
    private volatile boolean inTransaction = false;
    private volatile int transactionIsolation = Connection.TRANSACTION_READ_COMMITTED;
    private volatile boolean readOnly = false;

    VedaConnection(VedaConfig config) throws SQLException {
        this.config = config;
        try {
            this.protocol = new VedaDBProtocol(config);
        } catch (Exception e) {
            throw new SQLException("Failed to create VedaDB connection", e);
        }
    }

    VedaConnection(VedaDBProtocol protocol, VedaConfig config) {
        this.protocol = protocol;
        this.config = config;
    }

    // ------------------------------------------------------------------
    // Statement creation
    // ------------------------------------------------------------------

    @Override
    public Statement createStatement() throws SQLException {
        checkOpen();
        return new VedaStatement(this, protocol);
    }

    @Override
    public PreparedStatement prepareStatement(String sql) throws SQLException {
        checkOpen();
        return new VedaPreparedStatement(this, protocol, sql);
    }

    @Override
    public CallableStatement prepareCall(String sql) throws SQLException {
        throw new SQLFeatureNotSupportedException("CallableStatement not supported");
    }

    @Override
    public String nativeSQL(String sql) throws SQLException {
        return sql;
    }

    // ------------------------------------------------------------------
    // Transaction control
    // ------------------------------------------------------------------

    @Override
    public void setAutoCommit(boolean autoCommit) throws SQLException {
        checkOpen();
        if (this.autoCommit == autoCommit) return;
        if (!autoCommit) {
            // Switching to manual commit — start transaction
            executeInternal("BEGIN");
            this.inTransaction = true;
        } else if (inTransaction) {
            // Switching to auto-commit — commit current transaction
            commit();
        }
        this.autoCommit = autoCommit;
    }

    @Override
    public boolean getAutoCommit() throws SQLException {
        return autoCommit;
    }

    @Override
    public void commit() throws SQLException {
        checkOpen();
        if (inTransaction) {
            executeInternal("COMMIT");
            inTransaction = false;
        }
    }

    @Override
    public void rollback() throws SQLException {
        checkOpen();
        if (inTransaction) {
            executeInternal("ROLLBACK");
            inTransaction = false;
        }
    }

    // ------------------------------------------------------------------
    // Connection state
    // ------------------------------------------------------------------

    @Override
    public void close() throws SQLException {
        if (closed) return;
        closed = true;
        if (inTransaction) {
            try { rollback(); } catch (Exception ignored) {}
        }
        protocol.close();
    }

    @Override
    public boolean isClosed() throws SQLException {
        return closed;
    }

    @Override
    public DatabaseMetaData getMetaData() throws SQLException {
        return new VedaDatabaseMetaData(this);
    }

    @Override
    public void setReadOnly(boolean readOnly) throws SQLException {
        this.readOnly = readOnly;
    }

    @Override
    public boolean isReadOnly() throws SQLException {
        return readOnly;
    }

    @Override
    public void setCatalog(String catalog) throws SQLException {
        // No-op: VedaDB does not use JDBC catalogs
    }

    @Override
    public String getCatalog() throws SQLException {
        return config.getDatabase();
    }

    @Override
    public void setTransactionIsolation(int level) throws SQLException {
        this.transactionIsolation = level;
    }

    @Override
    public int getTransactionIsolation() throws SQLException {
        return transactionIsolation;
    }

    @Override
    public SQLWarning getWarnings() throws SQLException {
        return null;
    }

    @Override
    public void clearWarnings() throws SQLException {
    }

    // ------------------------------------------------------------------
    // Prepared statement variants
    // ------------------------------------------------------------------

    @Override
    public PreparedStatement prepareStatement(String sql, int resultSetType, int resultSetConcurrency) throws SQLException {
        return prepareStatement(sql);
    }

    @Override
    public PreparedStatement prepareStatement(String sql, int resultSetType, int resultSetConcurrency, int resultSetHoldability) throws SQLException {
        return prepareStatement(sql);
    }

    @Override
    public PreparedStatement prepareStatement(String sql, int autoGeneratedKeys) throws SQLException {
        return prepareStatement(sql);
    }

    @Override
    public PreparedStatement prepareStatement(String sql, int[] columnIndexes) throws SQLException {
        return prepareStatement(sql);
    }

    @Override
    public PreparedStatement prepareStatement(String sql, String[] columnNames) throws SQLException {
        return prepareStatement(sql);
    }

    // ------------------------------------------------------------------
    // Statement variants
    // ------------------------------------------------------------------

    @Override
    public Statement createStatement(int resultSetType, int resultSetConcurrency) throws SQLException {
        return createStatement();
    }

    @Override
    public Statement createStatement(int resultSetType, int resultSetConcurrency, int resultSetHoldability) throws SQLException {
        return createStatement();
    }

    @Override
    public CallableStatement prepareCall(String sql, int resultSetType, int resultSetConcurrency) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public CallableStatement prepareCall(String sql, int resultSetType, int resultSetConcurrency, int resultSetHoldability) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    // ------------------------------------------------------------------
    // Type map / holdability / savepoint
    // ------------------------------------------------------------------

    @Override
    public Map<String, Class<?>> getTypeMap() throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setTypeMap(Map<String, Class<?>> map) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setHoldability(int holdability) throws SQLException {
    }

    @Override
    public int getHoldability() throws SQLException {
        return ResultSet.HOLD_CURSORS_OVER_COMMIT;
    }

    @Override
    public Savepoint setSavepoint() throws SQLException {
        throw new SQLFeatureNotSupportedException("Savepoints not supported");
    }

    @Override
    public Savepoint setSavepoint(String name) throws SQLException {
        throw new SQLFeatureNotSupportedException("Savepoints not supported");
    }

    @Override
    public void rollback(Savepoint savepoint) throws SQLException {
        rollback();
    }

    @Override
    public void releaseSavepoint(Savepoint savepoint) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    // ------------------------------------------------------------------
    // Connection properties
    // ------------------------------------------------------------------

    @Override
    public void setSchema(String schema) throws SQLException {
    }

    @Override
    public String getSchema() throws SQLException {
        return config.getDatabase();
    }

    @Override
    public void abort(Executor executor) throws SQLException {
        close();
    }

    @Override
    public void setNetworkTimeout(Executor executor, int milliseconds) throws SQLException {
    }

    @Override
    public int getNetworkTimeout() throws SQLException {
        return (int) config.getTimeoutMs();
    }

    @Override
    public <T> T unwrap(Class<T> iface) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public boolean isWrapperFor(Class<?> iface) throws SQLException {
        return false;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    void checkOpen() throws SQLException {
        if (closed) throw new SQLException("Connection is closed");
    }

    VedaDBProtocol getProtocol() {
        return protocol;
    }

    void executeInternal(String sql) throws SQLException {
        try {
            protocol.query(sql, null);
        } catch (VedaDBException e) {
            throw new SQLException(e.getMessage(), e);
        }
    }

    void ensureTransaction() throws SQLException {
        if (!autoCommit && !inTransaction) {
            executeInternal("BEGIN");
            inTransaction = true;
        }
    }

    void transactionComplete() {
        inTransaction = false;
    }

    boolean isInTransaction() {
        return inTransaction;
    }
}
