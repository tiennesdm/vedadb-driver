package vedadb

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Sentinel Support (Redis-Sentinel-style HA)
// ---------------------------------------------------------------------------

// SentinelNode represents a sentinel instance that monitors VedaDB nodes.
type SentinelNode struct {
	Name     string
	Host     string
	Port     int
	Priority int

	mu       sync.RWMutex
	client   *Client
	healthy  atomic.Bool
}

// IsHealthy reports whether the sentinel is reachable.
func (s *SentinelNode) IsHealthy() bool {
	return s.healthy.Load()
}

// SentinelMaster represents a monitored master node.
type SentinelMaster struct {
	Name           string
	Host           string
	Port           int
	Flags          string // "master", "slave", "s_down", "o_down"
	NumSlaves      int
	NumSentinels   int
	LastOkPing     time.Time
}

// SentinelSlave represents a monitored slave (replica) node.
type SentinelSlave struct {
	Name       string
	Host       string
	Port       int
	MasterName string
	Flags      string
	Priority   int
	Offset     int64
}

// Sentinel provides high-availability monitoring using sentinel nodes.
type Sentinel struct {
	sentinels       []*SentinelNode
	masterName      string
	checkInterval   time.Duration
	quorum          int // minimum sentinels that must agree

	mu              sync.RWMutex
	currentMaster   *SentinelMaster
	knownSlaves     []*SentinelSlave

	onMasterChange  func(old, new *SentinelMaster)
	onFailover      func()

	stopCh          chan struct{}
	running         atomic.Bool
}

// SentinelOption configures the sentinel.
type SentinelOption func(*Sentinel)

// WithCheckInterval sets the health check interval.
func WithCheckInterval(d time.Duration) SentinelOption {
	return func(s *Sentinel) {
		s.checkInterval = d
	}
}

// WithQuorum sets the required sentinel quorum.
func WithQuorum(q int) SentinelOption {
	return func(s *Sentinel) {
		s.quorum = q
	}
}

// NewSentinel creates a new sentinel monitor.
func NewSentinel(sentinels []*SentinelNode, masterName string, opts ...SentinelOption) *Sentinel {
	s := &Sentinel{
		sentinels:     sentinels,
		masterName:    masterName,
		checkInterval: 5 * time.Second,
		quorum:        len(sentinels)/2 + 1,
		stopCh:        make(chan struct{}),
		knownSlaves:   make([]*SentinelSlave, 0),
	}

	for _, opt := range opts {
		opt(s)
	}

	return s
}

// OnMasterChange sets a callback invoked when the master changes.
func (s *Sentinel) OnMasterChange(fn func(old, new *SentinelMaster)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onMasterChange = fn
}

// OnFailover sets a callback invoked on failover.
func (s *Sentinel) OnFailover(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onFailover = fn
}

// Start begins sentinel monitoring in a background goroutine.
func (s *Sentinel) Start(ctx context.Context) {
	if !s.running.CompareAndSwap(false, true) {
		return
	}

	// Initial discovery
	s.discover(ctx)

	// Start monitoring
	go s.monitor(ctx)
}

// Stop halts sentinel monitoring.
func (s *Sentinel) Stop() {
	if s.running.CompareAndSwap(true, false) {
		close(s.stopCh)
	}
}

// monitor runs the main monitoring loop.
func (s *Sentinel) monitor(ctx context.Context) {
	ticker := time.NewTicker(s.checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.checkSentinels(ctx)
			s.checkMaster(ctx)
			s.updateSlaves(ctx)
		}
	}
}

// discover performs initial discovery of the master and slaves.
func (s *Sentinel) discover(ctx context.Context) {
	// Ask each sentinel for the current master
	for _, sentinel := range s.sentinels {
		master, err := s.askSentinelForMaster(ctx, sentinel)
		if err == nil && master != nil {
			s.mu.Lock()
			oldMaster := s.currentMaster
			s.currentMaster = master
			s.mu.Unlock()

			if oldMaster != nil && (oldMaster.Host != master.Host || oldMaster.Port != master.Port) {
				s.mu.RLock()
				cb := s.onMasterChange
				s.mu.RUnlock()
				if cb != nil {
					go cb(oldMaster, master)
				}
			}
			break
		}
	}
}

