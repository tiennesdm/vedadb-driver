// Package vedadb provides a production-grade Go driver for VedaDB.
//
// It implements the database/sql/driver interface so you can use VedaDB
// through the standard database/sql API with full connection pooling,
// prepared statement support, and robust error handling.
//
// # Quick Start
//
//	db, err := sql.Open("vedadb", "vedadb://admin:secret@localhost:8080/mydb")
//	if err != nil { log.Fatal(err) }
//	defer db.Close()
//
//	var id int
//	err = db.QueryRow("SELECT id FROM users WHERE name = ?", "alice").Scan(&id)
//
// # DSN Format
//
//	vedadb://[username[:password]@]host[:port][/database][?param1=value1&...]
//
// Supported parameters:
//
//	tls          - Enable HTTPS (default: false)
//	tls_insecure - Skip TLS verification (default: false)
//	timeout      - Request timeout in seconds (default: 30)
//	max_retries  - Max retry attempts (default: 3)
package vedadb

import (
	"database/sql/driver"
	"fmt"
)

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

// Error is the base error type for all VedaDB driver errors.
type Error struct {
	Msg        string
	StatusCode int
	Op         string
}

func (e *Error) Error() string {
	if e.StatusCode > 0 {
		return fmt.Sprintf("vedadb %s: %s (HTTP %d)", e.Op, e.Msg, e.StatusCode)
	}
	return fmt.Sprintf("vedadb %s: %s", e.Op, e.Msg)
}

// ConnectionError is returned when the client cannot reach the server.
type ConnectionError struct {
	Error
}

// NewConnectionError creates a new ConnectionError.
func NewConnectionError(msg string) *ConnectionError {
	return &ConnectionError{Error{Op: "conn", Msg: msg}}
}

// AuthError is returned on authentication/authorization failure.
type AuthError struct {
	Error
}

// NewAuthError creates a new AuthError.
func NewAuthError(msg string, statusCode int) *AuthError {
	return &AuthError{Error{Op: "auth", Msg: msg, StatusCode: statusCode}}
}

// QueryError is returned when VedaDB rejects a query.
type QueryError struct {
	Error
}

// NewQueryError creates a new QueryError.
func NewQueryError(msg string) *QueryError {
	return &QueryError{Error{Op: "query", Msg: msg}}
}

// RateLimitError is returned when the rate limit is exceeded.
type RateLimitError struct {
	Error
	RetryAfter float64 // seconds, if provided by server
}

// PoolError is returned for connection pool errors.
type PoolError struct {
	Error
}

// NewPoolError creates a new PoolError.
func NewPoolError(msg string) *PoolError {
	return &PoolError{Error{Op: "pool", Msg: msg}}
}

// ValidationError is returned for client-side validation failures.
type ValidationError struct {
	Error
}

// NewValidationError creates a new ValidationError.
func NewValidationError(msg string) *ValidationError {
	return &ValidationError{Error{Op: "validate", Msg: msg}}
}

// Ensure our error types implement driver.Error for compatibility.
var (
	_ error        = (*Error)(nil)
	_ driver.Error = (*Error)(nil) // Not standard, but good practice
)
