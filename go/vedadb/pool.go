package vedadb

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Connection Pool
// ---------------------------------------------------------------------------

// PoolStats holds pool statistics.
type PoolStats struct {
	TotalConns     int
	IdleConns      int
	ActiveConns    int
	WaitCount      int64
	WaitDuration   time.Duration
	MaxLifetime    time.Duration
	HealthFailures int64
}

// Pool manages a pool of Protocol connections with health checks.
type Pool struct {
	config     Config
	maxConns   int
	maxIdle    int
	maxLifetime time.Duration
	healthCheckInterval time.Duration
	idleTimeout time.Duration

	mu        sync.RWMutex
	conns     []*PooledConn
	idle      chan *PooledConn
	waiting   int32 // number of goroutines waiting for a connection

	closed    atomic.Bool
	stopCh    chan struct{}

	// Stats
	waitCount    atomic.Int64
	waitDuration atomic.Int64
	healthFails  atomic.Int64

	// Hooks
	onGet       func()
	onPut       func()
	onEvict     func(error)
	healthCheck func(*Protocol) error
}

// PooledConn wraps a Protocol with pool metadata.
type PooledConn struct {
	*Protocol
	pool        *Pool
	createdAt   time.Time
	lastUsedAt  time.Time
	inUse       atomic.Bool
	useCount    atomic.Int64
}

// NewPool creates a new connection pool.
func NewPool(cfg Config, maxConns int) *Pool {
	if maxConns <= 0 {
		maxConns = 10
	}
	p := &Pool{
		config:              cfg,
		maxConns:            maxConns,
		maxIdle:             maxConns,
		maxLifetime:         1 * time.Hour,
		healthCheckInterval: 30 * time.Second,
		idleTimeout:         10 * time.Minute,
		stopCh:              make(chan struct{}),
		idle:                make(chan *PooledConn, maxConns),
		conns:               make([]*PooledConn, 0, maxConns),
	}
	p.healthCheck = defaultHealthCheck
	return p
}

// NewPoolWithOptions creates a pool with detailed options.
func NewPoolWithOptions(cfg Config, maxConns, maxIdle int, maxLifetime, idleTimeout, healthCheckInterval time.Duration) *Pool {
	p := NewPool(cfg, maxConns)
	p.maxIdle = maxIdle
	p.maxLifetime = maxLifetime
	p.idleTimeout = idleTimeout
	p.healthCheckInterval = healthCheckInterval
	return p
}

// defaultHealthCheck performs a basic ping health check.
func defaultHealthCheck(proto *Protocol) error {
	return proto.Ping()
}

// SetHealthCheck sets the health check function.
func (p *Pool) SetHealthCheck(fn func(*Protocol) error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.healthCheck = fn
}

// Start begins background health check and eviction goroutines.
func (p *Pool) Start(ctx context.Context) {
	go p.maintainer(ctx)
}

// maintainer runs background tasks: health checks and idle eviction.
func (p *Pool) maintainer(ctx context.Context) {
	ticker := time.NewTicker(p.healthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-p.stopCh:
			return
		case <-ticker.C:
			p.checkHealth()
			p.evictIdle()
			p.evictExpired()
		}
	}
}

// checkHealth pings all idle connections and removes unhealthy ones.
func (p *Pool) checkHealth() {
	p.mu.Lock()
	conns := make([]*PooledConn, len(p.conns))
	copy(conns, p.conns)
	p.mu.Unlock()

	for _, c := range conns {
		if c.inUse.Load() {
			continue
		}
		if err := p.healthCheck(c.Protocol); err != nil {
			p.healthFails.Add(1)
			p.removeConn(c)
			c.Protocol.Close()
		}
	}
}

// evictIdle removes connections idle longer than idleTimeout.
func (p *Pool) evictIdle() {
	p.mu.Lock()
	defer p.mu.Unlock()

	cutoff := time.Now().Add(-p.idleTimeout)
	kept := p.conns[:0]
	for _, c := range p.conns {
		if c.inUse.Load() || c.lastUsedAt.After(cutoff) {
			kept = append(kept, c)
			continue
		}
		go c.Protocol.Close()
	}
	p.conns = kept
}

// evictExpired removes connections older than maxLifetime.
func (p *Pool) evictExpired() {
	p.mu.Lock()
	defer p.mu.Unlock()

	cutoff := time.Now().Add(-p.maxLifetime)
	kept := p.conns[:0]
	for _, c := range p.conns {
		if c.inUse.Load() || c.createdAt.After(cutoff) {
			kept = append(kept, c)
			continue
		}
		go c.Protocol.Close()
	}
	p.conns = kept
}

