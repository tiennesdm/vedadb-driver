package vedadb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Bulk Inserter
// ---------------------------------------------------------------------------

// BulkInserter buffers rows and flushes them in batches.
type BulkInserter struct {
	Table     string
	BatchSize int

	client *Client
	mu     sync.Mutex
	buffer []map[string]interface{}
	closed bool
	flushed int64 // total rows flushed
}

// Client is a high-level VedaDB client.
type Client struct {
	proto       *Protocol
	config      Config
	breaker     *CircuitBreaker
	retryPolicy *RetryPolicy
	mu          sync.RWMutex
}

// NewClient creates a new Client from a Config.
func NewClient(cfg Config) (*Client, error) {
	proto, err := NewProtocol(cfg)
	if err != nil {
		return nil, err
	}
	return &Client{
		proto:       proto,
		config:      cfg,
		breaker:     DefaultCircuitBreaker(),
		retryPolicy: DefaultRetryPolicy(),
	}, nil
}

// Close closes the client.
func (c *Client) Close() error {
	c.proto.Close()
	return nil
}

// Protocol returns the underlying Protocol.
func (c *Client) Protocol() *Protocol {
	return c.proto
}

// Config returns the client configuration.
func (c *Client) Config() Config {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.config
}

// WithCircuitBreaker sets the circuit breaker for the client.
func (c *Client) WithCircuitBreaker(cb *CircuitBreaker) *Client {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.breaker = cb
	return c
}

// WithRetryPolicy sets the retry policy for the client.
func (c *Client) WithRetryPolicy(rp *RetryPolicy) *Client {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.retryPolicy = rp
	return c
}

// Query executes a query and returns a *Result.
func (c *Client) Query(ctx context.Context, sql string, args ...interface{}) (*Result, error) {
	c.mu.RLock()
	rp := c.retryPolicy
	br := c.breaker
	proto := c.proto
	c.mu.RUnlock()

	fn := func() (*Result, error) {
		return proto.Query(sql, args)
	}

	if br != nil {
		return CallResult(br, fn)
	}
	if rp != nil {
		return ExecuteResult(ctx, rp, fn)
	}
	return fn()
}

// Exec executes a statement and returns affected rows.
func (c *Client) Exec(ctx context.Context, sql string, args ...interface{}) (int64, error) {
	result, err := c.Query(ctx, sql, args...)
	if err != nil {
		return 0, err
	}
	return int64(result.RowCount), nil
}

// Ping checks connectivity.
func (c *Client) Ping(ctx context.Context) error {
	return c.proto.Ping()
}

// Health returns the health status.
func (c *Client) Health(ctx context.Context) (*HealthStatus, error) {
	return c.proto.Health()
}

// NewBulkInserter creates a BulkInserter for the given table.
func (c *Client) NewBulkInserter(table string, batchSize int) *BulkInserter {
	if batchSize <= 0 {
		batchSize = 1000
	}
	return &BulkInserter{
		Table:     table,
		BatchSize: batchSize,
		client:    c,
		buffer:    make([]map[string]interface{}, 0, batchSize),
	}
}

// Add buffers a row for bulk insertion. Flushes automatically when the buffer is full.
func (b *BulkInserter) Add(row map[string]interface{}) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.closed {
		return NewConnectionError("bulk inserter is closed")
	}
	if row == nil {
		return NewValidationError("nil row")
	}

	b.buffer = append(b.buffer, row)

	if len(b.buffer) >= b.BatchSize {
		return b.flushLocked()
	}
	return nil
}

// AddRows adds multiple rows at once, flushing as needed.
func (b *BulkInserter) AddRows(rows []map[string]interface{}) error {
	for _, row := range rows {
		if err := b.Add(row); err != nil {
			return err
		}
	}
	return nil
}

// Flush sends all buffered rows to the server.
func (b *BulkInserter) Flush() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.flushLocked()
}

