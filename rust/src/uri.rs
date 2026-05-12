use url::Url;

use crate::client::VedaConfig;
use crate::error::VedaError;
use std::time::Duration;

/// Parsed VedaDB connection URI.
#[derive(Debug, Clone)]
pub struct VedaUri {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub params: Vec<(String, String)>,
}

impl VedaUri {
    /// Parse a VedaDB URI string.
    ///
    /// Supported formats:
    /// - `vedadb://host:port/database`
    /// - `vedadb://user:pass@host:port/database?opt=value`
    /// - `vedadb+tls://host:port/database`
pub fn parse(uri: &str) -> Result<Self, VedaError> {
        let url = Url::parse(uri).map_err(|e| VedaError::UriParse(format!(
            "invalid URI '{}': {}", uri, e
        )))?;

        let scheme = url.scheme().to_string();
        if !scheme.starts_with("vedadb") {
            return Err(VedaError::UriParse(format!(
                "unsupported scheme '{}', expected 'vedadb://'",
                scheme
            )));
        }

        let host = url
            .host_str()
            .ok_or_else(|| VedaError::UriParse("missing host".to_string()))?
            .to_string();

        let port = url.port().unwrap_or(6380);

        let database = if url.path().len() > 1 {
            Some(url.path()[1..].to_string())
        } else {
            None
        };

        let username = if url.username().is_empty() {
            None
        } else {
            Some(url.username().to_string())
        };

        let password = url.password().map(|p| p.to_string());

        let params: Vec<(String, String)> = url
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();

        Ok(VedaUri {
            scheme,
            host,
            port,
            database,
            username,
            password,
            params,
        })
    }

    /// Convert to VedaConfig.
    pub fn into_config(self) -> VedaConfig {
        let tls = self.scheme.contains("tls") || self.scheme.contains("ssl");

        let mut config = VedaConfig {
            host: self.host,
            port: self.port,
            database: self.database,
            tls,
            username: self.username,
            password: self.password,
            ..VedaConfig::default()
        };

        // Apply query parameters
        for (key, value) in &self.params {
            match key.as_str() {
                "timeout" | "connect_timeout" => {
                    if let Ok(secs) = value.parse::<u64>() {
                        config.timeout = Duration::from_secs(secs);
                    }
                }
                "pool_size" | "pool_max_size" => {
                    if let Ok(size) = value.parse::<usize>() {
                        config.pool_max_size = size;
                    }
                }
                "tls" => {
                    config.tls = value == "true" || value == "1";
                }
                "tls_verify" => {
                    config.tls_verify = value == "true" || value == "1";
                }
                "retry_attempts" => {
                    if let Ok(attempts) = value.parse::<usize>() {
                        config.retry_max_attempts = attempts;
                    }
                }
                "app_name" => {
                    config.app_name = Some(value.clone());
                }
                _ => {}
            }
        }

        config
    }

    /// Build a URI string from components.
    pub fn to_uri(&self) -> String {
        let mut uri = format!("{}://", self.scheme);

        if let (Some(user), Some(pass)) = (&self.username, &self.password) {
            uri.push_str(&format!("{}:{}@", user, pass));
        } else if let Some(user) = &self.username {
            uri.push_str(&format!("{}@", user));
        }

        uri.push_str(&self.host);
        if self.port != 6380 {
            uri.push_str(&format!(":{}", self.port));
        }

        if let Some(db) = &self.database {
            uri.push('/');
            uri.push_str(db);
        }

        if !self.params.is_empty() {
            let param_strs: Vec<String> = self
                .params
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect();
            uri.push('?');
            uri.push_str(&param_strs.join("&"));
        }

        uri
    }

    /// Get a query parameter by name.
    pub fn param(&self, name: &str) -> Option<&String> {
        self.params.iter().find(|(k, _)| k == name).map(|(_, v)| v)
    }
}

impl std::fmt::Display for VedaUri {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_uri())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_uri() {
        let uri = VedaUri::parse("vedadb://localhost:6380/mydb").unwrap();
        assert_eq!(uri.host, "localhost");
        assert_eq!(uri.port, 6380);
        assert_eq!(uri.database, Some("mydb".to_string()));
        assert_eq!(uri.username, None);
        assert!(!uri.scheme.contains("tls"));
    }

    #[test]
    fn parse_with_auth() {
        let uri = VedaUri::parse("vedadb://admin:secret@db.example.com:6380").unwrap();
        assert_eq!(uri.username, Some("admin".to_string()));
        assert_eq!(uri.password, Some("secret".to_string()));
        assert_eq!(uri.host, "db.example.com");
    }

    #[test]
    fn parse_tls() {
        let uri = VedaUri::parse("vedadb+tls://localhost:6380").unwrap();
        let config = uri.into_config();
        assert!(config.tls);
    }

    #[test]
    fn parse_with_params() {
        let uri = VedaUri::parse(
            "vedadb://localhost:6380/db?timeout=60&pool_size=20&retry_attempts=5",
        )
        .unwrap();
        assert_eq!(uri.param("timeout"), Some(&"60".to_string()));
        assert_eq!(uri.param("pool_size"), Some(&"20".to_string()));
    }

    #[test]
    fn roundtrip_uri() {
        let original = "vedadb://user:pass@host:1234/db?timeout=30";
        let uri = VedaUri::parse(original).unwrap();
        assert_eq!(uri.to_uri(), original);
    }

    #[test]
    fn invalid_scheme_fails() {
        assert!(VedaUri::parse("http://localhost:6380").is_err());
    }

    #[test]
    fn config_from_uri() {
        let uri = VedaUri::parse("vedadb+tls://admin:pass@db:7000/prod?timeout=60&pool_size=50").unwrap();
        let config = uri.into_config();
        assert_eq!(config.host, "db");
        assert_eq!(config.port, 7000);
        assert!(config.tls);
        assert_eq!(config.username, Some("admin".to_string()));
        assert_eq!(config.password, Some("pass".to_string()));
        assert_eq!(config.database, Some("prod".to_string()));
        assert_eq!(config.timeout, Duration::from_secs(60));
        assert_eq!(config.pool_max_size, 50);
    }
}
