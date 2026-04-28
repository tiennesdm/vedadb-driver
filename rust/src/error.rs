use thiserror::Error;

/// Error types for VedaDB operations.
#[derive(Error, Debug)]
pub enum VedaError {
    #[error("connection error: {0}")]
    Connection(String),

    #[error("query error: {0}")]
    Query(String),

    #[error("timeout")]
    Timeout,

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json parse error: {0}")]
    Parse(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, VedaError>;
