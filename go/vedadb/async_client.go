package vedadb

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// AsyncVedaDB - async wrapper using goroutines + channels
// ---------------------------------------------------------------------------

// AsyncResult wraps a query result or error for channel-based async ops.
type AsyncResult struct {
	Result *Result
	RowsAffected int64
	Error  error
}

// AsyncVedaDB wraps a synchronous Client to provide async operations
// via goroutines and channels. All methods return channels for
// receiving results.
type AsyncVedaDB struct {
	client *Client
	wg     sync.WaitGroup
	ctx    context.Context
	cancel context.CancelFunc
}

// NewAsyncVedaDB creates a new async wrapper around a sync client.
func NewAsyncVedaDB(client *Client) *AsyncVedaDB {
	ctx, cancel := context.WithCancel(context.Background())
	return &AsyncVedaDB{
		client: client,
		ctx:    ctx,
		cancel: cancel,
	}
}

// Close shuts down the async client and waits for goroutines.
func (a *AsyncVedaDB) Close() error {
	a.cancel()
	a.wg.Wait()
	return nil
}

// QueryAsync executes a query asynchronously, returning a channel.
func (a *AsyncVedaDB) QueryAsync(sql string, args ...interface{}) <-chan AsyncResult {
	ch := make(chan AsyncResult, 1)
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		result, err := a.client.Query(a.ctx, sql, args...)
		select {
		case ch <- AsyncResult{Result: result, Error: err}:
		case <-a.ctx.Done():
		}
		close(ch)
	}()
	return ch
}

// ExecAsync executes a non-query asynchronously.
func (a *AsyncVedaDB) ExecAsync(sql string, args ...interface{}) <-chan AsyncResult {
	ch := make(chan AsyncResult, 1)
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		affected, err := a.client.Exec(a.ctx, sql, args...)
		select {
		case ch <- AsyncResult{RowsAffected: affected, Error: err}:
		case <-a.ctx.Done():
		}
		close(ch)
	}()
	return ch
}

// InsertAsync inserts a row asynchronously.
func (a *AsyncVedaDB) InsertAsync(table string, data map[string]interface{}) <-chan AsyncResult {
	ch := make(chan AsyncResult, 1)
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		result, err := a.client.Insert(a.ctx, table, data)
		select {
		case ch <- AsyncResult{Result: result, Error: err}:
		case <-a.ctx.Done():
		}
		close(ch)
	}()
	return ch
}

// SelectAsync selects rows asynchronously.
func (a *AsyncVedaDB) SelectAsync(table string, opts ...SelectOption) <-chan AsyncResult {
	ch := make(chan AsyncResult, 1)
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		result, err := a.client.Select(a.ctx, table, opts...)
		select {
		case ch <- AsyncResult{Result: result, Error: err}:
		case <-a.ctx.Done():
		}
		close(ch)
	}()
	return ch
}

// PingAsync pings the server asynchronously.
func (a *AsyncVedaDB) PingAsync() <-chan error {
	ch := make(chan error, 1)
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		err := a.client.Ping(a.ctx)
		select {
		case ch <- err:
		case <-a.ctx.Done():
		}
		close(ch)
	}()
	return ch
}

// ---------------------------------------------------------------------------
// AsyncConnectionPool - context-aware connection pool
// ---------------------------------------------------------------------------

// AsyncPooledClient wraps a pooled connection for async use.
type AsyncPooledClient struct {
	pool   *AsyncConnectionPool
	client *Client
}

// AsyncConnectionPool manages a pool of async-capable connections.
type AsyncConnectionPool struct {
	mu       sync.RWMutex
	clients  chan *Client
	config   Config
	maxSize  int
	timeout  time.Duration
	closed   bool
}

// NewAsyncConnectionPool creates a new async connection pool.
func NewAsyncConnectionPool(cfg Config, maxSize int, timeout time.Duration) (*AsyncConnectionPool, error) {
	pool := &AsyncConnectionPool{
		clients: make(chan *Client, maxSize),
		config:  cfg,
		maxSize: maxSize,
		timeout: timeout,
	}
	// Pre-warm connections
	for i := 0; i < maxSize; i++ {
		client, err := NewProtocol(cfg)
		if err != nil {
			return nil, fmt.Errorf("pool pre-warm: %w", err)
		}
		// Wrap protocol as client
		c := &Client{proto: client}
		pool.clients <- c
	}
	return pool, nil
}

// Acquire gets a client from the pool with context-based timeout.
func (p *AsyncConnectionPool) Acquire(ctx context.Context) (*AsyncPooledClient, error) {
	select {
	case client := <-p.clients:
		return &AsyncPooledClient{pool: p, client: client}, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("pool acquire: %w", ctx.Err())
	}
}

