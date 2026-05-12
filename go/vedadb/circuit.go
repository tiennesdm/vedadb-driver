package vedadb

import (
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

// CircuitState represents the state of the circuit breaker.
type CircuitState int32

const (
	// StateClosed means the circuit is closed and requests flow normally.
	StateClosed CircuitState = iota
	// StateOpen means the circuit is open and requests fail fast.
	StateOpen
	// StateHalfOpen means the circuit is testing if the service has recovered.
	StateHalfOpen
)

func (s CircuitState) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// ErrCircuitOpen is returned when the circuit breaker is open.
var ErrCircuitOpen = errors.New("circuit breaker is open")

// CircuitBreaker implements the circuit breaker pattern.
type CircuitBreaker struct {
	FailureThreshold int           // consecutive failures before opening
	RecoveryTimeout  time.Duration // time to wait before moving to half-open
	HalfOpenMaxCalls int           // max calls allowed in half-open state

	state      atomic.Int32
	failures   atomic.Int32
	successes  atomic.Int32
	halfOpenCalls atomic.Int32

	mu             sync.RWMutex
	lastFailureTime time.Time
	onStateChange  func(from, to CircuitState)
}

// DefaultCircuitBreaker returns a *CircuitBreaker with sensible defaults.
func DefaultCircuitBreaker() *CircuitBreaker {
	return &CircuitBreaker{
		FailureThreshold: 5,
		RecoveryTimeout:  30 * time.Second,
		HalfOpenMaxCalls: 3,
	}
}

// NewCircuitBreaker creates a CircuitBreaker with the given settings.
func NewCircuitBreaker(failureThreshold int, recoveryTimeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		FailureThreshold: failureThreshold,
		RecoveryTimeout:  recoveryTimeout,
		HalfOpenMaxCalls: 3,
	}
}

// OnStateChange registers a callback invoked whenever the breaker changes state.
func (cb *CircuitBreaker) OnStateChange(fn func(from, to CircuitState)) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.onStateChange = fn
}

// State returns the current circuit breaker state.
func (cb *CircuitBreaker) State() CircuitState {
	return CircuitState(cb.state.Load())
}

// Call executes fn respecting the circuit breaker state.
// Returns ErrCircuitOpen if the circuit is open.
func (cb *CircuitBreaker) Call(fn func() error) error {
	st := cb.State()

	switch st {
	case StateOpen:
		// Check if recovery timeout has elapsed -> transition to half-open
		cb.mu.RLock()
		lft := cb.lastFailureTime
		cb.mu.RUnlock()

		if time.Since(lft) >= cb.RecoveryTimeout {
			if cb.transition(StateOpen, StateHalfOpen) {
				cb.halfOpenCalls.Store(0)
				return cb.executeHalfOpen(fn)
			}
			// Another goroutine already transitioned; retry
			return cb.Call(fn)
		}
		return ErrCircuitOpen

	case StateHalfOpen:
		calls := cb.halfOpenCalls.Add(1)
		if calls > int32(cb.HalfOpenMaxCalls) {
			cb.halfOpenCalls.Add(-1)
			return ErrCircuitOpen
		}
		return cb.executeHalfOpen(fn)

	case StateClosed:
		return cb.executeClosed(fn)
	}

	return ErrCircuitOpen
}

// CallResult executes fn which returns (T, error) respecting the circuit breaker state.
func CallResult[T any](cb *CircuitBreaker, fn func() (T, error)) (T, error) {
	var zero T
	st := cb.State()

	switch st {
	case StateOpen:
		cb.mu.RLock()
		lft := cb.lastFailureTime
		cb.mu.RUnlock()

		if time.Since(lft) >= cb.RecoveryTimeout {
			if cb.transition(StateOpen, StateHalfOpen) {
				cb.halfOpenCalls.Store(0)
				return cb.executeHalfOpenResult(fn)
			}
			return CallResult(cb, fn)
		}
		return zero, ErrCircuitOpen

	case StateHalfOpen:
		calls := cb.halfOpenCalls.Add(1)
		if calls > int32(cb.HalfOpenMaxCalls) {
			cb.halfOpenCalls.Add(-1)
			return zero, ErrCircuitOpen
		}
		return cb.executeHalfOpenResult(fn)

	case StateClosed:
		return cb.executeClosedResult(fn)
	}

	return zero, ErrCircuitOpen
}

func (cb *CircuitBreaker) executeClosed(fn func() error) error {
	if err := fn(); err != nil {
		cb.recordFailure()
		return err
	}
	cb.recordSuccess()
	return nil
}

func (cb *CircuitBreaker) executeClosedResult[T any](fn func() (T, error)) (T, error) {
	var zero T
	result, err := fn()
	if err != nil {
		cb.recordFailure()
		return zero, err
	}
	cb.recordSuccess()
	return result, nil
}

func (cb *CircuitBreaker) executeHalfOpen(fn func() error) error {
	err := fn()
	if err != nil {
		// Failure in half-open -> immediately open again
		cb.transition(StateHalfOpen, StateOpen)
		cb.recordFailure()
		return err
	}
	// Success in half-open -> close
	cb.transition(StateHalfOpen, StateClosed)
	cb.recordSuccess()
	return nil
}

func (cb *CircuitBreaker) executeHalfOpenResult[T any](fn func() (T, error)) (T, error) {
	var zero T
	result, err := fn()
	if err != nil {
		cb.transition(StateHalfOpen, StateOpen)
		cb.recordFailure()
		return zero, err
	}
	cb.transition(StateHalfOpen, StateClosed)
	cb.recordSuccess()
	return result, nil
}

func (cb *CircuitBreaker) recordFailure() {
	f := cb.failures.Add(1)
	cb.mu.Lock()
	cb.lastFailureTime = time.Now()
	cb.mu.Unlock()

	if int(f) >= cb.FailureThreshold {
		cb.transition(StateClosed, StateOpen)
	}
}

func (cb *CircuitBreaker) recordSuccess() {
	cb.failures.Store(0)
	cb.successes.Add(1)
}

func (cb *CircuitBreaker) transition(from, to CircuitState) bool {
	if cb.state.CompareAndSwap(int32(from), int32(to)) {
		cb.mu.RLock()
		cbMu := cb.onStateChange
		cb.mu.RUnlock()
		if cbMu != nil {
			go cbMu(from, to)
		}
		return true
	}
	return false
}

// Reset forces the circuit breaker into the closed state.
func (cb *CircuitBreaker) Reset() {
	cb.state.Store(int32(StateClosed))
	cb.failures.Store(0)
	cb.successes.Store(0)
	cb.halfOpenCalls.Store(0)
}

// Stats returns current breaker statistics.
func (cb *CircuitBreaker) Stats() CircuitStats {
	cb.mu.RLock()
	lft := cb.lastFailureTime
	cb.mu.RUnlock()
	return CircuitStats{
		State:           cb.State(),
		Failures:        int(cb.failures.Load()),
		Successes:       int(cb.successes.Load()),
		LastFailureTime: lft,
	}
}

// CircuitStats holds circuit breaker statistics.
type CircuitStats struct {
	State           CircuitState
	Failures        int
	Successes       int
	LastFailureTime time.Time
}
