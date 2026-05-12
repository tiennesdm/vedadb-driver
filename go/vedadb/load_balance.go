package vedadb

import (
	"context"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Load Balancer
// ---------------------------------------------------------------------------

// LoadBalancerStrategy defines the load balancing algorithm.
type LoadBalancerStrategy int

const (
	// RoundRobin cycles through nodes in order.
	RoundRobin LoadBalancerStrategy = iota
	// Random selects a random healthy node.
	Random
	// LeastConnections selects the node with fewest active connections.
	LeastConnections
	// WeightedRoundRobin considers node weights.
	WeightedRoundRobin
	// LatencyBased selects the node with lowest latency.
	LatencyBased
)

func (s LoadBalancerStrategy) String() string {
	switch s {
	case RoundRobin:
		return "round-robin"
	case Random:
		return "random"
	case LeastConnections:
		return "least-connections"
	case WeightedRoundRobin:
		return "weighted-round-robin"
	case LatencyBased:
		return "latency-based"
	default:
		return "unknown"
	}
}

// BalancedNode represents a node in the load balancer.
type BalancedNode struct {
	*Node
	activeConns atomic.Int64
}

// LoadBalancer distributes queries across multiple nodes.
type LoadBalancer struct {
	strategy LoadBalancerStrategy
	nodes    []*BalancedNode

	mu          sync.RWMutex
	currentIdx  atomic.Int64 // for round-robin
	weights     []int        // cumulative weights for weighted round-robin
	healthCheck *HealthChecker
}

// LoadBalancerOption configures the load balancer.
type LoadBalancerOption func(*LoadBalancer)

// WithStrategy sets the load balancing strategy.
func WithStrategy(s LoadBalancerStrategy) LoadBalancerOption {
	return func(lb *LoadBalancer) {
		lb.strategy = s
	}
}

// NewLoadBalancer creates a new load balancer.
func NewLoadBalancer(nodes []*BalancedNode, opts ...LoadBalancerOption) *LoadBalancer {
	lb := &LoadBalancer{
		strategy: RoundRobin,
		nodes:    nodes,
		weights:  make([]int, len(nodes)),
	}

	// Build cumulative weights
	total := 0
	for i, n := range nodes {
		total += n.Weight
		if total == 0 {
			total = 1 // minimum weight
		}
		lb.weights[i] = total
	}

	for _, opt := range opts {
		opt(lb)
	}
	return lb
}

// Pick returns the next node based on the configured strategy.
func (lb *LoadBalancer) Pick() *BalancedNode {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	switch lb.strategy {
	case Random:
		return lb.pickRandom()
	case LeastConnections:
		return lb.pickLeastConns()
	case WeightedRoundRobin:
		return lb.pickWeighted()
	case LatencyBased:
		return lb.pickLowestLatency()
	default:
		return lb.pickRoundRobin()
	}
}

// pickRoundRobin selects the next node in round-robin order.
func (lb *LoadBalancer) pickRoundRobin() *BalancedNode {
	healthy := lb.healthyNodes()
	if len(healthy) == 0 {
		return nil
	}
	idx := int(lb.currentIdx.Add(1)) % len(healthy)
	return healthy[idx]
}

// pickRandom selects a random healthy node.
func (lb *LoadBalancer) pickRandom() *BalancedNode {
	healthy := lb.healthyNodes()
	if len(healthy) == 0 {
		return nil
	}
	return healthy[rand.Intn(len(healthy))]
}

// pickLeastConns selects the node with fewest active connections.
func (lb *LoadBalancer) pickLeastConns() *BalancedNode {
	healthy := lb.healthyNodes()
	if len(healthy) == 0 {
		return nil
	}

	var best *BalancedNode
	minConns := int64(-1)
	for _, n := range healthy {
		conns := n.activeConns.Load()
		if minConns == -1 || conns < minConns {
			minConns = conns
			best = n
		}
	}
	return best
}

// pickWeighted selects a node using weighted round-robin.
func (lb *LoadBalancer) pickWeighted() *BalancedNode {
	healthy := lb.healthyNodes()
	if len(healthy) == 0 {
		return nil
	}

	// Simple weighted selection
	totalWeight := 0
	for _, n := range healthy {
		w := n.Weight
		if w <= 0 {
			w = 1
		}
		totalWeight += w
	}

	pick := rand.Intn(totalWeight)
	current := 0
	for _, n := range healthy {
		w := n.Weight
		if w <= 0 {
			w = 1
		}
		current += w
		if pick < current {
			return n
		}
	}
	return healthy[0]
}

// pickLowestLatency selects the node with the lowest latency.
func (lb *LoadBalancer) pickLowestLatency() *BalancedNode {
	healthy := lb.healthyNodes()
	if len(healthy) == 0 {
		return nil
	}

	var best *BalancedNode
	minLatency := int64(-1)
	for _, n := range healthy {
		lat := n.Latency()
		if lat == 0 {
			lat = 999999999 // unknown latency -> deprioritize
		}
		if minLatency == -1 || lat < minLatency {
			minLatency = lat
			best = n
		}
	}
	return best
}

// healthyNodes returns all currently healthy nodes.
func (lb *LoadBalancer) healthyNodes() []*BalancedNode {
	healthy := make([]*BalancedNode, 0, len(lb.nodes))
	for _, n := range lb.nodes {
		if n.IsHealthy() {
			healthy = append(healthy, n)
		}
	}
	return healthy
}

// Acquire returns a node and increments its active connection count.
func (lb *LoadBalancer) Acquire() *BalancedNode {
	node := lb.Pick()
	if node != nil {
		node.activeConns.Add(1)
	}
	return node
}

// Release decrements a node's active connection count.
func (lb *LoadBalancer) Release(node *BalancedNode) {
	if node != nil {
		node.activeConns.Add(-1)
	}
}

// Query executes a query on a load-balanced node.
func (lb *LoadBalancer) Query(ctx context.Context, sql string, args ...interface{}) (*Result, error) {
	node := lb.Acquire()
	if node == nil {
		return nil, NewConnectionError("no healthy nodes available")
	}
	defer lb.Release(node)

	return node.Client.Query(ctx, sql, args...)
}

// Exec executes a statement on a load-balanced node.
func (lb *LoadBalancer) Exec(ctx context.Context, sql string, args ...interface{}) (int64, error) {
	node := lb.Acquire()
	if node == nil {
		return 0, NewConnectionError("no healthy nodes available")
	}
	defer lb.Release(node)

	return node.Client.Exec(ctx, sql, args...)
}

// AddNode adds a node to the load balancer.
func (lb *LoadBalancer) AddNode(node *BalancedNode) {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	lb.nodes = append(lb.nodes, node)
}

// RemoveNode removes a node by name.
func (lb *LoadBalancer) RemoveNode(name string) {
	lb.mu.Lock()
	defer lb.mu.Unlock()

	filtered := make([]*BalancedNode, 0, len(lb.nodes))
	for _, n := range lb.nodes {
		if n.Name != name {
			filtered = append(filtered, n)
		}
	}
	lb.nodes = filtered
}

// NodeCount returns the total number of nodes.
func (lb *LoadBalancer) NodeCount() int {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	return len(lb.nodes)
}

// HealthyNodeCount returns the number of healthy nodes.
func (lb *LoadBalancer) HealthyNodeCount() int {
	return len(lb.healthyNodes())
}

// Stats returns load balancer statistics.
func (lb *LoadBalancer) Stats() LoadBalancerStats {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	totalConns := int64(0)
	nodeStats := make([]NodeStats, 0, len(lb.nodes))
	for _, n := range lb.nodes {
		conns := n.activeConns.Load()
		totalConns += conns
		nodeStats = append(nodeStats, NodeStats{
			Name:         n.Name,
			Role:         n.Role,
			Healthy:      n.IsHealthy(),
			Latency:      n.Latency(),
			Weight:       n.Weight,
			ActiveConns:  conns,
		})
	}

	return LoadBalancerStats{
		Strategy:         lb.strategy.String(),
		TotalNodes:       len(lb.nodes),
		HealthyNodes:     lb.HealthyNodeCount(),
		TotalConnections: totalConns,
		NodeStats:        nodeStats,
	}
}

// LoadBalancerStats holds load balancer statistics.
type LoadBalancerStats struct {
	Strategy         string
	TotalNodes       int
	HealthyNodes     int
	TotalConnections int64
	NodeStats        []NodeStats
}

// WaitForHealthy blocks until at least minHealthy nodes are healthy or context is cancelled.
func (lb *LoadBalancer) WaitForHealthy(ctx context.Context, minHealthy int) error {
	if minHealthy <= 0 {
		minHealthy = 1
	}
	for {
		if lb.HealthyNodeCount() >= minHealthy {
			return nil
		}
		select {
		case <-ctx.Done():
			return context.Cause(ctx)
		case <-time.After(100 * time.Millisecond):
		}
	}
}
