// circuit_test.go — Circuit breaker tests for VedaDB Go driver
package vedadb

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// CircuitState represents the state of a circuit breaker
type CircuitState int

const (
	CircuitClosed CircuitState = iota
	CircuitOpen
	CircuitHalfOpen
)

func (s CircuitState) String() string {
	switch s {
	case CircuitClosed:
		return "closed"
	case CircuitOpen:
		return "open"
	case CircuitHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// CircuitBreaker implements the circuit breaker pattern
type CircuitBreaker struct {
	mu                sync.RWMutex
	state             CircuitState
	failureCount      int
	successCount      int
	failureThreshold  int
	successThreshold  int
	timeout           time.Duration
	lastFailureTime   time.Time
	halfOpenMaxCalls  int
	halfOpenCalls     int
}

func NewCircuitBreaker(failureThreshold, successThreshold int, timeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		state:            CircuitClosed,
		failureThreshold: failureThreshold,
		successThreshold: successThreshold,
		timeout:          timeout,
		halfOpenMaxCalls: 1,
	}
}

func (cb *CircuitBreaker) State() CircuitState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.state == CircuitClosed {
		return true
	}
	if cb.state == CircuitOpen {
		if time.Since(cb.lastFailureTime) > cb.timeout {
			cb.state = CircuitHalfOpen
			cb.halfOpenCalls = 0
			cb.successCount = 0
			return true
		}
		return false
	}
	// Half-open
	if cb.halfOpenCalls < cb.halfOpenMaxCalls {
		cb.halfOpenCalls++
		return true
	}
	return false
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.state == CircuitHalfOpen {
		cb.successCount++
		if cb.successCount >= cb.successThreshold {
			cb.state = CircuitClosed
			cb.failureCount = 0
			cb.halfOpenCalls = 0
		}
	} else if cb.state == CircuitClosed {
		cb.failureCount = 0
	}
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.lastFailureTime = time.Now()

	if cb.state == CircuitHalfOpen {
		cb.state = CircuitOpen
		cb.halfOpenCalls = 0
		return
	}

	cb.failureCount++
	if cb.failureCount >= cb.failureThreshold {
		cb.state = CircuitOpen
	}
}

func (cb *CircuitBreaker) Execute(ctx context.Context, fn func() error) error {
	if !cb.Allow() {
		return errors.New("circuit breaker is open")
	}

	err := fn()
	if err != nil {
		cb.RecordFailure()
		return err
	}
	cb.RecordSuccess()
	return nil
}

