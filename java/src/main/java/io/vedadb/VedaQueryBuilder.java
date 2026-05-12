package io.vedadb;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Fluent query builder for VedaDB.
 *
 * <p>Provides a type-safe, chainable API for constructing SQL queries
 * without string concatenation. Supports SELECT, INSERT, UPDATE, DELETE.
 *
 * <p>Usage:
 * <pre>{@code
 * String sql = new VedaQueryBuilder()
 *     .select("id", "name", "email")
 *     .from("users")
 *     .where("active = TRUE")
 *     .and("age > ?", 18)
 *     .orderBy("name ASC")
 *     .limit(100)
 *     .build();
 * }</pre>
 */
public class VedaQueryBuilder {

    // SECURE: SQL identifier validation to prevent injection (HIGH-006 fix)
    private static final Pattern VALID_IDENTIFIER = Pattern.compile("^[a-zA-Z_][a-zA-Z0-9_]*$");
    private static final Set<String> VALID_OPERATORS = Set.of(
        "=", "<>", "!=", "<", ">", "<=", ">=", "LIKE", "NOT LIKE", "IN", "NOT IN", "IS", "IS NOT"
    );

    private String operation;
    private final List<String> columns = new ArrayList<>();
    private String table;
    private final List<String> whereClauses = new ArrayList<>();
    private final List<Object> whereParams = new ArrayList<>();
    private final List<String> orderByClauses = new ArrayList<>();
    private int limit = 0;
    private int offset = 0;
    private final List<String> setClauses = new ArrayList<>();
    private final List<Object> values = new ArrayList<>();

    /**
     * Validate a SQL identifier (table or column name) to prevent injection.
     */
    private static void validateIdentifier(String ident, String label) {
        if (ident == null || !VALID_IDENTIFIER.matcher(ident).matches()) {
            throw new IllegalArgumentException("Invalid " + label + ": \"" + ident + "\". Only alphanumeric and underscores allowed.");
        }
    }

    /**
     * Validate a SQL operator to prevent injection.
     */
    private static void validateOperator(String operator) {
        if (operator == null || !VALID_OPERATORS.contains(operator.toUpperCase())) {
            throw new IllegalArgumentException("Invalid operator: \"" + operator + "\".");
        }
    }

    // ── SELECT ────────────────────────────────────────────────────

    /**
     * Start a SELECT query.
     */
    public VedaQueryBuilder select(String... cols) {
        this.operation = "SELECT";
        for (String col : cols) {
            validateIdentifier(col, "column");
            this.columns.add(col);
        }
        return this;
    }

    /**
     * Specify the table for the query.
     */
    public VedaQueryBuilder from(String table) {
        validateIdentifier(table, "table");
        this.table = table;
        return this;
    }

    // ── INSERT ────────────────────────────────────────────────────

    /**
     * Start an INSERT query.
     */
    public VedaQueryBuilder insertInto(String table) {
        validateIdentifier(table, "table");
        this.operation = "INSERT";
        this.table = table;
        return this;
    }

    /**
     * Set columns for INSERT.
     */
    public VedaQueryBuilder columns(String... cols) {
        for (String col : cols) {
            validateIdentifier(col, "column");
            this.columns.add(col);
        }
        return this;
    }

    /**
     * Set values for INSERT.
     */
    public VedaQueryBuilder values(Object... vals) {
        for (Object val : vals) {
            this.values.add(val);
        }
        return this;
    }

    // ── UPDATE ────────────────────────────────────────────────────

    /**
     * Start an UPDATE query.
     */
    public VedaQueryBuilder update(String table) {
        validateIdentifier(table, "table");
        this.operation = "UPDATE";
        this.table = table;
        return this;
    }

    /**
     * Add a SET clause for UPDATE.
     */
    public VedaQueryBuilder set(String column, Object value) {
        validateIdentifier(column, "column");
        this.setClauses.add(column + " = " + formatValue(value));
        return this;
    }

    // ── DELETE ────────────────────────────────────────────────────

    /**
     * Start a DELETE query.
     */
    public VedaQueryBuilder deleteFrom(String table) {
        validateIdentifier(table, "table");
        this.operation = "DELETE";
        this.table = table;
        return this;
    }

    // ── WHERE ─────────────────────────────────────────────────────

    /**
     * Add a WHERE clause.
     */
    public VedaQueryBuilder where(String clause, Object... params) {
        this.whereClauses.add(clause);
        for (Object param : params) {
            this.whereParams.add(param);
        }
        return this;
    }

