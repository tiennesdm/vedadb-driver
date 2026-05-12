use std::fmt;
use std::io;
use std::time::Duration;
use serde::{Deserialize, Serialize};

/// Comprehensive error types for VedaDB operations.
#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
pub enum VedaError {
    #[error("connection error: {message} (host={host:?}, port={port:?})")]
    Connection {
        message: String,
        host: Option<String>,
        port: Option<u16>,
    },

    #[error("query error: {0}")]
    Query(String),

    #[error("protocol error: {0}")]
    Protocol(String),

    #[error("timeout after {0:?}")]
    Timeout(Duration),

    #[error("pool exhausted (size={current}, max={max})")]
    PoolExhausted { current: usize, max: usize },

    #[error("circuit breaker open: {0}")]
    CircuitOpen(String),

    #[error("authentication failed: {0}")]
    Auth(String),

    #[error("TLS error: {0}")]
    Tls(String),

    #[error("URI parse error: {0}")]
    UriParse(String),

    #[error("serialization error: {0}")]
    Serialize(String),

    #[error("failover error: all nodes unreachable after {attempts} attempts")]
    Failover { attempts: usize },

    #[error("retry exhausted after {attempts} attempts: {last_error}")]
    RetryExhausted { attempts: usize, last_error: String },

    #[error("interceptor error: {0}")]
    Interceptor(String),

    #[error("I/O error: {0}")]
    Io(String),

    #[error("JSON error: {0}")]
    Json(String),
}

impl VedaError {
    /// Returns true if this error is retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            VedaError::Connection { .. }
                | VedaError::Timeout(_)
                | VedaError::PoolExhausted { .. }
                | VedaError::Failover { .. }
        )
    }

    /// Returns true if this error indicates the connection was lost.
    pub fn is_disconnect(&self) -> bool {
        matches!(
            self,
            VedaError::Connection { .. } | VedaError::Io(_) | VedaError::Timeout(_)
        )
    }
}

impl From<io::Error> for VedaError {
    fn from(err: io::Error) -> Self {
        VedaError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for VedaError {
    fn from(err: serde_json::Error) -> Self {
        VedaError::Json(err.to_string())
    }
}

impl From<std::net::AddrParseError> for VedaError {
    fn from(err: std::net::AddrParseError) -> Self {
        VedaError::Connection {
            message: err.to_string(),
            host: None,
            port: None,
        }
    }
}

impl From<std::string::FromUtf8Error> for VedaError {
    fn from(err: std::string::FromUtf8Error) -> Self {
        VedaError::Serialize(err.to_string())
    }
}

impl From<url::ParseError> for VedaError {
    fn from(err: url::ParseError) -> Self {
        VedaError::UriParse(err.to_string())
    }
}
