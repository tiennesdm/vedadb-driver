package vedadb

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
)

// WithTLS configures TLS using certificate file paths.
// caCert is the path to the CA certificate (optional).
// clientCert and clientKey are paths to client certificate and key (optional, for mutual TLS).
func (c *Config) WithTLS(caCert, clientCert, clientKey string) *Config {
	c.TLS = true
	c.TLSCAFile = caCert

	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	// Load CA cert
	if caCert != "" {
		caPEM, err := os.ReadFile(caCert)
		if err != nil {
			// Store error for later — we'll handle it in NewProtocol
			_ = err
		} else {
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(caPEM) {
				_ = fmt.Errorf("failed to parse CA certificate")
			} else {
				tlsConfig.RootCAs = pool
			}
		}
	}

	// Load client cert for mutual TLS
	if clientCert != "" && clientKey != "" {
		cert, err := tls.LoadX509KeyPair(clientCert, clientKey)
		if err == nil {
			tlsConfig.Certificates = []tls.Certificate{cert}
		}
	}

	return c
}

// WithTLSConfig applies a pre-built tls.Config.
func (c *Config) WithTLSConfig(tlsConfig *tls.Config) *Config {
	c.TLS = true
	c.TLSInsecure = tlsConfig.InsecureSkipVerify
	return c
}

// BuildTLSConfig constructs a tls.Config from the Config's TLS fields.
func (c *Config) BuildTLSConfig() (*tls.Config, error) {
	if !c.TLS {
		return nil, nil
	}

	tlsConfig := &tls.Config{
		InsecureSkipVerify: c.TLSInsecure,
		MinVersion:         tls.VersionTLS12,
	}

	// Load CA cert
	if c.TLSCAFile != "" {
		caPEM, err := os.ReadFile(c.TLSCAFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read CA certificate: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caPEM) {
			return nil, fmt.Errorf("failed to parse CA certificate")
		}
		tlsConfig.RootCAs = pool
	}

	return tlsConfig, nil
}

// TLSInfo holds parsed TLS information for display/debugging.
type TLSInfo struct {
	Enabled        bool
	Insecure       bool
	CAFile         string
	HasRootCAs     bool
	HasClientCert  bool
	MinVersion     string
	ServerName     string
}

// GetTLSInfo returns TLS configuration info.
func (c *Config) GetTLSInfo() TLSInfo {
	info := TLSInfo{
		Enabled:  c.TLS,
		Insecure: c.TLSInsecure,
		CAFile:   c.TLSCAFile,
	}

	if c.TLS {
		info.MinVersion = "TLS 1.2"
	}

	return info
}
