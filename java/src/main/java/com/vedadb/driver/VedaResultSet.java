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
import java.util.Map;

/**
 * JDBC ResultSet implementation for VedaDB.
 *
 * <p>Reads results from the VedaDB JSON response format and provides
 * standard cursor navigation and data access.
 */
public class VedaResultSet implements ResultSet {

    private final Statement statement;
    private final List<String> columns;
    private final List<JsonNode> rows;
    private int currentRow = -1;
    private boolean closed = false;
    private boolean lastColumnNull = false;
    private boolean wasNull = false;

    VedaResultSet(Statement stmt, JsonNode result) {
        this.statement = stmt;
        this.columns = new ArrayList<>();

        JsonNode cols = result.get("columns");
        if (cols != null && cols.isArray()) {
            for (JsonNode c : cols) columns.add(c.asText());
        }

        this.rows = new ArrayList<>();
        JsonNode rs = result.get("rows");
        if (rs != null && rs.isArray()) {
            for (JsonNode row : rs) this.rows.add(row);
        }
    }

    private JsonNode currentRowNode() throws SQLException {
        if (currentRow < 0 || currentRow >= rows.size()) {
            throw new SQLException("Cursor not on a valid row");
        }
        return rows.get(currentRow);
    }

    private String getColumnValue(int columnIndex) throws SQLException {
        if (columnIndex < 1 || columnIndex > columns.size()) {
            throw new SQLException("Column index out of range: " + columnIndex);
        }
        JsonNode row = currentRowNode();
        JsonNode value = row.get(columnIndex - 1);
        wasNull = value == null || value.isNull();
        lastColumnNull = wasNull;
        return wasNull ? null : value.asText();
    }

    private String getColumnValue(String columnLabel) throws SQLException {
        int idx = columns.indexOf(columnLabel);
        if (idx < 0) throw new SQLException("Column not found: " + columnLabel);
        return getColumnValue(idx + 1);
    }

    @Override
    public boolean next() throws SQLException {
        if (currentRow + 1 < rows.size()) {
            currentRow++;
            return true;
        }
        currentRow = rows.size(); // past end
        return false;
    }

    @Override public void close() throws SQLException { closed = true; }
    @Override public boolean wasNull() throws SQLException { return wasNull; }

