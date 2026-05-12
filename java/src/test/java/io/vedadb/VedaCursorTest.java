package io.vedadb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;

/**
 * Cursor tests for VedaDB Java driver.
 */
class VedaCursorTest {

    @Nested
    @DisplayName("Iteration Tests")
    class IterationTests {

        @Test
        @DisplayName("Should iterate all rows")
        void testIterateAll() {
            List<Map<String, Object>> rows = List.of(
                Map.of("id", 1, "name", "Alice"),
                Map.of("id", 2, "name", "Bob"),
                Map.of("id", 3, "name", "Charlie")
            );
            Cursor cursor = new Cursor(rows);
            
            List<Map<String, Object>> results = new ArrayList<>();
            while (cursor.next()) {
                results.add(cursor.getCurrent());
            }
            
            assertEquals(3, results.size());
            assertEquals("Alice", results.get(0).get("name"));
            assertEquals("Bob", results.get(1).get("name"));
        }

        @Test
        @DisplayName("Should handle empty result")
        void testEmptyResult() {
            Cursor cursor = new Cursor(List.of());
            
            assertFalse(cursor.next());
            assertEquals(0, cursor.getRowCount());
        }

        @Test
        @DisplayName("Should handle single row")
        void testSingleRow() {
            Cursor cursor = new Cursor(List.of(Map.of("id", 1, "value", "only")));
            
            assertTrue(cursor.next());
            assertEquals("only", cursor.getCurrent().get("value"));
            assertFalse(cursor.next());
        }

        @Test
        @DisplayName("Should prevent iteration when closed")
        void testClosed() {
            Cursor cursor = new Cursor(List.of(Map.of("id", 1)));
            cursor.close();
            
            assertThrows(IllegalStateException.class, cursor::next);
        }

        @Test
        @DisplayName("Should get row count")
        void testRowCount() {
            Cursor cursor = new Cursor(List.of(
                Map.of("id", 1), Map.of("id", 2), Map.of("id", 3)
            ));
            
            assertEquals(3, cursor.getRowCount());
        }

        @Test
        @DisplayName("Should throw when accessing before first")
        void testAccessBeforeFirst() {
            Cursor cursor = new Cursor(List.of(Map.of("id", 1)));
            
            assertThrows(IllegalStateException.class, cursor::getCurrent);
        }

        @Test
        @DisplayName("Should throw when accessing after last")
        void testAccessAfterLast() {
            List<Map<String, Object>> rows = List.of(Map.of("id", 1));
            Cursor cursor = new Cursor(rows);
            cursor.next();
            cursor.next(); // move past last
            
            assertThrows(IllegalStateException.class, cursor::getCurrent);
        }
    }

    @Nested
    @DisplayName("Fetch Tests")
    class FetchTests {

        @Test
        @DisplayName("Should fetch one row at a time")
        void testFetchOne() {
            Cursor cursor = new Cursor(List.of(
                Map.of("id", 1), Map.of("id", 2)
            ));
            
            cursor.next();
            Map<String, Object> row = cursor.getCurrent();
            assertEquals(1, row.get("id"));
            
            cursor.next();
            row = cursor.getCurrent();
            assertEquals(2, row.get("id"));
        }

        @Test
        @DisplayName("Should return independent copies")
        void testIndependentCopies() {
            List<Map<String, Object>> rows = new ArrayList<>();
            rows.add(new HashMap<>(Map.of("id", 1)));
            Cursor cursor = new Cursor(rows);
            
            cursor.next();
            Map<String, Object> row = cursor.getCurrent();
            row.put("id", 999); // modify returned row
            
            cursor.reset();
            cursor.next();
            Map<String, Object> original = cursor.getCurrent();
            assertEquals(1, original.get("id")); // original unchanged
        }
    }

    @Nested
    @DisplayName("Large Result Tests")
    class LargeResultTests {

        @Test
        @DisplayName("Should handle many rows")
        void testManyRows() {
            List<Map<String, Object>> rows = new ArrayList<>();
            for (int i = 0; i < 10000; i++) {
                rows.add(Map.of("id", i, "data", "row-" + i));
            }
            Cursor cursor = new Cursor(rows);
            
            int count = 0;
            while (cursor.next()) {
                count++;
            }
            
            assertEquals(10000, count);
        }

        @Test
        @DisplayName("Should track position")
        void testPosition() {
            List<Map<String, Object>> rows = new ArrayList<>();
            for (int i = 0; i < 100; i++) {
                rows.add(Map.of("id", i));
            }
            Cursor cursor = new Cursor(rows);
            
            assertEquals(-1, cursor.getPosition());
            cursor.next();
            assertEquals(0, cursor.getPosition());
            
            for (int i = 0; i < 49; i++) {
                cursor.next();
            }
            assertEquals(50, cursor.getPosition());
        }
    }

    @Nested
    @DisplayName("Iterator Tests")
    class IteratorTests {

        @Test
        @DisplayName("Should support for-each iteration")
        void testForEach() {
            Cursor cursor = new Cursor(List.of(
                Map.of("id", 1), Map.of("id", 2), Map.of("id", 3)
            ));
            
            List<Map<String, Object>> results = new ArrayList<>();
            for (Map<String, Object> row : cursor) {
                results.add(row);
            }
            
            assertEquals(3, results.size());
        }

        @Test
        @DisplayName("Should implement iterator correctly")
        void testIterator() {
            Cursor cursor = new Cursor(List.of(Map.of("id", 1), Map.of("id", 2)));
            
            assertTrue(cursor.hasNext());
            assertNotNull(cursor.next());
            assertTrue(cursor.hasNext());
            assertNotNull(cursor.next());
            assertFalse(cursor.hasNext());
        }
    }

    @Test
    @DisplayName("Close should be idempotent")
    void testCloseIdempotent() {
        Cursor cursor = new Cursor(List.of());
        cursor.close();
        assertDoesNotThrow(cursor::close);
    }

    @Test
    @DisplayName("Should support reset")
    void testReset() {
        Cursor cursor = new Cursor(List.of(
            Map.of("id", 1), Map.of("id", 2)
        ));
        
        cursor.next();
        cursor.next();
        cursor.reset();
        
        assertTrue(cursor.hasNext());
        assertEquals(1, cursor.next().get("id"));
    }
}

/** Cursor implementation */
class Cursor implements Iterator<Map<String, Object>>, Iterable<Map<String, Object>> {
    private final List<Map<String, Object>> rows;
    private int position = -1;
    private boolean closed = false;

    Cursor(List<Map<String, Object>> rows) {
        this.rows = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            this.rows.add(new HashMap<>(row));
        }
    }

    boolean next() {
        checkClosed();
        position++;
        return position >= 0 && position < rows.size();
    }

    Map<String, Object> getCurrent() {
        checkClosed();
        if (position < 0 || position >= rows.size()) {
            throw new IllegalStateException("No current row");
        }
        return new HashMap<>(rows.get(position));
    }

    int getRowCount() {
        return rows.size();
    }

    int getPosition() {
        return position;
    }

    void close() {
        closed = true;
    }

    void reset() {
        position = -1;
    }

    private void checkClosed() {
        if (closed) throw new IllegalStateException("Cursor is closed");
    }

    @Override
    public boolean hasNext() {
        return !closed && position + 1 < rows.size();
    }

    @Override
    public Map<String, Object> next() {
        if (!next()) throw new NoSuchElementException();
        return getCurrent();
    }

    @Override
    public Iterator<Map<String, Object>> iterator() {
        return this;
    }
}