    /**
     * Add an AND condition.
     */
    public VedaQueryBuilder and(String clause, Object... params) {
        this.whereClauses.add(clause);
        for (Object param : params) {
            this.whereParams.add(param);
        }
        return this;
    }

    /**
     * Add an OR condition (wraps with parentheses).
     */
    public VedaQueryBuilder or(String clause, Object... params) {
        if (!this.whereClauses.isEmpty()) {
            String last = this.whereClauses.remove(this.whereClauses.size() - 1);
            this.whereClauses.add("(" + last + " OR " + clause + ")");
        } else {
            this.whereClauses.add(clause);
        }
        for (Object param : params) {
            this.whereParams.add(param);
        }
        return this;
    }

    // ── ORDER / LIMIT / OFFSET ────────────────────────────────────

    /**
     * Add ORDER BY clause.
     */
    public VedaQueryBuilder orderBy(String... cols) {
        for (String col : cols) {
            validateIdentifier(col, "ORDER BY column");
            this.orderByClauses.add(col);
        }
        return this;
    }

    /**
     * Set LIMIT.
     */
    public VedaQueryBuilder limit(int limit) {
        if (limit < 0) throw new IllegalArgumentException("limit must be >= 0");
        this.limit = limit;
        return this;
    }

    /**
     * Set OFFSET.
     */
    public VedaQueryBuilder offset(int offset) {
        if (offset < 0) throw new IllegalArgumentException("offset must be >= 0");
        this.offset = offset;
        return this;
    }

    // ── BUILD ─────────────────────────────────────────────────────

    /**
     * Build the SQL query string.
     */
    public String build() {
        Objects.requireNonNull(operation, "No operation specified (use select(), insertInto(), update(), or deleteFrom())");
        Objects.requireNonNull(table, "No table specified (use from() or table name in operation)");

        StringBuilder sql = new StringBuilder();

        switch (operation) {
            case "SELECT":
                buildSelect(sql);
                break;
            case "INSERT":
                buildInsert(sql);
                break;
            case "UPDATE":
                buildUpdate(sql);
                break;
            case "DELETE":
                buildDelete(sql);
                break;
            default:
                throw new IllegalStateException("Unknown operation: " + operation);
        }

        return sql.toString();
    }

    private void buildSelect(StringBuilder sql) {
        sql.append("SELECT ");
        if (columns.isEmpty()) {
            sql.append("*");
        } else {
            sql.append(String.join(", ", columns));
        }
        sql.append(" FROM ").append(table);

        appendWhere(sql);
        appendOrderBy(sql);
        appendLimit(sql);
        appendOffset(sql);
        sql.append(";");
    }

    private void buildInsert(StringBuilder sql) {
        sql.append("INSERT INTO ").append(table);
        if (!columns.isEmpty()) {
            sql.append(" (").append(String.join(", ", columns)).append(")");
        }
        sql.append(" VALUES (");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) sql.append(", ");
            sql.append(formatValue(values.get(i)));
        }
        sql.append(");");
    }

    private void buildUpdate(StringBuilder sql) {
        sql.append("UPDATE ").append(table).append(" SET ");
        sql.append(String.join(", ", setClauses));
        appendWhere(sql);
        sql.append(";");
    }

    private void buildDelete(StringBuilder sql) {
        sql.append("DELETE FROM ").append(table);
        appendWhere(sql);
        sql.append(";");
    }

    private void appendWhere(StringBuilder sql) {
        if (!whereClauses.isEmpty()) {
            sql.append(" WHERE ");
            sql.append(String.join(" AND ", whereClauses));
        }
    }

    private void appendOrderBy(StringBuilder sql) {
        if (!orderByClauses.isEmpty()) {
            sql.append(" ORDER BY ").append(String.join(", ", orderByClauses));
        }
    }

    private void appendLimit(StringBuilder sql) {
        if (limit > 0) {
            sql.append(" LIMIT ").append(limit);
        }
    }

    private void appendOffset(StringBuilder sql) {
        if (offset > 0) {
            sql.append(" OFFSET ").append(offset);
        }
    }

    private static String formatValue(Object value) {
        if (value == null) return "NULL";
        if (value instanceof String) return "'" + ((String) value).replace("'", "''") + "'";
        if (value instanceof Boolean) return ((Boolean) value) ? "TRUE" : "FALSE";
        return value.toString();
    }

    public List<Object> getWhereParams() {
        return new ArrayList<>(whereParams);
    }

    public String getOperation() { return operation; }
    public String getTable() { return table; }
}