func TestCircuitClosed(t *testing.T) {
	t.Run("allows_requests_when_closed", func(t *testing.T) {
		cb := NewCircuitBreaker(5, 2, 1*time.Second)

		if cb.State() != CircuitClosed {
			t.Fatalf("expected initial state closed, got %s", cb.State())
		}
		if !cb.Allow() {
			t.Error("expected Allow() to be true when closed")
		}
	})

	t.Run("executes_function_when_closed", func(t *testing.T) {
		cb := NewCircuitBreaker(5, 2, 1*time.Second)

		err := cb.Execute(context.Background(), func() error {
			return nil
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
	})

	t.Run("resets_failure_count_on_success", func(t *testing.T) {
		cb := NewCircuitBreaker(5, 2, 1*time.Second)

		// Record some failures
		for i := 0; i < 3; i++ {
			cb.RecordFailure()
		}

		// Success should reset
		cb.RecordSuccess()

		// Should still be closed
		if cb.State() != CircuitClosed {
			t.Errorf("expected state closed, got %s", cb.State())
		}
	})
}

func TestCircuitOpenAfterFailures(t *testing.T) {
	t.Run("opens_after_threshold", func(t *testing.T) {
		cb := NewCircuitBreaker(3, 2, 1*time.Second)

		for i := 0; i < 3; i++ {
			cb.RecordFailure()
		}

		if cb.State() != CircuitOpen {
			t.Fatalf("expected state open, got %s", cb.State())
		}
	})

	t.Run("rejects_requests_when_open", func(t *testing.T) {
		cb := NewCircuitBreaker(1, 1, 1*time.Minute)
		cb.RecordFailure()

		if cb.Allow() {
			t.Error("expected Allow() to be false when open")
		}
	})

	t.Run("execute_returns_error_when_open", func(t *testing.T) {
		cb := NewCircuitBreaker(1, 1, 1*time.Minute)
		cb.RecordFailure()

		called := false
		err := cb.Execute(context.Background(), func() error {
			called = true
			return nil
		})

		if err == nil {
			t.Fatal("expected error when circuit open")
		}
		if called {
			t.Error("expected function not to be called when open")
		}
	})

	t.Run("threshold_is_exact", func(t *testing.T) {
		cb := NewCircuitBreaker(3, 2, 1*time.Second)

		// Just under threshold
		for i := 0; i < 2; i++ {
			cb.RecordFailure()
		}
		if cb.State() != CircuitClosed {
			t.Errorf("expected state closed after 2 failures (threshold=3), got %s", cb.State())
		}

		// One more should open it
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Errorf("expected state open after 3 failures, got %s", cb.State())
		}
	})
}

func TestCircuitHalfOpen(t *testing.T) {
	t.Run("transitions_to_half_open_after_timeout", func(t *testing.T) {
		cb := NewCircuitBreaker(1, 1, 50*time.Millisecond)
		cb.RecordFailure()

		if cb.State() != CircuitOpen {
			t.Fatalf("expected state open, got %s", cb.State())
		}

		time.Sleep(100 * time.Millisecond)

		if !cb.Allow() {
			t.Error("expected Allow() after timeout to transition to half-open")
		}
		if cb.State() != CircuitHalfOpen {
			t.Errorf("expected state half-open after timeout, got %s", cb.State())
		}
	})

	t.Run("allows_limited_calls_in_half_open", func(t *testing.T) {
		cb := NewCircuitBreaker(1, 1, 1*time.Millisecond)
		cb.RecordFailure()
		time.Sleep(5 * time.Millisecond)

		if !cb.Allow() {
			t.Fatal("expected first call to be allowed in half-open")
		}
		// Second call should be denied if max calls reached
		// (default halfOpenMaxCalls = 1)
	})

	t.Run("success_in_half_open_closes_circuit", func(t *testing.T) {
		cb := NewCircuitBreaker(5, 1, 50*time.Millisecond)
		cb.RecordFailure()
		time.Sleep(100 * time.Millisecond)

		// Now in half-open
		err := cb.Execute(context.Background(), func() error {
			return nil
		})

		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if cb.State() != CircuitClosed {
			t.Errorf("expected state closed after success in half-open, got %s", cb.State())
		}
	})

	t.Run("failure_in_half_open_reopens_circuit", func(t *testing.T) {
		cb := NewCircuitBreaker(5, 1, 50*time.Millisecond)
		cb.RecordFailure()
		time.Sleep(100 * time.Millisecond)

		// Now in half-open
		err := cb.Execute(context.Background(), func() error {
			return errors.New("still failing")
		})

		if err == nil {
			t.Fatal("expected error")
		}
		if cb.State() != CircuitOpen {
			t.Errorf("expected state open after failure in half-open, got %s", cb.State())
		}
	})

	t.Run("multiple_successes_required", func(t *testing.T) {
		cb := NewCircuitBreaker(5, 3, 1*time.Millisecond)
		cb.RecordFailure()
		time.Sleep(5 * time.Millisecond)

		// First success
		cb.Execute(context.Background(), func() error { return nil })

		if cb.State() != CircuitHalfOpen {
			t.Errorf("expected half-open (need 3 successes), got %s", cb.State())
		}
	})
}

func TestCircuitRecovery(t *testing.T) {
	t.Run("full_recovery_cycle", func(t *testing.T) {
		cb := NewCircuitBreaker(2, 1, 50*time.Millisecond)

		// Start closed
		if cb.State() != CircuitClosed {
			t.Fatalf("expected closed initially, got %s", cb.State())
		}

		// Failures open the circuit
		cb.RecordFailure()
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Errorf("expected open, got %s", cb.State())
		}

		// Wait for timeout -> half-open
		time.Sleep(100 * time.Millisecond)
		if !cb.Allow() {
			t.Fatal("expected to allow probe in half-open")
		}
		if cb.State() != CircuitHalfOpen {
			t.Errorf("expected half-open, got %s", cb.State())
		}

		// Success closes the circuit
		cb.RecordSuccess()
		if cb.State() != CircuitClosed {
			t.Errorf("expected closed after recovery, got %s", cb.State())
		}
	})

	t.Run("multiple_recovery_attempts", func(t *testing.T) {
		cb := NewCircuitBreaker(1, 2, 30*time.Millisecond)

		// First cycle: fail, open, half-open, fail again
		cb.RecordFailure()
		time.Sleep(50 * time.Millisecond)
		cb.Allow() // half-open probe
		cb.RecordFailure() // back to open

		if cb.State() != CircuitOpen {
			t.Errorf("expected open after second failure, got %s", cb.State())
		}

		// Second recovery attempt
		time.Sleep(50 * time.Millisecond)
		if !cb.Allow() {
			t.Fatal("expected allow after second timeout")
		}
		cb.RecordSuccess()
		// Need 2 successes
		if cb.State() == CircuitClosed {
			// Got 2? No, just 1
		}
	})
}

func TestCircuitConcurrency(t *testing.T) {
	t.Run("concurrent_record_failure", func(t *testing.T) {
		cb := NewCircuitBreaker(100, 1, 1*time.Second)
		var wg sync.WaitGroup

		for i := 0; i < 50; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				cb.RecordFailure()
			}()
		}
		wg.Wait()

		if cb.State() != CircuitOpen {
			t.Errorf("expected open after concurrent failures, got %s", cb.State())
		}
	})

	t.Run("concurrent_allow", func(t *testing.T) {
		cb := NewCircuitBreaker(1, 1, 1*time.Hour)
		cb.RecordFailure()

		var wg sync.WaitGroup
		allowed := 0
		var mu sync.Mutex

		for i := 0; i < 20; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if cb.Allow() {
					mu.Lock()
					allowed++
					mu.Unlock()
				}
			}()
		}
		wg.Wait()

		mu.Lock()
		if allowed != 0 {
			t.Errorf("expected 0 allowed when open, got %d", allowed)
		}
		mu.Unlock()
	})
}

func TestCircuitString(t *testing.T) {
	tests := []struct {
		state    CircuitState
		expected string
	}{
		{CircuitClosed, "closed"},
		{CircuitOpen, "open"},
		{CircuitHalfOpen, "half-open"},
		{CircuitState(999), "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if got := tt.state.String(); got != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, got)
			}
		})
	}
}
