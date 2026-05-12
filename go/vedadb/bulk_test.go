// bulk_test.go — Bulk operations tests for VedaDB Go driver
package vedadb

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// BulkInserter handles batch insert operations
type BulkInserter struct {
	client      *Client
	table       string
	columns     []string
	batchSize   int
	buffer      []map[string]interface{}
	mu          sync.Mutex
	totalSent   int64
	totalErrors int64
	flushed     chan struct{}
}

func NewBulkInserter(client *Client, table string, columns []string, batchSize int) *BulkInserter {
	return &BulkInserter{
		client:    client,
		table:     table,
		columns:   columns,
		batchSize: batchSize,
		buffer:    make([]map[string]interface{}, 0, batchSize),
		flushed:   make(chan struct{}, 1),
	}
}

func (bi *BulkInserter) Insert(ctx context.Context, row map[string]interface{}) error {
	bi.mu.Lock()
	defer bi.mu.Unlock()

	bi.buffer = append(bi.buffer, row)

	if len(bi.buffer) >= bi.batchSize {
		return bi.flushLocked(ctx)
	}
	return nil
}

func (bi *BulkInserter) Flush(ctx context.Context) error {
	bi.mu.Lock()
	defer bi.mu.Unlock()
	return bi.flushLocked(ctx)
}

func (bi *BulkInserter) flushLocked(ctx context.Context) error {
	if len(bi.buffer) == 0 {
		return nil
	}

	// Mock: send buffer to server
	atomic.AddInt64(&bi.totalSent, int64(len(bi.buffer)))
	bi.buffer = bi.buffer[:0]
	select {
	case bi.flushed <- struct{}{}:
	default:
	}
	return nil
}

func (bi *BulkInserter) TotalSent() int64 {
	return atomic.LoadInt64(&bi.totalSent)
}

func (bi *BulkInserter) Close(ctx context.Context) error {
	return bi.Flush(ctx)
}

// Pipeline handles pipelined operations
type Pipeline struct {
	client   *Client
	commands []pipelineCmd
	mu       sync.Mutex
}

type pipelineCmd struct {
	sql    string
	params []interface{}
}

func NewPipeline(client *Client) *Pipeline {
	return &Pipeline{
		client:   client,
		commands: make([]pipelineCmd, 0),
	}
}

func (p *Pipeline) Add(sql string, params ...interface{}) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.commands = append(p.commands, pipelineCmd{sql: sql, params: params})
}

func (p *Pipeline) Execute(ctx context.Context) ([]Result, error) {
	p.mu.Lock()
	commands := make([]pipelineCmd, len(p.commands))
	copy(commands, p.commands)
	p.commands = p.commands[:0]
	p.mu.Unlock()

	results := make([]Result, 0, len(commands))
	for range commands {
		results = append(results, Result{RowsAffected: 1})
	}
	return results, nil
}

func (p *Pipeline) Len() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.commands)
}

func TestBulkInsert(t *testing.T) {
	t.Run("single_row", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		bi := NewBulkInserter(client, "users", []string{"name", "age"}, 10)

		err := bi.Insert(context.Background(), map[string]interface{}{
			"name": "Alice",
			"age":  30,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bi.TotalSent() != 0 {
			t.Error("expected 0 sent (buffer not full)")
		}
	})

	t.Run("auto_flush_on_batch_size", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		bi := NewBulkInserter(client, "users", []string{"name", "age"}, 3)

		for i := 0; i < 3; i++ {
			err := bi.Insert(context.Background(), map[string]interface{}{
				"name": "User",
				"age":  i,
			})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		}

		// Should have auto-flushed
		if bi.TotalSent() != 3 {
			t.Errorf("expected 3 sent, got %d", bi.TotalSent())
		}
	})

	t.Run("explicit_flush", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		bi := NewBulkInserter(client, "users", []string{"name", "age"}, 100)

		for i := 0; i < 5; i++ {
			bi.Insert(context.Background(), map[string]interface{}{
				"name": "User",
				"age":  i,
			})
		}

		err := bi.Flush(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bi.TotalSent() != 5 {
			t.Errorf("expected 5 sent, got %d", bi.TotalSent())
		}
	})

	t.Run("close_flushes_remaining", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		bi := NewBulkInserter(client, "users", []string{"name", "age"}, 100)

		for i := 0; i < 7; i++ {
			bi.Insert(context.Background(), map[string]interface{}{"id": i})
		}

		err := bi.Close(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bi.TotalSent() != 7 {
			t.Errorf("expected 7 sent after close, got %d", bi.TotalSent())
		}
	})
}

