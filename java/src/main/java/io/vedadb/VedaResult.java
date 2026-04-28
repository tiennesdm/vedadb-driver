package io.vedadb;

import java.util.*;

/**
 * Represents the result of a VedaDB query.
 */
public class VedaResult {
    private List<String> columns;
    private List<List<String>> rows;
    private int rowCount;
    private String message;

    public List<String> getColumns() { return columns; }
    public List<List<String>> getRows() { return rows; }
    public int getRowCount() { return rowCount; }
    public String getMessage() { return message != null ? message : rowCount + " rows"; }

    /**
     * Parse a JSON response from VedaDB.
     * Simple JSON parser (no external dependencies).
     */
    @SuppressWarnings("unchecked")
    public static VedaResult parse(String json) throws VedaException {
        VedaResult result = new VedaResult();

        // Check for error
        if (json.contains("\"error\"")) {
            int start = json.indexOf("\"error\"") + 9;
            int end = json.indexOf("\"", start);
            if (end > start) {
                throw new VedaException(json.substring(start, end));
            }
        }

        // Parse message
        if (json.contains("\"message\"")) {
            int start = json.indexOf("\"message\"") + 11;
            int end = json.indexOf("\"", start);
            if (end > start) {
                result.message = json.substring(start, end);
            }
        }

        // Parse row_count
        if (json.contains("\"row_count\"")) {
            int start = json.indexOf("\"row_count\"") + 12;
            StringBuilder num = new StringBuilder();
            for (int i = start; i < json.length(); i++) {
                char c = json.charAt(i);
                if (Character.isDigit(c)) num.append(c);
                else if (num.length() > 0) break;
            }
            if (num.length() > 0) {
                result.rowCount = Integer.parseInt(num.toString());
            }
        }

        // Parse columns
        if (json.contains("\"columns\"")) {
            result.columns = parseStringArray(json, "columns");
        }

        // Parse rows (array of arrays)
        if (json.contains("\"rows\"")) {
            result.rows = new ArrayList<>();
            int rowsStart = json.indexOf("\"rows\"") + 7;
            // Find the opening [[
            int arrStart = json.indexOf("[[", rowsStart);
            if (arrStart >= 0) {
                int arrEnd = json.indexOf("]]", arrStart) + 2;
                String rowsJson = json.substring(arrStart, arrEnd);

                // Split into individual arrays
                int depth = 0;
                int start = -1;
                for (int i = 0; i < rowsJson.length(); i++) {
                    char c = rowsJson.charAt(i);
                    if (c == '[') {
                        depth++;
                        if (depth == 2) start = i;
                    } else if (c == ']') {
                        depth--;
                        if (depth == 1 && start >= 0) {
                            String rowStr = rowsJson.substring(start, i + 1);
                            result.rows.add(parseSimpleArray(rowStr));
                            start = -1;
                        }
                    }
                }
            }
        }

        return result;
    }

    private static List<String> parseStringArray(String json, String key) {
        List<String> result = new ArrayList<>();
        int start = json.indexOf("\"" + key + "\"");
        if (start < 0) return result;

        int arrStart = json.indexOf("[", start);
        int arrEnd = json.indexOf("]", arrStart);
        if (arrStart < 0 || arrEnd < 0) return result;

        String arr = json.substring(arrStart + 1, arrEnd);
        String[] parts = arr.split(",");
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
                result.add(trimmed.substring(1, trimmed.length() - 1));
            }
        }
        return result;
    }

    private static List<String> parseSimpleArray(String arr) {
        List<String> result = new ArrayList<>();
        // Remove [ and ]
        String inner = arr.substring(1, arr.length() - 1);
        String[] parts = inner.split(",");
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
                result.add(trimmed.substring(1, trimmed.length() - 1));
            } else {
                result.add(trimmed);
            }
        }
        return result;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder();
        if (message != null) {
            sb.append(message).append("\n");
        }
        if (columns != null) {
            sb.append(String.join(" | ", columns)).append("\n");
            sb.append("-".repeat(columns.size() * 18)).append("\n");
        }
        if (rows != null) {
            for (List<String> row : rows) {
                sb.append(String.join(" | ", row)).append("\n");
            }
        }
        sb.append("(").append(rowCount).append(" rows)\n");
        return sb.toString();
    }
}