    @Override public String getString(int columnIndex) throws SQLException { return getColumnValue(columnIndex); }
    @Override public boolean getBoolean(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v != null && (v.equalsIgnoreCase("true") || v.equals("1")); }
    @Override public byte getByte(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? 0 : Byte.parseByte(v); }
    @Override public short getShort(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? 0 : Short.parseShort(v); }
    @Override public int getInt(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? 0 : Integer.parseInt(v); }
    @Override public long getLong(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? 0 : Long.parseLong(v); }
    @Override public float getFloat(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? 0 : Float.parseFloat(v); }
    @Override public double getDouble(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? 0 : Double.parseDouble(v); }
    @Override public BigDecimal getBigDecimal(int columnIndex, int scale) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? null : new BigDecimal(v); }
    @Override public byte[] getBytes(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? null : v.getBytes(); }
    @Override public Date getDate(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? null : Date.valueOf(v); }
    @Override public Time getTime(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? null : Time.valueOf(v); }
    @Override public Timestamp getTimestamp(int columnIndex) throws SQLException { String v = getColumnValue(columnIndex); return v == null ? null : Timestamp.valueOf(v); }
    @Override public InputStream getAsciiStream(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public InputStream getUnicodeStream(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public InputStream getBinaryStream(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }

    @Override public String getString(String columnLabel) throws SQLException { return getColumnValue(columnLabel); }
    @Override public boolean getBoolean(String columnLabel) throws SQLException { return getBoolean(findColumn(columnLabel)); }
    @Override public byte getByte(String columnLabel) throws SQLException { return getByte(findColumn(columnLabel)); }
    @Override public short getShort(String columnLabel) throws SQLException { return getShort(findColumn(columnLabel)); }
    @Override public int getInt(String columnLabel) throws SQLException { return getInt(findColumn(columnLabel)); }
    @Override public long getLong(String columnLabel) throws SQLException { return getLong(findColumn(columnLabel)); }
    @Override public float getFloat(String columnLabel) throws SQLException { return getFloat(findColumn(columnLabel)); }
    @Override public double getDouble(String columnLabel) throws SQLException { return getDouble(findColumn(columnLabel)); }
    @Override public BigDecimal getBigDecimal(String columnLabel, int scale) throws SQLException { return getBigDecimal(findColumn(columnLabel)); }
    @Override public byte[] getBytes(String columnLabel) throws SQLException { return getBytes(findColumn(columnLabel)); }
    @Override public Date getDate(String columnLabel) throws SQLException { return getDate(findColumn(columnLabel)); }
    @Override public Time getTime(String columnLabel) throws SQLException { return getTime(findColumn(columnLabel)); }
    @Override public Timestamp getTimestamp(String columnLabel) throws SQLException { return getTimestamp(findColumn(columnLabel)); }
    @Override public InputStream getAsciiStream(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public InputStream getUnicodeStream(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public InputStream getBinaryStream(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }

    @Override public SQLWarning getWarnings() throws SQLException { return null; }
    @Override public void clearWarnings() throws SQLException {}
    @Override public String getCursorName() throws SQLException { return ""; }
    @Override public ResultSetMetaData getMetaData() throws SQLException { return new VedaResultSetMetaData(columns); }
    @Override public Object getObject(int columnIndex) throws SQLException { return getString(columnIndex); }
    @Override public Object getObject(String columnLabel) throws SQLException { return getObject(findColumn(columnLabel)); }
    @Override public int findColumn(String columnLabel) throws SQLException { int idx = columns.indexOf(columnLabel); if (idx < 0) throw new SQLException("Column not found: " + columnLabel); return idx + 1; }

    @Override public Reader getCharacterStream(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Reader getCharacterStream(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public BigDecimal getBigDecimal(int columnIndex) throws SQLException { String v = getString(columnIndex); return v == null ? null : new BigDecimal(v); }
    @Override public BigDecimal getBigDecimal(String columnLabel) throws SQLException { return getBigDecimal(findColumn(columnLabel)); }
    @Override public boolean isBeforeFirst() throws SQLException { return currentRow < 0 && !rows.isEmpty(); }
    @Override public boolean isAfterLast() throws SQLException { return currentRow >= rows.size(); }
    @Override public boolean isFirst() throws SQLException { return currentRow == 0; }
    @Override public boolean isLast() throws SQLException { return currentRow == rows.size() - 1; }
    @Override public void beforeFirst() throws SQLException { currentRow = -1; }
    @Override public void afterLast() throws SQLException { currentRow = rows.size(); }
    @Override public boolean first() throws SQLException { if (rows.isEmpty()) return false; currentRow = 0; return true; }
    @Override public boolean last() throws SQLException { if (rows.isEmpty()) return false; currentRow = rows.size() - 1; return true; }
    @Override public int getRow() throws SQLException { return currentRow + 1; }
    @Override public boolean absolute(int row) throws SQLException { if (row > 0) currentRow = row - 1; else if (row < 0) currentRow = rows.size() + row; else currentRow = -1; return currentRow >= 0 && currentRow < rows.size(); }
    @Override public boolean relative(int rows) throws SQLException { currentRow += rows; return currentRow >= 0 && currentRow < this.rows.size(); }
    @Override public boolean previous() throws SQLException { if (currentRow > 0) { currentRow--; return true; } return false; }
    @Override public void setFetchDirection(int direction) throws SQLException {}
    @Override public int getFetchDirection() throws SQLException { return FETCH_FORWARD; }
    @Override public void setFetchSize(int rows) throws SQLException {}
    @Override public int getFetchSize() throws SQLException { return 0; }
    @Override public int getType() throws SQLException { return TYPE_SCROLL_INSENSITIVE; }
    @Override public int getConcurrency() throws SQLException { return CONCUR_READ_ONLY; }
    @Override public boolean rowUpdated() throws SQLException { return false; }
    @Override public boolean rowInserted() throws SQLException { return false; }
    @Override public boolean rowDeleted() throws SQLException { return false; }
    @Override public void updateNull(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBoolean(int columnIndex, boolean x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateByte(int columnIndex, byte x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateShort(int columnIndex, short x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateInt(int columnIndex, int x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateLong(int columnIndex, long x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateFloat(int columnIndex, float x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateDouble(int columnIndex, double x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBigDecimal(int columnIndex, BigDecimal x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateString(int columnIndex, String x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBytes(int columnIndex, byte[] x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateDate(int columnIndex, Date x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateTime(int columnIndex, Time x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateTimestamp(int columnIndex, Timestamp x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateAsciiStream(int columnIndex, InputStream x, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBinaryStream(int columnIndex, InputStream x, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateCharacterStream(int columnIndex, Reader x, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateObject(int columnIndex, Object x, int scaleOrLength) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateObject(int columnIndex, Object x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNull(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBoolean(String columnLabel, boolean x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateByte(String columnLabel, byte x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateShort(String columnLabel, short x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateInt(String columnLabel, int x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateLong(String columnLabel, long x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateFloat(String columnLabel, float x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateDouble(String columnLabel, double x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBigDecimal(String columnLabel, BigDecimal x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateString(String columnLabel, String x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBytes(String columnLabel, byte[] x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateDate(String columnLabel, Date x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateTime(String columnLabel, Time x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateTimestamp(String columnLabel, Timestamp x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateAsciiStream(String columnLabel, InputStream x, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBinaryStream(String columnLabel, InputStream x, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateCharacterStream(String columnLabel, Reader reader, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateObject(String columnLabel, Object x, int scaleOrLength) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateObject(String columnLabel, Object x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void insertRow() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateRow() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void deleteRow() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void refreshRow() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void cancelRowUpdates() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void moveToInsertRow() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void moveToCurrentRow() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Statement getStatement() throws SQLException { return statement; }
    @Override public Object getObject(int columnIndex, Map<String, Class<?>> map) throws SQLException { return getObject(columnIndex); }
    @Override public Ref getRef(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Blob getBlob(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Clob getClob(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Array getArray(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Object getObject(String columnLabel, Map<String, Class<?>> map) throws SQLException { return getObject(columnLabel); }
    @Override public Ref getRef(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Blob getBlob(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Clob getClob(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Array getArray(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Date getDate(int columnIndex, Calendar cal) throws SQLException { return getDate(columnIndex); }
    @Override public Date getDate(String columnLabel, Calendar cal) throws SQLException { return getDate(columnLabel); }
    @Override public Time getTime(int columnIndex, Calendar cal) throws SQLException { return getTime(columnIndex); }
    @Override public Time getTime(String columnLabel, Calendar cal) throws SQLException { return getTime(columnLabel); }
    @Override public Timestamp getTimestamp(int columnIndex, Calendar cal) throws SQLException { return getTimestamp(columnIndex); }
    @Override public Timestamp getTimestamp(String columnLabel, Calendar cal) throws SQLException { return getTimestamp(columnLabel); }
    @Override public URL getURL(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public URL getURL(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateRef(int columnIndex, Ref x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateRef(String columnLabel, Ref x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBlob(int columnIndex, Blob x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBlob(String columnLabel, Blob x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateClob(int columnIndex, Clob x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateClob(String columnLabel, Clob x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateArray(int columnIndex, Array x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateArray(String columnLabel, Array x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public RowId getRowId(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public RowId getRowId(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateRowId(int columnIndex, RowId x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateRowId(String columnLabel, RowId x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public int getHoldability() throws SQLException { return HOLD_CURSORS_OVER_COMMIT; }
    @Override public boolean isClosed() throws SQLException { return closed; }
    @Override public void updateNString(int columnIndex, String nString) throws SQLException { updateString(columnIndex, nString); }
    @Override public void updateNString(String columnLabel, String nString) throws SQLException { updateString(columnLabel, nString); }
    @Override public void updateNClob(int columnIndex, NClob nClob) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNClob(String columnLabel, NClob nClob) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public NClob getNClob(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public NClob getNClob(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public SQLXML getSQLXML(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public SQLXML getSQLXML(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateSQLXML(int columnIndex, SQLXML xmlObject) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateSQLXML(String columnLabel, SQLXML xmlObject) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public String getNString(int columnIndex) throws SQLException { return getString(columnIndex); }
    @Override public String getNString(String columnLabel) throws SQLException { return getString(columnLabel); }
    @Override public Reader getNCharacterStream(int columnIndex) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Reader getNCharacterStream(String columnLabel) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNCharacterStream(int columnIndex, Reader x, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNCharacterStream(String columnLabel, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateAsciiStream(int columnIndex, InputStream x, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBinaryStream(int columnIndex, InputStream x, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateCharacterStream(int columnIndex, Reader x, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateAsciiStream(String columnLabel, InputStream x, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBinaryStream(String columnLabel, InputStream x, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateCharacterStream(String columnLabel, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBlob(int columnIndex, InputStream inputStream, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBlob(String columnLabel, InputStream inputStream, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateClob(int columnIndex, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateClob(String columnLabel, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNClob(int columnIndex, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNClob(String columnLabel, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNCharacterStream(int columnIndex, Reader x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNCharacterStream(String columnLabel, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateAsciiStream(int columnIndex, InputStream x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBinaryStream(int columnIndex, InputStream x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateCharacterStream(int columnIndex, Reader x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateAsciiStream(String columnLabel, InputStream x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBinaryStream(String columnLabel, InputStream x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateCharacterStream(String columnLabel, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBlob(int columnIndex, InputStream inputStream) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateBlob(String columnLabel, InputStream inputStream) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateClob(int columnIndex, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateClob(String columnLabel, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNClob(int columnIndex, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void updateNClob(String columnLabel, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public <T> T getObject(int columnIndex, Class<T> type) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public <T> T getObject(String columnLabel, Class<T> type) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public <T> T unwrap(Class<T> iface) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public boolean isWrapperFor(Class<?> iface) throws SQLException { return false; }
}
