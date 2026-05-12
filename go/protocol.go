package vedadb

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

// Result represents the response from a VedaQL query.
type Result struct {
	Columns  []string   `json:"columns"`
	Rows     [][]string `json:"rows"`
	RowCount int        `json:"row_count"`
	Message  string     `json:"message,omitempty"`
}

// ToMaps converts rows to a slice of maps keyed by column name.
func (r *Result) ToMaps() []map[string]string {
	if r.Columns == nil || r.Rows == nil {
		return nil
	}
	out := make([]map[string]string, 0, len(r.Rows))
	for _, row := range r.Rows {
		m := make(map[string]string, len(r.Columns))
		for i, col := range r.Columns {
			if i < len(row) {
				m[col] = row[i]
			}
		}
		out = append(out, m)
	}
	return out
}

// HealthStatus is the response from GET /v1/health.
type HealthStatus struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Raw       map[string]interface{}
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Config holds connection configuration.
type Config struct {
	Host             string
	Port             int
	BaseURL          string // overrides Host/Port/TLS
	Username         string
	Password         string
	Database         string
	Timeout          time.Duration
	TLS              bool
	TLSInsecure      bool
	TLSCAFile        string
	MaxRetries       int
	RetryBackoffBase time.Duration
	RetryMaxBackoff  time.Duration
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		Host:             "localhost",
		Port:             8080,
		Timeout:          30 * time.Second,
		MaxRetries:       3,
		RetryBackoffBase: 500 * time.Millisecond,
		RetryMaxBackoff:  30 * time.Second,
	}
}

// ---------------------------------------------------------------------------
// Protocol (HTTP transport)
// ---------------------------------------------------------------------------

// Protocol handles HTTP communication with the VedaDB REST API.
type Protocol struct {
	config     Config
	client     *http.Client
	authHeader string
	baseURL    string
	mu         sync.RWMutex
	closed     bool
}

// NewProtocol creates a new Protocol.
func NewProtocol(cfg Config) (*Protocol, error) {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   cfg.Timeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}

	if cfg.TLS {
		transport.TLSClientConfig = &tls.Config{
			InsecureSkipVerify: cfg.TLSInsecure,
		}
	}

	p := &Protocol{
		config: cfg,
		client: &http.Client{
			Transport: transport,
			Timeout:   cfg.Timeout,
		},
	}

	if cfg.BaseURL != "" {
		p.baseURL = strings.TrimRight(cfg.BaseURL, "/")
	} else {
		scheme := "http"
		if cfg.TLS {
			scheme = "https"
		}
		p.baseURL = fmt.Sprintf("%s://%s:%d", scheme, cfg.Host, cfg.Port)
	}

	if cfg.Username != "" && cfg.Password != "" {
		token := base64.StdEncoding.EncodeToString([]byte(cfg.Username + ":" + cfg.Password))
		p.authHeader = "Bearer " + token
	}

	return p, nil
}

// Close marks the protocol as closed.
func (p *Protocol) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.client.CloseIdleConnections()
}

