package vedadb

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ParseDSN parses a VedaDB connection string.
//
// Format:
//
//	vedadb://[username[:password]@]host[:port][/database][?param1=value1&...]
//
// Supported query parameters:
//
//	tls          - Enable HTTPS (default: false)
//	tls_insecure - Skip TLS verification (default: false)
//	timeout      - Request timeout in seconds (default: 30)
//	max_retries  - Max retry attempts (default: 3)
func ParseDSN(dsn string) (Config, error) {
	cfg := DefaultConfig()

	if !strings.HasPrefix(dsn, "vedadb://") {
		return cfg, fmt.Errorf("invalid DSN: must start with vedadb://")
	}

	u, err := url.Parse(dsn)
	if err != nil {
		return cfg, fmt.Errorf("invalid DSN: %w", err)
	}

	if u.Hostname() != "" {
		cfg.Host = u.Hostname()
	}
	if u.Port() != "" {
		p, err := strconv.Atoi(u.Port())
		if err != nil {
			return cfg, fmt.Errorf("invalid port: %w", err)
		}
		cfg.Port = p
	}

	if u.User != nil {
		cfg.Username = u.User.Username()
		if pw, ok := u.Password(); ok {
			cfg.Password = pw
		}
	}

	// Database from path (strip leading /)
	cfg.Database = strings.TrimPrefix(u.Path, "/")

	// Query parameters
	q := u.Query()
	if v := q.Get("tls"); v != "" {
		cfg.TLS = v == "true" || v == "1" || v == "yes"
	}
	if v := q.Get("tls_insecure"); v != "" {
		cfg.TLSInsecure = v == "true" || v == "1" || v == "yes"
	}
	if v := q.Get("timeout"); v != "" {
		s, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return cfg, fmt.Errorf("invalid timeout: %w", err)
		}
		cfg.Timeout = time.Duration(s * float64(time.Second))
	}
	if v := q.Get("max_retries"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return cfg, fmt.Errorf("invalid max_retries: %w", err)
		}
		cfg.MaxRetries = n
	}

	return cfg, nil
}

// FormatDSN formats a Config back into a DSN string.
func FormatDSN(cfg Config) string {
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
	if cfg.Timeout != 30*time.Second {
		q.Set("timeout", strconv.FormatFloat(cfg.Timeout.Seconds(), 'f', -1, 64))
	}
	if cfg.MaxRetries != 3 {
		q.Set("max_retries", strconv.Itoa(cfg.MaxRetries))
	}
	u.RawQuery = q.Encode()

	return u.String()
}
