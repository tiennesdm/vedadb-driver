// Package vedadb provides a Go client driver for VedaDB.
//
// Usage:
//
//	client, err := vedadb.Connect("localhost:6380")
//	defer client.Close()
//
//	result, err := client.Query("SELECT * FROM users WHERE age > 25;")
//	for _, row := range result.Rows {
//	    fmt.Println(row)
//	}
package vedadb

import (
	"bufio"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

// Result holds the response from a VedaDB query.
type Result struct {
	Columns  []string   `json:"columns"`
	Rows     [][]string `json:"rows"`
	RowCount int        `json:"row_count"`
	Message  string     `json:"message"`
	Error    string     `json:"error"`
}

// Client is a VedaDB TCP client.
type Client struct {
	mu     sync.Mutex
	conn   net.Conn
	reader *bufio.Reader
	addr   string
	opts   *Options // stored for auto-reconnect
}

// Options configures the client connection.
type Options struct {
	Addr         string        // "host:port" (default "localhost:6380")
	DialTimeout  time.Duration // Connection timeout (default 5s)
	ReadTimeout  time.Duration // Read timeout per query (default 30s)
	WriteTimeout time.Duration // Write timeout per query (default 30s)
	TLS          bool          // Enable STARTTLS upgrade
	TLSInsecure  bool          // Skip TLS certificate verification
	Username     string        // Username for AUTH
	Password     string        // Password for AUTH
}

// DefaultOptions returns default connection options.
func DefaultOptions() *Options {
	return &Options{
		Addr:         "localhost:6380",
		DialTimeout:  5 * time.Second,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}
}

// Connect creates a new client connected to VedaDB.
func Connect(addr string) (*Client, error) {
	opts := DefaultOptions()
	opts.Addr = addr
	return ConnectWithOptions(opts)
}

// ConnectWithOptions creates a client with custom options.
func ConnectWithOptions(opts *Options) (*Client, error) {
	conn, err := net.DialTimeout("tcp", opts.Addr, opts.DialTimeout)
	if err != nil {
		return nil, fmt.Errorf("vedadb: connect failed: %w", err)
	}

	reader := bufio.NewReader(conn)

	// Read and discard the welcome message.
	reader.ReadString('\n')

	// STARTTLS upgrade.
	if opts.TLS {
		_, err := conn.Write([]byte("STARTTLS\n"))
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("vedadb: STARTTLS write failed: %w", err)
		}

		response, err := reader.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("vedadb: STARTTLS read failed: %w", err)
		}

		var result Result
		if err := json.Unmarshal([]byte(response), &result); err != nil {
			conn.Close()
			return nil, fmt.Errorf("vedadb: STARTTLS invalid response: %w", err)
		}
		if result.Error != "" {
			conn.Close()
			return nil, fmt.Errorf("vedadb: STARTTLS failed: %s", result.Error)
		}

		// Extract hostname from address (remove port) for TLS certificate verification.
		host := opts.Addr
		if idx := strings.LastIndex(host, ":"); idx != -1 {
			host = host[:idx]
		}

		tlsConn := tls.Client(conn, &tls.Config{
			ServerName:         host,
			InsecureSkipVerify: opts.TLSInsecure,
		})
		if err := tlsConn.Handshake(); err != nil {
			conn.Close()
			return nil, fmt.Errorf("vedadb: TLS handshake failed: %w", err)
		}

		conn = tlsConn
		reader = bufio.NewReader(conn)
	}

	// AUTH.
	if opts.Username != "" {
		_, err := conn.Write([]byte(fmt.Sprintf("AUTH %s %s\n", opts.Username, opts.Password)))
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("vedadb: AUTH write failed: %w", err)
		}

		response, err := reader.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("vedadb: AUTH read failed: %w", err)
		}

		var result Result
		if err := json.Unmarshal([]byte(response), &result); err != nil {
			conn.Close()
			return nil, fmt.Errorf("vedadb: AUTH invalid response: %w", err)
		}
		if result.Error != "" {
			conn.Close()
			return nil, fmt.Errorf("vedadb: authentication failed: %s", result.Error)
		}
	}

	client := &Client{
		conn:   conn,
		reader: reader,
		addr:   opts.Addr,
		opts:   opts,
	}

	return client, nil
}

// Query executes a VedaQL query and returns the result.
func (c *Client) Query(query string) (*Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Send query.
	_, err := c.conn.Write([]byte(query + "\n"))
	if err != nil {
		return nil, fmt.Errorf("vedadb: write failed: %w", err)
	}

	// Read response.
	response, err := c.reader.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("vedadb: read failed: %w", err)
	}

	var result Result
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		return nil, fmt.Errorf("vedadb: invalid response: %w", err)
	}

	if result.Error != "" {
		return nil, fmt.Errorf("vedadb: %s", result.Error)
	}

	return &result, nil
}

// Exec executes a query that doesn't return rows (INSERT, UPDATE, DELETE, CREATE, DROP).
func (c *Client) Exec(query string) (string, error) {
	result, err := c.Query(query)
	if err != nil {
		return "", err
	}
	return result.Message, nil
}

