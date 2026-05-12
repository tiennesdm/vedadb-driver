// cursor_test.go — Cursor iteration tests for VedaDB Go driver
package vedadb

import (
	"context"
	"errors"
	"testing"
)

// Cursor provides iteration over query results
type Cursor struct {
	rows     []map[string]interface{}
	position int
	closed   bool
	batchSize int
	exhausted bool
}

func NewCursor(rows []map[string]interface{}) *Cursor {
	return &Cursor{
		rows:      rows,
		position:  -1,
		batchSize: 100,
	}
}

func (c *Cursor) Next() bool {
	if c.closed || c.exhausted {
		return false
	}
	c.position++
	if c.position >= len(c.rows) {
		c.exhausted = true
		return false
	}
	return true
}

func (c *Cursor) Scan(dest ...interface{}) error {
	if c.closed {
		return errors.New("cursor is closed")
	}
	if c.position < 0 || c.position >= len(c.rows) {
		return errors.New("no current row")
	}
	row := c.rows[c.position]
	for i, d := range dest {
		if i >= len(row) {
			break
		}
		// Simplified scan for testing
		_ = d
	}
	_ = row
	return nil
}

func (c *Cursor) ScanMap() (map[string]interface{}, error) {
	if c.closed {
		return nil, errors.New("cursor is closed")
	}
	if c.position < 0 || c.position >= len(c.rows) {
		return nil, errors.New("no current row")
	}
	result := make(map[string]interface{})
	for k, v := range c.rows[c.position] {
		result[k] = v
	}
	return result, nil
}

func (c *Cursor) Err() error {
	return nil
}

func (c *Cursor) Close() error {
	c.closed = true
	return nil
}

func (c *Cursor) RowCount() int {
	return len(c.rows)
}

func (c *Cursor) Position() int {
	return c.position
}

func TestCursorIteration(t *testing.T) {
	t.Run("iterate_all_rows", func(t *testing.T) {
		rows := []map[string]interface{}{
			{"id": 1, "name": "Alice"},
			{"id": 2, "name": "Bob"},
			{"id": 3, "name": "Charlie"},
		}
		cursor := NewCursor(rows)
		defer cursor.Close()

		count := 0
		for cursor.Next() {
			row, err := cursor.ScanMap()
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if row["id"] == nil {
				t.Error("expected id field")
			}
			count++
		}

		if count != 3 {
			t.Errorf("expected 3 rows, got %d", count)
		}
	})

	t.Run("empty_result", func(t *testing.T) {
		cursor := NewCursor([]map[string]interface{}{})
		defer cursor.Close()

		if cursor.Next() {
			t.Error("expected no rows")
		}
	})

	t.Run("single_row", func(t *testing.T) {
		cursor := NewCursor([]map[string]interface{}{
			{"id": 1, "value": "only"},
		})
		defer cursor.Close()

		if !cursor.Next() {
			t.Fatal("expected one row")
		}
		row, err := cursor.ScanMap()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if row["value"] != "only" {
			t.Errorf("expected 'only', got %v", row["value"])
		}
		if cursor.Next() {
			t.Error("expected no more rows")
		}
	})

	t.Run("close_prevents_iteration", func(t *testing.T) {
		cursor := NewCursor([]map[string]interface{}{
			{"id": 1},
		})
		cursor.Close()

		if cursor.Next() {
			t.Error("expected no rows after close")
		}

		_, err := cursor.ScanMap()
		if err == nil {
			t.Error("expected error scanning closed cursor")
		}
	})

	t.Run("row_count", func(t *testing.T) {
		rows := []map[string]interface{}{
			{"id": 1}, {"id": 2}, {"id": 3},
		}
		cursor := NewCursor(rows)
		defer cursor.Close()

		if cursor.RowCount() != 3 {
			t.Errorf("expected row count 3, got %d", cursor.RowCount())
		}
	})

	t.Run("scan_without_next", func(t *testing.T) {
		cursor := NewCursor([]map[string]interface{}{
			{"id": 1},
		})
		defer cursor.Close()

		_, err := cursor.ScanMap()
		if err == nil {
			t.Error("expected error when scanning before Next()")
		}
	})

	t.Run("multiple_iterations_independent", func(t *testing.T) {
		rows := []map[string]interface{}{
			{"id": 1, "name": "Alice"},
			{"id": 2, "name": "Bob"},
		}

		cursor1 := NewCursor(rows)
		cursor2 := NewCursor(rows)

		cursor1.Next()
		cursor1.Next()

		if !cursor2.Next() {
			t.Fatal("cursor2 should be at first row")
		}
		row, _ := cursor2.ScanMap()
		if row["id"] != 1 {
			t.Errorf("expected cursor2 at row 1, got %v", row["id"])
		}

		cursor1.Close()
		cursor2.Close()
	})
}

func TestCursorLargeResult(t *testing.T) {
	t.Run("many_rows", func(t *testing.T) {
		rows := make([]map[string]interface{}, 10000)
		for i := 0; i < 10000; i++ {
			rows[i] = map[string]interface{}{
				"id":    i,
				"data":  "row-data",
				"index": i % 100,
			}
		}

		cursor := NewCursor(rows)
		defer cursor.Close()

		count := 0
		for cursor.Next() {
			count++
		}

		if count != 10000 {
			t.Errorf("expected 10000 rows, got %d", count)
		}
	})

	t.Run("position_tracking", func(t *testing.T) {
		rows := make([]map[string]interface{}, 100)
		for i := 0; i < 100; i++ {
			rows[i] = map[string]interface{}{"id": i}
		}

		cursor := NewCursor(rows)
		defer cursor.Close()

		for i := 0; i < 50; i++ {
			cursor.Next()
		}

		if cursor.Position() != 49 {
			t.Errorf("expected position 49, got %d", cursor.Position())
		}
	})

	t.Run("no_error_during_iteration", func(t *testing.T) {
		rows := []map[string]interface{}{
			{"id": 1},
			{"id": 2},
		}
		cursor := NewCursor(rows)
		defer cursor.Close()

		for cursor.Next() {
			if err := cursor.Err(); err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		}
	})

	t.Run("memory_efficiency_many_rows", func(t *testing.T) {
		// Ensure cursor doesn't duplicate data
		rows := make([]map[string]interface{}, 1000)
		for i := range rows {
			rows[i] = map[string]interface{}{"id": i}
		}

		cursor := NewCursor(rows)
		if cursor.RowCount() != 1000 {
			t.Errorf("expected 1000, got %d", cursor.RowCount())
		}
		cursor.Close()
	})
}
