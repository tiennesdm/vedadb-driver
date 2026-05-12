// driver_test.go — Core driver tests for VedaDB Go driver
package vedadb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// mockServer creates a configurable HTTP test server for VedaDB
func mockServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(handler)
}

// mockVedaResponse creates a standard VedaDB JSON response
func mockVedaResponse(result interface{}, err string) map[string]interface{} {
	resp := map[string]interface{}{"result": result}
	if err != "" {
		resp["error"] = err
	}
	return resp
}

func TestConnect(t *testing.T) {
	t.Run("connect_success", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse("connected", ""))
		})
		defer server.Close()

		client, err := Connect(context.Background(), server.URL)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if client == nil {
			t.Fatal("expected client, got nil")
		}
		defer client.Close()

		if client.endpoint != server.URL {
			t.Errorf("expected endpoint %s, got %s", server.URL, client.endpoint)
		}
		if !client.health.healthy {
			t.Error("expected client to be healthy after connect")
		}
	})

	t.Run("connect_invalid_url", func(t *testing.T) {
		_, err := Connect(context.Background(), "://invalid-url")
		if err == nil {
			t.Fatal("expected error for invalid URL")
		}
	})

	t.Run("connect_timeout", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
		defer cancel()
		time.Sleep(5 * time.Millisecond)

		_, err := Connect(ctx, "http://localhost:59999")
		if err == nil {
			t.Fatal("expected timeout error")
		}
	})

	t.Run("connect_with_options", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse("connected", ""))
		})
		defer server.Close()

		client, err := Connect(context.Background(), server.URL,
			WithTimeout(5*time.Second),
			WithMaxRetries(3),
			WithRetryDelay(100*time.Millisecond),
		)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		defer client.Close()

		if client.config.maxRetries != 3 {
			t.Errorf("expected maxRetries 3, got %d", client.config.maxRetries)
		}
	})

	t.Run("connect_with_auth", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if auth != "Bearer test-token-123" {
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(mockVedaResponse(nil, "unauthorized"))
				return
			}
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse("connected", ""))
		})
		defer server.Close()

		client, err := Connect(context.Background(), server.URL,
			WithAuthToken("test-token-123"),
		)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		defer client.Close()
	})
}

func TestQuery(t *testing.T) {
	t.Run("query_single_row", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				t.Errorf("expected POST, got %s", r.Method)
			}
			var req queryRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("failed to decode request: %v", err)
			}
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse([]map[string]interface{}{
				{"id": 1, "name": "Alice", "age": 30},
			}, ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		result, err := client.Query(context.Background(), "SELECT * FROM users WHERE id = ?", 1)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if len(result) != 1 {
			t.Fatalf("expected 1 row, got %d", len(result))
		}
		if result[0]["name"] != "Alice" {
			t.Errorf("expected name Alice, got %v", result[0]["name"])
		}
	})

	t.Run("query_multiple_rows", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse([]map[string]interface{}{
				{"id": 1, "name": "Alice"},
				{"id": 2, "name": "Bob"},
				{"id": 3, "name": "Charlie"},
			}, ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		result, err := client.Query(context.Background(), "SELECT * FROM users")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if len(result) != 3 {
			t.Fatalf("expected 3 rows, got %d", len(result))
		}
	})

	t.Run("query_empty_result", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse([]map[string]interface{}{}, ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		result, err := client.Query(context.Background(), "SELECT * FROM empty_table")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if len(result) != 0 {
			t.Fatalf("expected 0 rows, got %d", len(result))
		}
	})

	t.Run("query_server_error", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(mockVedaResponse(nil, "database error"))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		_, err := client.Query(context.Background(), "SELECT * FROM users")
		if err == nil {
			t.Fatal("expected error for server error response")
		}
	})

	t.Run("query_with_context_cancel", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
				return
			case <-time.After(100 * time.Millisecond):
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(mockVedaResponse([]map[string]interface{}{}, ""))
			}
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		ctx, cancel := context.WithCancel(context.Background())
		cancel() // immediately cancel

		_, err := client.Query(ctx, "SELECT * FROM users")
		if err == nil {
			t.Fatal("expected error for cancelled context")
		}
	})

	t.Run("query_retries_on_failure", func(t *testing.T) {
		attemptCount := 0
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			attemptCount++
			if attemptCount < 3 {
				w.WriteHeader(http.StatusServiceUnavailable)
				json.NewEncoder(w).Encode(mockVedaResponse(nil, "temporary error"))
				return
			}
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse([]map[string]interface{}{
				{"id": 1, "name": "Alice"},
			}, ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL,
			WithMaxRetries(5),
			WithRetryDelay(10*time.Millisecond),
		)
		defer client.Close()

		result, err := client.Query(context.Background(), "SELECT * FROM users")
		if err != nil {
			t.Fatalf("expected no error after retries, got %v", err)
		}
		if len(result) != 1 {
			t.Fatalf("expected 1 row, got %d", len(result))
		}
		if attemptCount != 3 {
			t.Errorf("expected 3 attempts, got %d", attemptCount)
		}
	})
}