// checkSentinels pings all sentinel instances.
func (s *Sentinel) checkSentinels(ctx context.Context) {
	for _, sentinel := range s.sentinels {
		var err error
		if sentinel.client != nil {
			err = sentinel.client.Ping(ctx)
		} else {
			// Try to connect
			cfg := DefaultConfig()
			cfg.Host = sentinel.Host
			cfg.Port = sentinel.Port
			sentinel.client, err = NewClient(cfg)
		}
		sentinel.healthy.Store(err == nil)
	}
}

// checkMaster verifies the current master is still healthy.
func (s *Sentinel) checkMaster(ctx context.Context) {
	s.mu.RLock()
	master := s.currentMaster
	s.mu.RUnlock()

	if master == nil {
		return
	}

	// Ping the master
	cfg := DefaultConfig()
	cfg.Host = master.Host
	cfg.Port = master.Port
	client, err := NewClient(cfg)
	if err != nil {
		s.handleMasterDown(ctx, master)
		return
	}
	defer client.Close()

	if err := client.Ping(ctx); err != nil {
		s.handleMasterDown(ctx, master)
	}
}

// handleMasterDown handles a master failure detection.
func (s *Sentinel) handleMasterDown(ctx context.Context, failedMaster *SentinelMaster) {
	// Check if enough sentinels agree the master is down
	agreeingSentinels := 0
	for _, sentinel := range s.sentinels {
		if !sentinel.IsHealthy() {
			continue
		}
		down, err := s.askSentinelIfMasterDown(ctx, sentinel, failedMaster.Name)
		if err == nil && down {
			agreeingSentinels++
		}
	}

	if agreeingSentinels < s.quorum {
		return // Not enough sentinels agree
	}

	// Initiate failover
	s.failover(ctx, failedMaster)
}

// failover promotes a slave to become the new master.
func (s *Sentinel) failover(ctx context.Context, failedMaster *SentinelMaster) {
	s.mu.RLock()
	slaves := make([]*SentinelSlave, len(s.knownSlaves))
	copy(slaves, s.knownSlaves)
	cb := s.onFailover
	s.mu.RUnlock()

	// Find the best slave to promote (lowest priority, highest offset)
	var bestSlave *SentinelSlave
	for _, slave := range slaves {
		if bestSlave == nil || slave.Priority < bestSlave.Priority {
			bestSlave = slave
		}
	}

	if bestSlave == nil {
		return // No slave available
	}

	newMaster := &SentinelMaster{
		Name:       failedMaster.Name,
		Host:       bestSlave.Host,
		Port:       bestSlave.Port,
		Flags:      "master",
		NumSlaves:  len(slaves) - 1,
		LastOkPing: time.Now(),
	}

	s.mu.Lock()
	oldMaster := s.currentMaster
	s.currentMaster = newMaster
	s.mu.Unlock()

	if cb != nil {
		go cb()
	}

	s.mu.RLock()
	mcb := s.onMasterChange
	s.mu.RUnlock()
	if mcb != nil && oldMaster != nil {
		go mcb(oldMaster, newMaster)
	}
}

// updateSlaves refreshes the list of known slaves.
func (s *Sentinel) updateSlaves(ctx context.Context) {
	s.mu.RLock()
	master := s.currentMaster
	s.mu.RUnlock()

	if master == nil {
		return
	}

	for _, sentinel := range s.sentinels {
		if !sentinel.IsHealthy() {
			continue
		}
		slaves, err := s.askSentinelForSlaves(ctx, sentinel, master.Name)
		if err == nil {
			s.mu.Lock()
			s.knownSlaves = slaves
			s.mu.Unlock()
			break
		}
	}
}

