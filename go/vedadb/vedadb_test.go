package vedadb

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ============================================================================
// Retry Tests
// ============================================================================

func TestDefaultRetryPolicy(t *testing.T) {
	rp := DefaultRetryPolicy()
	if rp.MaxRetries != 3 {
		t.Errorf("MaxRetries = %d, want 3", rp.MaxRetries)
	}
	if rp.BaseDelay != 250*time.Millisecond {
		t.Errorf("BaseDelay = %v, want 250ms", rp.BaseDelay)
	}
	if rp.MaxDelay != 30*time.Second {
		t.Errorf("MaxDelay = %v, want 30s", rp.MaxDelay)
	}
	if !rp.Jitter {
		t.Error("Jitter should be true")
	}
}

func TestRetryPolicy_Execute_Success(t *testing.T) {
	rp := &RetryPolicy{
		MaxRetries: 3,
		BaseDelay:  10 * time.Millisecond,
		MaxDelay:   100 * time.Millisecond,
		Jitter:     false,
	}

	callCount := 0
	err := rp.Execute(context.Background(), func() error {
		callCount++
		return nil
	})

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if callCount != 1 {
		t.Errorf("callCount = %d, want 1", callCount)
	}
}

func TestRetryPolicy_Execute_EventualSuccess(t *testing.T) {
	rp := &RetryPolicy{
		MaxRetries: 3,
		BaseDelay:  5 * time.Millisecond,
		MaxDelay:   50 * time.Millisecond,
		Jitter:     false,
	}

	callCount := 0
	err := rp.Execute(context.Background(), func() error {
		callCount++
		if callCount < 3 {
			return errors.New("transient error")
		}
		return nil
	})

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if callCount != 3 {
		t.Errorf("callCount = %d, want 3", callCount)
	}
}

func TestRetryPolicy_Execute_MaxRetriesExceeded(t *testing.T) {
	rp := &RetryPolicy{
		MaxRetries: 2,
		BaseDelay:  1 * time.Millisecond,
		MaxDelay:   10 * time.Millisecond,
		Jitter:     false,
	}

	callCount := 0
	err := rp.Execute(context.Background(), func() error {
		callCount++
		return errors.New("persistent error")
	})

	if err == nil {
		t.Error("expected error")
	}
	if callCount != 3 { // initial + 2 retries
		t.Errorf("callCount = %d, want 3", callCount)
	}
}