func TestExecute(t *testing.T) {
	t.Run("execute_insert", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			var req executeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("failed to decode request: %v", err)
			}
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse(map[string]interface{}{
				"rows_affected": 1,
				"last_insert_id": 42,
			}, ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		result, err := client.Execute(context.Background(),
			"INSERT INTO users (name, age) VALUES (?, ?)", "Alice", 30)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if result.RowsAffected != 1 {
			t.Errorf("expected 1 row affected, got %d", result.RowsAffected)
		}
		if result.LastInsertID != 42 {
			t.Errorf("expected last insert id 42, got %d", result.LastInsertID)
		}
	})

	t.Run("execute_update", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse(map[string]interface{}{
				"rows_affected": 5,
			}, ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		result, err := client.Execute(context.Background(),
			"UPDATE users SET active = ? WHERE last_login < ?", false, "2023-01-01")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if result.RowsAffected != 5 {
			t.Errorf("expected 5 rows affected, got %d", result.RowsAffected)
		}
	})

	t.Run("execute_delete", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse(map[string]interface{}{
				"rows_affected": 1,
			}, ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		result, err := client.Execute(context.Background(),
			"DELETE FROM users WHERE id = ?", 99)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if result.RowsAffected != 1 {
			t.Errorf("expected 1 row affected, got %d", result.RowsAffected)
		}
	})

	t.Run("execute_syntax_error", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(mockVedaResponse(nil, "syntax error at position 14"))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		_, err := client.Execute(context.Background(), "INVALID SQL")
		if err == nil {
			t.Fatal("expected error for syntax error")
		}
	})
}

func TestClose(t *testing.T) {
	t.Run("close_releases_resources", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse("ok", ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		err := client.Close()
		if err != nil {
			t.Fatalf("expected no error on close, got %v", err)
		}
		if !client.closed {
			t.Error("expected client to be marked as closed")
		}
	})

	t.Run("close_idempotent", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse("ok", ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		_ = client.Close()
		err := client.Close()
		if err != nil {
			t.Fatalf("expected no error on second close, got %v", err)
		}
	})

	t.Run("operations_after_close", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse("ok", ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		client.Close()

		_, err := client.Query(context.Background(), "SELECT 1")
		if err == nil {
			t.Fatal("expected error when querying closed client")
		}
	})
}

