package vedadb

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	_ "github.com/vedadb/vedadb-go"
)

// mockServer creates a local HTTP server that simulates VedaDB responses.
func mockServer(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/health":
			json.NewEncoder(w).Encode(map[string]string{
				"status":    "ok",
				"timestamp": time.Now().Format(time.RFC3339),
			})
		case "/v1/query":
			body, _ := io.ReadAll(r.Body)
			var req struct {
				Query  string   `json:"query"`
				Params []string `json:"params,omitempty"`
			}
			json.Unmarshal(body, &req)

			if req.Query == "" {
				w.WriteHeader(400)
				json.NewEncoder(w).Encode(map[string]string{"error": "empty query"})
				return
			}

			if req.Query == "ERROR" {
				w.WriteHeader(400)
				json.NewEncoder(w).Encode(map[string]string{"error": "syntax error"})
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(Result{
				Columns:  []string{"result"},
				Rows:     [][]string{{"42"}},
				RowCount: 1,
			})
		case "/v1/tables":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"tables": []map[string]string{{"name": "users"}},
			})
		default:
			w.WriteHeader(404)
			json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
		}
	}))
}

func TestDSN(t *testing.T) {
	tests := []struct {
		dsn    string
		want   Config
		wantDSN string
	}{
		{
			dsn: "vedadb://localhost:8080/mydb",
			want: Config{
				Host:     "localhost",
				Port:     8080,
				Database: "mydb",
			},
		},
		{
			dsn: "vedadb://admin:secret@db.example.com:9090/prod?tls=true&timeout=60",
			want: Config{
				Host:     "db.example.com",
				Port:     9090,
				Username: "admin",
				Password: "secret",
				Database: "prod",
				TLS:      true,
				Timeout:  60 * time.Second,
			},
		},
		{
			dsn: "vedadb://localhost:8080/",
			want: Config{
				Host: "localhost",
				Port: 8080,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.dsn, func(t *testing.T) {
			cfg, err := ParseDSN(tt.dsn)
			if err != nil {
				t.Fatalf("ParseDSN(%q) error: %v", tt.dsn, err)
			}
			if cfg.Host != tt.want.Host {
				t.Errorf("Host = %q, want %q", cfg.Host, tt.want.Host)
			}
			if cfg.Port != tt.want.Port {
				t.Errorf("Port = %d, want %d", cfg.Port, tt.want.Port)
			}
			if cfg.Username != tt.want.Username {
				t.Errorf("Username = %q, want %q", cfg.Username, tt.want.Username)
			}
			if cfg.Password != tt.want.Password {
				t.Errorf("Password = %q, want %q", cfg.Password, tt.want.Password)
			}
			if cfg.Database != tt.want.Database {
				t.Errorf("Database = %q, want %q", cfg.Database, tt.want.Database)
			}
			if cfg.TLS != tt.want.TLS {
				t.Errorf("TLS = %v, want %v", cfg.TLS, tt.want.TLS)
			}
			if cfg.Timeout != tt.want.Timeout {
				t.Errorf("Timeout = %v, want %v", cfg.Timeout, tt.want.Timeout)
			}
		})
	}
}

func TestDSNInvalid(t *testing.T) {
	_, err := ParseDSN("invalid://localhost")
	if err == nil {
		t.Fatal("expected error for invalid DSN")
	}
}

func TestFormatDSN(t *testing.T) {
	cfg := Config{
		Host:     "localhost",
		Port:     8080,
		Username: "admin",
		Password: "secret",
		Database: "test",
		TLS:      true,
		Timeout:  60 * time.Second,
	}
	dsn := FormatDSN(cfg)
	parsed, err := ParseDSN(dsn)
	if err != nil {
		t.Fatalf("ParseDSN(FormatDSN(cfg)) error: %v", err)
	}
	if parsed.Host != cfg.Host || parsed.Port != cfg.Port {
		t.Errorf("round-trip failed: got %s:%d, want %s:%d", parsed.Host, parsed.Port, cfg.Host, cfg.Port)
	}
}

func TestDriverOpen(t *testing.T) {
	server := mockServer(t)
	defer server.Close()

	db, err := sql.Open("vedadb", server.URL)
	if err != nil {
		t.Fatalf("sql.Open error: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		t.Fatalf("db.Ping error: %v", err)
	}
}

func TestDriverQuery(t *testing.T) {
	server := mockServer(t)
	defer server.Close()

	db, err := sql.Open("vedadb", server.URL)
	if err != nil {
		t.Fatalf("sql.Open error: %v", err)
	}
	defer db.Close()

	var result string
	err = db.QueryRow("SELECT 42").Scan(&result)
	if err != nil {
		t.Fatalf("QueryRow error: %v", err)
	}
	if result != "42" {
		t.Errorf("result = %q, want %q", result, "42")
	}
}

func TestDriverQueryError(t *testing.T) {
	server := mockServer(t)
	defer server.Close()

	db, err := sql.Open("vedadb", server.URL)
	if err != nil {
		t.Fatalf("sql.Open error: %v", err)
	}
	defer db.Close()

	_, err = db.Query("ERROR")
	if err == nil {
		t.Fatal("expected error for bad query")
	}
}

func TestDriverPreparedStatement(t *testing.T) {
	server := mockServer(t)
	defer server.Close()

	db, err := sql.Open("vedadb", server.URL)
	if err != nil {
		t.Fatalf("sql.Open error: %v", err)
	}
	defer db.Close()

	var result string
	err = db.QueryRow("SELECT ?", 42).Scan(&result)
	if err != nil {
		t.Fatalf("QueryRow with param error: %v", err)
	}
	if result != "42" {
		t.Errorf("result = %q, want %q", result, "42")
	}
}

func TestDriverTransaction(t *testing.T) {
	server := mockServer(t)
	defer server.Close()

	db, err := sql.Open("vedadb", server.URL)
	if err != nil {
		t.Fatalf("sql.Open error: %v", err)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("db.Begin error: %v", err)
	}

	var result string
	err = tx.QueryRow("SELECT 42").Scan(&result)
	if err != nil {
		t.Fatalf("tx.QueryRow error: %v", err)
	}

	if err := tx.Commit(); err != nil {
		t.Fatalf("tx.Commit error: %v", err)
	}
}

func TestDriverTransactionRollback(t *testing.T) {
	server := mockServer(t)
	defer server.Close()

	db, err := sql.Open("vedadb", server.URL)
	if err != nil {
		t.Fatalf("sql.Open error: %v", err)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("db.Begin error: %v", err)
	}

	if err := tx.Rollback(); err != nil {
		t.Fatalf("tx.Rollback error: %v", err)
	}
}

func TestResultToMaps(t *testing.T) {
	r := &Result{
		Columns:  []string{"id", "name"},
		Rows:     [][]string{{"1", "Alice"}, {"2", "Bob"}},
		RowCount: 2,
	}
	maps := r.ToMaps()
	if len(maps) != 2 {
		t.Fatalf("len(maps) = %d, want 2", len(maps))
	}
	if maps[0]["name"] != "Alice" {
		t.Errorf("maps[0][name] = %q, want Alice", maps[0]["name"])
	}
}

func TestConnectionPool(t *testing.T) {
	server := mockServer(t)
	defer server.Close()

	db, err := sql.Open("vedadb", server.URL)
	if err != nil {
		t.Fatalf("sql.Open error: %v", err)
	}
	defer db.Close()

	// database/sql automatically pools connections.
	// Verify we can execute multiple queries concurrently.
	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func() {
			defer func() { done <- true }()
			var result string
			if err := db.QueryRow("SELECT 42").Scan(&result); err != nil {
				t.Errorf("QueryRow error: %v", err)
			}
		}()
	}
	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestErrorTypes(t *testing.T) {
	connErr := NewConnectionError("connection refused")
	if connErr.Error() != "vedadb conn: connection refused" {
		t.Errorf("unexpected error message: %s", connErr.Error())
	}

	authErr := NewAuthError("invalid credentials", 401)
	if authErr.StatusCode != 401 {
		t.Errorf("status code = %d, want 401", authErr.StatusCode)
	}

	queryErr := NewQueryError("syntax error")
	if queryErr.Error() != "vedadb query: syntax error" {
		t.Errorf("unexpected error message: %s", queryErr.Error())
	}
}

func TestValidationError(t *testing.T) {
	err := NewValidationError("invalid identifier")
	if err.Error() != "vedadb validate: invalid identifier" {
		t.Errorf("unexpected error message: %s", err.Error())
	}
}