func TestRetryPolicy_Execute_ContextCancellation(t *testing.T) {
	rp := &RetryPolicy{
		MaxRetries: 10,
		BaseDelay:  100 * time.Millisecond,
		MaxDelay:   1 * time.Second,
		Jitter:     false,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	callCount := 0
	err := rp.Execute(ctx, func() error {
		callCount++
		return errors.New("transient")
	})

	if err == nil {
		t.Error("expected error from context")
	}
	if callCount < 1 {
		t.Error("should have been called at least once")
	}
}

func TestRetryPolicy_isRetryable(t *testing.T) {
	rp := DefaultRetryPolicy()

	if !rp.isRetryable(NewConnectionError("test")) {
		t.Error("ConnectionError should be retryable")
	}
	if !rp.isRetryable(&RateLimitError{}) {
		t.Error("RateLimitError should be retryable")
	}
	if rp.isRetryable(NewValidationError("test")) && len(rp.RetryableErrors) > 0 {
		t.Error("ValidationError should not be retryable when RetryableErrors is set")
	}
}

func TestRetryPolicy_computeDelay(t *testing.T) {
	rp := &RetryPolicy{
		BaseDelay: 100 * time.Millisecond,
		MaxDelay:  5 * time.Second,
		Jitter:    false,
	}

	tests := []struct {
		attempt  int
		expected time.Duration
	}{
		{0, 100 * time.Millisecond},
		{1, 200 * time.Millisecond},
		{2, 400 * time.Millisecond},
		{3, 800 * time.Millisecond},
	}

	for _, tt := range tests {
		delay := rp.computeDelay(tt.attempt)
		if delay != tt.expected {
			t.Errorf("computeDelay(%d) = %v, want %v", tt.attempt, delay, tt.expected)
		}
	}
}

func TestExecuteResult(t *testing.T) {
	rp := &RetryPolicy{
		MaxRetries: 3,
		BaseDelay:  5 * time.Millisecond,
		MaxDelay:   50 * time.Millisecond,
		Jitter:     false,
	}

	callCount := 0
	result, err := ExecuteResult(context.Background(), rp, func() (int, error) {
		callCount++
		if callCount < 2 {
			return 0, errors.New("transient")
		}
		return 42, nil
	})

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result != 42 {
		t.Errorf("result = %d, want 42", result)
	}
}

// ============================================================================
// Circuit Breaker Tests
// ============================================================================

func TestDefaultCircuitBreaker(t *testing.T) {
	cb := DefaultCircuitBreaker()
	if cb.FailureThreshold != 5 {
		t.Errorf("FailureThreshold = %d, want 5", cb.FailureThreshold)
	}
	if cb.RecoveryTimeout != 30*time.Second {
		t.Errorf("RecoveryTimeout = %v, want 30s", cb.RecoveryTimeout)
	}
	if cb.HalfOpenMaxCalls != 3 {
		t.Errorf("HalfOpenMaxCalls = %d, want 3", cb.HalfOpenMaxCalls)
	}
	if cb.State() != StateClosed {
		t.Errorf("initial state = %v, want Closed", cb.State())
	}
}

func TestCircuitBreaker_ClosedState_Success(t *testing.T) {
	cb := NewCircuitBreaker(3, 1*time.Second)

	for i := 0; i < 5; i++ {
		err := cb.Call(func() error {
			return nil
		})
		if err != nil {
			t.Errorf("unexpected error on call %d: %v", i, err)
		}
	}

	if cb.State() != StateClosed {
		t.Errorf("state = %v, want Closed", cb.State())
	}
}

func TestCircuitBreaker_OpensAfterFailures(t *testing.T) {
	cb := NewCircuitBreaker(3, 1*time.Second)

	// Cause 3 failures
	for i := 0; i < 3; i++ {
		cb.Call(func() error {
			return errors.New("failure")
		})
	}

	if cb.State() != StateOpen {
		t.Errorf("state = %v, want Open", cb.State())
	}

	// Next call should fail fast
	err := cb.Call(func() error {
		return nil
	})
	if err != ErrCircuitOpen {
		t.Errorf("expected ErrCircuitOpen, got: %v", err)
	}
}

func TestCircuitBreaker_Stats(t *testing.T) {
	cb := NewCircuitBreaker(5, 1*time.Second)

	cb.Call(func() error { return nil })
	cb.Call(func() error { return nil })
	cb.Call(func() error { return errors.New("fail") })

	stats := cb.Stats()
	if stats.State != StateClosed {
		t.Errorf("state = %v, want Closed", stats.State)
	}
	if stats.Successes != 2 {
		t.Errorf("successes = %d, want 2", stats.Successes)
	}
	if stats.Failures != 1 {
		t.Errorf("failures = %d, want 1", stats.Failures)
	}
}

func TestCircuitBreaker_Reset(t *testing.T) {
	cb := NewCircuitBreaker(2, 1*time.Second)

	cb.Call(func() error { return errors.New("fail") })
	cb.Call(func() error { return errors.New("fail") })

	if cb.State() != StateOpen {
		t.Fatal("expected Open state")
	}

	cb.Reset()

	if cb.State() != StateClosed {
		t.Errorf("state = %v, want Closed after reset", cb.State())
	}

	err := cb.Call(func() error { return nil })
	if err != nil {
		t.Errorf("unexpected error after reset: %v", err)
	}
}

func TestCircuitBreaker_CallResult(t *testing.T) {
	cb := NewCircuitBreaker(3, 1*time.Second)

	result, err := CallResult(cb, func() (int, error) {
		return 42, nil
	})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result != 42 {
		t.Errorf("result = %d, want 42", result)
	}
}

// ============================================================================
// Health Checker Tests
// ============================================================================

func TestNewHealthChecker(t *testing.T) {
	// Create a mock protocol
	cfg := DefaultConfig()
	proto, err := NewProtocol(cfg)
	if err != nil {
		t.Skip("cannot create protocol:", err)
	}
	defer proto.Close()

	hc := NewHealthChecker(proto)
	if hc.CheckInterval != 10*time.Second {
		t.Errorf("CheckInterval = %v, want 10s", hc.CheckInterval)
	}
	if hc.Timeout != 5*time.Second {
		t.Errorf("Timeout = %v, want 5s", hc.Timeout)
	}
	if !hc.IsHealthy() {
		t.Error("initial state should be healthy")
	}
}

func TestHealthChecker_LastPing(t *testing.T) {
	cfg := DefaultConfig()
	proto, err := NewProtocol(cfg)
	if err != nil {
		t.Skip("cannot create protocol:", err)
	}
	defer proto.Close()

	hc := NewHealthChecker(proto)
	if hc.LastPing() != 0 {
		t.Error("LastPing should be 0 before any check")
	}
}

// ============================================================================
// URI Parser Tests
// ============================================================================

func TestParseURI(t *testing.T) {
	tests := []struct {
		name     string
		uri      string
		wantHost string
		wantPort int
		wantDB   string
		wantErr  bool
	}{
		{
			name:     "full URI",
			uri:      "vedadb://admin:pass@localhost:7480/mydb?pool_size=20&timeout=30s",
			wantHost: "localhost",
			wantPort: 7480,
			wantDB:   "mydb",
			wantErr:  false,
		},
		{
			name:     "minimal URI",
			uri:      "vedadb://localhost:8080",
			wantHost: "localhost",
			wantPort: 8080,
			wantDB:   "",
			wantErr:  false,
		},
		{
			name:    "invalid scheme",
			uri:     "http://localhost:8080",
			wantErr: true,
		},
		{
			name:     "with TLS",
			uri:      "vedadb://admin:pass@db.example.com:443/mydb?tls=true&timeout=10s&max_retries=5",
			wantHost: "db.example.com",
			wantPort: 443,
			wantDB:   "mydb",
			wantErr:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := ParseURI(tt.uri)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseURI() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr {
				return
			}
			if cfg.Host != tt.wantHost {
				t.Errorf("Host = %q, want %q", cfg.Host, tt.wantHost)
			}
			if cfg.Port != tt.wantPort {
				t.Errorf("Port = %d, want %d", cfg.Port, tt.wantPort)
			}
			if cfg.Database != tt.wantDB {
				t.Errorf("Database = %q, want %q", cfg.Database, tt.wantDB)
			}
		})
	}
}

func TestParseURI_TLSParams(t *testing.T) {
	uri := "vedadb://admin:pass@localhost:7480/mydb?tls=true&tls_insecure=true&max_retries=5&retry_base=1s&retry_max=60s"
	cfg, err := ParseURI(uri)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.TLS {
		t.Error("TLS should be true")
	}
	if !cfg.TLSInsecure {
		t.Error("TLSInsecure should be true")
	}
	if cfg.MaxRetries != 5 {
		t.Errorf("MaxRetries = %d, want 5", cfg.MaxRetries)
	}
	if cfg.RetryBackoffBase != 1*time.Second {
		t.Errorf("RetryBackoffBase = %v, want 1s", cfg.RetryBackoffBase)
	}
	if cfg.RetryMaxBackoff != 60*time.Second {
		t.Errorf("RetryMaxBackoff = %v, want 60s", cfg.RetryMaxBackoff)
	}
}

func TestFormatURI(t *testing.T) {
	cfg := Config{
		Host:             "localhost",
		Port:             7480,
		Username:         "admin",
		Password:         "secret",
		Database:         "mydb",
		TLS:              true,
		TLSInsecure:      true,
		Timeout:          10 * time.Second,
		MaxRetries:       5,
		RetryBackoffBase: 1 * time.Second,
		RetryMaxBackoff:  60 * time.Second,
	}

	uri := FormatURI(cfg)
	if !strings.Contains(uri, "vedadb://") {
		t.Error("URI should start with vedadb://")
	}
	if !strings.Contains(uri, "admin:secret@") {
		t.Error("URI should contain credentials")
	}
	if !strings.Contains(uri, "tls=true") {
		t.Error("URI should contain tls=true")
	}
}

func TestValidateURI(t *testing.T) {
	if err := ValidateURI("vedadb://localhost:8080/db"); err != nil {
		t.Errorf("valid URI failed validation: %v", err)
	}
	if err := ValidateURI("http://localhost:8080"); err == nil {
		t.Error("invalid URI should fail validation")
	}
}

// ============================================================================
// TLS Tests
// ============================================================================

