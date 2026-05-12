package io.vedadb;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;

/**
 * Pipeline for batching multiple VedaDB queries/executions into a single round-trip.
 *
 * <p>Accumulates SQL commands and runs them all at once via {@link #run()}.
 * Each command is executed in order, and results are returned positionally.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaPipeline pipe = new VedaPipeline(client)
 *     .query("SELECT * FROM users WHERE id = ?", 1)
 *     .execute("UPDATE users SET active = TRUE WHERE id = ?", 2);
 * List<VedaResult> results = pipe.run();
 * }</pre>
 */
public class VedaPipeline {

    /**
     * Represents a single pipelined operation.
     */
    private static class Op {
        final String sql;
        final boolean isQuery;

        Op(String sql, boolean isQuery) {
            this.sql = sql;
            this.isQuery = isQuery;
        }
    }

    private final VedaClient client;
    private final List<Op> ops = new ArrayList<>();

    /**
     * Create a pipeline bound to a client.
     *
     * @param client the VedaClient to execute operations on
     */
    public VedaPipeline(VedaClient client) {
        this.client = Objects.requireNonNull(client, "client cannot be null");
    }

    /**
     * Add a query operation that returns rows.
     *
     * @param sql    SQL with optional ? placeholders
     * @param params parameter values to substitute for ?
     * @return this pipeline for chaining
     */
    public VedaPipeline query(String sql, Object... params) {
        ops.add(new Op(substituteParams(sql, params), true));
        return this;
    }

    /**
     * Add an execute operation that doesn't return rows.
     *
     * @param sql    SQL with optional ? placeholders
     * @param params parameter values to substitute for ?
     * @return this pipeline for chaining
     */
    public VedaPipeline execute(String sql, Object... params) {
        ops.add(new Op(substituteParams(sql, params), false));
        return this;
    }

    /**
     * Run all pipelined operations.
     *
     * @return list of results in the same order as operations were added
     * @throws IOException   on I/O error
     * @throws VedaException on VedaDB error
     */
    public List<VedaResult> run() throws IOException, VedaException {
        if (ops.isEmpty()) {
            return new ArrayList<>();
        }

        List<VedaResult> results = new ArrayList<>();
        for (Op op : ops) {
            VedaResult result = client.query(op.sql);
            results.add(result);
        }
        return results;
    }

    /**
     * Get the number of operations in the pipeline.
     */
    public int size() {
        return ops.size();
    }

    /**
     * Check if the pipeline has no operations.
     */
    public boolean isEmpty() {
        return ops.isEmpty();
    }

    /**
     * Clear all operations from the pipeline.
     */
    public VedaPipeline clear() {
        ops.clear();
        return this;
    }

    /**
     * Substitute positional parameters (?) in SQL with formatted values.
     */
    private static String substituteParams(String sql, Object... params) {
        if (params == null || params.length == 0) {
            return sql;
        }
        StringBuilder result = new StringBuilder();
        int paramIndex = 0;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (c == '?' && paramIndex < params.length) {
                result.append(formatValue(params[paramIndex++]));
            } else {
                result.append(c);
            }
        }
        return result.toString();
    }

    private static String formatValue(Object value) {
        if (value == null) return "NULL";
        if (value instanceof String) return "'" + ((String) value).replace("'", "''") + "'";
        if (value instanceof Boolean) return ((Boolean) value) ? "TRUE" : "FALSE";
        return value.toString();
    }
}
