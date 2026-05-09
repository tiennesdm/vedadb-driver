package vedadb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"sync"
)

func init() {
	sql.Register("vedadb", &VedaDriver{})
}

// VedaDriver implements database/sql/driver.Driver and DriverContext.
type VedaDriver struct{}

// Open implements driver.Driver.
func (d *VedaDriver) Open(name string) (driver.Conn, error) {
	cfg, err := ParseDSN(name)
	if err != nil {
		return nil, err
	}
	return openConnection(cfg)
}

// OpenConnector implements driver.DriverContext.
func (d *VedaDriver) OpenConnector(name string) (driver.Connector, error) {
	cfg, err := ParseDSN(name)
	if err != nil {
		return nil, err
	}
	return &vedaConnector{cfg: cfg, driver: d}, nil
}

// vedaConnector implements driver.Connector.
type vedaConnector struct {
	cfg    Config
	driver *VedaDriver
}

func (c *vedaConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := openConnection(c.cfg)
	if err != nil {
		return nil, err
	}
	// Verify connectivity
	if err := conn.Ping(ctx); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

func (c *vedaConnector) Driver() driver.Driver {
	return c.driver
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

// VedaConn implements driver.Conn, driver.ConnBeginTx, driver.ConnPrepareContext,
// driver.Pinger, driver.QueryerContext, driver.ExecerContext, and driver.SessionResetter.
type VedaConn struct {
	proto  *Protocol
	mu     sync.Mutex
	closed bool
	tx     bool // true if in transaction
}

func openConnection(cfg Config) (*VedaConn, error) {
	proto, err := NewProtocol(cfg)
	if err != nil {
		return nil, err
	}
	return &VedaConn{proto: proto}, nil
}

// Ping implements driver.Pinger.
func (c *VedaConn) Ping(ctx context.Context) error {
	return c.proto.Ping()
}

// Prepare implements driver.Conn.
func (c *VedaConn) Prepare(query string) (driver.Stmt, error) {
	return c.PrepareContext(context.Background(), query)
}

// PrepareContext implements driver.ConnPrepareContext.
func (c *VedaConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, driver.ErrBadConn
	}
	return &VedaStmt{conn: c, query: query}, nil
}

// Close implements driver.Conn.
func (c *VedaConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	c.proto.Close()
	return nil
}

// Begin is deprecated — use BeginTx instead.
func (c *VedaConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

// BeginTx implements driver.ConnBeginTx.
func (c *VedaConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, driver.ErrBadConn
	}
	if err := c.proto.Begin(); err != nil {
		return nil, err
	}
	c.tx = true
	return &VedaTx{conn: c}, nil
}

// QueryContext implements driver.QueryerContext.
func (c *VedaConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, driver.ErrBadConn
	}

	values := namedValuesToValues(args)
	result, err := c.proto.Query(query, values)
	if err != nil {
		return nil, err
	}
	return &vedaRows{result: result, pos: -1}, nil
}

// ExecContext implements driver.ExecerContext.
func (c *VedaConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, driver.ErrBadConn
	}

	values := namedValuesToValues(args)
	affected, err := c.proto.Exec(query, values)
	if err != nil {
		return nil, err
	}
	return &vedaResult{lastID: 0, rowsAffected: affected}, nil
}

// ResetSession implements driver.SessionResetter.
func (c *VedaConn) ResetSession(ctx context.Context) error {
	// Check if connection is still alive
	if c.closed {
		return driver.ErrBadConn
	}
	return nil
}

// IsValid implements driver.Validator (Go 1.15+).
func (c *VedaConn) IsValid() bool {
	return !c.closed
}

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

// VedaStmt implements driver.Stmt and driver.StmtExecContext / StmtQueryContext.
type VedaStmt struct {
	conn  *VedaConn
	query string
}

func (s *VedaStmt) Close() error { return nil }

func (s *VedaStmt) NumInput() int {
	// Return -1 to let the database/sql package handle parameter counting.
	return -1
}

func (s *VedaStmt) Exec(args []driver.Value) (driver.Result, error) {
	return s.ExecContext(context.Background(), valuesToNamedValues(args))
}

func (s *VedaStmt) Query(args []driver.Value) (driver.Rows, error) {
	return s.QueryContext(context.Background(), valuesToNamedValues(args))
}

func (s *VedaStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	return s.conn.ExecContext(ctx, s.query, args)
}

func (s *VedaStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	return s.conn.QueryContext(ctx, s.query, args)
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

// VedaTx implements driver.Tx.
type VedaTx struct {
	conn *VedaConn
	done bool
}

func (t *VedaTx) Commit() error {
	if t.done {
		return errors.New("transaction already completed")
	}
	t.done = true
	t.conn.mu.Lock()
	defer t.conn.mu.Unlock()
	t.conn.tx = false
	return t.conn.proto.Commit()
}

func (t *VedaTx) Rollback() error {
	if t.done {
		return errors.New("transaction already completed")
	}
	t.done = true
	t.conn.mu.Lock()
	defer t.conn.mu.Unlock()
	t.conn.tx = false
	return t.conn.proto.Rollback()
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type vedaRows struct {
	result *Result
	pos    int
}

func (r *vedaRows) Columns() []string {
	return r.result.Columns
}

func (r *vedaRows) Close() error { return nil }

func (r *vedaRows) Next(dest []driver.Value) error {
	r.pos++
	if r.pos >= len(r.result.Rows) {
		return io.EOF
	}
	row := r.result.Rows[r.pos]
	for i := range dest {
		if i < len(row) {
			dest[i] = row[i]
		} else {
			dest[i] = nil
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

type vedaResult struct {
	lastID       int64
	rowsAffected int64
}

func (r *vedaResult) LastInsertId() (int64, error) { return r.lastID, nil }
func (r *vedaResult) RowsAffected() (int64, error) { return r.rowsAffected, nil }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func namedValuesToValues(named []driver.NamedValue) []driver.Value {
	values := make([]driver.Value, len(named))
	for i, nv := range named {
		values[i] = nv.Value
	}
	return values
}

func valuesToNamedValues(values []driver.Value) []driver.NamedValue {
	named := make([]driver.NamedValue, len(values))
	for i, v := range values {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return named
}
