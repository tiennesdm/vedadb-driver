// Package vedadb provides a database/sql/driver compatible driver for VedaDB.
//
// Usage:
//
//	import (
// 	    _ "github.com/tiennesdm/vedadb-driver/go/vedadb"
// 	    "database/sql"
// 	)
//
// 	db, err := sql.Open("vedadb", "vedadb://localhost:6380/mydb")
// 	defer db.Close()
//
// 	rows, err := db.Query("SELECT * FROM users WHERE age > ?", 25)
package vedadb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
)

func init() {
	sql.Register("vedadb", &VedaDriver{})
}

// VedaDriver implements database/sql/driver.Driver.
type VedaDriver struct{}

// Open returns a new connection to the VedaDB server.
// The name should be in the format "host:port" or a URL like "vedadb://host:port/db".
func (d *VedaDriver) Open(name string) (driver.Conn, error) {
	addr := name
	if strings.HasPrefix(name, "vedadb://") {
		u := strings.TrimPrefix(name, "vedadb://")
		parts := strings.SplitN(u, "/", 2)
		addr = parts[0]
	}
	if !strings.Contains(addr, ":") {
		addr = addr + ":6380"
	}
	client, err := Connect(addr)
	if err != nil {
		return nil, err
	}
	return &VedaConn{client: client}, nil
}

// VedaConn implements driver.Conn.
type VedaConn struct {
	client *Client
}

// Prepare returns a prepared statement.
func (c *VedaConn) Prepare(query string) (driver.Stmt, error) {
	return &VedaStmt{client: c.client, query: query}, nil
}

// Close closes the connection.
func (c *VedaConn) Close() error {
	return c.client.Close()
}

// Begin is not supported (VedaDB auto-commit).
func (c *VedaConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("vedadb: transactions not supported via database/sql")
}

// VedaStmt implements driver.Stmt.
type VedaStmt struct {
	client *Client
	query  string
}

// Close closes the statement.
func (s *VedaStmt) Close() error { return nil }

// NumInput returns the number of placeholder parameters.
func (s *VedaStmt) NumInput() int {
	// Count ? placeholders
	return strings.Count(s.query, "?")
}

// Exec executes a query that doesn't return rows.
func (s *VedaStmt) Exec(args []driver.Value) (driver.Result, error) {
	query := s.interpolate(s.query, args)
	res, err := s.client.Query(query)
	if err != nil {
		return nil, err
	}
	return &VedaResult{rowsAffected: int64(res.RowCount)}, nil
}

// Query executes a query that returns rows.
func (s *VedaStmt) Query(args []driver.Value) (driver.Rows, error) {
	query := s.interpolate(s.query, args)
	res, err := s.client.Query(query)
	if err != nil {
		return nil, err
	}
	return &VedaRows{result: res, pos: -1}, nil
}

// interpolate replaces ? placeholders with values.
func (s *VedaStmt) interpolate(query string, args []driver.Value) string {
	for _, arg := range args {
		placeholder := "?"
		value := fmt.Sprintf("%v", arg)
		// Quote strings
		switch arg.(type) {
		case string:
			value = fmt.Sprintf("'%s'", strings.ReplaceAll(value, "'", "\\'"))
		}
		query = strings.Replace(query, placeholder, value, 1)
	}
	return query
}

// VedaResult implements driver.Result.
type VedaResult struct {
	lastInsertID int64
	rowsAffected int64
}

func (r *VedaResult) LastInsertId() (int64, error) { return r.lastInsertID, nil }
func (r *VedaResult) RowsAffected() (int64, error)  { return r.rowsAffected, nil }

// VedaRows implements driver.Rows.
type VedaRows struct {
	result *Result
	pos    int
}

// Columns returns the column names.
func (r *VedaRows) Columns() []string {
	return r.result.Columns
}

// Close closes the rows iterator.
func (r *VedaRows) Close() error { return nil }

// Next moves to the next row.
func (r *VedaRows) Next(dest []driver.Value) error {
	r.pos++
	if r.pos >= len(r.result.Rows) {
		return io.EOF
	}
	for i, val := range r.result.Rows[r.pos] {
		dest[i] = val
	}
	return nil
}

// --- Connector for context support ---

// VedaConnector implements driver.Connector.
type VedaConnector struct {
	addr string
}

func (c *VedaConnector) Connect(ctx context.Context) (driver.Conn, error) {
	client, err := Connect(c.addr)
	if err != nil {
		return nil, err
	}
	return &VedaConn{client: client}, nil
}

func (c *VedaConnector) Driver() driver.Driver {
	return &VedaDriver{}
}

// OpenDB creates a *sql.DB with context support.
//
//	db := vedadb.OpenDB("localhost:6380")
// 	defer db.Close()
func OpenDB(addr string) *sql.DB {
	return sql.OpenDB(&VedaConnector{addr: addr})
}
