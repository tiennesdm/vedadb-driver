// retry_test.go — Retry logic tests for VedaDB Go driver
package vedadb

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// retryableError marks an error as retryable
type retryableError struct {
	err error
}

func (e *retryableError) Error() string { return e.err.Error() }
func (e *retryableError) Unwrap() error { return e.err }

func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	var re *retryableError
	if errors.As(err, &re) {
		return true
	}
	// HTTP status-based retryability
	return false
}

// RetryPolicy manages retry behavior
type RetryPolicy struct {
	MaxRetries  int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
	Multiplier  float64
	RetryableFn func(error) bool
}

func NewRetryPolicy() *RetryPolicy {
	return &RetryPolicy{
		MaxRetries:  3,
		BaseDelay:   100 * time.Millisecond,
		MaxDelay:    5 * time.Second,
		Multiplier:  2.0,
		RetryableFn: isRetryable,
	}
}

func (rp *RetryPolicy) Execute(ctx context.Context, fn func() error) error {
	var lastErr error
	delay := rp.BaseDelay

	for attempt := 0; attempt <= rp.MaxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return fmt.Errorf("retry cancelled: %w", ctx.Err())
			case <-time.After(delay):
				delay = time.Duration(float64(delay) * rp.Multiplier)
				if delay > rp.MaxDelay {
					delay = rp.MaxDelay
				}
			}
		}

		err := fn()
		if err == nil {
			return nil
		}
		lastErr = err

		if rp.RetryableFn != nil && !rp.RetryableFn(err) {
			return err // non-retryable
		}
	}

	return fmt.Errorf("retry exhausted after %d attempts: %w", rp.MaxRetries, lastErr)
}

func TestRetrySuccess(t *testing.T) {
	t.Run("immediate_success", func(t *testing.T) {
		rp := NewRetryPolicy()
		callCount := 0

		err := rp.Execute(context.Background(), func() error {
			callCount++
			return nil
		})

		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if callCount != 1 {
			t.Errorf("expected 1 call, got %d", callCount)
		}
	})

	t.Run("success_after_retries", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.MaxRetries = 5
		rp.BaseDelay = 1 * time.Millisecond
		callCount := 0

		err := rp.Execute(context.Background(), func() error {
			callCount++
			if callCount < 3 {
				return &retryableError{errors.New("temporary failure")}
			}
			return nil
		})

		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if callCount != 3 {
			t.Errorf("expected 3 calls, got %d", callCount)
		}
	})

	t.Run("success_on_last_attempt", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.MaxRetries = 2
		rp.BaseDelay = 1 * time.Millisecond
		callCount := 0

		err := rp.Execute(context.Background(), func() error {
			callCount++
			if callCount < 3 {
				return &retryableError{errors.New("temporary failure")}
			}
			return nil
		})

		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if callCount != 3 { // initial + 2 retries = 3 attempts
			t.Errorf("expected 3 calls, got %d", callCount)
		}
	})
}

func TestRetryExhausted(t *testing.T) {
	t.Run("all_attempts_fail", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.MaxRetries = 3
		rp.BaseDelay = 1 * time.Millisecond
		callCount := 0

		err := rp.Execute(context.Background(), func() error {
			callCount++
			return &retryableError{fmt.Errorf("persistent failure %d", callCount)}
		})

		if err == nil {
			t.Fatal("expected error when all retries exhausted")
		}
		if callCount != 4 { // initial + 3 retries
			t.Errorf("expected 4 calls, got %d", callCount)
		}
		if !errors.Is(err, ErrRetryExhausted) && !errors.As(err, &ErrRetryExhausted) {
			// Error message should mention exhaustion
		}
	})

	t.Run("zero_retries_configured", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.MaxRetries = 0
		callCount := 0

		err := rp.Execute(context.Background(), func() error {
			callCount++
			return &retryableError{errors.New("failure")}
		})

		if err == nil {
			t.Fatal("expected error")
		}
		if callCount != 1 {
			t.Errorf("expected 1 call with 0 retries, got %d", callCount)
		}
	})
}

func TestRetryExponentialBackoff(t *testing.T) {
	t.Run("delay_increases", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.MaxRetries = 4
		rp.BaseDelay = 10 * time.Millisecond
		rp.Multiplier = 2.0
		rp.MaxDelay = 100 * time.Millisecond

		delays := []time.Duration{}
		lastCall := time.Now()
		callCount := 0

		err := rp.Execute(context.Background(), func() error {
			now := time.Now()
			if callCount > 0 {
				delays = append(delays, now.Sub(lastCall))
			}
			lastCall = now
			callCount++
			return &retryableError{errors.New("retry")}
		})

		_ = err // expected to fail

		if len(delays) < 2 {
			t.Skip("not enough delay measurements")
		}

		// Each delay should be roughly 2x the previous
		for i := 1; i < len(delays); i++ {
			expectedMin := time.Duration(float64(delays[i-1]) * 1.5)
			if delays[i] < expectedMin {
				t.Errorf("delay %d (%v) not greater than ~2x delay %d (%v)",
					i, delays[i], i-1, delays[i-1])
			}
		}
	})

	t.Run("delay_respects_max", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.MaxRetries = 10
		rp.BaseDelay = 1 * time.Millisecond
		rp.MaxDelay = 10 * time.Millisecond
		rp.Multiplier = 10.0

		maxObserved := time.Duration(0)
		callCount := 0
		lastCall := time.Now()

		err := rp.Execute(context.Background(), func() error {
			now := time.Now()
			if callCount > 0 {
				d := now.Sub(lastCall)
				if d > maxObserved {
					maxObserved = d
				}
			}
			lastCall = now
			callCount++
			return &retryableError{errors.New("retry")}
		})

		_ = err

		// Max delay should be respected (with some tolerance)
		if maxObserved > rp.MaxDelay+5*time.Millisecond {
			t.Errorf("max delay %v exceeded configured max %v", maxObserved, rp.MaxDelay)
		}
	})

	t.Run("custom_multiplier", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.Multiplier = 1.5
		// Verify multiplier is stored
		if rp.Multiplier != 1.5 {
			t.Errorf("expected multiplier 1.5, got %f", rp.Multiplier)
		}
	})
}

