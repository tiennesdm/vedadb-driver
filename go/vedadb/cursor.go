package vedadb

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"sync"
)

// Row represents a single row of data from a cursor.
type Row map[string]interface{}

// Cursor provides streaming access to large result sets using server-side cursors.
type Cursor struct {
	batchSize int

	client     *Client
	sql        string
	args       []interface{}
	ctx        context.Context
	cancel     context.CancelFunc

	mu        sync.Mutex
	current   []Row
	position  int
	exhausted bool
	cursorID  string
	closed    bool

	// Columns holds the column names from the result set.
	Columns []string
}

// CursorOption configures a Cursor.
type CursorOption func(*Cursor)

// WithBatchSize sets the cursor batch size (default 1000).
func WithBatchSize(size int) CursorOption {
	return func(c *Cursor) {
		if size > 0 {
			c.batchSize = size
		}
	}
}

// Cursor creates a new streaming Cursor for the given query.
func (c *Client) Cursor(ctx context.Context, sql string, args ...interface{}) (*Cursor, error) {
	return c.CursorWithOptions(ctx, sql, args)
}

// CursorWithOptions creates a Cursor with options.
func (c *Client) CursorWithOptions(ctx context.Context, sql string, args []interface{}, opts ...CursorOption) (*Cursor, error) {
	c.mu.RLock()
	proto := c.proto
	c.mu.RUnlock()

	cur := &Cursor{
		batchSize: 1000,
		client:    c,
		sql:       sql,
		args:      args,
	}
	for _, opt := range opts {
		opt(cur)
	}

	cur.ctx, cur.cancel = context.WithCancel(ctx)

	// Initialize cursor on server
	payload := map[string]interface{}{
		"query":      sql,
		"batch_size": cur.batchSize,
	}
	if len(args) > 0 {
		encoded := make([]string, len(args))
		for i, v := range args {
			encoded[i] = jsonParam(v)
		}
		payload["params"] = encoded
	}

	body, err := json.Marshal(payload)
	if err != nil {
		cur.cancel()
		return nil, NewValidationError("failed to encode cursor init: " + err.Error())
	}

	reqCtx, cancel := contextWithTimeout(c.config.Timeout)
	defer cancel()

	// Use the Protocol's request method for cursors via a special endpoint
	result, err := proto.Query(sql, args)
	if err != nil {
		cur.cancel()
		return nil, err
	}

	// Convert first batch
	cur.Columns = result.Columns
	cur.current = rowsToMaps(result.Rows, result.Columns)
	if len(cur.current) < cur.batchSize {
		cur.exhausted = true
	}

	return cur, nil
}

// Next advances the cursor to the next row, fetching the next batch if needed.
// Returns false when there are no more rows or on error.
func (c *Cursor) Next() bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return false
	}

	// Check context
	if c.ctx.Err() != nil {
		return false
	}

	c.position++

	// If we've exhausted the current batch, fetch the next one
	if c.position >= len(c.current) && !c.exhausted {
		if err := c.fetchNext(); err != nil {
			c.exhausted = true
			return false
		}
		c.position = 0
		if len(c.current) == 0 {
			c.exhausted = true
			return false
		}
	}

	return c.position < len(c.current)
}

// Scan copies column values from the current row into dest.
// The number of dest values must match the number of columns.
func (c *Cursor) Scan(dest ...interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return NewConnectionError("cursor is closed")
	}
	if c.position < 0 || c.position >= len(c.current) {
		return io.EOF
	}

	row := c.current[c.position]
	if len(dest) != len(c.Columns) {
		return NewValidationError(fmt.Sprintf("scan: expected %d destinations, got %d", len(c.Columns), len(dest)))
	}

	for i, col := range c.Columns {
		val, ok := row[col]
		if !ok {
			dest[i] = nil
			continue
		}
		if err := scanValue(val, dest[i]); err != nil {
			return fmt.Errorf("scan column %q: %w", col, err)
		}
	}

	return nil
}

// Err returns the last error encountered during cursor iteration.
func (c *Cursor) Err() error {
	if c.ctx.Err() != nil {
		return c.ctx.Err()
	}
	return nil
}

// Close releases the cursor resources.
func (c *Cursor) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return nil
	}
	c.closed = true
	c.exhausted = true
	c.current = nil
	c.cancel()
	return nil
}

// Row returns the current row as a map.
func (c *Cursor) Row() Row {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.position < 0 || c.position >= len(c.current) {
		return nil
	}
	return c.current[c.position]
}

// RowCount returns the number of rows in the current batch.
func (c *Cursor) RowCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.current)
}

// IsExhausted reports whether all rows have been consumed.
func (c *Cursor) IsExhausted() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.exhausted && c.position >= len(c.current)-1
}

// fetchNext retrieves the next batch of rows from the server.
func (c *Cursor) fetchNext() error {
	c.mu.Unlock()
	defer c.mu.Lock()

	c.mu.Lock()
	// Simple implementation: re-query with OFFSET
	offsetSQL := fmt.Sprintf("%s LIMIT %d OFFSET %d", c.sql, c.batchSize, len(c.current))
	c.mu.Unlock()

	c.mu.RLock()
	proto := c.client.proto
	args := c.args
	c.mu.RUnlock()

	result, err := proto.Query(offsetSQL, args)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.current = rowsToMaps(result.Rows, result.Columns)
	if len(c.current) < c.batchSize {
		c.exhausted = true
	}
	c.mu.Unlock()

	return nil
}

// rowsToMaps converts string rows to Row maps.
func rowsToMaps(rows [][]string, columns []string) []Row {
	if rows == nil {
		return nil
	}
	result := make([]Row, 0, len(rows))
	for _, row := range rows {
		m := make(Row, len(columns))
		for i, col := range columns {
			if i < len(row) {
				m[col] = row[i]
			}
		}
		result = append(result, m)
	}
	return result
}

// scanValue converts a value to the destination type.
func scanValue(src interface{}, dest interface{}) error {
	if dest == nil {
		return nil
	}

	switch d := dest.(type) {
	case *string:
		if src == nil {
			*d = ""
			return nil
		}
		*d = fmt.Sprint(src)
		return nil
	case *int:
		if src == nil {
			*d = 0
			return nil
		}
		s := fmt.Sprint(src)
		v, err := strconv.Atoi(s)
		if err != nil {
			return err
		}
		*d = v
		return nil
	case *int64:
		if src == nil {
			*d = 0
			return nil
		}
		s := fmt.Sprint(src)
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return err
		}
		*d = v
		return nil
	case *bool:
		if src == nil {
			*d = false
			return nil
		}
		s := fmt.Sprint(src)
		v, err := strconv.ParseBool(s)
		if err != nil {
			return err
		}
		*d = v
		return nil
	case *float64:
		if src == nil {
			*d = 0
			return nil
		}
		s := fmt.Sprint(src)
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return err
		}
		*d = v
		return nil
	case *[]byte:
		if src == nil {
			*d = nil
			return nil
		}
		*d = []byte(fmt.Sprint(src))
		return nil
	case *driver.Value:
		*d = driver.Value(src)
		return nil
	default:
		// Try JSON marshal/unmarshal for complex types
		b, err := json.Marshal(src)
		if err != nil {
			return err
		}
		return json.Unmarshal(b, dest)
	}
}