// Prepare creates a prepared statement on the server.
func (c *Client) Prepare(name, query string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	cmd := fmt.Sprintf("PREPARE %s AS %s\n", name, query)
	_, err := c.conn.Write([]byte(cmd))
	if err != nil {
		return fmt.Errorf("vedadb: prepare write failed: %w", err)
	}

	response, err := c.reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("vedadb: prepare read failed: %w", err)
	}

	var result Result
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		return fmt.Errorf("vedadb: prepare invalid response: %w", err)
	}

	if result.Error != "" {
		return fmt.Errorf("vedadb: prepare failed: %s", result.Error)
	}

	return nil
}

// ExecutePrepared executes a previously prepared statement with the given arguments.
//
// Each argument is SQL-escaped (single quotes doubled per SQL standard) before
// being interpolated into the EXECUTE command, so embedded quotes in arg values
// cannot escape the literal and inject SQL.
func (c *Client) ExecutePrepared(name string, args ...string) (*Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Format args as ('val1', 'val2', ...) with proper SQL-literal escaping.
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = "'" + strings.ReplaceAll(a, "'", "''") + "'"
	}
	cmd := fmt.Sprintf("EXECUTE %s (%s)\n", name, strings.Join(quoted, ", "))

	_, err := c.conn.Write([]byte(cmd))
	if err != nil {
		return nil, fmt.Errorf("vedadb: execute write failed: %w", err)
	}

	response, err := c.reader.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("vedadb: execute read failed: %w", err)
	}

	var result Result
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		return nil, fmt.Errorf("vedadb: execute invalid response: %w", err)
	}

	if result.Error != "" {
		return nil, fmt.Errorf("vedadb: %s", result.Error)
	}

	return &result, nil
}

// Deallocate removes a prepared statement from the server.
func (c *Client) Deallocate(name string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	cmd := fmt.Sprintf("DEALLOCATE %s\n", name)
	_, err := c.conn.Write([]byte(cmd))
	if err != nil {
		return fmt.Errorf("vedadb: deallocate write failed: %w", err)
	}

	response, err := c.reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("vedadb: deallocate read failed: %w", err)
	}

	var result Result
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		return fmt.Errorf("vedadb: deallocate invalid response: %w", err)
	}

	if result.Error != "" {
		return fmt.Errorf("vedadb: deallocate failed: %s", result.Error)
	}

	return nil
}

// Ping checks if the server is reachable.
func (c *Client) Ping() error {
	_, err := c.Query("SHOW TABLES;")
	return err
}

// Close closes the connection. Safe to call multiple times.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return nil
	}
	// Best-effort QUIT; swallow the error since the peer may already be gone.
	_, _ = c.conn.Write([]byte("QUIT\n"))
	err := c.conn.Close()
	c.conn = nil
	c.reader = nil
	return err
}

// --- Transactions ---

// Begin starts a new transaction.
func (c *Client) Begin() error {
	_, err := c.Query("BEGIN")
	return err
}

// Commit commits the current transaction.
func (c *Client) Commit() error {
	_, err := c.Query("COMMIT")
	return err
}

// Rollback aborts the current transaction.
func (c *Client) Rollback() error {
	_, err := c.Query("ROLLBACK")
	return err
}

// Transaction runs fn inside a BEGIN/COMMIT block, rolling back on error.
func (c *Client) Transaction(fn func() error) error {
	if err := c.Begin(); err != nil {
		return err
	}
	if err := fn(); err != nil {
		c.Rollback()
		return err
	}
	return c.Commit()
}

// --- Auto-Reconnect ---

// reconnect attempts to re-establish the connection up to 3 times with 1s backoff.
func (c *Client) reconnect() error {
	for i := 0; i < 3; i++ {
		time.Sleep(time.Duration(i+1) * time.Second)

		conn, err := net.DialTimeout("tcp", c.opts.Addr, c.opts.DialTimeout)
		if err != nil {
			continue
		}

		reader := bufio.NewReader(conn)
		// Discard welcome banner.
		reader.ReadString('\n')

		// Re-authenticate if credentials were configured.
		if c.opts.Username != "" {
			_, err := conn.Write([]byte(fmt.Sprintf("AUTH %s %s\n", c.opts.Username, c.opts.Password)))
			if err != nil {
				conn.Close()
				continue
			}
			response, err := reader.ReadString('\n')
			if err != nil {
				conn.Close()
				continue
			}
			var result Result
			if err := json.Unmarshal([]byte(response), &result); err != nil || result.Error != "" {
				conn.Close()
				continue
			}
		}

		// Success – swap the connection.
		c.mu.Lock()
		c.conn.Close()
		c.conn = conn
		c.reader = reader
		c.mu.Unlock()
		return nil
	}
	return fmt.Errorf("vedadb: reconnect failed after 3 attempts")
}

// QueryWithReconnect executes a query, automatically reconnecting on connection error.
func (c *Client) QueryWithReconnect(query string) (*Result, error) {
	result, err := c.Query(query)
	if err == nil {
		return result, nil
	}
	msg := err.Error()
	if strings.Contains(msg, "write failed") || strings.Contains(msg, "read failed") {
		if rerr := c.reconnect(); rerr != nil {
			return nil, rerr
		}
		return c.Query(query)
	}
	return result, err
}

