package vedadb

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Multi-Node Failover
// ---------------------------------------------------------------------------

// FailoverStrategy defines the failover behavior.
type FailoverStrategy int

const (
	// FailoverSequential tries nodes in order.
	FailoverSequential FailoverStrategy = iota
	// FailoverRandom picks a random node on failover.
	FailoverRandom
	// FailoverPriority uses priority-weighted selection.
	FailoverPriority
)

func (s FailoverStrategy) String() string {
	switch s {
	case FailoverSequential:
		return "sequential"
	case FailoverRandom:
		return "random"
	case FailoverPriority:
		return "priority"
	default:
		return "unknown"
	}
}

// FailoverNode represents a node in the failover cluster.
type FailoverNode struct {
	Name     string
	Client   *Client
	Config   Config
	Priority int // lower = higher priority for sequential
	MaxRetries int

	mu       sync.RWMutex
	healthy  atomic.Bool
	failures atomic.Int64
}

// IsHealthy reports whether the node is healthy.
func (n *FailoverNode) IsHealthy() bool {
	return n.healthy.Load()
}

// RecordFailure records a failure on this node.
func (n *FailoverNode) RecordFailure() {
	n.failures.Add(1)
}

// ResetFailures resets the failure count.
func (n *FailoverNode) ResetFailures() {
	n.failures.Store(0)
}

// FailoverManager manages connections to multiple VedaDB nodes with automatic failover.
type FailoverManager struct {
	nodes        []*FailoverNode
	strategy     FailoverStrategy
	maxRetries   int
	retryDelay   time.Duration
	healthInterval time.Duration

	mu           sync.RWMutex
	currentIdx   atomic.Int32
	onFailover   func(from, to string)
	onAllFailed  func(error)

	stopCh       chan struct{}
}

// FailoverOption configures the failover manager.
type FailoverOption func(*FailoverManager)

// WithFailoverStrategy sets the failover strategy.
func WithFailoverStrategy(s FailoverStrategy) FailoverOption {
	return func(fm *FailoverManager) {
		fm.strategy = s
	}
}

// WithMaxRetries sets the maximum retry attempts per node.
func WithMaxRetries(n int) FailoverOption {
	return func(fm *FailoverManager) {
		fm.maxRetries = n
	}
}

// WithRetryDelay sets the delay between retry attempts.
func WithRetryDelay(d time.Duration) FailoverOption {
	return func(fm *FailoverManager) {
		fm.retryDelay = d
	}
}

// WithHealthInterval sets the health check interval.
func WithHealthInterval(d time.Duration) FailoverOption {
	return func(fm *FailoverManager) {
		fm.healthInterval = d
	}
}

// NewFailoverManager creates a new failover manager.
func NewFailoverManager(nodes []*FailoverNode, opts ...FailoverOption) *FailoverManager {
	fm := &FailoverManager{
		nodes:          nodes,
		strategy:       FailoverSequential,
		maxRetries:     3,
		retryDelay:     1 * time.Second,
		healthInterval: 10 * time.Second,
		stopCh:         make(chan struct{}),
	}

	for _, opt := range opts {
		opt(fm)
	}

	// Mark all nodes as healthy initially
	for _, n := range nodes {
		n.healthy.Store(true)
	}

	return fm
}

// OnFailover sets a callback invoked when failover occurs.
func (fm *FailoverManager) OnFailover(fn func(from, to string)) {
	fm.mu.Lock()
	defer fm.mu.Unlock()
	fm.onFailover = fn
}

// OnAllFailed sets a callback invoked when all nodes fail.
func (fm *FailoverManager) OnAllFailed(fn func(error)) {
	fm.mu.Lock()
	defer fm.mu.Unlock()
	fm.onAllFailed = fn
}

// Start begins health checking in a background goroutine.
func (fm *FailoverManager) Start(ctx context.Context) {
	go fm.healthChecker(ctx)
}

// Stop halts the failover manager.
func (fm *FailoverManager) Stop() {
	close(fm.stopCh)
}

// healthChecker periodically pings all nodes.
func (fm *FailoverManager) healthChecker(ctx context.Context) {
	ticker := time.NewTicker(fm.healthInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-fm.stopCh:
			return
		case <-ticker.C:
			fm.checkAllNodes(ctx)
		}
	}
}

// checkAllNodes pings all nodes and updates their health status.
func (fm *FailoverManager) checkAllNodes(ctx context.Context) {
	fm.mu.RLock()
	nodes := make([]*FailoverNode, len(fm.nodes))
	copy(nodes, fm.nodes)
	fm.mu.RUnlock()

	var wg sync.WaitGroup
	for _, node := range nodes {
		wg.Add(1)
		go func(n *FailoverNode) {
			defer wg.Done()
			err := n.Client.Ping(ctx)
			wasHealthy := n.IsHealthy()
			isHealthy := err == nil
			n.healthy.Store(isHealthy)

			if wasHealthy && !isHealthy {
				n.RecordFailure()
			}
			if !wasHealthy && isHealthy {
				n.ResetFailures()
			}
		}(node)
	}
	wg.Wait()
}