// askSentinelForMaster asks a sentinel for the current master address.
func (s *Sentinel) askSentinelForMaster(ctx context.Context, sentinel *SentinelNode) (*SentinelMaster, error) {
	cfg := DefaultConfig()
	cfg.Host = sentinel.Host
	cfg.Port = sentinel.Port
	client, err := NewClient(cfg)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	result, err := client.Query(ctx, "SENTINEL GET-MASTER-ADDR-BY-NAME", s.masterName)
	if err != nil {
		return nil, err
	}
	if len(result.Rows) == 0 {
		return nil, fmt.Errorf("no master found for %s", s.masterName)
	}

	host := ""
	port := 0
	if len(result.Rows[0]) > 0 {
		host = result.Rows[0][0]
	}
	if len(result.Rows[0]) > 1 {
		port, _ = strconv.Atoi(result.Rows[0][1])
	}

	return &SentinelMaster{
		Name:       s.masterName,
		Host:       host,
		Port:       port,
		Flags:      "master",
		LastOkPing: time.Now(),
	}, nil
}

// askSentinelIfMasterDown asks a sentinel if it thinks the master is down.
func (s *Sentinel) askSentinelIfMasterDown(ctx context.Context, sentinel *SentinelNode, masterName string) (bool, error) {
	cfg := DefaultConfig()
	cfg.Host = sentinel.Host
	cfg.Port = sentinel.Port
	client, err := NewClient(cfg)
	if err != nil {
		return false, err
	}
	defer client.Close()

	result, err := client.Query(ctx, "SENTINEL MASTER", masterName)
	if err != nil {
		return false, err
	}

	// Check flags for "s_down" or "o_down"
	for _, row := range result.Rows {
		for _, col := range row {
			if col == "s_down" || col == "o_down" || col == "master_down" {
				return true, nil
			}
		}
	}
	return false, nil
}

// askSentinelForSlaves asks a sentinel for the list of slaves.
func (s *Sentinel) askSentinelForSlaves(ctx context.Context, sentinel *SentinelNode, masterName string) ([]*SentinelSlave, error) {
	cfg := DefaultConfig()
	cfg.Host = sentinel.Host
	cfg.Port = sentinel.Port
	client, err := NewClient(cfg)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	result, err := client.Query(ctx, "SENTINEL SLAVES", masterName)
	if err != nil {
		return nil, err
	}

	slaves := make([]*SentinelSlave, 0, len(result.Rows))
	for _, row := range result.Rows {
		if len(row) < 2 {
			continue
		}
		host := row[0]
		port, _ := strconv.Atoi(row[1])
		slaves = append(slaves, &SentinelSlave{
			Host:       host,
			Port:       port,
			MasterName: masterName,
		})
	}

	return slaves, nil
}

// GetMaster returns the current master.
func (s *Sentinel) GetMaster() *SentinelMaster {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.currentMaster
}

// GetSlaves returns the current known slaves.
func (s *Sentinel) GetSlaves() []*SentinelSlave {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*SentinelSlave, len(s.knownSlaves))
	copy(result, s.knownSlaves)
	return result
}

// IsRunning reports whether the sentinel is running.
func (s *Sentinel) IsRunning() bool {
	return s.running.Load()
}

// SentinelStats holds sentinel statistics.
type SentinelStats struct {
	SentinelCount  int
	HealthyCount   int
	Master         *SentinelMaster
	SlaveCount     int
	Quorum         int
	IsRunning      bool
}

// Stats returns sentinel statistics.
func (s *Sentinel) Stats() SentinelStats {
	healthy := 0
	for _, sen := range s.sentinels {
		if sen.IsHealthy() {
			healthy++
		}
	}

	s.mu.RLock()
	master := s.currentMaster
	slaveCount := len(s.knownSlaves)
	s.mu.RUnlock()

	return SentinelStats{
		SentinelCount: len(s.sentinels),
		HealthyCount:  healthy,
		Master:        master,
		SlaveCount:    slaveCount,
		Quorum:        s.quorum,
		IsRunning:     s.IsRunning(),
	}
}