// --- Batch Insert ---

// InsertMany inserts multiple rows in a single batch INSERT statement.
//
// Values are SQL-escaped (single quotes doubled) so embedded quotes cannot
// inject SQL. Column and table names are NOT escaped — pass trusted identifiers.
func (c *Client) InsertMany(table string, columns []string, rows [][]string) (*Result, error) {
	colList := strings.Join(columns, ", ")
	valueSets := make([]string, len(rows))
	for i, row := range rows {
		quoted := make([]string, len(row))
		for j, v := range row {
			quoted[j] = "'" + strings.ReplaceAll(v, "'", "''") + "'"
		}
		valueSets[i] = "(" + strings.Join(quoted, ", ") + ")"
	}
	sql := fmt.Sprintf("INSERT INTO %s (%s) VALUES %s;", table, colList, strings.Join(valueSets, ", "))
	return c.Query(sql)
}

// --- Cache API ---

// CacheSet sets a cache key with a value and TTL in seconds.
func (c *Client) CacheSet(key, value string, ttl int) error {
	_, err := c.Query(fmt.Sprintf("CACHE SET %s %s EX %d", key, value, ttl))
	return err
}

// CacheGet retrieves a value from the cache by key.
func (c *Client) CacheGet(key string) (string, error) {
	result, err := c.Query(fmt.Sprintf("CACHE GET %s", key))
	if err != nil {
		return "", err
	}
	return result.Message, nil
}

// CacheDel deletes a key from the cache.
func (c *Client) CacheDel(key string) error {
	_, err := c.Query(fmt.Sprintf("CACHE DEL %s", key))
	return err
}

// CacheKeys lists cache keys matching a pattern.
func (c *Client) CacheKeys(pattern string) (*Result, error) {
	return c.Query(fmt.Sprintf("CACHE KEYS %s", pattern))
}

// --- Search API ---

// Search performs a full-text search on a table.
func (c *Client) Search(table, query string, fuzzy int) (*Result, error) {
	sql := fmt.Sprintf("SEARCH %s MATCH(*) AGAINST('%s') FUZZY %d", table, query, fuzzy)
	return c.Query(sql)
}

// --- Graph API ---

// GraphAddNode adds a node to the graph.
func (c *Client) GraphAddNode(id, label string, props map[string]string) error {
	propsStr := "{"
	i := 0
	for k, v := range props {
		if i > 0 {
			propsStr += ", "
		}
		propsStr += fmt.Sprintf("%s: '%s'", k, v)
		i++
	}
	propsStr += "}"
	_, err := c.Query(fmt.Sprintf("GRAPH ADD NODE %s LABEL %s %s", id, label, propsStr))
	return err
}

// GraphAddEdge adds an edge between two nodes.
func (c *Client) GraphAddEdge(from, to, edgeType string) error {
	_, err := c.Query(fmt.Sprintf("GRAPH ADD EDGE %s -> %s TYPE %s", from, to, edgeType))
	return err
}

// GraphBFS performs a breadth-first search from a starting node.
func (c *Client) GraphBFS(start string, depth int) (*Result, error) {
	return c.Query(fmt.Sprintf("GRAPH BFS %s DEPTH %d", start, depth))
}

// --- Connection Pool ---

// Pool is a simple connection pool.
type Pool struct {
	mu      sync.Mutex
	addr    string
	opts    *Options
	clients []*Client
	maxSize int
	closed  bool
}

// ErrPoolClosed is returned by Pool.Get after Close has been called.
var ErrPoolClosed = fmt.Errorf("vedadb: pool is closed")

// NewPool creates a connection pool.
func NewPool(addr string, maxSize int) *Pool {
	opts := DefaultOptions()
	opts.Addr = addr
	return &Pool{
		addr:    addr,
		opts:    opts,
		maxSize: maxSize,
	}
}

// Get returns a client from the pool or creates a new one.
// Returns ErrPoolClosed if the pool has been closed.
func (p *Pool) Get() (*Client, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, ErrPoolClosed
	}
	if len(p.clients) > 0 {
		client := p.clients[len(p.clients)-1]
		p.clients = p.clients[:len(p.clients)-1]
		p.mu.Unlock()
		return client, nil
	}
	p.mu.Unlock()

	return ConnectWithOptions(p.opts)
}

// Put returns a client to the pool. If the pool is closed or full,
// the client is closed instead of being parked.
func (p *Pool) Put(client *Client) {
	if client == nil {
		return
	}
	p.mu.Lock()
	if p.closed || len(p.clients) >= p.maxSize {
		p.mu.Unlock()
		client.Close()
		return
	}
	p.clients = append(p.clients, client)
	p.mu.Unlock()
}

// Close closes all pooled connections and marks the pool closed.
// Subsequent calls to Get return ErrPoolClosed; subsequent Put closes
// the released client instead of parking it.
func (p *Pool) Close() {
	p.mu.Lock()
	p.closed = true
	clients := p.clients
	p.clients = nil
	p.mu.Unlock()

	for _, client := range clients {
		client.Close()
	}
}
