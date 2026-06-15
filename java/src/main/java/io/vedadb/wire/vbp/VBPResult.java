package io.vedadb.wire.vbp;

import java.util.List;

/** Result of a VBP query execution (mirrors the Python POC's VBPResult). */
public class VBPResult {
    public final List<String> columns;
    public final List<Integer> columnTypes;
    public final List<List<Object>> rows;
    public final String commandTag;
    public final long rowsAffected;

    public VBPResult(List<String> columns, List<Integer> columnTypes,
                     List<List<Object>> rows, String commandTag, long rowsAffected) {
        this.columns = columns;
        this.columnTypes = columnTypes;
        this.rows = rows;
        this.commandTag = commandTag;
        this.rowsAffected = rowsAffected;
    }

    public int rowCount() { return rows.size(); }

    public List<Object> getRow(int i) { return rows.get(i); }

    public Object getValue(int row, int col) {
        return rows.get(row).get(col);
    }

    @Override
    public String toString() {
        return "VBPResult(cols=" + columns + ", rows=" + rows.size()
                + ", tag=" + commandTag + ", affected=" + rowsAffected + ")";
    }
}