// Ping checks connectivity.
func (p *Protocol) Ping() error {
	if p.closed {
		return NewConnectionError("protocol is closed")
	}
	ctx, cancel := contextWithTimeout(p.config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", p.baseURL+"/v1/health", nil)
	if err != nil {
		return err
	}

	p.setHeaders(req, false)
	resp, err := p.client.Do(req)
	if err != nil {
		return NewConnectionError(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return NewConnectionError(fmt.Sprintf("health returned %d", resp.StatusCode))
	}
	return nil
}

// Query executes a VedaQL statement.
func (p *Protocol) Query(sql string, params []driver.Value) (*Result, error) {
	if p.closed {
		return nil, NewConnectionError("protocol is closed")
	}
	if strings.TrimSpace(sql) == "" {
		return nil, NewValidationError("empty query")
	}
	if len(sql) > 1_000_000 {
		return nil, NewValidationError("query exceeds 1MB maximum")
	}

	payload := map[string]interface{}{"query": sql}
	if p.config.Database != "" {
		payload["database"] = p.config.Database
	}
	if len(params) > 0 {
		if len(params) > 1024 {
			return nil, NewValidationError("maximum 1024 params per query")
		}
		encoded := make([]string, len(params))
		for i, v := range params {
			encoded[i] = jsonParam(v)
		}
		payload["params"] = encoded
	}

	body, statusCode, err := p.request("POST", "/v1/query", payload)
	if err != nil {
		return nil, err
	}

	if statusCode != 200 {
		return nil, p.mapError(statusCode, body)
	}

	var result Result
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, NewConnectionError("invalid response JSON: " + err.Error())
	}
	return &result, nil
}

// Exec executes a non-SELECT statement and returns affected rows.
func (p *Protocol) Exec(sql string, params []driver.Value) (int64, error) {
	result, err := p.Query(sql, params)
	if err != nil {
		return 0, err
	}
	return int64(result.RowCount), nil
}

// Health calls GET /v1/health.
func (p *Protocol) Health() (*HealthStatus, error) {
	body, statusCode, err := p.request("GET", "/v1/health", nil)
	if err != nil {
		return nil, err
	}
	if statusCode != 200 {
		return nil, p.mapError(statusCode, body)
	}
	var h HealthStatus
	if err := json.Unmarshal(body, &h); err != nil {
		return nil, err
	}
	h.Raw = make(map[string]interface{})
	json.Unmarshal(body, &h.Raw)
	return &h, nil
}

// Begin starts a transaction.
func (p *Protocol) Begin() error {
	_, err := p.Exec("BEGIN", nil)
	return err
}

// Commit commits the current transaction.
func (p *Protocol) Commit() error {
	_, err := p.Exec("COMMIT", nil)
	return err
}

// Rollback rolls back the current transaction.
func (p *Protocol) Rollback() error {
	_, err := p.Exec("ROLLBACK", nil)
	return err
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func (p *Protocol) request(method, path string, payload interface{}) ([]byte, int, error) {
	maxAttempts := 1 + p.config.MaxRetries
	var lastErr error

	for attempt := 0; attempt < maxAttempts; attempt++ {
		var bodyReader io.Reader
		if payload != nil {
			data, err := json.Marshal(payload)
			if err != nil {
				return nil, 0, NewValidationError("failed to encode payload: " + err.Error())
			}
			bodyReader = bytes.NewReader(data)
		}

		ctx, cancel := contextWithTimeout(p.config.Timeout)
		req, err := http.NewRequestWithContext(ctx, method, p.baseURL+path, bodyReader)
		if err != nil {
			cancel()
			return nil, 0, err
		}

		p.setHeaders(req, payload != nil)
		resp, err := p.client.Do(req)

		if err != nil {
			cancel()
			lastErr = NewConnectionError(err.Error())
			if attempt < maxAttempts-1 {
				backoff := minDuration(p.config.RetryBackoffBase*time.Duration(math.Pow(2, float64(attempt))), p.config.RetryMaxBackoff)
				time.Sleep(backoff)
				continue
			}
			return nil, 0, lastErr
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		cancel()

		if err != nil {
			lastErr = NewConnectionError("failed to read response: " + err.Error())
			if attempt < maxAttempts-1 {
				continue
			}
			return nil, 0, lastErr
		}

		if resp.StatusCode == 429 && attempt < maxAttempts-1 {
			retryAfter := p.config.RetryBackoffBase.Seconds() * math.Pow(2, float64(attempt))
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if v, err := strconv.ParseFloat(ra, 64); err == nil {
					retryAfter = v
				}
			}
			time.Sleep(time.Duration(retryAfter * float64(time.Second)))
			continue
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return body, resp.StatusCode, nil
		}

		if resp.StatusCode >= 500 && resp.StatusCode < 600 && attempt < maxAttempts-1 {
			backoff := minDuration(p.config.RetryBackoffBase*time.Duration(math.Pow(2, float64(attempt))), p.config.RetryMaxBackoff)
			time.Sleep(backoff)
			continue
		}

		return body, resp.StatusCode, p.mapError(resp.StatusCode, body)
	}

	return nil, 0, lastErr
}

func (p *Protocol) setHeaders(req *http.Request, hasBody bool) {
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Client-Library", "vedadb-go")
	if hasBody {
		req.Header.Set("Content-Type", "application/json")
	}
	if p.authHeader != "" {
		req.Header.Set("Authorization", p.authHeader)
	}
	if p.config.Database != "" {
		req.Header.Set("X-VedaDB-Database", p.config.Database)
	}
}

func (p *Protocol) mapError(statusCode int, body []byte) error {
	var parsed struct {
		Error string `json:"error"`
	}
	msg := string(body)
	if err := json.Unmarshal(body, &parsed); err == nil && parsed.Error != "" {
		msg = parsed.Error
	}

	switch statusCode {
	case 401, 403:
		return NewAuthError(msg, statusCode)
	case 400:
		return NewQueryError(msg)
	case 429:
		e := NewConnectionError(msg)
		return &RateLimitError{Error: e.Error, RetryAfter: 0}
	default:
		return &ConnectionError{Error{Op: "http", Msg: msg, StatusCode: statusCode}}
	}
}

// ---------------------------------------------------------------------------
// Parameter encoding
// ---------------------------------------------------------------------------

func jsonParam(v driver.Value) string {
	if v == nil {
		return "null"
	}
	switch x := v.(type) {
	case bool:
		return strconv.FormatBool(x)
	case int:
		return strconv.FormatInt(int64(x), 10)
	case int8:
		return strconv.FormatInt(int64(x), 10)
	case int16:
		return strconv.FormatInt(int64(x), 10)
	case int32:
		return strconv.FormatInt(int64(x), 10)
	case int64:
		return strconv.FormatInt(x, 10)
	case uint:
		return strconv.FormatUint(uint64(x), 10)
	case uint8:
		return strconv.FormatUint(uint64(x), 10)
	case uint16:
		return strconv.FormatUint(uint64(x), 10)
	case uint32:
		return strconv.FormatUint(uint64(x), 10)
	case uint64:
		return strconv.FormatUint(x, 10)
	case float32:
		return strconv.FormatFloat(float64(x), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case string:
		b, _ := json.Marshal(x)
		return string(b)
	case []byte:
		b, _ := json.Marshal(string(x))
		return string(b)
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func contextWithTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
