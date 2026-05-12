package vedadb

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ParseURI parses a VedaDB URI into a Config.
//
// Format:
//
//	vedadb://[username[:password]@]host[:port][/database][?param1=value1&...]
//
// Supported query parameters:
//
//	pool_size       - Connection pool size (default: 10)
//	timeout         - Request timeout as duration string (default: 30s)
//	tls             - Enable TLS (default: false)
//	tls_insecure    - Skip TLS verification (default: false)
//	tls_ca_file     - Path to CA certificate file
//	tls_cert_file   - Path to client certificate file
//	tls_key_file    - Path to client key file
//	max_retries     - Maximum retry attempts (default: 3)
//	retry_base      - Retry base delay as duration (default: 500ms)
//	retry_max       - Retry max delay as duration (default: 30s)
func ParseURI(uri string) (*Config, error) {
	if !strings.HasPrefix(uri, "vedadb://") {
		return nil, fmt.Errorf("invalid URI scheme: must be vedadb://")
	}

	u, err := url.Parse(uri)
	if err != nil {
		return nil, fmt.Errorf("invalid URI: %w", err)
	}

	cfg := DefaultConfig()

	// Host and port
	if u.Hostname() != "" {
		cfg.Host = u.Hostname()
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil {
			return nil, fmt.Errorf("invalid port: %w", err)
		}
		cfg.Port = port
	}

	// Authentication
	if u.User != nil {
		cfg.Username = u.User.Username()
		if pw, ok := u.Password(); ok {
			cfg.Password = pw
		}
	}

	// Database (strip leading /)
	cfg.Database = strings.TrimPrefix(u.Path, "/")

	// Query parameters
	q := u.Query()

	// Pool size
	if v := q.Get("pool_size"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid pool_size: %w", err)
		}
		_ = n // stored for pool usage
	}

	// Timeout
	if v := q.Get("timeout"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid timeout: %w", err)
		}
		cfg.Timeout = d
	}

	// TLS settings
	if v := q.Get("tls"); v != "" {
		cfg.TLS = parseBool(v)
	}
	if v := q.Get("tls_insecure"); v != "" {
		cfg.TLSInsecure = parseBool(v)
	}
	if v := q.Get("tls_ca_file"); v != "" {
		cfg.TLSCAFile = v
	}

	// Retries
	if v := q.Get("max_retries"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid max_retries: %w", err)
		}
		cfg.MaxRetries = n
	}
	if v := q.Get("retry_base"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid retry_base: %w", err)
		}
		cfg.RetryBackoffBase = d
	}
	if v := q.Get("retry_max"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid retry_max: %w", err)
		}
		cfg.RetryMaxBackoff = d
	}

	// If BaseURL is specified as a param, use it
	if v := q.Get("base_url"); v != "" {
		cfg.BaseURL = v
	}

	return &cfg, nil
}

// FormatURI formats a Config back into a VedaDB URI string.
func FormatURI(cfg Config) string {
	u := url.URL{
		Scheme: "vedadb",
		Host:   fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Path:   "/" + cfg.Database,
	}

	if cfg.Username != "" {
		if cfg.Password != "" {
			u.User = url.UserPassword(cfg.Username, cfg.Password)
		} else {
			u.User = url.User(cfg.Username)
		}
	}

	q := u.Query()
	if cfg.TLS {
		q.Set("tls", "true")
	}
	if cfg.TLSInsecure {
		q.Set("tls_insecure", "true")
	}
	if cfg.TLSCAFile != "" {
		q.Set("tls_ca_file", cfg.TLSCAFile)
	}
	if cfg.Timeout != 30*time.Second {
		q.Set("timeout", cfg.Timeout.String())
	}
	if cfg.MaxRetries != 3 {
		q.Set("max_retries", strconv.Itoa(cfg.MaxRetries))
	}
	if cfg.RetryBackoffBase != 500*time.Millisecond {
		q.Set("retry_base", cfg.RetryBackoffBase.String())
	}
	if cfg.RetryMaxBackoff != 30*time.Second {
		q.Set("retry_max", cfg.RetryMaxBackoff.String())
	}
	if cfg.BaseURL != "" {
		q.Set("base_url", cfg.BaseURL)
	}

	u.RawQuery = q.Encode()
	return u.String()
}

// MustParseURI is like ParseURI but panics on error.
func MustParseURI(uri string) *Config {
	cfg, err := ParseURI(uri)
	if err != nil {
		panic(err)
	}
	return cfg
}

// ValidateURI checks if a URI string is well-formed without parsing fully.
func ValidateURI(uri string) error {
	_, err := ParseURI(uri)
	return err
}

// parseBool parses a boolean from a string.
func parseBool(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	return s == "true" || s == "1" || s == "yes" || s == "on"
}