func (b *BulkInserter) flushLocked() error {
	if len(b.buffer) == 0 {
		return nil
	}

	payload := map[string]interface{}{
		"table": b.Table,
		"rows":  b.buffer,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return NewValidationError("failed to encode bulk payload: " + err.Error())
	}

	ctx, cancel := contextWithTimeout(b.client.config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST",
		b.client.proto.baseURL+"/v1/bulk/insert", bytes.NewReader(body))
	if err != nil {
		return err
	}

	b.client.proto.setHeaders(req, true)
	resp, err := b.client.proto.client.Do(req)
	if err != nil {
		return NewConnectionError(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var errResp struct {
			Error string `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil && errResp.Error != "" {
			return NewQueryError(errResp.Error)
		}
		return NewConnectionError(fmt.Sprintf("bulk insert returned %d", resp.StatusCode))
	}

	b.flushed += int64(len(b.buffer))
	b.buffer = b.buffer[:0] // reset buffer
	return nil
}

// Buffered returns the number of rows currently buffered.
func (b *BulkInserter) Buffered() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.buffer)
}

// Flushed returns the total number of rows flushed to the server.
func (b *BulkInserter) Flushed() int64 {
	return atomic.LoadInt64(&b.flushed)
}

// Close flushes remaining rows and marks the inserter as closed.
func (b *BulkInserter) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.closed {
		return nil
	}
	b.closed = true

	if err := b.flushLocked(); err != nil {
		return err
	}
	b.buffer = nil
	return nil
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

// pipelineCmd represents a single command in a pipeline.
type pipelineCmd struct {
	op   string // "query" or "exec"
	sql  string
	args []interface{}
}

// Pipeline buffers multiple commands and sends them as a batch.
type Pipeline struct {
	client *Client
	mu     sync.Mutex
	cmds   []pipelineCmd
	closed bool
}

// Pipeline creates a new Pipeline for the client.
func (c *Client) Pipeline() *Pipeline {
	return &Pipeline{client: c}
}

// Query adds a query command to the pipeline.
func (p *Pipeline) Query(sql string, args ...interface{}) *Pipeline {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cmds = append(p.cmds, pipelineCmd{op: "query", sql: sql, args: args})
	return p
}

// Execute adds an exec command to the pipeline.
func (p *Pipeline) Execute(sql string, args ...interface{}) *Pipeline {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cmds = append(p.cmds, pipelineCmd{op: "exec", sql: sql, args: args})
	return p
}

// Len returns the number of commands in the pipeline.
func (p *Pipeline) Len() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.cmds)
}

// Clear removes all commands from the pipeline.
func (p *Pipeline) Clear() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cmds = p.cmds[:0]
}

// PipelineResult holds the result of a single pipeline command.
type PipelineResult struct {
	Op     string
	SQL    string
	Result *Result
	Err    error
}

// Run sends all pipelined commands and returns their results.
func (p *Pipeline) Run(ctx context.Context) ([]*PipelineResult, error) {
	p.mu.Lock()
	cmds := make([]pipelineCmd, len(p.cmds))
	copy(cmds, p.cmds)
	p.cmds = p.cmds[:0] // clear after copy
	p.mu.Unlock()

	if len(cmds) == 0 {
		return nil, nil
	}

	// Serialize all commands
	payload := map[string]interface{}{
		"commands": cmds,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, NewValidationError("failed to encode pipeline: " + err.Error())
	}

	reqCtx, cancel := contextWithTimeout(p.client.config.Timeout)
	if deadline, ok := ctx.Deadline(); ok {
		ctxTimeout := time.Until(deadline)
		if ctxTimeout < p.client.config.Timeout {
			cancel()
			reqCtx, cancel = context.WithTimeout(context.Background(), ctxTimeout)
		}
	}
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "POST",
		p.client.proto.baseURL+"/v1/pipeline", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	p.client.proto.setHeaders(req, true)
	resp, err := p.client.proto.client.Do(req)
	if err != nil {
		return nil, NewConnectionError(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var errResp struct {
			Error string `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil && errResp.Error != "" {
			return nil, NewQueryError(errResp.Error)
		}
		return nil, NewConnectionError(fmt.Sprintf("pipeline returned %d", resp.StatusCode))
	}

	var batchResp struct {
		Results []json.RawMessage `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&batchResp); err != nil {
		return nil, NewConnectionError("invalid pipeline response: " + err.Error())
	}

	results := make([]*PipelineResult, len(cmds))
	for i, cmd := range cmds {
		pr := &PipelineResult{Op: cmd.op, SQL: cmd.sql}
		if i < len(batchResp.Results) {
			var r Result
			if err := json.Unmarshal(batchResp.Results[i], &r); err == nil {
				pr.Result = &r
			} else {
				// Try to decode as error
				var errMsg struct {
					Error string `json:"error"`
				}
				if json.Unmarshal(batchResp.Results[i], &errMsg) == nil && errMsg.Error != "" {
					pr.Err = NewQueryError(errMsg.Error)
				}
			}
		}
		results[i] = pr
	}

	return results, nil
}

// Close clears the pipeline.
func (p *Pipeline) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.cmds = p.cmds[:0]
}
