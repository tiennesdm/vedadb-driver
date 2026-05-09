package com.vedadb.driver;

import java.sql.*;

/**
 * ParameterMetaData for VedaDB prepared statements.
 */
public class VedaParameterMetaData implements ParameterMetaData {

    private final int paramCount;

    VedaParameterMetaData(int paramCount) {
        this.paramCount = paramCount;
    }

    @Override public int getParameterCount() throws SQLException { return paramCount; }
    @Override public int isNullable(int param) throws SQLException { return parameterNullableUnknown; }
    @Override public boolean isSigned(int param) throws SQLException { return false; }
    @Override public int getPrecision(int param) throws SQLException { return 0; }
    @Override public int getScale(int param) throws SQLException { return 0; }
    @Override public int getParameterType(int param) throws SQLException { return Types.VARCHAR; }
    @Override public String getParameterTypeName(int param) throws SQLException { return "VARCHAR"; }
    @Override public String getParameterClassName(int param) throws SQLException { return "java.lang.String"; }
    @Override public int getParameterMode(int param) throws SQLException { return parameterModeIn; }
    @Override public <T> T unwrap(Class<T> iface) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public boolean isWrapperFor(Class<?> iface) throws SQLException { return false; }
}