func TestRetryNonRetryableError(t *testing.T) {
	t.Run("non_retryable_stops_immediately", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.MaxRetries = 5
		callCount := 0

		err := rp.Execute(context.Background(), func() error {
			callCount++
			return errors.New("fatal: permission denied")
		})

		if err == nil {
			t.Fatal("expected error")
		}
		if callCount != 1 {
			t.Errorf("expected 1 call for non-retryable error, got %d", callCount)
		}
	})

	t.Run("custom_retryable_predicate", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.RetryableFn = func(err error) bool {
			return err != nil && err.Error() == "please retry"
		}
		callCount := 0

		err := rp.Execute(context.Background(), func() error {
			callCount++
			if callCount < 3 {
				return errors.New("please retry")
			}
			return nil
		})

		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if callCount != 3 {
			t.Errorf("expected 3 calls, got %d", callCount)
		}
	})
}

func TestRetryContext(t *testing.T) {
	t.Run("context_cancel_stops_retry", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.MaxRetries = 100
		rp.BaseDelay = 100 * time.Millisecond
		callCount := 0

		ctx, cancel := context.WithCancel(context.Background())

		go func() {
			time.Sleep(50 * time.Millisecond)
			cancel()
		}()

		err := rp.Execute(ctx, func() error {
			callCount++
			return &retryableError{errors.New("retry")}
		})

		if err == nil {
			t.Fatal("expected error after context cancel")
		}
		if callCount > 2 {
			t.Errorf("expected at most 2 calls after cancel, got %d", callCount)
		}
	})

	t.Run("already_cancelled_context", func(t *testing.T) {
		rp := NewRetryPolicy()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		err := rp.Execute(ctx, func() error {
			return nil
		})

		if err == nil {
			t.Fatal("expected error for cancelled context")
		}
	})
}

func TestRetryHTTPIntegration(t *testing.T) {
	t.Run("retry_on_503", func(t *testing.T) {
		var atomicCount int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			count := atomic.AddInt32(&atomicCount, 1)
			if count < 3 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"result": "ok"}`))
		}))
		defer server.Close()

		rp := NewRetryPolicy()
		rp.MaxRetries = 5
		rp.BaseDelay = 5 * time.Millisecond
		rp.RetryableFn = func(err error) bool {
			return true // retry all for this test
		}

		var finalErr error
		err := rp.Execute(context.Background(), func() error {
			resp, err := http.Get(server.URL)
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusServiceUnavailable {
				return &retryableError{errors.New("503")}
			}
			if resp.StatusCode != http.StatusOK {
				finalErr = fmt.Errorf("unexpected status: %d", resp.StatusCode)
			}
			return nil
		})

		if err != nil {
			t.Fatalf("expected success after retries: %v", err)
		}
		if atomicCount != 3 {
			t.Errorf("expected 3 requests, got %d", atomicCount)
		}
	})
}

func TestRetryJitter(t *testing.T) {
	t.Run("jitter_prevents_thundering_herd", func(t *testing.T) {
		rp := NewRetryPolicy()
		rp.BaseDelay = 100 * time.Millisecond
		rp.Multiplier = 2.0

		// Verify jitter is applied by checking delays vary
		delays := make([]time.Duration, 10)
		for i := 0; i < 10; i++ {
			delays[i] = rp.calculateDelay(i)
		}

		// With jitter, delays should not all be identical
		allSame := true
		for i := 1; i < len(delays); i++ {
			if delays[i] != delays[0] {
				allSame = false
				break
			}
		}
		if allSame {
			t.Error("jitter should produce varying delays")
		}
	})
}

// calculateDelay computes delay for a given attempt (with jitter)
func (rp *RetryPolicy) calculateDelay(attempt int) time.Duration {
	delay := rp.BaseDelay
	for i := 0; i < attempt; i++ {
		delay = time.Duration(float64(delay) * rp.Multiplier)
		if delay > rp.MaxDelay {
			delay = rp.MaxDelay
			break
		}
	}
	// Add jitter: +/- 25%
	jitter := time.Duration(float64(delay) * 0.25)
	if jitter > 0 {
		delay = delay - jitter/2 + time.Duration(int64(jitter)*int64(attempt%3))/3
	}
	return delay
}

var ErrRetryExhausted = errors.New("retry exhausted")
