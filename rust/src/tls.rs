use std::fs;
use std::sync::Arc;
use std::time::Duration;

/// TLS configuration for VedaDB connections.
#[derive(Debug, Clone)]
pub struct TlsConfig {
    /// Enable TLS.
    pub enabled: bool,
    /// Verify server certificate.
    pub verify: bool,
    /// Path to CA certificate file.
    pub ca_file: Option<String>,
    /// Path to client certificate file.
    pub cert_file: Option<String>,
    /// Path to client private key file.
    pub key_file: Option<String>,
    /// Server name for SNI (if different from host).
    pub server_name: Option<String>,
    /// Minimum TLS version.
    pub min_version: TlsVersion,
    /// Acceptable cipher suites (empty = default).
    pub cipher_suites: Vec<String>,
}

impl Default for TlsConfig {
    fn default() -> Self {
        TlsConfig {
            enabled: false,
            verify: true,
            ca_file: None,
            cert_file: None,
            key_file: None,
            server_name: None,
            min_version: TlsVersion::Tls12,
            cipher_suites: Vec::new(),
        }
    }
}

/// TLS protocol version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsVersion {
    Tls10,
    Tls11,
    Tls12,
    Tls13,
}

impl TlsConfig {
    /// Create a new TLS config with defaults.
    pub fn new() -> Self {
        TlsConfig::default()
    }

    /// Enable TLS.
    pub fn enable(mut self) -> Self {
        self.enabled = true;
        self
    }

    /// Disable certificate verification (not recommended for production).
    pub fn danger_disable_verification(mut self) -> Self {
        self.verify = false;
        self
    }

    /// Set CA certificate file.
    pub fn with_ca_file(mut self, path: &str) -> Self {
        self.ca_file = Some(path.to_string());
        self
    }

    /// Set client certificate file.
    pub fn with_cert_file(mut self, path: &str) -> Self {
        self.cert_file = Some(path.to_string());
        self
    }

    /// Set client private key file.
    pub fn with_key_file(mut self, path: &str) -> Self {
        self.key_file = Some(path.to_string());
        self
    }

    /// Set minimum TLS version.
    pub fn with_min_version(mut self, version: TlsVersion) -> Self {
        self.min_version = version;
        self
    }

    /// Set SNI server name.
    pub fn with_server_name(mut self, name: &str) -> Self {
        self.server_name = Some(name.to_string());
        self
    }

    /// Validate the TLS configuration.
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }

        if let Some(ref ca_file) = self.ca_file {
            if !std::path::Path::new(ca_file).exists() {
                return Err(format!("CA file not found: {}", ca_file));
            }
        }

        if let (Some(ref cert), Some(ref key)) = (&self.cert_file, &self.key_file) {
            if !std::path::Path::new(cert).exists() {
                return Err(format!("Certificate file not found: {}", cert));
            }
            if !std::path::Path::new(key).exists() {
                return Err(format!("Key file not found: {}", key));
            }
        }

        Ok(())
    }
}

/// TLS connector for establishing secure connections.
pub struct TlsConnector {
    config: TlsConfig,
}

impl TlsConnector {
    /// Create a new TLS connector.
    pub fn new(config: TlsConfig) -> Result<Self, String> {
        config.validate()?;
        Ok(TlsConnector { config })
    }

    /// Get the TLS config.
    pub fn config(&self) -> &TlsConfig {
        &self.config
    }

    /// Check if TLS is enabled.
    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }
}

/// Load certificate from file.
pub fn load_cert(path: &str) -> Result<Vec<u8>, VedaError> {
    fs::read(path).map_err(|e| {
        VedaError::Tls(format!("failed to load certificate from '{}': {}", path, e))
    })
}

/// Load private key from file.
pub fn load_key(path: &str) -> Result<Vec<u8>, VedaError> {
    fs::read(path).map_err(|e| {
        VedaError::Tls(format!("failed to load key from '{}': {}", path, e))
    })
}
