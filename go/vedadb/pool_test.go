// pool_test.go — Connection pool tests for VedaDB Go driver
package vedadb

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// PoolConn represents a pooled connection
type PoolConn struct {
	id       int64
	client   *Client
	pool     *Pool
	created  time.Time
	inUse    bool
}

func (pc *PoolConn) Release() {
	pc.pool.release(pc)
}

func (pc *PoolConn) IsValid() bool {
	return !pc.client.closed
}

// Pool manages a pool of reusable connections
type Pool struct {
	mu          sync.Mutex
	endpoint    string
	maxConns    int
	maxIdle     int
	connections []*PoolConn
	available   chan *PoolConn
	activeCount int64
	totalCreated int64
	waitTimeout time.Duration
	factory     func() (*Client, error)
	closed      bool
}

func NewPool(endpoint string, maxConns, maxIdle int, waitTimeout time.Duration) *Pool {
	return &Pool{
		endpoint:    endpoint,
		maxConns:    maxConns,
		maxIdle:     maxIdle,
		connections: make([]*PoolConn, 0, maxConns),
		available:   make(chan *PoolConn, maxConns),
		waitTimeout: waitTimeout,
		factory: func() (*Client, error) {
			return Connect(context.Background(), endpoint)
		},
	}
}

func (p *Pool) Acquire(ctx context.Context) (*PoolConn, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, errors.New("pool is closed")
	}

	// Try to get from available
	select {
	case conn := <-p.available:
		p.mu.Unlock()
		conn.inUse = true
		atomic.AddInt64(&p.activeCount, 1)
		return conn, nil
	default:
	}

	// Create new if under max
	if len(p.connections) < p.maxConns {
		atomic.AddInt64(&p.totalCreated, 1)
		client, err := p.factory()
		if err != nil {
			p.mu.Unlock()
			return nil, err
		}
		conn := &PoolConn{
			id:      p.totalCreated,
			client:  client,
			pool:    p,
			created: time.Now(),
			inUse:   true,
		}
		p.connections = append(p.connections, conn)
		atomic.AddInt64(&p.activeCount, 1)
		p.mu.Unlock()
		return conn, nil
	}
	p.mu.Unlock()

	// Wait for available connection
	select {
	case conn := <-p.available:
		conn.inUse = true
		atomic.AddInt64(&p.activeCount, 1)
		return conn, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(p.waitTimeout):
		return nil, errors.New("pool exhausted: wait timeout")
	}
}

func (p *Pool) release(conn *PoolConn) {
	conn.inUse = false
	atomic.AddInt64(&p.activeCount, -1)
	select {
	case p.available <- conn:
	default:
		// Pool full, discard
	}
}

func (p *Pool) ActiveCount() int {
	return int(atomic.LoadInt64(&p.activeCount))
}

func (p *Pool) TotalCreated() int64 {
	return atomic.LoadInt64(&p.totalCreated)
}

func (p *Pool) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	for _, conn := range p.connections {
		if conn.client != nil {
			conn.client.Close()
		}
	}
	return nil
}

