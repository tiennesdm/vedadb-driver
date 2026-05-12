package vedadb

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// HealthStatus is the response from GET /v1/health.
// (Defined in protocol.go — kept here for reference.)

// HealthChecker performs periodic health checks on a Protocol instance.
type HealthChecker struct {
	CheckInterval time.Duration
	Timeout       time.Duration
	OnUnhealthy   func()
	OnHealthy     func()

	proto       *Protocol
	mu          sync.RWMutex
	healthy     atomic.Bool
	stopCh      chan struct{}
	stopped     atomic.Bool
	lastPing    atomic.Int64 // nanoseconds
	lastCheck   atomic.Int64 // Unix nanoseconds
}

// NewHealthChecker creates a new HealthChecker for the given Protocol.
func NewHealthChecker(proto *Protocol) *HealthChecker {
	h := &HealthChecker{
		CheckInterval: 10 * time.Second,
		Timeout:       5 * time.Second,
		proto:         proto,
		stopCh:        make(chan struct{}),
	}
	h.healthy.Store(true)
	return h
}

// NewHealthCheckerWithInterval creates a HealthChecker with custom interval/timeout.
func NewHealthCheckerWithInterval(proto *Protocol, checkInterval, timeout time.Duration) *HealthChecker {
	h := NewHealthChecker(proto)
	h.CheckInterval = checkInterval
	h.Timeout = timeout
	return h
}

// Start begins periodic health checks in a background goroutine.
func (h *HealthChecker) Start(ctx context.Context) {
	if h.stopped.Load() {
		return
	}

	go func() {
		ticker := time.NewTicker(h.CheckInterval)
		defer ticker.Stop()

		// Initial check
		h.check()

		for {
			select {
			case <-ctx.Done():
				return
			case <-h.stopCh:
				return
			case <-ticker.C:
				h.check()
			}
		}
	}()
}

// Stop halts the health checker.
func (h *HealthChecker) Stop() {
	if h.stopped.CompareAndSwap(false, true) {
		close(h.stopCh)
	}
}

// IsHealthy reports whether the last health check passed.
func (h *HealthChecker) IsHealthy() bool {
	return h.healthy.Load()
}

// LastPing returns the round-trip duration of the last health check.
func (h *HealthChecker) LastPing() time.Duration {
	return time.Duration(h.lastPing.Load())
}

// LastCheck returns the timestamp of the last health check.
func (h *HealthChecker) LastCheck() time.Time {
	ns := h.lastCheck.Load()
	if ns == 0 {
		return time.Time{}
	}
	return time.Unix(0, ns)
}

// Uptime returns the duration since the last successful health check.
func (h *HealthChecker) Uptime() time.Duration {
	if !h.IsHealthy() {
		return 0
	}
	return time.Since(h.LastCheck())
}

func (h *HealthChecker) check() {
	start := time.Now()

	checkCtx, cancel := context.WithTimeout(context.Background(), h.Timeout)
	defer cancel()

	// Use Ping through a channel to respect context cancellation
	done := make(chan struct{})
	var pingErr error

	go func() {
		defer close(done)
		pingErr = h.proto.Ping()
	}()

	select {
	case <-checkCtx.Done():
		h.updateHealth(false, time.Since(start))
		return
	case <-done:
		h.updateHealth(pingErr == nil, time.Since(start))
	}
}

func (h *HealthChecker) updateHealth(healthy bool, ping time.Duration) {
	h.lastPing.Store(int64(ping))
	h.lastCheck.Store(time.Now().UnixNano())

	wasHealthy := h.healthy.Load()
	h.healthy.Store(healthy)

	if wasHealthy && !healthy {
		h.mu.RLock()
		cb := h.OnUnhealthy
		h.mu.RUnlock()
		if cb != nil {
			go cb()
		}
	}
	if !wasHealthy && healthy {
		h.mu.RLock()
		cb := h.OnHealthy
		h.mu.RUnlock()
		if cb != nil {
			go cb()
		}
	}
}
