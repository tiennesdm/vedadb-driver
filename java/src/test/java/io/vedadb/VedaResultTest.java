package io.vedadb;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.List;

class VedaResultTest {

    @Test
    void parseSelectResponse() throws VedaException {
        String json = "{\"columns\":[\"id\",\"name\"],\"rows\":[[\"1\",\"Alice\"],[\"2\",\"Bob\"]],\"row_count\":2}";
        VedaResult result = VedaResult.parse(json);

        assertEquals(List.of("id", "name"), result.getColumns());
        assertEquals(2, result.getRowCount());
        assertEquals(2, result.getRows().size());
        assertEquals("1", result.getRows().get(0).get(0));
        assertEquals("Alice", result.getRows().get(0).get(1));
        assertEquals("2", result.getRows().get(1).get(0));
        assertEquals("Bob", result.getRows().get(1).get(1));
    }

    @Test
    void parseMessageOnlyResponse() throws VedaException {
        String json = "{\"message\":\"Table created successfully\",\"row_count\":0}";
        VedaResult result = VedaResult.parse(json);

        assertEquals("Table created successfully", result.getMessage());
        assertEquals(0, result.getRowCount());
        assertNull(result.getColumns());
        assertNull(result.getRows());
    }

    @Test
    void parseErrorResponse() {
        String json = "{\"error\":\"Table not found: users\"}";
        VedaException ex = assertThrows(VedaException.class, () -> VedaResult.parse(json));
        assertTrue(ex.getMessage().contains("Table not found"));
    }

    @Test
    void parseEmptyRowsResponse() throws VedaException {
        String json = "{\"columns\":[\"id\",\"name\"],\"rows\":[],\"row_count\":0}";
        VedaResult result = VedaResult.parse(json);

        assertEquals(List.of("id", "name"), result.getColumns());
        assertEquals(0, result.getRowCount());
        // rows list exists but has no parsed entries (no [[ found)
        assertTrue(result.getRows() == null || result.getRows().isEmpty());
    }

    @Test
    void parseSingleRowResponse() throws VedaException {
        String json = "{\"columns\":[\"count\"],\"rows\":[[\"42\"]],\"row_count\":1}";
        VedaResult result = VedaResult.parse(json);

        assertEquals(1, result.getRowCount());
        assertEquals(1, result.getRows().size());
        assertEquals("42", result.getRows().get(0).get(0));
    }

    @Test
    void toStringFormatsTable() throws VedaException {
        String json = "{\"columns\":[\"id\",\"name\"],\"rows\":[[\"1\",\"Alice\"]],\"row_count\":1}";
        VedaResult result = VedaResult.parse(json);

        String output = result.toString();
        assertTrue(output.contains("id"));
        assertTrue(output.contains("name"));
        assertTrue(output.contains("Alice"));
        assertTrue(output.contains("(1 rows)"));
    }

    @Test
    void getMessageFallsBackToRowCount() throws VedaException {
        String json = "{\"columns\":[\"id\"],\"rows\":[[\"1\"],[\"2\"],[\"3\"]],\"row_count\":3}";
        VedaResult result = VedaResult.parse(json);

        assertEquals("3 rows", result.getMessage());
    }
}