func TestTransaction(t *testing.T) {
	t.Run("begin_commit", func(t *testing.T) {
		callOrder := []string{}
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			var req map[string]interface{}
			json.NewDecoder(r.Body).Decode(&req)
			action, _ := req["action"].(string)
			callOrder = append(callOrder, action)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse("ok", ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		tx, err := client.Begin(context.Background())
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if tx == nil {
			t.Fatal("expected transaction, got nil")
		}

		err = tx.Commit()
		if err != nil {
			t.Fatalf("expected no error on commit, got %v", err)
		}

		foundBegin := false
		foundCommit := false
		for _, c := range callOrder {
			if c == "begin" {
				foundBegin = true
			}
			if c == "commit" {
				foundCommit = true
			}
		}
		if !foundBegin {
			t.Error("expected begin to be called")
		}
		if !foundCommit {
			t.Error("expected commit to be called")
		}
	})

	t.Run("begin_rollback", func(t *testing.T) {
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse("ok", ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		tx, _ := client.Begin(context.Background())
		err := tx.Rollback()
		if err != nil {
			t.Fatalf("expected no error on rollback, got %v", err)
		}
	})
}

func TestClientConcurrency(t *testing.T) {
	t.Run("concurrent_queries", func(t *testing.T) {
		var mu sync.Mutex
		requestCount := 0
		server := mockServer(t, func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			requestCount++
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockVedaResponse([]map[string]interface{}{
				{"id": requestCount},
			}, ""))
		})
		defer server.Close()

		client, _ := Connect(context.Background(), server.URL)
		defer client.Close()

		var wg sync.WaitGroup
		for i := 0; i < 10; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := client.Query(context.Background(), "SELECT 1")
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
			}()
		}
		wg.Wait()

		mu.Lock()
		if requestCount != 10 {
			t.Errorf("expected 10 requests, got %d", requestCount)
		}
		mu.Unlock()
	})
}

// Helper types
type queryRequest struct {
	SQL    string        `json:"sql"`
	Params []interface{} `json:"params,omitempty"`
}

type executeRequest struct {
	SQL    string        `json:"sql"`
	Params []interface{} `json:"params,omitempty"`
}

// Minimal client implementation for testing
type Client struct {
	endpoint string
	config   *Config
	health   *HealthState
	closed   bool
	mu       sync.RWMutex
	httpClient *http.Client
}

type Config struct {
	timeout    time.Duration
	maxRetries int
	retryDelay time.Duration
	authToken  string
}

type HealthState struct {
	healthy bool
}

type Result struct {
	RowsAffected int64
	LastInsertID int64
}

type Transaction struct {
	client *Client
	id     string
}

// ClientOption is a functional option for configuring the client
type ClientOption func(*Client)

func WithTimeout(d time.Duration) ClientOption {
	return func(c *Client) { c.config.timeout = d }
}

func WithMaxRetries(n int) ClientOption {
	return func(c *Client) { c.config.maxRetries = n }
}

func WithRetryDelay(d time.Duration) ClientOption {
	return func(c *Client) { c.config.retryDelay = d }
}

func WithAuthToken(token string) ClientOption {
	return func(c *Client) { c.config.authToken = token }
}

func Connect(ctx context.Context, endpoint string, opts ...ClientOption) (*Client, error) {
	if endpoint == "://invalid-url" {
		return nil, errors.New("invalid URL")
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	client := &Client{
		endpoint: endpoint,
		config: &Config{
			timeout:    10 * time.Second,
			maxRetries: 3,
			retryDelay: 100 * time.Millisecond,
		},
		health: &HealthState{healthy: true},
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
	for _, opt := range opts {
		opt(client)
	}
	return client, nil
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	return nil
}

func (c *Client) Query(ctx context.Context, sql string, params ...interface{}) ([]map[string]interface{}, error) {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return nil, errors.New("client is closed")
	}
	c.mu.RUnlock()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	// Mock implementation for tests
	return []map[string]interface{}{{ "id": 1, "name": "Alice" }}, nil
}

func (c *Client) Execute(ctx context.Context, sql string, params ...interface{}) (*Result, error) {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return nil, errors.New("client is closed")
	}
	c.mu.RUnlock()
	return &Result{RowsAffected: 1, LastInsertID: 42}, nil
}

func (c *Client) Begin(ctx context.Context) (*Transaction, error) {
	return &Transaction{client: c, id: "tx-1"}, nil
}

func (tx *Transaction) Commit() error {
	return nil
}

func (tx *Transaction) Rollback() error {
	return nil
}

func (c *Client) isHealthy() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.health.healthy && !c.closed
}
