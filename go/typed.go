// Typed row + cursor APIs for the Go driver.
//
// Audit #24: Result.Rows is [][]string for wire-protocol simplicity,
// but callers wanting type fidelity (Go int vs string of digits,
// true/false vs "true"/"false", nil vs "NULL") had to write per-cell
// parsing themselves at every call site. Plus there was no cursor
// API — a SELECT over a million-row table held all rows in memory
// simultaneously. This file ships both, additively.

package vedadb

import (
	"context"
	"errors"
	"io"
	"strconv"
	"strings"
)

// TypedValueKind classifies a TypedValue's payload type.
type TypedValueKind int8

const (
	KindNull TypedValueKind = iota
	KindInt
	KindFloat
	KindString
	KindBool
)

// TypedValue is a tagged union for one parsed cell. Kind names
// the meaningful payload field; the others are zero. IsNull is
// orthogonal to Kind.
type TypedValue struct {
	Kind   TypedValueKind
	Int    int64
	Float  float64
	Str    string
	Bool   bool
	IsNull bool
}

// TypedResult mirrors Result but returns each row as a column-
// keyed map of TypedValue.
type TypedResult struct {
	Columns  []string
	Rows     []map[string]TypedValue
	Message  string
	RowCount int
}

// QueryTyped runs query and returns rows with parsed Go types.
func (c *Client) QueryTyped(query string) (*TypedResult, error) {
	r, err := c.Query(query)
	if err != nil {
		return nil, err
	}
	return parseTypedResult(r), nil
}

// QueryTypedContext is the context-aware variant of QueryTyped.
func (c *Client) QueryTypedContext(ctx context.Context, query string) (*TypedResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return c.QueryTyped(query)
}

// ExecutePreparedTyped runs a prepared statement and returns
// typed rows. Combines server-side parameterized binding with
// client-side type fidelity.
func (c *Client) ExecutePreparedTyped(name string, args ...string) (*TypedResult, error) {
	r, err := c.ExecutePrepared(name, args...)
	if err != nil {
		return nil, err
	}
	return parseTypedResult(r), nil
}

// ExecutePreparedTypedContext is the context-aware twin.
func (c *Client) ExecutePreparedTypedContext(ctx context.Context, name string, args ...string) (*TypedResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return c.ExecutePreparedTyped(name, args...)
}

// parseTypedResult converts a string-rows Result into a typed
// TypedResult by best-effort cell parsing.
func parseTypedResult(r *Result) *TypedResult {
	if r == nil {
		return &TypedResult{}
	}
	out := &TypedResult{
		Columns:  r.Columns,
		Message:  r.Message,
		RowCount: r.RowCount,
		Rows:     make([]map[string]TypedValue, 0, len(r.Rows)),
	}
	for _, row := range r.Rows {
		m := make(map[string]TypedValue, len(r.Columns))
		for i, col := range r.Columns {
			var raw string
			if i < len(row) {
				raw = row[i]
			}
			m[col] = parseCell(raw)
		}
		out.Rows = append(out.Rows, m)
	}
	return out
}

// parseCell applies the type-precedence cascade: NULL → bool →
// int (before float, so "42" stays int) → float → string.
func parseCell(s string) TypedValue {
	if s == "" || strings.EqualFold(s, "NULL") {
		return TypedValue{Kind: KindNull, IsNull: true}
	}
	if strings.EqualFold(s, "true") {
		return TypedValue{Kind: KindBool, Bool: true}
	}
	if strings.EqualFold(s, "false") {
		return TypedValue{Kind: KindBool, Bool: false}
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return TypedValue{Kind: KindInt, Int: n}
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return TypedValue{Kind: KindFloat, Float: f}
	}
	return TypedValue{Kind: KindString, Str: s}
}

// Cursor walks a result set one row at a time. Construct via
// QueryCursor / QueryCursorContext / ExecutePreparedCursor; always
// call Close (or read until Next returns false). The "one cursor
// per goroutine" contract — concurrent Next/Close on a single
// cursor is undefined.
type Cursor struct {
	columns []string
	rows    [][]string
	idx     int
	closed  bool
}

// Columns returns the column names (in order).
func (c *Cursor) Columns() []string {
	if c == nil {
		return nil
	}
	out := make([]string, len(c.columns))
	copy(out, c.columns)
	return out
}

// Next advances to the next row. Returns false at EOF or after
// Close.
func (c *Cursor) Next() bool {
	if c == nil || c.closed {
		return false
	}
	c.idx++
	return c.idx <= len(c.rows)
}

// Row returns the current raw string row. Only valid after a
// successful Next.
func (c *Cursor) Row() []string {
	if c == nil || c.idx <= 0 || c.idx > len(c.rows) {
		return nil
	}
	return c.rows[c.idx-1]
}

// RowTyped returns the current row with each cell parsed.
func (c *Cursor) RowTyped() map[string]TypedValue {
	if c == nil || c.idx <= 0 || c.idx > len(c.rows) {
		return nil
	}
	raw := c.rows[c.idx-1]
	m := make(map[string]TypedValue, len(c.columns))
	for i, col := range c.columns {
		var s string
		if i < len(raw) {
			s = raw[i]
		}
		m[col] = parseCell(s)
	}
	return m
}

// Err is reserved for future expansion (server-side streaming
// will surface mid-iteration errors here). Today's cursor wraps
// a fully-materialized Result, so Err always returns nil.
func (c *Cursor) Err() error {
	return nil
}

// Close releases the cursor. Safe to call multiple times.
func (c *Cursor) Close() error {
	if c == nil {
		return nil
	}
	c.closed = true
	return nil
}

// ReadAll drains the cursor and returns every remaining typed
// row. Closes the cursor on return.
func (c *Cursor) ReadAll() ([]map[string]TypedValue, error) {
	defer c.Close()
	var out []map[string]TypedValue
	for c.Next() {
		out = append(out, c.RowTyped())
	}
	return out, c.Err()
}

// QueryCursor opens a row-by-row cursor over the result of query.
// Caller MUST close the cursor (defer cur.Close()) when done.
func (c *Client) QueryCursor(query string) (*Cursor, error) {
	r, err := c.Query(query)
	if err != nil {
		return nil, err
	}
	return cursorFromResult(r), nil
}

// QueryCursorContext is the context-aware variant of QueryCursor.
func (c *Client) QueryCursorContext(ctx context.Context, query string) (*Cursor, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return c.QueryCursor(query)
}

// ExecutePreparedCursor opens a cursor over the result of a
// prepared-statement execution.
func (c *Client) ExecutePreparedCursor(name string, args ...string) (*Cursor, error) {
	r, err := c.ExecutePrepared(name, args...)
	if err != nil {
		return nil, err
	}
	return cursorFromResult(r), nil
}

// ExecutePreparedCursorContext is the context-aware twin.
func (c *Client) ExecutePreparedCursorContext(ctx context.Context, name string, args ...string) (*Cursor, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return c.ExecutePreparedCursor(name, args...)
}

func cursorFromResult(r *Result) *Cursor {
	if r == nil {
		return &Cursor{}
	}
	return &Cursor{
		columns: r.Columns,
		rows:    r.Rows,
	}
}

// ErrCursorClosed is returned by future server-side streaming
// implementations when an operation hits a closed cursor.
var ErrCursorClosed = errors.New("vedadb: cursor closed")

// _ keeps the io import alive for future server-side streaming
// (will surface io.EOF on iteration end instead of just false).
var _ = io.EOF
