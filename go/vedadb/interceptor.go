package vedadb

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Connection Middleware / Interceptor
// ---------------------------------------------------------------------------

// Interceptor is a function that wraps query execution.
// It receives the SQL, args, and a handler function to execute the actual query.
type Interceptor func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error)

// Handler is the function signature for the actual query handler.
type Handler func(ctx context.Context, sql string, args []interface{}) (*Result, error)

// InterceptorChain manages a chain of interceptors.
type InterceptorChain struct {
	interceptors []Interceptor
	mu           sync.RWMutex
}

// NewInterceptorChain creates a new interceptor chain.
func NewInterceptorChain() *InterceptorChain {
	return &InterceptorChain{
		interceptors: make([]Interceptor, 0),
	}
}

// Add appends an interceptor to the chain.
func (ic *InterceptorChain) Add(interceptor Interceptor) {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	ic.interceptors = append(ic.interceptors, interceptor)
}

// AddFirst prepends an interceptor to the chain.
func (ic *InterceptorChain) AddFirst(interceptor Interceptor) {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	ic.interceptors = append([]Interceptor{interceptor}, ic.interceptors...)
}

// Remove removes an interceptor by index.
func (ic *InterceptorChain) Remove(index int) error {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	if index < 0 || index >= len(ic.interceptors) {
		return fmt.Errorf("interceptor index %d out of range", index)
	}
	ic.interceptors = append(ic.interceptors[:index], ic.interceptors[index+1:]...)
	return nil
}

// Clear removes all interceptors.
func (ic *InterceptorChain) Clear() {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	ic.interceptors = ic.interceptors[:0]
}

// Len returns the number of interceptors.
func (ic *InterceptorChain) Len() int {
	ic.mu.RLock()
	defer ic.mu.RUnlock()
	return len(ic.interceptors)
}

// Execute runs the handler through the full interceptor chain.
func (ic *InterceptorChain) Execute(ctx context.Context, sql string, args []interface{}, handler Handler) (*Result, error) {
	ic.mu.RLock()
	chain := make([]Interceptor, len(ic.interceptors))
	copy(chain, ic.interceptors)
	ic.mu.RUnlock()

	// Build the chain from inside out
	current := handler
	for i := len(chain) - 1; i >= 0; i-- {
		interceptor := chain[i]
		next := current
		current = func(ctx context.Context, sql string, args []interface{}) (*Result, error) {
			return interceptor(ctx, sql, args, next)
		}
	}
	return current(ctx, sql, args)
}

// ---------------------------------------------------------------------------
// Built-in Interceptors
// ---------------------------------------------------------------------------

// LoggingInterceptor logs query execution details.
func LoggingInterceptor(onLog func(sql string, args []interface{}, duration time.Duration, err error)) Interceptor {
	return func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		start := time.Now()
		result, err := next(ctx, sql, args)
		duration := time.Since(start)
		if onLog != nil {
			onLog(sql, args, duration, err)
		}
		return result, err
	}
}

// RetryInterceptor adds retry logic to queries.
func RetryInterceptor(policy *RetryPolicy) Interceptor {
	return func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		return ExecuteResult(ctx, policy, func() (*Result, error) {
			return next(ctx, sql, args)
		})
	}
}

// CircuitBreakerInterceptor adds circuit breaker protection.
func CircuitBreakerInterceptor(breaker *CircuitBreaker) Interceptor {
	return func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		return CallResult(breaker, func() (*Result, error) {
			return next(ctx, sql, args)
		})
	}
}

// TimeoutInterceptor enforces a timeout on queries.
func TimeoutInterceptor(timeout time.Duration) Interceptor {
	return func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		ctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return next(ctx, sql, args)
	}
}

// MetricsInterceptor collects query metrics.
func MetricsInterceptor(metrics *MetricsCollector) Interceptor {
	return func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		start := time.Now()
		result, err := next(ctx, sql, args)
		metrics.RecordQuery(time.Since(start))
		if err != nil {
			metrics.RecordQueryFailure()
		}
		return result, err
	}
}

// ValidationInterceptor validates queries before execution.
func ValidationInterceptor(maxLength int) Interceptor {
	return func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		if len(sql) > maxLength {
			return nil, NewValidationError(fmt.Sprintf("query exceeds maximum length of %d", maxLength))
		}
		return next(ctx, sql, args)
	}
}

// CachingInterceptor adds query result caching.
func CachingInterceptor(cache *Cache) Interceptor {
	return func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		if !isSelectQuery(sql) {
			return next(ctx, sql, args)
		}
		key := cache.QueryKey(sql, args)
		if entry := cache.Get(key); entry != nil {
			return entry.Result, nil
		}
		result, err := next(ctx, sql, args)
		if err == nil {
			cache.Set(key, sql, args, result)
		}
		return result, err
	}
}

// InterceptedClient wraps a Client with an interceptor chain.
type InterceptedClient struct {
	*Client
	chain *InterceptorChain
}

// NewInterceptedClient creates a client with an interceptor chain.
func NewInterceptedClient(client *Client, chain *InterceptorChain) *InterceptedClient {
	return &InterceptedClient{
		Client: client,
		chain:  chain,
	}
}

// Query executes a query through the interceptor chain.
func (ic *InterceptedClient) Query(ctx context.Context, sql string, args ...interface{}) (*Result, error) {
	handler := func(ctx context.Context, sql string, args []interface{}) (*Result, error) {
		return ic.Client.Query(ctx, sql, args...)
	}
	return ic.chain.Execute(ctx, sql, args, handler)
}

// Exec executes a statement through the interceptor chain.
func (ic *InterceptedClient) Exec(ctx context.Context, sql string, args ...interface{}) (int64, error) {
	result, err := ic.Query(ctx, sql, args...)
	if err != nil {
		return 0, err
	}
	return int64(result.RowCount), nil
}