// Get acquires a connection from the pool.
func (p *Pool) Get(ctx context.Context) (*PooledConn, error) {
	if p.closed.Load() {
		return nil, NewPoolError("pool is closed")
	}

	// Fast path: try idle channel
	select {
	case c := <-p.idle:
		if c.isValid() {
			c.inUse.Store(true)
			c.lastUsedAt = time.Now()
			c.useCount.Add(1)
			return c, nil
		}
		// Invalid connection, discard and try again
		p.removeConn(c)
		c.Protocol.Close()
	default:
	}

	// Medium path: create new if under limit
	p.mu.Lock()
	if len(p.conns) < p.maxConns {
		p.mu.Unlock()
		c, err := p.createConn()
		if err != nil {
			return nil, err
		}
		return c, nil
	}
	p.mu.Unlock()

	// Slow path: wait for a connection to become available
	start := time.Now()
	p.waitCount.Add(1)
	atomic.AddInt32(&p.waiting, 1)
	defer atomic.AddInt32(&p.waiting, -1)

	for {
		select {
		case c := <-p.idle:
			p.waitDuration.Add(int64(time.Since(start)))
			if c.isValid() {
				c.inUse.Store(true)
				c.lastUsedAt = time.Now()
				c.useCount.Add(1)
				return c, nil
			}
			p.removeConn(c)
			c.Protocol.Close()
		case <-ctx.Done():
			p.waitDuration.Add(int64(time.Since(start)))
			return nil, context.Cause(ctx)
		case <-p.stopCh:
			p.waitDuration.Add(int64(time.Since(start)))
			return nil, NewPoolError("pool is closed")
		case <-time.After(100 * time.Millisecond):
			// Retry
		}
	}
}

// Put returns a connection to the pool.
func (p *Pool) Put(c *PooledConn) {
	if c == nil || c.pool != p {
		return
	}
	if p.closed.Load() {
		c.Protocol.Close()
		return
	}

	c.inUse.Store(false)
	c.lastUsedAt = time.Now()

	select {
	case p.idle <- c:
		// Returned to idle pool
	default:
		// Idle pool is full, close connection
		p.removeConn(c)
		c.Protocol.Close()
	}
}

// createConn creates a new pooled connection.
func (p *Pool) createConn() (*PooledConn, error) {
	proto, err := NewProtocol(p.config)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	c := &PooledConn{
		Protocol:   proto,
		pool:       p,
		createdAt:  now,
		lastUsedAt: now,
	}
	c.inUse.Store(true)

	p.mu.Lock()
	p.conns = append(p.conns, c)
	p.mu.Unlock()

	return c, nil
}

// removeConn removes a connection from the pool's tracking.
func (p *Pool) removeConn(c *PooledConn) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for i, conn := range p.conns {
		if conn == c {
			p.conns = append(p.conns[:i], p.conns[i+1:]...)
			return
		}
	}
}

// isValid checks if the pooled connection is still usable.
func (c *PooledConn) isValid() bool {
	return c.Protocol != nil
}

// Age returns the age of the connection.
func (c *PooledConn) Age() time.Duration {
	return time.Since(c.createdAt)
}

// IdleTime returns how long the connection has been idle.
func (c *PooledConn) IdleTime() time.Duration {
	return time.Since(c.lastUsedAt)
}

// UseCount returns the number of times this connection has been used.
func (c *PooledConn) UseCount() int64 {
	return c.useCount.Load()
}

// Stats returns pool statistics.
func (p *Pool) Stats() PoolStats {
	p.mu.RLock()
	total := len(p.conns)
	p.mu.RUnlock()

	idle := len(p.idle)

	return PoolStats{
		TotalConns:     total,
		IdleConns:      idle,
		ActiveConns:    total - idle,
		WaitCount:      p.waitCount.Load(),
		WaitDuration:   time.Duration(p.waitDuration.Load()),
		MaxLifetime:    p.maxLifetime,
		HealthFailures: p.healthFails.Load(),
	}
}

// Close closes the pool and all connections.
func (p *Pool) Close() error {
	if !p.closed.CompareAndSwap(false, true) {
		return nil
	}
	close(p.stopCh)

	p.mu.Lock()
	conns := make([]*PooledConn, len(p.conns))
	copy(conns, p.conns)
	p.conns = p.conns[:0]
	p.mu.Unlock()

	for _, c := range conns {
		c.Protocol.Close()
	}

	// Drain idle channel
	close(p.idle)
	for c := range p.idle {
		c.Protocol.Close()
	}

	return nil
}
