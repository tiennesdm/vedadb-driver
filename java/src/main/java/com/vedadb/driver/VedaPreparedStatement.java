package com.vedadb.driver;

import com.fasterxml.jackson.databind.JsonNode;

import java.io.InputStream;
import java.io.Reader;
import java.math.BigDecimal;
import java.net.URL;
import java.sql.*;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * JDBC PreparedStatement implementation for VedaDB.
 *
 * <p>Supports positional parameter binding with {@code ?} placeholders.
 * Parameters are sent to the server using VedaDB's native {@code params}
 * binding for safe server-side interpolation.
 */
public class VedaPreparedStatement extends VedaStatement implements PreparedStatement {

    private final String sql;
    private final List<Object> parameters = new ArrayList<>();
    private final int paramCount;

    VedaPreparedStatement(VedaConnection connection, VedaDBProtocol protocol, String sql) {
        super(connection, protocol);
        this.sql = sql;
        this.paramCount = countPlaceholders(sql);
        // Pre-size parameters list
        for (int i = 0; i < paramCount; i++) {
            parameters.add(null);
        }
    }

    private static int countPlaceholders(String sql) {
        int count = 0;
        boolean inString = false;
        char stringChar = 0;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (!inString && (c == '\'' || c == '"')) {
                inString = true;
                stringChar = c;
            } else if (inString && c == stringChar) {
                inString = false;
            } else if (!inString && c == '?') {
                count++;
            }
        }
        return count;
    }

    private void setParam(int parameterIndex, Object value) throws SQLException {
        if (parameterIndex < 1 || parameterIndex > paramCount) {
            throw new SQLException("Parameter index out of range: " + parameterIndex);
        }
        parameters.set(parameterIndex - 1, value);
    }

    private List<Object> getParams() {
        return parameters;
    }

    private void clearParams() {
        for (int i = 0; i < parameters.size(); i++) {
            parameters.set(i, null);
        }
    }

    @Override
    public ResultSet executeQuery() throws SQLException {
        checkOpen();
        connection.ensureTransaction();
        try {
            JsonNode result = protocol.query(sql, getParams());
            currentResultSet = new VedaResultSet(this, result);
            updateCount = -1;
            return currentResultSet;
        } catch (VedaDBException e) {
            throw new SQLException(e.getMessage(), e);
        }
    }

    @Override
    public int executeUpdate() throws SQLException {
        checkOpen();
        connection.ensureTransaction();
        try {
            JsonNode result = protocol.query(sql, getParams());
            updateCount = result.path("row_count").asInt(0);
            currentResultSet = null;
            return updateCount;
        } catch (VedaDBException e) {
            throw new SQLException(e.getMessage(), e);
        }
    }

    @Override
    public void setNull(int parameterIndex, int sqlType) throws SQLException {
        setParam(parameterIndex, null);
    }

    @Override
    public void setBoolean(int parameterIndex, boolean x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setByte(int parameterIndex, byte x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setShort(int parameterIndex, short x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setInt(int parameterIndex, int x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setLong(int parameterIndex, long x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setFloat(int parameterIndex, float x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setDouble(int parameterIndex, double x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setBigDecimal(int parameterIndex, BigDecimal x) throws SQLException {
        setParam(parameterIndex, x != null ? x.doubleValue() : null);
    }

    @Override
    public void setString(int parameterIndex, String x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setBytes(int parameterIndex, byte[] x) throws SQLException {
        setParam(parameterIndex, x != null ? new String(x) : null);
    }

    @Override
    public void setDate(int parameterIndex, Date x) throws SQLException {
        setParam(parameterIndex, x != null ? x.toString() : null);
    }

    @Override
    public void setTime(int parameterIndex, Time x) throws SQLException {
        setParam(parameterIndex, x != null ? x.toString() : null);
    }

    @Override
    public void setTimestamp(int parameterIndex, Timestamp x) throws SQLException {
        setParam(parameterIndex, x != null ? x.toString() : null);
    }

    @Override
    public void setAsciiStream(int parameterIndex, InputStream x, int length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setUnicodeStream(int parameterIndex, InputStream x, int length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setBinaryStream(int parameterIndex, InputStream x, int length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void clearParameters() throws SQLException {
        clearParams();
    }

    @Override
    public void setObject(int parameterIndex, Object x, int targetSqlType) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public void setObject(int parameterIndex, Object x) throws SQLException {
        setParam(parameterIndex, x);
    }

    @Override
    public boolean execute() throws SQLException {
        try {
            ResultSet rs = executeQuery();
            return rs != null;
        } catch (SQLException e) {
            executeUpdate();
            return false;
        }
    }

    @Override
    public void addBatch() throws SQLException {
        throw new SQLFeatureNotSupportedException("Batch via addBatch not supported");
    }

    @Override
    public void setCharacterStream(int parameterIndex, Reader reader, int length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setRef(int parameterIndex, Ref x) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setBlob(int parameterIndex, Blob x) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setClob(int parameterIndex, Clob x) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setArray(int parameterIndex, Array x) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public ResultSetMetaData getMetaData() throws SQLException {
        return currentResultSet != null ? currentResultSet.getMetaData() : null;
    }

    @Override
    public void setDate(int parameterIndex, Date x, Calendar cal) throws SQLException {
        setDate(parameterIndex, x);
    }

    @Override
    public void setTime(int parameterIndex, Time x, Calendar cal) throws SQLException {
        setTime(parameterIndex, x);
    }

    @Override
    public void setTimestamp(int parameterIndex, Timestamp x, Calendar cal) throws SQLException {
        setTimestamp(parameterIndex, x);
    }

    @Override
    public void setNull(int parameterIndex, int sqlType, String typeName) throws SQLException {
        setNull(parameterIndex, sqlType);
    }

    @Override
    public void setURL(int parameterIndex, URL x) throws SQLException {
        setString(parameterIndex, x != null ? x.toString() : null);
    }

    @Override
    public ParameterMetaData getParameterMetaData() throws SQLException {
        return new VedaParameterMetaData(paramCount);
    }

    @Override
    public void setRowId(int parameterIndex, RowId x) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setNString(int parameterIndex, String value) throws SQLException {
        setString(parameterIndex, value);
    }

    @Override
    public void setNCharacterStream(int parameterIndex, Reader value, long length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setNClob(int parameterIndex, NClob value) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setClob(int parameterIndex, Reader reader, long length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setBlob(int parameterIndex, InputStream inputStream, long length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setNClob(int parameterIndex, Reader reader, long length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setSQLXML(int parameterIndex, SQLXML xmlObject) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setObject(int parameterIndex, Object x, int targetSqlType, int scaleOrLength) throws SQLException {
        setObject(parameterIndex, x);
    }

    @Override
    public void setAsciiStream(int parameterIndex, InputStream x, long length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setBinaryStream(int parameterIndex, InputStream x, long length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setCharacterStream(int parameterIndex, Reader reader, long length) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setAsciiStream(int parameterIndex, InputStream x) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setBinaryStream(int parameterIndex, InputStream x) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setCharacterStream(int parameterIndex, Reader reader) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setNCharacterStream(int parameterIndex, Reader value) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setClob(int parameterIndex, Reader reader) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setBlob(int parameterIndex, InputStream inputStream) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }

    @Override
    public void setNClob(int parameterIndex, Reader reader) throws SQLException {
        throw new SQLFeatureNotSupportedException();
    }
}
