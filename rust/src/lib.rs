//! VedaDB Rust Driver - Official client library for VedaDB.
//!
//! # Overview
//!
//! This crate provides a synchronous and asynchronous client for interacting
//! with VedaDB servers. Key modules include:
//!
//! - `client` - Core sync client (`VedaClient`, `VedaConfig`, `VedaConfigBuilder`)
//! - `async_client` - Async client (`AsyncVedaClient`) via tokio
//! - `pool` - Connection pooling (`VedaPool`, `PooledClient`)
//! - `query_builder` - Fluent SQL query builder (`QueryBuilder`)
//! - `bulk` - Pipeline and bulk insert operations (`Pipeline`, `BulkInserter`)
//! - `cursor` - Streaming cursor for large result sets (`Cursor`)
//! - `circuit` - Circuit breaker for fault tolerance (`CircuitBreaker`)
//! - `retry` - Retry policies with exponential backoff (`RetryPolicy`)
//! - `failover` - Multi-node failover cluster (`FailoverCluster`)
//! - `health` - Health checking (`HealthChecker`)
//! - `pubsub` - Publish/subscribe messaging (`PubSub`)
//! - `error` - Error types (`VedaError`)
//! - `result` - Result types (`VedaResult`, `Value`, `Row`)
//! - `protocol` - Wire protocol (`Protocol`, `Command`)
//! - `uri` - URI parsing (`VedaUri`)
//! - `tls` - TLS configuration
//! - `metrics` - Metrics collection
//! - `change_stream` - Change data capture streams
//! - `load_balance` - Load balancing
//! - `rw_split` - Read/write splitting
//! - `interceptor` - Request/response interceptors
//! - `cache` - Client-side caching

#![forbid(unsafe_code)]

// Module declarations - each maps to a source file in src/
pub mod client;
pub mod async_client;
pub mod error;
pub mod result;
pub mod protocol;
pub mod pool;
pub mod query_builder;
pub mod bulk;
pub mod cursor;
pub mod retry;
pub mod circuit;
pub mod failover;
pub mod health;
pub mod pubsub;
pub mod uri;
pub mod tls;
pub mod metrics;
pub mod change_stream;
pub mod load_balance;
pub mod rw_split;
pub mod interceptor;
pub mod cache;

// Re-export commonly used types at the crate root for convenience
pub use client::{VedaClient, VedaConfig, VedaConfigBuilder, VedaClientHandle};
pub use error::VedaError;
pub use result::{Value, VedaResult, Row};
pub use pool::{VedaPool, PooledClient, PoolStats};
pub use query_builder::QueryBuilder;
pub use bulk::{Pipeline, BulkInserter};
pub use cursor::Cursor;
pub use retry::RetryPolicy;
pub use circuit::{CircuitBreaker, CircuitState, CircuitConfig};
pub use failover::{FailoverCluster, FailoverStrategy};
pub use health::{HealthChecker, HealthConfig, HealthStatus};
pub use pubsub::{PubSub, Message};

// Internal test re-exports
#[cfg(test)]
mod tests {
    use super::*;
}