// Release returns a client to the pool.
func (p *AsyncPooledClient) Release() {
	if p.client != nil && p.pool != nil {
		select {
		case p.pool.clients <- p.client:
		default:
			// Pool is full, discard
		}
		p.client = nil
	}
}

// Close shuts down the pool.
func (p *AsyncConnectionPool) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	close(p.clients)
	for client := range p.clients {
		client.Close()
	}
	return nil
}

// Stats returns pool statistics.
func (p *AsyncConnectionPool) Stats() (available, capacity int) {
	return len(p.clients), cap(p.clients)
}

// ---------------------------------------------------------------------------
// Async transactions
// ---------------------------------------------------------------------------

// AsyncTx wraps an async transaction.
type AsyncTx struct {
	a   *AsyncVedaDB
	ctx context.Context
}

// BeginAsync starts an async transaction.
func (a *AsyncVedaDB) BeginAsync() (*AsyncTx, error) {
	_, err := a.client.Exec(a.ctx, "BEGIN")
	if err != nil {
		return nil, err
	}
	return &AsyncTx{a: a, ctx: a.ctx}, nil
}

// CommitAsync commits the transaction.
func (tx *AsyncTx) CommitAsync() <-chan error {
	ch := make(chan error, 1)
	tx.a.wg.Add(1)
	go func() {
		defer tx.a.wg.Done()
		_, err := tx.a.client.Exec(tx.a.ctx, "COMMIT")
		ch <- err
		close(ch)
	}()
	return ch
}

// RollbackAsync rolls back the transaction.
func (tx *AsyncTx) RollbackAsync() <-chan error {
	ch := make(chan error, 1)
	tx.a.wg.Add(1)
	go func() {
		defer tx.a.wg.Done()
		_, err := tx.a.client.Exec(tx.a.ctx, "ROLLBACK")
		ch <- err
		close(ch)
	}()
	return ch
}

// ---------------------------------------------------------------------------
// Async pub/sub
// ---------------------------------------------------------------------------

// AsyncSubscription represents an async pub/sub subscription.
type AsyncSubscription struct {
	topic   string
	msgs    chan *Result
	errs    chan error
	cancel  context.CancelFunc
}

// Messages returns the message channel.
func (s *AsyncSubscription) Messages() <-chan *Result { return s.msgs }

// Errors returns the error channel.
func (s *AsyncSubscription) Errors() <-chan error { return s.errs }

// Unsubscribe cancels the subscription.
func (s *AsyncSubscription) Unsubscribe() { s.cancel() }

// SubscribeAsync subscribes to a topic asynchronously.
func (a *AsyncVedaDB) SubscribeAsync(topic string) *AsyncSubscription {
	ctx, cancel := context.WithCancel(a.ctx)
	msgs := make(chan *Result, 100)
	errs := make(chan error, 10)

	go func() {
		defer close(msgs)
		defer close(errs)
		for {
			select {
			case <-ctx.Done():
				return
			default:
				result, err := a.client.Query(ctx, "SUBSCRIBE "+topic)
				if err != nil {
					select {
					case errs <- err:
					case <-ctx.Done():
						return
					}
					continue
				}
				select {
				case msgs <- result:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return &AsyncSubscription{topic: topic, msgs: msgs, errs: errs, cancel: cancel}
}

// ---------------------------------------------------------------------------
// AsyncCursor - streaming results via channels
// ---------------------------------------------------------------------------

// AsyncCursor streams query results via channels.
type AsyncCursor struct {
	sql     string
	results chan *Result
	errs    chan error
	cancel  context.CancelFunc
}

// Results returns the result streaming channel.
func (c *AsyncCursor) Results() <-chan *Result { return c.results }

// Errors returns the error channel.
func (c *AsyncCursor) Errors() <-chan error { return c.errs }

// Close cancels the cursor.
func (c *AsyncCursor) Close() { c.cancel() }

// OpenAsyncCursor opens an async streaming cursor.
func (a *AsyncVedaDB) OpenAsyncCursor(sql string) *AsyncCursor {
	ctx, cancel := context.WithCancel(a.ctx)
	results := make(chan *Result, 10)
	errs := make(chan error, 1)

	go func() {
		defer close(results)
		defer close(errs)
		// Stream in batches
		offset := 0
		batchSize := 1000
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			pagedSQL := fmt.Sprintf("%s LIMIT %d OFFSET %d", sql, batchSize, offset)
			result, err := a.client.Query(ctx, pagedSQL)
			if err != nil {
				errs <- err
				return
			}
			if len(result.Rows) == 0 {
				return
			}
			select {
			case results <- result:
			case <-ctx.Done():
				return
			}
			offset += batchSize
		}
	}()

	return &AsyncCursor{sql: sql, results: results, errs: errs, cancel: cancel}
}
