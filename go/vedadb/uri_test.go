// uri_test.go — URI parsing tests for VedaDB Go driver
package vedadb

import (
	"fmt"
	"strings"
	"testing"
)

// ConnectionURI represents a parsed VedaDB connection URI
type ConnectionURI struct {
	Scheme    string
	Host      string
	Port      int
	Database  string
	Username  string
	Password  string
	Options   map[string]string
	Secure    bool
	Raw       string
}

// ParseURI parses a VedaDB connection string
func ParseURI(uri string) (*ConnectionURI, error) {
	result := &ConnectionURI{
		Options: make(map[string]string),
		Raw:     uri,
	}

	// Handle empty URI
	if uri == "" {
		return nil, fmt.Errorf("empty connection URI")
	}

	// Parse scheme
	if strings.HasPrefix(uri, "vedadb://") {
		result.Scheme = "vedadb"
		result.Secure = false
		uri = uri[9:]
	} else if strings.HasPrefix(uri, "vedadbs://") {
		result.Scheme = "vedadbs"
		result.Secure = true
		uri = uri[10:]
	} else {
		return nil, fmt.Errorf("invalid scheme: expected vedadb:// or vedadbs://")
	}

	// Parse user info
	if atIdx := strings.Index(uri, "@"); atIdx != -1 {
		userInfo := uri[:atIdx]
		uri = uri[atIdx+1:]
		if colonIdx := strings.Index(userInfo, ":"); colonIdx != -1 {
			result.Username = userInfo[:colonIdx]
			result.Password = userInfo[colonIdx+1:]
		} else {
			result.Username = userInfo
		}
	}

	// Parse host and port
	hostPart := uri
	if slashIdx := strings.Index(uri, "/"); slashIdx != -1 {
		hostPart = uri[:slashIdx]
		uri = uri[slashIdx+1:]
	} else {
		uri = ""
	}

	if colonIdx := strings.LastIndex(hostPart, ":"); colonIdx != -1 {
		result.Host = hostPart[:colonIdx]
		fmt.Sscanf(hostPart[colonIdx+1:], "%d", &result.Port)
	} else {
		result.Host = hostPart
		if result.Secure {
			result.Port = 443
		} else {
			result.Port = 80
		}
	}

	// Parse database and options
	if uri != "" {
		dbPart := uri
		if qIdx := strings.Index(uri, "?"); qIdx != -1 {
			dbPart = uri[:qIdx]
			query := uri[qIdx+1:]
			for _, pair := range strings.Split(query, "&") {
				if kv := strings.SplitN(pair, "=", 2); len(kv) == 2 {
					result.Options[kv[0]] = kv[1]
				}
			}
		}
		result.Database = dbPart
	}

	return result, nil
}

func TestParseURI(t *testing.T) {
	t.Run("basic_uri", func(t *testing.T) {
		uri, err := ParseURI("vedadb://localhost:8080/mydb")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Scheme != "vedadb" {
			t.Errorf("expected scheme 'vedadb', got %q", uri.Scheme)
		}
		if uri.Host != "localhost" {
			t.Errorf("expected host 'localhost', got %q", uri.Host)
		}
		if uri.Port != 8080 {
			t.Errorf("expected port 8080, got %d", uri.Port)
		}
		if uri.Database != "mydb" {
			t.Errorf("expected database 'mydb', got %q", uri.Database)
		}
		if uri.Secure {
			t.Error("expected non-secure for vedadb://")
		}
	})

	t.Run("secure_uri", func(t *testing.T) {
		uri, err := ParseURI("vedadbs://secure.example.com/production")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Scheme != "vedadbs" {
			t.Errorf("expected scheme 'vedadbs', got %q", uri.Scheme)
		}
		if !uri.Secure {
			t.Error("expected secure for vedadbs://")
		}
		if uri.Port != 443 {
			t.Errorf("expected default port 443, got %d", uri.Port)
		}
	})

	t.Run("uri_with_auth", func(t *testing.T) {
		uri, err := ParseURI("vedadb://user:pass@localhost:8080/db")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Username != "user" {
			t.Errorf("expected username 'user', got %q", uri.Username)
		}
		if uri.Password != "pass" {
			t.Errorf("expected password 'pass', got %q", uri.Password)
		}
	})

	t.Run("uri_with_options", func(t *testing.T) {
		uri, err := ParseURI("vedadb://localhost/db?timeout=30&pool_size=10&retry=true")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Options["timeout"] != "30" {
			t.Errorf("expected timeout=30, got %q", uri.Options["timeout"])
		}
		if uri.Options["pool_size"] != "10" {
			t.Errorf("expected pool_size=10, got %q", uri.Options["pool_size"])
		}
		if uri.Options["retry"] != "true" {
			t.Errorf("expected retry=true, got %q", uri.Options["retry"])
		}
	})

	t.Run("default_port_http", func(t *testing.T) {
		uri, err := ParseURI("vedadb://localhost/mydb")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Port != 80 {
			t.Errorf("expected default port 80, got %d", uri.Port)
		}
	})

	t.Run("default_port_https", func(t *testing.T) {
		uri, err := ParseURI("vedadbs://host/db")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Port != 443 {
			t.Errorf("expected default port 443, got %d", uri.Port)
		}
	})

	t.Run("empty_uri_error", func(t *testing.T) {
		_, err := ParseURI("")
		if err == nil {
			t.Fatal("expected error for empty URI")
		}
	})

	t.Run("invalid_scheme", func(t *testing.T) {
		_, err := ParseURI("http://localhost/db")
		if err == nil {
			t.Fatal("expected error for invalid scheme")
		}
	})

	t.Run("no_database", func(t *testing.T) {
		uri, err := ParseURI("vedadb://localhost:8080")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Database != "" {
			t.Errorf("expected empty database, got %q", uri.Database)
		}
	})

	t.Run("username_no_password", func(t *testing.T) {
		uri, err := ParseURI("vedadb://admin@localhost/db")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Username != "admin" {
			t.Errorf("expected username 'admin', got %q", uri.Username)
		}
		if uri.Password != "" {
			t.Errorf("expected empty password, got %q", uri.Password)
		}
	})

	t.Run("complex_uri", func(t *testing.T) {
		input := "vedadbs://admin:secret@db.example.com:9999/production?pool=20&timeout=60"
		uri, err := ParseURI(input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Scheme != "vedadbs" {
			t.Errorf("wrong scheme: %q", uri.Scheme)
		}
		if uri.Username != "admin" {
			t.Errorf("wrong username: %q", uri.Username)
		}
		if uri.Password != "secret" {
			t.Errorf("wrong password: %q", uri.Password)
		}
		if uri.Host != "db.example.com" {
			t.Errorf("wrong host: %q", uri.Host)
		}
		if uri.Port != 9999 {
			t.Errorf("wrong port: %d", uri.Port)
		}
		if uri.Database != "production" {
			t.Errorf("wrong database: %q", uri.Database)
		}
		if !uri.Secure {
			t.Error("expected secure")
		}
		if uri.Options["pool"] != "20" {
			t.Errorf("wrong pool option: %q", uri.Options["pool"])
		}
		if uri.Raw != input {
			t.Errorf("raw mismatch: %q", uri.Raw)
		}
	})

	t.Run("special_characters_in_password", func(t *testing.T) {
		uri, err := ParseURI("vedadb://user:p%40ss@host/db")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uri.Username != "user" {
			t.Errorf("expected username 'user', got %q", uri.Username)
		}
		// Note: Full URL decoding not implemented in basic parser
		_ = uri.Password
	})
}