func TestConfig_WithTLS(t *testing.T) {
	cfg := &Config{Host: "localhost", Port: 8080}
	cfg.WithTLS("", "", "")

	if !cfg.TLS {
		t.Error("TLS should be enabled")
	}
}

func TestConfig_WithTLSConfig(t *testing.T) {
	cfg := &Config{Host: "localhost", Port: 8080}
	cfg.WithTLSConfig(&tls.Config{InsecureSkipVerify: true})

	if !cfg.TLS {
		t.Error("TLS should be enabled")
	}
	if !cfg.TLSInsecure {
		t.Error("TLSInsecure should be true")
	}
}

func TestConfig_GetTLSInfo(t *testing.T) {
	cfg := Config{TLS: true, TLSInsecure: true, TLSCAFile: "/path/to/ca.crt"}
	info := cfg.GetTLSInfo()

	if !info.Enabled {
		t.Error("Enabled should be true")
	}
	if !info.Insecure {
		t.Error("Insecure should be true")
	}
	if info.CAFile != "/path/to/ca.crt" {
		t.Errorf("CAFile = %q, want /path/to/ca.crt", info.CAFile)
	}
}

// ============================================================================
// Query Builder Tests
// ============================================================================

func TestSelect_Build(t *testing.T) {
	sql := Select("id", "name").From("users").
		Where("active", "=", true).
		OrderBy("name", true).
		Limit(10).
		Build()

	want := "SELECT id, name FROM users WHERE active = ? ORDER BY name DESC LIMIT 10"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestInsert_Build(t *testing.T) {
	sql := Insert("users").Columns("name", "email").Values("?", "?").Build()

	want := "INSERT INTO users (name, email) VALUES (?, ?)"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestUpdate_Build(t *testing.T) {
	sql := Update("users").
		Set("name", "John").
		Set("updated_at", "2024-01-01").
		Where("id", "=", 1).
		Build()

	want := "UPDATE users SET name = ?, updated_at = ? WHERE id = ?"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestDelete_Build(t *testing.T) {
	sql := Delete("users").Where("id", "=", 1).Build()

	want := "DELETE FROM users WHERE id = ?"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestSelect_Star(t *testing.T) {
	sql := Select().From("users").Build()
	want := "SELECT * FROM users"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestSelect_Join(t *testing.T) {
	sql := Select("u.id", "u.name", "o.total").
		From("users u").
		Join("orders o", "u.id = o.user_id").
		Where("u.active", "=", true).
		Build()

	want := "SELECT u.id, u.name, o.total FROM users u INNER JOIN orders o ON u.id = o.user_id WHERE u.active = ?"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestSelect_WhereIn(t *testing.T) {
	sql := Select("*").From("users").WhereIn("id", 1, 2, 3).Build()
	want := "SELECT * FROM users WHERE id IN (?, ?, ?)"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestSelect_WhereNull(t *testing.T) {
	sql := Select("*").From("users").WhereNull("deleted_at").Build()
	want := "SELECT * FROM users WHERE deleted_at IS NULL"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestSelect_GroupByHaving(t *testing.T) {
	sql := Select("category", "COUNT(*)").From("products").
		GroupBy("category").
		Having("COUNT(*) > 5").
		Build()

	want := "SELECT category, COUNT(*) FROM products GROUP BY category HAVING COUNT(*) > 5"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestSelect_Returning(t *testing.T) {
	sql := Insert("users").Columns("name").Values("?").Returning("id").Build()
	want := "INSERT INTO users (name) VALUES (?) RETURNING id"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestSelect_Count(t *testing.T) {
	qb := Select("*").From("users").Where("active", "=", true)
	qb.Count()
	sql := qb.Build()
	want := "SELECT COUNT(*) FROM users WHERE active = ?"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestSelect_Exists(t *testing.T) {
	qb := Select("*").From("users").Where("id", "=", 1)
	qb.Exists()
	sql := qb.Build()
	want := "SELECT 1 FROM users WHERE id = ? LIMIT 1"
	if sql != want {
		t.Errorf("got %q, want %q", sql, want)
	}
}

func TestQueryBuilder_Params(t *testing.T) {
	qb := Select("*").From("users").
		Where("active", "=", true).
		Where("age", ">=", 18).
		OrderBy("name")

	params := qb.Params()
	if len(params) != 2 {
		t.Errorf("len(params) = %d, want 2", len(params))
	}
}

// ============================================================================
// Cache Tests
// ============================================================================

func TestCache_GetSet(t *testing.T) {
	cache := NewCache(WithMaxSize(10))
	key := "test-key"
	result := &Result{RowCount: 42}

	// Should be nil initially
	if cache.Get(key) != nil {
		t.Error("expected nil for non-existent key")
	}

	// Set and get
	cache.Set(key, "SELECT 1", nil, result)
	entry := cache.Get(key)
	if entry == nil {
		t.Fatal("expected non-nil entry")
	}
	if entry.Result.RowCount != 42 {
		t.Errorf("RowCount = %d, want 42", entry.Result.RowCount)
	}
}

func TestCache_QueryKey(t *testing.T) {
	cache := NewCache()
	key1 := cache.QueryKey("SELECT * FROM users", []interface{}{"alice"})
	key2 := cache.QueryKey("SELECT * FROM users", []interface{}{"alice"})
	key3 := cache.QueryKey("SELECT * FROM users", []interface{}{"bob"})

	if key1 != key2 {
		t.Error("same query+params should produce same key")
	}
	if key1 == key3 {
		t.Error("different params should produce different keys")
	}
}

func TestCache_Expiry(t *testing.T) {
	cache := NewCache(WithDefaultTTL(50 * time.Millisecond))
	cache.Set("key", "SELECT 1", nil, &Result{RowCount: 1})

	// Should be available immediately
	if cache.Get("key") == nil {
		t.Error("entry should exist immediately after set")
	}

	// Wait for expiry
	time.Sleep(100 * time.Millisecond)
	if cache.Get("key") != nil {
		t.Error("entry should have expired")
	}
}

func TestCache_LRU_Eviction(t *testing.T) {
	cache := NewCache(WithMaxSize(2))

	cache.Set("a", "sql1", nil, &Result{RowCount: 1})
	cache.Set("b", "sql2", nil, &Result{RowCount: 2})
	cache.Set("c", "sql3", nil, &Result{RowCount: 3})

	// "a" should have been evicted (LRU)
	if cache.Get("a") != nil {
		t.Error("'a' should have been evicted")
	}
	if cache.Get("b") == nil {
		t.Error("'b' should still exist")
	}
	if cache.Get("c") == nil {
		t.Error("'c' should still exist")
	}
}

func TestCache_Stats(t *testing.T) {
	cache := NewCache()

	// Miss
	cache.Get("nonexistent")

	// Hit
	cache.Set("exists", "SELECT 1", nil, &Result{})
	cache.Get("exists")
	cache.Get("exists")

	stats := cache.Stats()
	if stats.Hits != 2 {
		t.Errorf("Hits = %d, want 2", stats.Hits)
	}
	if stats.Misses != 1 {
		t.Errorf("Misses = %d, want 1", stats.Misses)
	}
	if stats.Size != 1 {
		t.Errorf("Size = %d, want 1", stats.Size)
	}
}

func TestCache_Clear(t *testing.T) {
	cache := NewCache()
	cache.Set("a", "sql", nil, &Result{})
	cache.Clear()

	if cache.Get("a") != nil {
		t.Error("cache should be empty after Clear()")
	}
}

// ============================================================================
// Pool Tests
// ============================================================================

func TestNewPool(t *testing.T) {
	cfg := DefaultConfig()
	pool := NewPool(cfg, 10)

	if pool.maxConns != 10 {
		t.Errorf("maxConns = %d, want 10", pool.maxConns)
	}
	if pool.maxLifetime != 1*time.Hour {
		t.Errorf("maxLifetime = %v, want 1h", pool.maxLifetime)
	}
	if pool.maxIdle != 10 {
		t.Errorf("maxIdle = %d, want 10", pool.maxIdle)
	}
}

func TestPool_Stats(t *testing.T) {
	cfg := DefaultConfig()
	pool := NewPool(cfg, 5)
	stats := pool.Stats()

	if stats.MaxLifetime != 1*time.Hour {
		t.Errorf("MaxLifetime = %v, want 1h", stats.MaxLifetime)
	}
}

func TestPool_Close(t *testing.T) {
	cfg := DefaultConfig()
	pool := NewPool(cfg, 5)

	err := pool.Close()
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if !pool.closed.Load() {
		t.Error("pool should be closed")
	}
}

func TestPool_Close_Idempotent(t *testing.T) {
	cfg := DefaultConfig()
	pool := NewPool(cfg, 5)

	pool.Close()
	err := pool.Close()
	if err != nil {
		t.Errorf("Close should be idempotent: %v", err)
	}
}

// ============================================================================
// R/W Split Tests
// ============================================================================

func TestIsWriteQuery(t *testing.T) {
	tests := []struct {
		sql  string
		want bool
	}{
		{"SELECT * FROM users", false},
		{"select * from users", false},
		{"  SELECT count(*) FROM t", false},
		{"INSERT INTO users VALUES (1)", true},
		{"UPDATE users SET name='x'", true},
		{"DELETE FROM users", true},
		{"CREATE TABLE t (id INT)", true},
		{"DROP TABLE users", true},
		{"BEGIN", true},
		{"COMMIT", true},
		{"ROLLBACK", true},
		{"ALTER TABLE users ADD col INT", true},
	}

	for _, tt := range tests {
		t.Run(tt.sql, func(t *testing.T) {
			got := isWriteQuery(tt.sql)
			if got != tt.want {
				t.Errorf("isWriteQuery(%q) = %v, want %v", tt.sql, got, tt.want)
			}
		})
	}
}

func TestNodeRole_String(t *testing.T) {
	if RoleReadWrite.String() != "read-write" {
		t.Error("wrong string for RoleReadWrite")
	}
	if RoleReadOnly.String() != "read-only" {
		t.Error("wrong string for RoleReadOnly")
	}
	if RoleWriteOnly.String() != "write-only" {
		t.Error("wrong string for RoleWriteOnly")
	}
}

// ============================================================================
// Load Balancer Tests
// ============================================================================

func TestLoadBalancerStrategy_String(t *testing.T) {
	if RoundRobin.String() != "round-robin" {
		t.Error("wrong string for RoundRobin")
	}
	if Random.String() != "random" {
		t.Error("wrong string for Random")
	}
	if LeastConnections.String() != "least-connections" {
		t.Error("wrong string for LeastConnections")
	}
	if WeightedRoundRobin.String() != "weighted-round-robin" {
		t.Error("wrong string for WeightedRoundRobin")
	}
	if LatencyBased.String() != "latency-based" {
		t.Error("wrong string for LatencyBased")
	}
}

func TestNewLoadBalancer(t *testing.T) {
	nodes := []*BalancedNode{
		{Node: &Node{Name: "n1", Weight: 1, healthy: func() atomic.Bool { var a atomic.Bool; a.Store(true); return a }()}},
	}
	lb := NewLoadBalancer(nodes)
	if lb.strategy != RoundRobin {
		t.Errorf("strategy = %v, want RoundRobin", lb.strategy)
	}
	if lb.NodeCount() != 1 {
		t.Errorf("NodeCount = %d, want 1", lb.NodeCount())
	}
}

func TestLoadBalancer_WaitForHealthy_Timeout(t *testing.T) {
	nodes := []*BalancedNode{}
	lb := NewLoadBalancer(nodes)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := lb.WaitForHealthy(ctx, 1)
	if err == nil {
		t.Error("expected timeout error")
	}
}

// ============================================================================
// Metrics Tests
// ============================================================================

func TestDefaultMetricsCollector(t *testing.T) {
	mc := DefaultMetricsCollector()
	if mc.prefix != "vedadb_" {
		t.Errorf("prefix = %q, want vedadb_", mc.prefix)
	}
}

func TestMetricsCollector_RecordConnectionOpened(t *testing.T) {
	mc := DefaultMetricsCollector()
	mc.RecordConnectionOpened()
	mc.RecordConnectionOpened()
	mc.RecordConnectionClosed()

	snap := mc.Snapshot()
	if snap.ConnectionsOpened != 2 {
		t.Errorf("ConnectionsOpened = %d, want 2", snap.ConnectionsOpened)
	}
	if snap.ConnectionsClosed != 1 {
		t.Errorf("ConnectionsClosed = %d, want 1", snap.ConnectionsClosed)
	}
	if snap.ConnectionsInUse != 1 {
		t.Errorf("ConnectionsInUse = %d, want 1", snap.ConnectionsInUse)
	}
}

func TestMetricsCollector_RecordQuery(t *testing.T) {
	mc := DefaultMetricsCollector()
	mc.RecordQuery(100 * time.Millisecond)
	mc.RecordQuery(200 * time.Millisecond)
	mc.RecordQueryFailure()

	snap := mc.Snapshot()
	if snap.QueriesTotal != 2 {
		t.Errorf("QueriesTotal = %d, want 2", snap.QueriesTotal)
	}
	if snap.QueriesFailed != 1 {
		t.Errorf("QueriesFailed = %d, want 1", snap.QueriesFailed)
	}
}

func TestMetricsCollector_CustomCounters(t *testing.T) {
	mc := DefaultMetricsCollector()
	mc.IncrementCounter("my_counter", 5)
	mc.IncrementCounter("my_counter", 3)

	snap := mc.Snapshot()
	if snap.CustomCounters["my_counter"] != 8 {
		t.Errorf("CustomCounters[my_counter] = %d, want 8", snap.CustomCounters["my_counter"])
	}
}

func TestMetricsCollector_CustomGauges(t *testing.T) {
	mc := DefaultMetricsCollector()
	mc.SetGauge("queue_size", 42)

	snap := mc.Snapshot()
	if snap.CustomGauges["queue_size"] != 42 {
		t.Errorf("CustomGauges[queue_size] = %d, want 42", snap.CustomGauges["queue_size"])
	}
}

func TestMetricsCollector_AverageQueryDuration(t *testing.T) {
	mc := DefaultMetricsCollector()
	mc.RecordQuery(100 * time.Millisecond)
	mc.RecordQuery(200 * time.Millisecond)

	avg := mc.AverageQueryDuration()
	if avg != 150*time.Millisecond {
		t.Errorf("AverageQueryDuration = %v, want 150ms", avg)
	}
}

func TestMetricsCollector_PrometheusFormat(t *testing.T) {
	mc := DefaultMetricsCollector()
	mc.RecordConnectionOpened()
	mc.RecordQuery(50 * time.Millisecond)

	output := mc.PrometheusFormat()
	if !strings.Contains(output, "vedadb_connections_opened_total") {
		t.Error("Prometheus output should contain connections_opened_total")
	}
	if !strings.Contains(output, "vedadb_queries_total") {
		t.Error("Prometheus output should contain queries_total")
	}
}

func TestMetricsCollector_Reset(t *testing.T) {
	mc := DefaultMetricsCollector()
	mc.RecordConnectionOpened()
	mc.RecordQuery(10 * time.Millisecond)
	mc.Reset()

	snap := mc.Snapshot()
	if snap.ConnectionsOpened != 0 {
		t.Errorf("ConnectionsOpened = %d, want 0 after reset", snap.ConnectionsOpened)
	}
	if snap.QueriesTotal != 0 {
		t.Errorf("QueriesTotal = %d, want 0 after reset", snap.QueriesTotal)
	}
}

// ============================================================================
// Circuit Breaker State Tests
// ============================================================================

func TestCircuitState_String(t *testing.T) {
	if StateClosed.String() != "closed" {
		t.Error("wrong string for StateClosed")
	}
	if StateOpen.String() != "open" {
		t.Error("wrong string for StateOpen")
	}
	if StateHalfOpen.String() != "half-open" {
		t.Error("wrong string for StateHalfOpen")
	}
}

// ============================================================================
// Failover Tests
// ============================================================================

func TestFailoverStrategy_String(t *testing.T) {
	if FailoverSequential.String() != "sequential" {
		t.Error("wrong string for FailoverSequential")
	}
	if FailoverRandom.String() != "random" {
		t.Error("wrong string for FailoverRandom")
	}
	if FailoverPriority.String() != "priority" {
		t.Error("wrong string for FailoverPriority")
	}
}

func TestNewFailoverManager(t *testing.T) {
	nodes := []*FailoverNode{
		{Name: "n1", Priority: 1},
		{Name: "n2", Priority: 2},
	}
	fm := NewFailoverManager(nodes)

	if fm.NodeCount() != 2 {
		t.Errorf("NodeCount = %d, want 2", fm.NodeCount())
	}
	if fm.strategy != FailoverSequential {
		t.Error("default strategy should be sequential")
	}
	if fm.maxRetries != 3 {
		t.Errorf("maxRetries = %d, want 3", fm.maxRetries)
	}
}

func TestFailoverManager_Options(t *testing.T) {
	nodes := []*FailoverNode{{Name: "n1"}}
	fm := NewFailoverManager(nodes,
		WithFailoverStrategy(FailoverRandom),
		WithMaxRetries(5),
		WithRetryDelay(2*time.Second),
	)

	if fm.strategy != FailoverRandom {
		t.Error("strategy should be Random")
	}
	if fm.maxRetries != 5 {
		t.Errorf("maxRetries = %d, want 5", fm.maxRetries)
	}
	if fm.retryDelay != 2*time.Second {
		t.Errorf("retryDelay = %v, want 2s", fm.retryDelay)
	}
}

func TestFailoverManager_Stats(t *testing.T) {
	nodes := []*FailoverNode{
		{Name: "n1", Priority: 1, healthy: func() atomic.Bool { var a atomic.Bool; a.Store(true); return a }()},
		{Name: "n2", Priority: 2, healthy: func() atomic.Bool { var a atomic.Bool; a.Store(false); return a }()},
	}
	fm := NewFailoverManager(nodes)
	stats := fm.Stats()

	if stats.TotalNodes != 2 {
		t.Errorf("TotalNodes = %d, want 2", stats.TotalNodes)
	}
	if stats.HealthyNodes != 1 {
		t.Errorf("HealthyNodes = %d, want 1", stats.HealthyNodes)
	}
}

// ============================================================================
// Sentinel Tests
// ============================================================================

func TestNewSentinel(t *testing.T) {
	sentinels := []*SentinelNode{
		{Name: "s1", Host: "localhost", Port: 26379},
		{Name: "s2", Host: "localhost", Port: 26380},
		{Name: "s3", Host: "localhost", Port: 26381},
	}
	s := NewSentinel(sentinels, "mymaster")

	if s.masterName != "mymaster" {
		t.Errorf("masterName = %q, want mymaster", s.masterName)
	}
	if s.quorum != 2 { // majority of 3
		t.Errorf("quorum = %d, want 2", s.quorum)
	}
	if s.checkInterval != 5*time.Second {
		t.Errorf("checkInterval = %v, want 5s", s.checkInterval)
	}
}

func TestSentinel_Options(t *testing.T) {
	sentinels := []*SentinelNode{{Name: "s1"}}
	s := NewSentinel(sentinels, "test",
		WithCheckInterval(1*time.Second),
		WithQuorum(1),
	)

	if s.checkInterval != 1*time.Second {
		t.Error("checkInterval should be 1s")
	}
	if s.quorum != 1 {
		t.Errorf("quorum = %d, want 1", s.quorum)
	}
}

func TestSentinel_IsRunning(t *testing.T) {
	s := NewSentinel([]*SentinelNode{{Name: "s1"}}, "test")
	if s.IsRunning() {
		t.Error("should not be running initially")
	}
}

// ============================================================================
// Migration Tests
// ============================================================================

func TestNewMigrator(t *testing.T) {
	// migrator needs a client, but we can still test the struct creation
	m := NewMigrator(nil)
	if m.tableName != "schema_migrations" {
		t.Errorf("tableName = %q, want schema_migrations", m.tableName)
	}
}

func TestMigrator_WithMigrationTable(t *testing.T) {
	m := NewMigrator(nil, WithMigrationTable("migrations"))
	if m.tableName != "migrations" {
		t.Errorf("tableName = %q, want migrations", m.tableName)
	}
}

func TestMigrator_AddMigration(t *testing.T) {
	m := NewMigrator(nil)
	m.AddMigration(Migration{Version: 1, Name: "init", Up: "CREATE TABLE t (id INT)"})

	if len(m.migrations) != 1 {
		t.Errorf("len(migrations) = %d, want 1", len(m.migrations))
	}
}

func TestMigrator_AddMigrationSimple(t *testing.T) {
	m := NewMigrator(nil)
	m.AddMigrationSimple(1, "init", "CREATE TABLE t (id INT)", "DROP TABLE t")

	if len(m.migrations) != 1 {
		t.Errorf("len(migrations) = %d, want 1", len(m.migrations))
	}
	if m.migrations[0].Version != 1 {
		t.Errorf("Version = %d, want 1", m.migrations[0].Version)
	}
}

func TestGenerateMigrationName(t *testing.T) {
	name := GenerateMigrationName("create users table")
	if !strings.Contains(name, "create_users_table") {
		t.Errorf("name = %q, should contain create_users_table", name)
	}
}

func TestParseMigrationFileName(t *testing.T) {
	version, name, err := ParseMigrationFileName("20240101120000_create_users.sql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if version != 20240101120000 {
		t.Errorf("version = %d, want 20240101120000", version)
	}
	if name != "create_users" {
		t.Errorf("name = %q, want create_users", name)
	}
}

func TestParseMigrationFileName_Invalid(t *testing.T) {
	_, _, err := ParseMigrationFileName("invalid.sql")
	if err == nil {
		t.Error("expected error for invalid filename")
	}
}

func TestMigrationStatus_HasPending(t *testing.T) {
	s := &MigrationStatus{Pending: []Migration{{Version: 1}}}
	if !s.HasPending() {
		t.Error("should have pending migrations")
	}

	s2 := &MigrationStatus{}
	if s2.HasPending() {
		t.Error("should not have pending migrations")
	}
}

// ============================================================================
// Interceptor Tests
// ============================================================================

func TestNewInterceptorChain(t *testing.T) {
	chain := NewInterceptorChain()
	if chain.Len() != 0 {
		t.Errorf("Len = %d, want 0", chain.Len())
	}
}

func TestInterceptorChain_Add(t *testing.T) {
	chain := NewInterceptorChain()
	chain.Add(func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		return next(ctx, sql, args)
	})
	if chain.Len() != 1 {
		t.Errorf("Len = %d, want 1", chain.Len())
	}
}

func TestInterceptorChain_Clear(t *testing.T) {
	chain := NewInterceptorChain()
	chain.Add(func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		return next(ctx, sql, args)
	})
	chain.Clear()
	if chain.Len() != 0 {
		t.Errorf("Len = %d, want 0 after Clear", chain.Len())
	}
}

func TestInterceptorChain_Remove(t *testing.T) {
	chain := NewInterceptorChain()
	chain.Add(func(ctx context.Context, sql string, args []interface{}, next Handler) (*Result, error) {
		return next(ctx, sql, args)
	})

	err := chain.Remove(0)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if chain.Len() != 0 {
		t.Errorf("Len = %d, want 0", chain.Len())
	}

	err = chain.Remove(0)
	if err == nil {
		t.Error("expected error for out of range")
	}
}

func TestTimeoutInterceptor(t *testing.T) {
	interceptor := TimeoutInterceptor(50 * time.Millisecond)

	handler := func(ctx context.Context, sql string, args []interface{}) (*Result, error) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
			return nil, errors.New("should have timed out")
		}
	}

	ctx := context.Background()
	_, err := interceptor(ctx, "SELECT 1", nil, handler)
	if err == nil {
		t.Error("expected timeout error")
	}
}

func TestValidationInterceptor(t *testing.T) {
	interceptor := ValidationInterceptor(100)

	_, err := interceptor(context.Background(), strings.Repeat("a", 101), nil, func(ctx context.Context, sql string, args []interface{}) (*Result, error) {
		return nil, nil
	})
	if err == nil {
		t.Error("expected validation error for oversized query")
	}

	_, err = interceptor(context.Background(), "SELECT 1", nil, func(ctx context.Context, sql string, args []interface{}) (*Result, error) {
		return nil, nil
	})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

// ============================================================================
// Pub/Sub Tests
// ============================================================================

func TestNewPubSub(t *testing.T) {
	ps := NewPubSub(nil)
	if ps == nil {
		t.Error("NewPubSub should not return nil")
	}
	if len(ps.subscribers) != 0 {
		t.Error("subscribers should be empty")
	}
}

func TestPubSub_Publish_Validation(t *testing.T) {
	ps := NewPubSub(nil)
	_, err := ps.Publish(context.Background(), "", "msg")
	if err == nil {
		t.Error("expected error for empty channel")
	}
}

func TestPubSub_Subscribe_Validation(t *testing.T) {
	ps := NewPubSub(nil)
	_, err := ps.Subscribe(context.Background())
	if err == nil {
		t.Error("expected error for no channels")
	}
}

// ============================================================================
// Streams Tests
// ============================================================================

func TestChangeEvent_String(t *testing.T) {
	e := &ChangeEvent{
		OperationType: "INSERT",
		Table:         "users",
		DocumentKey:   "42",
		LSN:           123,
	}
	s := e.String()
	if !strings.Contains(s, "INSERT") {
		t.Error("String should contain operation type")
	}
	if !strings.Contains(s, "users") {
		t.Error("String should contain table")
	}
}

func TestDefaultWatchOptions(t *testing.T) {
	opts := DefaultWatchOptions()
	if !opts.FullDocument {
		t.Error("FullDocument should be true")
	}
	if opts.HeartbeatInterval != 30*time.Second {
		t.Errorf("HeartbeatInterval = %v, want 30s", opts.HeartbeatInterval)
	}
}

func TestShouldIncludeEvent(t *testing.T) {
	event := &ChangeEvent{OperationType: "INSERT"}

	if !shouldIncludeEvent(event, WatchOptions{}) {
		t.Error("should include with no filter")
	}

	if shouldIncludeEvent(event, WatchOptions{OperationTypes: []string{"UPDATE"}}) {
		t.Error("should not include filtered-out type")
	}

	if !shouldIncludeEvent(event, WatchOptions{OperationTypes: []string{"INSERT", "UPDATE"}}) {
		t.Error("should include matching type")
	}
}

func TestNewChangeStream(t *testing.T) {
	ch := make(<-chan *ChangeEvent)
	cs := NewChangeStream(ch, func() {})
	if cs == nil {
		t.Error("NewChangeStream should not return nil")
	}
}

// ============================================================================
// Cursor Tests
// ============================================================================

func TestCursor_Next_Closed(t *testing.T) {
	c := &Cursor{closed: true}
	if c.Next() {
		t.Error("Next should return false for closed cursor")
	}
}

func TestCursor_Scan_Closed(t *testing.T) {
	c := &Cursor{closed: true}
	err := c.Scan("dest")
	if err == nil {
		t.Error("Scan should return error for closed cursor")
	}
}

func TestCursor_Close(t *testing.T) {
	c := &Cursor{current: []Row{{"id": "1"}}, closed: false}
	err := c.Close()
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if !c.closed {
		t.Error("cursor should be closed")
	}
	if c.current != nil {
		t.Error("current should be nil after close")
	}
}

func TestCursor_Close_Idempotent(t *testing.T) {
	c := &Cursor{closed: true}
	err := c.Close()
	if err != nil {
		t.Error("Close should be idempotent")
	}
}

func TestRowsToMaps(t *testing.T) {
	columns := []string{"id", "name"}
	rows := [][]string{{"1", "alice"}, {"2", "bob"}}

	result := rowsToMaps(rows, columns)
	if len(result) != 2 {
		t.Fatalf("len = %d, want 2", len(result))
	}
	if result[0]["name"] != "alice" {
		t.Errorf("name = %q, want alice", result[0]["name"])
	}
	if result[1]["name"] != "bob" {
		t.Errorf("name = %q, want bob", result[1]["name"])
	}
}

func TestScanValue(t *testing.T) {
	var s string
	if err := scanValue("hello", &s); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if s != "hello" {
		t.Errorf("s = %q, want hello", s)
	}

	var i int
	if err := scanValue("42", &i); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if i != 42 {
		t.Errorf("i = %d, want 42", i)
	}

	var b bool
	if err := scanValue("true", &b); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if !b {
		t.Error("b should be true")
	}

	var f float64
	if err := scanValue("3.14", &f); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if f != 3.14 {
		t.Errorf("f = %f, want 3.14", f)
	}
}

// ============================================================================
// Bulk Tests
// ============================================================================

func TestBulkInserter_Buffered(t *testing.T) {
	bi := &BulkInserter{
		Table:     "users",
		BatchSize: 5,
		buffer:    make([]map[string]interface{}, 0, 5),
	}

	if bi.Buffered() != 0 {
		t.Errorf("Buffered = %d, want 0", bi.Buffered())
	}

	bi.buffer = append(bi.buffer, map[string]interface{}{"name": "alice"})
	if bi.Buffered() != 1 {
		t.Errorf("Buffered = %d, want 1", bi.Buffered())
	}
}

func TestBulkInserter_Add_NilRow(t *testing.T) {
	bi := &BulkInserter{
		buffer: make([]map[string]interface{}, 0),
	}
	err := bi.Add(nil)
	if err == nil {
		t.Error("expected error for nil row")
	}
}

func TestBulkInserter_Closed(t *testing.T) {
	bi := &BulkInserter{closed: true}
	err := bi.Add(map[string]interface{}{"a": 1})
	if err == nil {
		t.Error("expected error for closed inserter")
	}
}

func TestPipeline(t *testing.T) {
	p := &Pipeline{cmds: make([]pipelineCmd, 0)}
	p.Query("SELECT 1").Execute("INSERT INTO t VALUES (1)")

	if p.Len() != 2 {
		t.Errorf("Len = %d, want 2", p.Len())
	}
}

func TestPipeline_Clear(t *testing.T) {
	p := &Pipeline{cmds: make([]pipelineCmd, 0)}
	p.Query("SELECT 1")
	p.Clear()
	if p.Len() != 0 {
		t.Errorf("Len = %d, want 0 after Clear", p.Len())
	}
}

// ============================================================================
// ORM Tests
// ============================================================================

func TestToSnakeCase(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"User", "user"},
		{"UserName", "user_name"},
		{"HTTPServer", "h_t_t_p_server"},
		{"ID", "i_d"},
		{"simple", "simple"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := toSnakeCase(tt.input)
			if got != tt.want {
				t.Errorf("toSnakeCase(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseTags(t *testing.T) {
	type TestStruct struct {
		ID   int    `vedadb:"primary:true;auto:true"`
		Name string `json:"name" column:"user_name"`
		Skip string `vedadb:"-"`
	}

	typeInfo := reflect.TypeOf(TestStruct{})

	// ID field
	idField, _ := typeInfo.FieldByName("ID")
	tags := parseTags(idField.Tag)
	if tags["primary"] != "true" {
		t.Error("primary tag should be true")
	}
	if tags["auto"] != "true" {
		t.Error("auto tag should be true")
	}

	// Name field
	nameField, _ := typeInfo.FieldByName("Name")
	nameTags := parseTags(nameField.Tag)
	if nameTags["column"] != "user_name" {
		t.Errorf("column = %q, want user_name", nameTags["column"])
	}

	// Skip field
	skipField, _ := typeInfo.FieldByName("Skip")
	skipTags := parseTags(skipField.Tag)
	if skipTags["vedadb"] != "-" {
		t.Error("skip tag should be -")
	}
}

func TestGoTypeToSQLType(t *testing.T) {
	tests := []struct {
		goType     reflect.Type
		isAuto     bool
		isNullable bool
		want       string
	}{
		{reflect.TypeOf(""), false, false, "TEXT NOT NULL"},
		{reflect.TypeOf(int(0)), false, false, "INTEGER NOT NULL"},
		{reflect.TypeOf(int64(0)), true, false, "INTEGER AUTOINCREMENT"},
		{reflect.TypeOf(float64(0)), false, false, "DOUBLE NOT NULL"},
		{reflect.TypeOf(true), false, false, "BOOLEAN NOT NULL"},
		{reflect.TypeOf(""), false, true, "TEXT"},
	}

	for _, tt := range tests {
		t.Run(tt.goType.String(), func(t *testing.T) {
			got := goTypeToSQLType(tt.goType, tt.isAuto, tt.isNullable)
			if got != tt.want {
				t.Errorf("goTypeToSQLType() = %q, want %q", got, tt.want)
			}
		})
	}
}

// ============================================================================
// Bulk Client Tests
// ============================================================================

func TestNewClient(t *testing.T) {
	cfg := DefaultConfig()
	client, err := NewClient(cfg)
	if err != nil {
		t.Skipf("cannot create client: %v", err)
	}
	defer client.Close()

	if client.proto == nil {
		t.Error("proto should not be nil")
	}
	if client.breaker == nil {
		t.Error("breaker should not be nil")
	}
	if client.retryPolicy == nil {
		t.Error("retryPolicy should not be nil")
	}
}

func TestClient_WithCircuitBreaker(t *testing.T) {
	cfg := DefaultConfig()
	client, err := NewClient(cfg)
	if err != nil {
		t.Skipf("cannot create client: %v", err)
	}
	defer client.Close()

	newBreaker := DefaultCircuitBreaker()
	result := client.WithCircuitBreaker(newBreaker)
	if result != client {
		t.Error("WithCircuitBreaker should return the same client")
	}
}

func TestClient_WithRetryPolicy(t *testing.T) {
	cfg := DefaultConfig()
	client, err := NewClient(cfg)
	if err != nil {
		t.Skipf("cannot create client: %v", err)
	}
	defer client.Close()

	newPolicy := DefaultRetryPolicy()
	result := client.WithRetryPolicy(newPolicy)
	if result != client {
		t.Error("WithRetryPolicy should return the same client")
	}
}

func TestClient_NewBulkInserter(t *testing.T) {
	cfg := DefaultConfig()
	client, err := NewClient(cfg)
	if err != nil {
		t.Skipf("cannot create client: %v", err)
	}
	defer client.Close()

	bi := client.NewBulkInserter("users", 500)
	if bi.Table != "users" {
		t.Errorf("Table = %q, want users", bi.Table)
	}
	if bi.BatchSize != 500 {
		t.Errorf("BatchSize = %d, want 500", bi.BatchSize)
	}
}

func TestClient_NewBulkInserter_DefaultSize(t *testing.T) {
	cfg := DefaultConfig()
	client, err := NewClient(cfg)
	if err != nil {
		t.Skipf("cannot create client: %v", err)
	}
	defer client.Close()

	bi := client.NewBulkInserter("users", 0)
	if bi.BatchSize != 1000 {
		t.Errorf("BatchSize = %d, want 1000 (default)", bi.BatchSize)
	}
}

// ============================================================================
// DSN Tests (existing functionality)
// ============================================================================

func TestParseDSN(t *testing.T) {
	dsn := "vedadb://admin:secret@localhost:8080/mydb?timeout=60"
	cfg, err := ParseDSN(dsn)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Host != "localhost" {
		t.Errorf("Host = %q", cfg.Host)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d", cfg.Port)
	}
	if cfg.Username != "admin" {
		t.Errorf("Username = %q", cfg.Username)
	}
	if cfg.Database != "mydb" {
		t.Errorf("Database = %q", cfg.Database)
	}
}

// ============================================================================
// Concurrency Tests
// ============================================================================

func TestRetryPolicy_ConcurrentExecute(t *testing.T) {
	rp := &RetryPolicy{
		MaxRetries: 3,
		BaseDelay:  1 * time.Millisecond,
		MaxDelay:   10 * time.Millisecond,
		Jitter:     false,
	}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := rp.Execute(context.Background(), func() error {
				return nil
			})
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		}()
	}
	wg.Wait()
}

func TestCircuitBreaker_ConcurrentCalls(t *testing.T) {
	cb := NewCircuitBreaker(100, 1*time.Second)

	var wg sync.WaitGroup
	successes := atomic.Int32{}
	failures := atomic.Int32{}

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := cb.Call(func() error {
				return nil
			})
			if err == nil {
				successes.Add(1)
			} else {
				failures.Add(1)
			}
		}()
	}
	wg.Wait()

	if successes.Load() != 50 {
		t.Errorf("successes = %d, want 50", successes.Load())
	}
	if failures.Load() != 0 {
		t.Errorf("failures = %d, want 0", failures.Load())
	}
}

func TestCache_ConcurrentAccess(t *testing.T) {
	cache := NewCache(WithMaxSize(100))
	result := &Result{RowCount: 1}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := fmt.Sprintf("key-%d", n%5)
			cache.Set(key, "SELECT 1", nil, result)
			cache.Get(key)
		}(i)
	}
	wg.Wait()
}

func TestMetricsCollector_Concurrent(t *testing.T) {
	mc := DefaultMetricsCollector()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			mc.RecordConnectionOpened()
		}()
		go func() {
			defer wg.Done()
			mc.RecordQuery(1 * time.Millisecond)
		}()
	}
	wg.Wait()

	snap := mc.Snapshot()
	if snap.ConnectionsOpened != 100 {
		t.Errorf("ConnectionsOpened = %d, want 100", snap.ConnectionsOpened)
	}
	if snap.QueriesTotal != 100 {
		t.Errorf("QueriesTotal = %d, want 100", snap.QueriesTotal)
	}
}