func TestBulkInsertBatching(t *testing.T) {
	t.Run("multiple_batches", func(t *testing.T) {
		flushCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			flushCount++
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse(map[string]interface{}{"inserted": 5}, ""))
		}))
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()
		bi := NewBulkInserter(client, "users", []string{"name"}, 5)

		for i := 0; i < 12; i++ {
			bi.Insert(context.Background(), map[string]interface{}{"name": "User"})
		}
		bi.Flush(context.Background())

		if bi.TotalSent() != 12 {
			t.Errorf("expected 12 sent, got %d", bi.TotalSent())
		}
	})

	t.Run("batch_size_1", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		bi := NewBulkInserter(client, "users", []string{"name"}, 1)

		err := bi.Insert(context.Background(), map[string]interface{}{"name": "Alice"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bi.TotalSent() != 1 {
			t.Errorf("expected 1 sent immediately, got %d", bi.TotalSent())
		}
	})

	t.Run("concurrent_inserts", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		bi := NewBulkInserter(client, "users", []string{"name"}, 50)
		var wg sync.WaitGroup

		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func(n int) {
				defer wg.Done()
				bi.Insert(context.Background(), map[string]interface{}{"id": n})
			}(i)
		}
		wg.Wait()
		bi.Flush(context.Background())

		if bi.TotalSent() != 100 {
			t.Errorf("expected 100 sent, got %d", bi.TotalSent())
		}
	})

	t.Run("empty_flush_no_op", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		bi := NewBulkInserter(client, "users", []string{"name"}, 10)

		err := bi.Flush(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bi.TotalSent() != 0 {
			t.Errorf("expected 0 sent, got %d", bi.TotalSent())
		}
	})
}

func TestPipeline(t *testing.T) {
	t.Run("add_commands", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		pipe := NewPipeline(client)

		pipe.Add("INSERT INTO users (name) VALUES (?)", "Alice")
		pipe.Add("INSERT INTO users (name) VALUES (?)", "Bob")

		if pipe.Len() != 2 {
			t.Errorf("expected 2 commands, got %d", pipe.Len())
		}
	})

	t.Run("execute_returns_results", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		pipe := NewPipeline(client)

		for i := 0; i < 3; i++ {
			pipe.Add("INSERT INTO users (name) VALUES (?)", "User")
		}

		results, err := pipe.Execute(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(results) != 3 {
			t.Errorf("expected 3 results, got %d", len(results))
		}

		// Pipeline should be cleared
		if pipe.Len() != 0 {
			t.Errorf("expected empty pipeline after execute, got %d", pipe.Len())
		}
	})

	t.Run("execute_empty_pipeline", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		pipe := NewPipeline(client)

		results, err := pipe.Execute(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(results) != 0 {
			t.Errorf("expected 0 results, got %d", len(results))
		}
	})

	t.Run("concurrent_add", func(t *testing.T) {
		client := &Client{endpoint: "mock"}
		pipe := NewPipeline(client)
		var wg sync.WaitGroup

		for i := 0; i < 50; i++ {
			wg.Add(1)
			go func(n int) {
				defer wg.Done()
				pipe.Add("INSERT INTO t VALUES (?)", n)
			}(i)
		}
		wg.Wait()

		if pipe.Len() != 50 {
			t.Errorf("expected 50 commands, got %d", pipe.Len())
		}
	})
}
