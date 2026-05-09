package com.vedadb.driver;

import java.sql.*;
import java.util.List;

/**
 * ResultSetMetaData for VedaDB.
 */
public class VedaResultSetMetaData implements ResultSetMetaData {

    private final List<String> columns;

    VedaResultSetMetaData(List<String> columns) {
        this.columns = columns;
    }

    @Override public int getColumnCount() throws SQLException { return columns.size(); }
    @Override public boolean isAutoIncrement(int column) throws SQLException { return false; }
    @Override public boolean isCaseSensitive(int column) throws SQLException { return true; }
    @Override public boolean isSearchable(int column) throws SQLException { return true; }
    @Override public boolean isCurrency(int column) throws SQLException { return false; }
    @Override public int isNullable(int column) throws SQLException { return columnNullableUnknown; }
    @Override public boolean isSigned(int column) throws SQLException { return false; }
    @Override public int getColumnDisplaySize(int column) throws SQLException { return 255; }
    @Override public String getColumnLabel(int column) throws SQLException { return getColumnName(column); }
    @Override public String getColumnName(int column) throws SQLException { return columns.get(column - 1); }
    @Override public String getSchemaName(int column) throws SQLException { return ""; }
    @Override public int getPrecision(int column) throws SQLException { return 0; }
    @Override public int getScale(int column) throws SQLException { return 0; }
    @Override public String getTableName(int column) throws SQLException { return ""; }
    @Override public String getCatalogName(int column) throws SQLException { return ""; }
    @Override public int getColumnType(int column) throws SQLException { return Types.VARCHAR; }
    @Override public String getColumnTypeName(int column) throws SQLException { return "VARCHAR"; }
    @Override public boolean isReadOnly(int column) throws SQLException { return true; }
    @Override public boolean isWritable(int column) throws SQLException { return false; }
    @Override public boolean isDefinitelyWritable(int column) throws SQLException { return false; }
    @Override public String getColumnClassName(int column) throws SQLException { return "java.lang.String"; }
    @Override public <T> T unwrap(Class<T> iface) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public boolean isWrapperFor(Class<?> iface) throws SQLException { return false; }
}
