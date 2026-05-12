package vedadb

import (
	"context"
	"math/rand"
	"sync"
	"time"
)

// RetryPolicy defines configurable exponential-backoff retry behaviour.
type RetryPolicy struct {
	MaxRetries      int
	BaseDelay       time.Duration
	MaxDelay        time.Duration
	Jitter          bool
	RetryableErrors []error

	mu        sync.RWMutex
	onRetry   func(attempt int, err error, nextDelay time.Duration)
	onSuccess func(attempt int)
}

// DefaultRetryPolicy returns a *RetryPolicy tuned for typical network work.
func DefaultRetryPolicy() *RetryPolicy {
	return &RetryPolicy{
		MaxRetries: 3,
		BaseDelay:  250 * time.Millisecond,
		MaxDelay:   30 * time.Second,
		Jitter:     true,
	}
}

// AggressiveRetryPolicy returns a policy tuned for fast failure detection.
func AggressiveRetryPolicy() *RetryPolicy {
	return &RetryPolicy{
		MaxRetries: 5,
		BaseDelay:  100 * time.Millisecond,
		MaxDelay:   5 * time.Second,
		Jitter:     true,
	}
}

// ConservativeRetryPolicy returns a policy tuned for high-reliability systems.
func ConservativeRetryPolicy() *RetryPolicy {
	return &RetryPolicy{
		MaxRetries: 10,
		BaseDelay:  1 * time.Second,
		MaxDelay:   60 * time.Second,
		Jitter:     true,
	}
}

// OnRetry sets an optional callback invoked on every retry attempt.
func (r *RetryPolicy) OnRetry(fn func(attempt int, err error, nextDelay time.Duration)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.onRetry = fn
}

// OnSuccess sets an optional callback invoked after eventual success.
func (r *RetryPolicy) OnSuccess(fn func(attempt int)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.onSuccess = fn
}

// Execute runs fn, retrying with exponential backoff until success,
// the context is cancelled, or MaxRetries is exhausted.
// It returns nil on success, or the last error encountered.
func (r *RetryPolicy) Execute(ctx context.Context, fn func() error) error {
	var lastErr error

	for attempt := 0; attempt <= r.MaxRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return context.Cause(ctx)
		}

		if err := fn(); err != nil {
			lastErr = err

			if attempt == r.MaxRetries {
				break
			}

			if !r.isRetryable(err) {
				return err
			}

			delay := r.computeDelay(attempt)

			r.mu.RLock()
			cb := r.onRetry
			r.mu.RUnlock()
			if cb != nil {
				cb(attempt, err, delay)
			}

			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return context.Cause(ctx)
			case <-timer.C:
			}
			continue
		}

		r.mu.RLock()
		cb := r.onSuccess
		r.mu.RUnlock()
		if cb != nil {
			cb(attempt)
		}
		return nil
	}

	return lastErr
}

// ExecuteResult runs fn which returns (T, error), retrying with exponential backoff.
func ExecuteResult[T any](ctx context.Context, r *RetryPolicy, fn func() (T, error)) (T, error) {
	var zero T
	var lastErr error

	for attempt := 0; attempt <= r.MaxRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, context.Cause(ctx)
		}

		result, err := fn()
		if err != nil {
			lastErr = err

			if attempt == r.MaxRetries {
				break
			}

			if !r.isRetryable(err) {
				return zero, err
			}

			delay := r.computeDelay(attempt)

			r.mu.RLock()
			cb := r.onRetry
			r.mu.RUnlock()
			if cb != nil {
				cb(attempt, err, delay)
			}

			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return zero, context.Cause(ctx)
			case <-timer.C:
			}
			continue
		}

		r.mu.RLock()
		cb := r.onSuccess
		r.mu.RUnlock()
		if cb != nil {
			cb(attempt)
		}
		return result, nil
	}

	return zero, lastErr
}

// isRetryable reports whether err matches any of the configured retryable errors.
func (r *RetryPolicy) isRetryable(err error) bool {
	if err == nil {
		return true
	}

	// Always retry connection errors and rate limits.
	switch err.(type) {
	case *ConnectionError, *RateLimitError:
		return true
	}

	for _, re := range r.RetryableErrors {
		if re == err {
			return true
		}
	}
	return len(r.RetryableErrors) == 0 // default to retry-all when not specified
}

// computeDelay returns the backoff delay for the given attempt number.
func (r *RetryPolicy) computeDelay(attempt int) time.Duration {
	d := r.BaseDelay * (1 << attempt)
	if d > r.MaxDelay || d <= 0 {
		d = r.MaxDelay
	}
	if r.Jitter {
		d = d/2 + time.Duration(rand.Int63n(int64(d)/2+1))
	}
	return d
}

// WithRetry wraps a Protocol method call with the given RetryPolicy.
// Usage:
//
//	result, err := vedadb.WithRetry(policy).Query(ctx, proto, "SELECT * FROM users")
func WithRetry(r *RetryPolicy) *RetryWrapper {
	return &RetryWrapper{policy: r}
}

// RetryWrapper provides a fluent API for retry-wrapped Protocol calls.
type RetryWrapper struct {
	policy *RetryPolicy
}

// Query wraps Protocol.Query with retry.
func (w *RetryWrapper) Query(ctx context.Context, proto *Protocol, sql string, args []interface{}) (*Result, error) {
	return ExecuteResult(ctx, w.policy, func() (*Result, error) {
		vals := make([]interface{}, len(args))
		copy(vals, args)
		return proto.Query(sql, vals)
	})
}