func TestPoolAcquire(t *testing.T) {
	t.Run("acquire_new_connection", func(t *testing.T) {
		p := NewPool("mock://test", 10, 5, 1*time.Second)
		defer p.Close()

		conn, err := p.Acquire(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if conn == nil {
			t.Fatal("expected connection, got nil")
		}
		if conn.pool != p {
			t.Error("expected connection to belong to pool")
		}
		conn.Release()
	})

	t.Run("acquire_reuses_released", func(t *testing.T) {
		p := NewPool("mock://test", 10, 5, 1*time.Second)
		defer p.Close()

		conn1, _ := p.Acquire(context.Background())
		conn1.Release()

		conn2, _ := p.Acquire(context.Background())
		defer conn2.Release()

		if conn1.id != conn2.id {
			t.Error("expected same connection to be reused")
		}
	})

	t.Run("acquire_tracks_active", func(t *testing.T) {
		p := NewPool("mock://test", 10, 5, 1*time.Second)
		defer p.Close()

		if p.ActiveCount() != 0 {
			t.Errorf("expected 0 active initially, got %d", p.ActiveCount())
		}

		conn, _ := p.Acquire(context.Background())
		if p.ActiveCount() != 1 {
			t.Errorf("expected 1 active, got %d", p.ActiveCount())
		}

		conn.Release()
		// Allow a moment for the release to process
		time.Sleep(10 * time.Millisecond)
	})
}

func TestPoolRelease(t *testing.T) {
	t.Run("release_returns_to_pool", func(t *testing.T) {
		p := NewPool("mock://test", 10, 5, 1*time.Second)
		defer p.Close()

		conn, _ := p.Acquire(context.Background())
		conn.Release()

		// Should be able to acquire again
		conn2, err := p.Acquire(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		conn2.Release()
	})

	t.Run("release_invalid_connection", func(t *testing.T) {
		p := NewPool("mock://test", 10, 5, 1*time.Second)
		defer p.Close()

		conn, _ := p.Acquire(context.Background())
		conn.client.closed = true
		conn.Release()
	})
}

func TestPoolExhausted(t *testing.T) {
	t.Run("wait_timeout_when_exhausted", func(t *testing.T) {
		p := NewPool("mock://test", 1, 1, 50*time.Millisecond)
		defer p.Close()

		conn, _ := p.Acquire(context.Background())
		defer conn.Release()

		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()

		_, err := p.Acquire(ctx)
		if err == nil {
			t.Fatal("expected error when pool exhausted")
		}
	})

	t.Run("context_cancel_while_waiting", func(t *testing.T) {
		p := NewPool("mock://test", 1, 1, 1*time.Hour)
		defer p.Close()

		conn, _ := p.Acquire(context.Background())
		defer conn.Release()

		ctx, cancel := context.WithCancel(context.Background())
		go func() {
			time.Sleep(50 * time.Millisecond)
			cancel()
		}()

		_, err := p.Acquire(ctx)
		if err == nil {
			t.Fatal("expected error after context cancel")
		}
	})

	t.Run("max_connections_enforced", func(t *testing.T) {
		created := int64(0)
		p := NewPool("mock://test", 3, 3, 100*time.Millisecond)
		p.factory = func() (*Client, error) {
			atomic.AddInt64(&created, 1)
			return &Client{endpoint: "mock"}, nil
		}
		defer p.Close()

		conns := make([]*PoolConn, 3)
		for i := 0; i < 3; i++ {
			conns[i], _ = p.Acquire(context.Background())
		}

		if created != 3 {
			t.Errorf("expected 3 created, got %d", created)
		}

		for _, c := range conns {
			c.Release()
		}
	})
}

func TestPoolConcurrent(t *testing.T) {
	t.Run("concurrent_acquire_release", func(t *testing.T) {
		p := NewPool("mock://test", 10, 10, 1*time.Second)
		p.factory = func() (*Client, error) {
			return &Client{endpoint: "mock"}, nil
		}
		defer p.Close()

		var wg sync.WaitGroup
		for i := 0; i < 50; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				conn, err := p.Acquire(context.Background())
				if err != nil {
					t.Errorf("unexpected error: %v", err)
					return
				}
				time.Sleep(1 * time.Millisecond)
				conn.Release()
			}()
		}
		wg.Wait()
	})

	t.Run("concurrent_stress_test", func(t *testing.T) {
		p := NewPool("mock://test", 5, 5, 1*time.Second)
		p.factory = func() (*Client, error) {
			return &Client{endpoint: "mock"}, nil
		}
		defer p.Close()

		var wg sync.WaitGroup
		errCount := int64(0)
		successCount := int64(0)

		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				conn, err := p.Acquire(context.Background())
				if err != nil {
					atomic.AddInt64(&errCount, 1)
					return
				}
				atomic.AddInt64(&successCount, 1)
				time.Sleep(1 * time.Millisecond)
				conn.Release()
			}()
		}
		wg.Wait()

		if successCount == 0 {
			t.Error("expected some successful acquisitions")
		}
	})
}

func TestPoolClose(t *testing.T) {
	t.Run("close_rejects_new_acquire", func(t *testing.T) {
		p := NewPool("mock://test", 10, 5, 1*time.Second)
		p.Close()

		_, err := p.Acquire(context.Background())
		if err == nil {
			t.Fatal("expected error after pool close")
		}
	})

	t.Run("close_is_idempotent", func(t *testing.T) {
		p := NewPool("mock://test", 10, 5, 1*time.Second)
		p.Close()
		err := p.Close()
		if err != nil {
			t.Fatalf("close should be idempotent: %v", err)
		}
	})
}
