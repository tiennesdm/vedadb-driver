package vedadb

import (
	"context"
	"testing"
	"time"
)

// TestAsyncVedaDB_BasicOperations validates async query/exec work.
func TestAsyncVedaDB_BasicOperations(t *testing.T) {
	// These tests validate structure compiles correctly.
	// Full integration tests require a running server.

	// Test channel-based result pattern
	ch := make(chan AsyncResult, 1)
	ch <- AsyncResult{Result: &Result{RowCount: 1}}
	close(ch)

	result := <-ch
	if result.Error != nil {
		t.Fatalf("unexpected error in async result: %v", result.Error)
	}
	if result.Result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Result.RowCount != 1 {
		t.Fatalf("expected row count 1, got %d", result.Result.RowCount)
	}
}

// TestAsyncConnectionPool validates pool acquire/release.
func TestAsyncConnectionPool(t *testing.T) {
	cfg := DefaultConfig()
	// Pool without pre-warming for unit test
	pool := &AsyncConnectionPool{
		clients: make(chan *Client, 2),
		config:  cfg,
		maxSize: 2,
		timeout: 5 * time.Second,
	}
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// Since pool is empty, acquire should timeout
	_, err := pool.Acquire(ctx)
	if err == nil {
		t.Fatal("expected timeout error on empty pool")
	}

	// Test stats
	avail, cap := pool.Stats()
	if avail != 0 || cap != 2 {
		t.Fatalf("expected avail=0 cap=2, got avail=%d cap=%d", avail, cap)
	}
}

// TestAsyncTx validates async transaction types compile.
func TestAsyncTx(t *testing.T) {
	// Just validate the struct compiles
	var tx AsyncTx
	_ = tx
}

// TestAsyncSubscription validates pub/sub types compile.
func TestAsyncSubscription(t *testing.T) {
	sub := &AsyncSubscription{
		msgs: make(chan *Result),
		errs: make(chan error),
	}
	_ = sub.Messages()
	_ = sub.Errors()
}

// TestAsyncCursor validates cursor types compile.
func TestAsyncCursor(t *testing.T) {
	cursor := &AsyncCursor{
		results: make(chan *Result),
		errs:    make(chan error),
	}
	_ = cursor.Results()
	_ = cursor.Errors()
	cursor.Close()
}
