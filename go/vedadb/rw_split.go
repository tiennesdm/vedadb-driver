package vedadb

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Read/Write Splitting
// ---------------------------------------------------------------------------

// NodeRole indicates whether a node is a read or write node.
type NodeRole int

const (
	// RoleReadWrite means the node handles both reads and writes.
	RoleReadWrite NodeRole = iota
	// RoleReadOnly means the node only handles reads.
	RoleReadOnly
	// RoleWriteOnly means the node only handles writes.
	RoleWriteOnly
)

func (r NodeRole) String() string {
	switch r {
	case RoleReadWrite:
		return "read-write"
	case RoleReadOnly:
		return "read-only"
	case RoleWriteOnly:
		return "write-only"
	default:
		return "unknown"
	}
}

// Node represents a database node with its role.
type Node struct {
	Name   string
	Client *Client
	Role   NodeRole
	Weight int // for load balancing among read replicas

	mu      sync.RWMutex
	healthy atomic.Bool
	latency atomic.Int64 // last ping latency in nanoseconds
}

// IsHealthy reports whether the node is healthy.
func (n *Node) IsHealthy() bool {
	return n.healthy.Load()
}

// Latency returns the last ping latency.
func (n *Node) Latency() int64 {
	return n.latency.Load()
}

// RWSplitter manages read/write splitting across multiple nodes.
type RWSplitter struct {
	mu sync.RWMutex

	writer   *Node              // primary write node
	readers  []*Node            // read replicas
	allNodes map[string]*Node   // all nodes by name

	readFromWriter bool // allow reads from writer if no readers available
	forceWrite     atomic.Bool
}

// RWSplitterOption configures the read/write splitter.
type RWSplitterOption func(*RWSplitter)

// WithReadFromWriter allows reads to fall back to the writer node.
func WithReadFromWriter() RWSplitterOption {
	return func(s *RWSplitter) {
		s.readFromWriter = true
	}
}

// NewRWSplitter creates a new read/write splitter.
func NewRWSplitter(writer *Node, readers []*Node, opts ...RWSplitterOption) *RWSplitter {
	s := &RWSplitter{
		writer:         writer,
		readers:        readers,
		allNodes:       make(map[string]*Node),
		readFromWriter: false,
	}

	s.allNodes[writer.Name] = writer
	for _, r := range readers {
		s.allNodes[r.Name] = r
	}

	for _, opt := range opts {
		opt(s)
	}
	return s
}

// Writer returns the write node.
func (s *RWSplitter) Writer() *Node {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.writer
}

// Readers returns all read replica nodes.
func (s *RWSplitter) Readers() []*Node {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*Node, len(s.readers))
	copy(result, s.readers)
	return result
}

// GetWriter returns the writer client for write operations.
func (s *RWSplitter) GetWriter() *Client {
	node := s.Writer()
	if node == nil {
		return nil
	}
	return node.Client
}

// GetReader returns a healthy read replica client.
// Uses round-robin selection among healthy readers.
func (s *RWSplitter) GetReader() *Client {
	s.mu.RLock()
	readers := make([]*Node, len(s.readers))
	copy(readers, s.readers)
	rw := s.readFromWriter
	writer := s.writer
	s.mu.RUnlock()

	// Find healthy readers
	healthyReaders := make([]*Node, 0, len(readers))
	for _, r := range readers {
		if r.IsHealthy() {
			healthyReaders = append(healthyReaders, r)
		}
	}

	if len(healthyReaders) > 0 {
		// Simple round-robin: pick based on time
		idx := int(timeNow().UnixNano()) % len(healthyReaders)
		return healthyReaders[idx].Client
	}

	// Fallback to writer if configured
	if rw && writer != nil && writer.IsHealthy() {
		return writer.Client
	}

	return nil
}

// Query executes a read query on a read replica.
func (s *RWSplitter) Query(ctx context.Context, sql string, args ...interface{}) (*Result, error) {
	client := s.GetReader()
	if client == nil {
		return nil, NewConnectionError("no healthy read node available")
	}
	return client.Query(ctx, sql, args...)
}

// Exec executes a write query on the writer node.
func (s *RWSplitter) Exec(ctx context.Context, sql string, args ...interface{}) (int64, error) {
	client := s.GetWriter()
	if client == nil {
		return 0, NewConnectionError("no writer node available")
	}
	return client.Exec(ctx, sql, args...)
}

// Execute routes the query based on whether it's a read or write.
func (s *RWSplitter) Execute(ctx context.Context, sql string, args ...interface{}) (*Result, error) {
	if isWriteQuery(sql) {
		_, err := s.Exec(ctx, sql, args...)
		if err != nil {
			return nil, err
		}
		return &Result{}, nil
	}
	return s.Query(ctx, sql, args...)
}

// HealthCheck pings all nodes and updates their health status.
func (s *RWSplitter) HealthCheck(ctx context.Context) {
	s.mu.RLock()
	nodes := make([]*Node, 0, len(s.allNodes))
	for _, n := range s.allNodes {
		nodes = append(nodes, n)
	}
	s.mu.RUnlock()

	var wg sync.WaitGroup
	for _, node := range nodes {
		wg.Add(1)
		go func(n *Node) {
			defer wg.Done()
			start := timeNow()
			err := n.Client.Ping(ctx)
			latency := timeSince(start)
			n.latency.Store(int64(latency))
			n.healthy.Store(err == nil)
		}(node)
	}
	wg.Wait()
}

// AddReader adds a new read replica.
func (s *RWSplitter) AddReader(node *Node) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.readers = append(s.readers, node)
	s.allNodes[node.Name] = node
}

// RemoveReader removes a read replica by name.
func (s *RWSplitter) RemoveReader(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]*Node, 0, len(s.readers))
	for _, r := range s.readers {
		if r.Name != name {
			filtered = append(filtered, r)
		}
	}
	s.readers = filtered
	delete(s.allNodes, name)
}

// Stats returns health stats for all nodes.
func (s *RWSplitter) Stats() map[string]NodeStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats := make(map[string]NodeStats, len(s.allNodes))
	for name, node := range s.allNodes {
		stats[name] = NodeStats{
			Name:    name,
			Role:    node.Role,
			Healthy: node.IsHealthy(),
			Latency: node.Latency(),
			Weight:  node.Weight,
		}
	}
	return stats
}

// NodeStats holds statistics for a node.
type NodeStats struct {
	Name    string
	Role    NodeRole
	Healthy bool
	Latency int64
	Weight  int
}

// isWriteQuery determines if a query is a write operation.
func isWriteQuery(sql string) bool {
	upper := strings.ToUpper(strings.TrimSpace(sql))
	return strings.HasPrefix(upper, "INSERT") ||
		strings.HasPrefix(upper, "UPDATE") ||
		strings.HasPrefix(upper, "DELETE") ||
		strings.HasPrefix(upper, "CREATE") ||
		strings.HasPrefix(upper, "DROP") ||
		strings.HasPrefix(upper, "ALTER") ||
		strings.HasPrefix(upper, "TRUNCATE") ||
		strings.HasPrefix(upper, "BEGIN") ||
		strings.HasPrefix(upper, "COMMIT") ||
		strings.HasPrefix(upper, "ROLLBACK")
}

// timeNow returns the current time (replaceable for testing).
var timeNow = func() time.Time {
	return time.Now()
}

// timeSince returns the duration since t (replaceable for testing).
var timeSince = func(t time.Time) time.Duration {
	return time.Since(t)
}