// GetPrimary returns the highest priority healthy node.
func (fm *FailoverManager) GetPrimary() *FailoverNode {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	for _, n := range fm.nodes {
		if n.IsHealthy() {
			return n
		}
	}
	return nil
}

// GetHealthyNodes returns all healthy nodes.
func (fm *FailoverManager) GetHealthyNodes() []*FailoverNode {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	healthy := make([]*FailoverNode, 0)
	for _, n := range fm.nodes {
		if n.IsHealthy() {
			healthy = append(healthy, n)
		}
	}
	return healthy
}

// Execute runs a function on the primary node with failover.
func (fm *FailoverManager) Execute(ctx context.Context, fn func(*Client) error) error {
	var lastErr error
	attempted := make(map[string]bool)

	for attempt := 0; attempt <= fm.maxRetries; attempt++ {
		node := fm.selectNode(attempted)
		if node == nil {
			// All nodes exhausted, trigger callback
			fm.mu.RLock()
			cb := fm.onAllFailed
			fm.mu.RUnlock()
			if cb != nil {
				cb(lastErr)
			}
			return fmt.Errorf("all nodes failed: %w", lastErr)
		}

		attempted[node.Name] = true
		err := fn(node.Client)
		if err == nil {
			return nil
		}

		lastErr = err
		node.RecordFailure()

		// Notify failover
		nextNode := fm.selectNode(attempted)
		if nextNode != nil {
			fm.mu.RLock()
			cb := fm.onFailover
			fm.mu.RUnlock()
			if cb != nil {
				go cb(node.Name, nextNode.Name)
			}
		}

		if fm.retryDelay > 0 {
			select {
			case <-ctx.Done():
				return context.Cause(ctx)
			case <-time.After(fm.retryDelay):
			}
		}
	}

	return lastErr
}

// Query executes a query with failover support.
func (fm *FailoverManager) Query(ctx context.Context, sql string, args ...interface{}) (*Result, error) {
	var result *Result
	err := fm.Execute(ctx, func(client *Client) error {
		var err error
		result, err = client.Query(ctx, sql, args...)
		return err
	})
	return result, err
}

// Exec executes a statement with failover support.
func (fm *FailoverManager) Exec(ctx context.Context, sql string, args ...interface{}) (int64, error) {
	var affected int64
	err := fm.Execute(ctx, func(client *Client) error {
		var err error
		affected, err = client.Exec(ctx, sql, args...)
		return err
	})
	return affected, err
}

// selectNode picks the next node to try based on the strategy.
func (fm *FailoverManager) selectNode(excluded map[string]bool) *FailoverNode {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	switch fm.strategy {
	case FailoverRandom:
		return fm.selectRandom(excluded)
	case FailoverPriority:
		return fm.selectPriority(excluded)
	default:
		return fm.selectSequential(excluded)
	}
}

func (fm *FailoverManager) selectSequential(excluded map[string]bool) *FailoverNode {
	for _, n := range fm.nodes {
		if excluded[n.Name] {
			continue
		}
		return n
	}
	return nil
}

func (fm *FailoverManager) selectRandom(excluded map[string]bool) *FailoverNode {
	candidates := make([]*FailoverNode, 0)
	for _, n := range fm.nodes {
		if !excluded[n.Name] {
			candidates = append(candidates, n)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	// Simple selection; in production use crypto/rand
	idx := int(time.Now().UnixNano()) % len(candidates)
	return candidates[idx]
}

func (fm *FailoverManager) selectPriority(excluded map[string]bool) *FailoverNode {
	var best *FailoverNode
	bestPriority := -1
	for _, n := range fm.nodes {
		if excluded[n.Name] {
			continue
		}
		if best == nil || n.Priority < bestPriority {
			best = n
			bestPriority = n.Priority
		}
	}
	return best
}

// NodeCount returns the total number of nodes.
func (fm *FailoverManager) NodeCount() int {
	fm.mu.RLock()
	defer fm.mu.RUnlock()
	return len(fm.nodes)
}

// HealthyNodeCount returns the number of healthy nodes.
func (fm *FailoverManager) HealthyNodeCount() int {
	return len(fm.GetHealthyNodes())
}

// Stats returns failover statistics.
func (fm *FailoverManager) Stats() FailoverStats {
	fm.mu.RLock()
	defer fm.mu.RUnlock()

	nodeStats := make([]NodeHealth, 0, len(fm.nodes))
	for _, n := range fm.nodes {
		nodeStats = append(nodeStats, NodeHealth{
			Name:     n.Name,
			Healthy:  n.IsHealthy(),
			Failures: n.failures.Load(),
			Priority: n.Priority,
		})
	}

	return FailoverStats{
		TotalNodes:    len(fm.nodes),
		HealthyNodes:  fm.HealthyNodeCount(),
		Strategy:      fm.strategy.String(),
		NodeStats:     nodeStats,
	}
}

// FailoverStats holds failover statistics.
type FailoverStats struct {
	TotalNodes   int
	HealthyNodes int
	Strategy     string
	NodeStats    []NodeHealth
}

// NodeHealth holds health information for a node.
type NodeHealth struct {
	Name     string
	Healthy  bool
	Failures int64
	Priority int
}
