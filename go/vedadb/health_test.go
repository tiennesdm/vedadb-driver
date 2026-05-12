// health_test.go — Health check tests for VedaDB Go driver
package vedadb

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// HealthChecker manages health check operations
type HealthChecker struct {
	mu          sync.RWMutex
	client      *http.Client
	endpoint    string
	isHealthy   bool
	lastCheck   time.Time
	checkInterval time.Duration
	consecutiveFails int
	failThreshold  int
	stopCh      chan struct{}
}

func NewHealthChecker(endpoint string, interval time.Duration, failThreshold int) *HealthChecker {
	return &HealthChecker{
		client:        &http.Client{Timeout: 5 * time.Second},
		endpoint:      endpoint + "/health",
		isHealthy:     true,
		checkInterval: interval,
		failThreshold: failThreshold,
		stopCh:        make(chan struct{}),
	}
}

func (hc *HealthChecker) IsHealthy() bool {
	hc.mu.RLock()
	defer hc.mu.RUnlock()
	return hc.isHealthy
}

func (hc *HealthChecker) Check(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, hc.endpoint, nil)
	if err != nil {
		hc.recordFailure()
		return err
	}

	resp, err := hc.client.Do(req)
	if err != nil {
		hc.recordFailure()
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		hc.recordFailure()
		return nil
	}

	hc.recordSuccess()
	return nil
}

func (hc *HealthChecker) recordSuccess() {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	hc.isHealthy = true
	hc.consecutiveFails = 0
	hc.lastCheck = time.Now()
}

func (hc *HealthChecker) recordFailure() {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	hc.consecutiveFails++
	hc.lastCheck = time.Now()
	if hc.consecutiveFails >= hc.failThreshold {
		hc.isHealthy = false
	}
}

func (hc *HealthChecker) Start() {
	go func() {
		ticker := time.NewTicker(hc.checkInterval)
		defer ticker.Stop()
		for {
			select {
			case <-hc.stopCh:
				return
			case <-ticker.C:
				hc.Check(context.Background())
			}
		}
	}()
}

func (hc *HealthChecker) Stop() {
	close(hc.stopCh)
}

func TestHealthCheckPass(t *testing.T) {
	t.Run("healthy_response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/health" {
				t.Errorf("expected /health path, got %s", r.URL.Path)
			}
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "healthy",
				"timestamp": time.Now().Unix(),
			})
		}))
		defer server.Close()

		hc := NewHealthChecker(server.URL, 1*time.Second, 3)
		err := hc.Check(context.Background())

		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if !hc.IsHealthy() {
			t.Error("expected healthy status")
		}
	})

	t.Run("consecutive_passes", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		hc := NewHealthChecker(server.URL, 1*time.Second, 3)

		for i := 0; i < 5; i++ {
			hc.Check(context.Background())
			if !hc.IsHealthy() {
				t.Fatalf("expected healthy after check %d", i)
			}
		}
	})

	t.Run("recovery_after_failure", func(t *testing.T) {
		failCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if failCount < 3 {
				failCount++
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		hc := NewHealthChecker(server.URL, 1*time.Second, 5)

		for i := 0; i < 3; i++ {
			hc.Check(context.Background())
		}
		if hc.IsHealthy() {
			t.Error("expected unhealthy after failures")
		}

		// Server recovers
		hc.Check(context.Background())
		if !hc.IsHealthy() {
			t.Error("expected healthy after recovery")
		}
	})

	t.Run("periodic_checks", func(t *testing.T) {
		checkCount := 0
		var mu sync.Mutex
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			checkCount++
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		hc := NewHealthChecker(server.URL, 50*time.Millisecond, 3)
		hc.Start()
		defer hc.Stop()

		time.Sleep(180 * time.Millisecond)

		mu.Lock()
		if checkCount < 2 {
			t.Errorf("expected at least 2 health checks, got %d", checkCount)
		}
		mu.Unlock()
	})
}

func TestHealthCheckFail(t *testing.T) {
	t.Run("server_returns_500", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		hc := NewHealthChecker(server.URL, 1*time.Second, 1)
		hc.Check(context.Background())

		if hc.IsHealthy() {
			t.Error("expected unhealthy after 500")
		}
	})

	t.Run("server_unreachable", func(t *testing.T) {
		hc := NewHealthChecker("http://localhost:59999", 1*time.Second, 1)
		err := hc.Check(context.Background())

		if err == nil {
			t.Fatal("expected error for unreachable server")
		}
		if hc.IsHealthy() {
			t.Error("expected unhealthy for unreachable server")
		}
	})

	t.Run("consecutive_failures_threshold", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		}))
		defer server.Close()

		hc := NewHealthChecker(server.URL, 1*time.Second, 3)

		// Should still be healthy after 2 failures
		hc.Check(context.Background())
		hc.Check(context.Background())
		if !hc.IsHealthy() {
			t.Error("expected still healthy after 2 failures (threshold=3)")
		}

		// Third failure should mark unhealthy
		hc.Check(context.Background())
		if hc.IsHealthy() {
			t.Error("expected unhealthy after 3 failures")
		}
	})

	t.Run("context_cancelled", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
				return
			case <-time.After(100 * time.Millisecond):
				w.WriteHeader(http.StatusOK)
			}
		}))
		defer server.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		defer cancel()

		hc := NewHealthChecker(server.URL, 1*time.Second, 1)
		err := hc.Check(ctx)

		if err == nil {
			t.Fatal("expected timeout error")
		}
	})

	t.Run("slow_response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(100 * time.Millisecond)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		hc := NewHealthChecker(server.URL, 1*time.Second, 1)
		hc.client = &http.Client{Timeout: 10 * time.Millisecond}

		err := hc.Check(context.Background())
		if err == nil {
			t.Fatal("expected timeout error")
		}
	})
}
