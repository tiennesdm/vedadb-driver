use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::client::VedaConfig;
use crate::error::VedaError;
use crate::pool::{PooledClient, VedaPool};
use crate::result::{Value, VedaResult};
use crate::retry::RetryPolicy;

/// Connection role: read or write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionRole {
    Read,
    Write,
}

/// Read/Write split configuration.
#[derive(Debug, Clone)]
pub struct RwSplitConfig {
    /// Number of read replicas.
    pub read_replicas: usize,
    /// Use read replicas for SELECT queries.
    pub route_reads: bool,
    /// Retry writes on primary if replica fails.
    pub retry_on_primary: bool,
}

impl Default for RwSplitConfig {
    fn default() -> Self {
        RwSplitConfig {
            read_replicas: 1,
            route_reads: true,
            retry_on_primary: true,
        }
    }
}

/// Read/Write splitting proxy that routes queries to appropriate nodes.
pub struct ReadWriteSplit {
    primary: VedaPool,
    replicas: Vec<VedaPool>,
    config: RwSplitConfig,
    read_counter: AtomicUsize,
}

impl ReadWriteSplit {
    /// Create a new RW split with a primary and optional replicas.
    pub fn new(
        primary_config: VedaConfig,
        replica_configs: Vec<VedaConfig>,
    ) -> Result<Self, VedaError> {
        let primary = VedaPool::new(primary_config)?;
        let mut replicas = Vec::with_capacity(replica_configs.len());
        for config in replica_configs {
            replicas.push(VedaPool::new(config)?);
        }

        Ok(ReadWriteSplit {
            primary,
            replicas,
            config: RwSplitConfig::default(),
            read_counter: AtomicUsize::new(0),
        })
    }

    /// Create with custom config.
    pub fn with_config(
        primary_config: VedaConfig,
        replica_configs: Vec<VedaConfig>,
        config: RwSplitConfig,
    ) -> Result<Self, VedaError> {
        let mut split = Self::new(primary_config, replica_configs)?;
        split.config = config;
        Ok(split)
    }

    /// Execute a query, routing reads to replicas and writes to primary.
    pub fn query(
        &self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<VedaResult, VedaError> {
        let role = self.classify(sql);

        match role {
            ConnectionRole::Write => {
                let mut client = self.primary.acquire()?;
                client.query(sql, params)
            }
            ConnectionRole::Read => {
                if self.config.route_reads && !self.replicas.is_empty() {
                    let idx = self.read_counter.fetch_add(1, Ordering::SeqCst)
                        % self.replicas.len();
                    match self.replicas[idx].acquire() {
                        Ok(mut client) => client.query(sql, params),
                        Err(e) => {
                            if self.config.retry_on_primary {
                                let mut client = self.primary.acquire()?;
                                client.query(sql, params)
                            } else {
                                Err(e)
                            }
                        }
                    }
                } else {
                    let mut client = self.primary.acquire()?;
                    client.query(sql, params)
                }
            }
        }
    }

    /// Execute a statement, always routing to primary.
    pub fn execute(&self, sql: &str, params: Option<&[Value]>) -> Result<u64, VedaError> {
        let mut client = self.primary.acquire()?;
        client.execute(sql, params)
    }

    /// Execute on a read replica explicitly.
    pub fn query_read(
        &self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<VedaResult, VedaError> {
        if self.replicas.is_empty() {
            return self.query(sql, params);
        }
        let idx = self.read_counter.fetch_add(1, Ordering::SeqCst) % self.replicas.len();
        let mut client = self.replicas[idx].acquire()?;
        client.query(sql, params)
    }

    /// Execute on the primary explicitly.
    pub fn query_write(
        &self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<VedaResult, VedaError> {
        let mut client = self.primary.acquire()?;
        client.query(sql, params)
    }

    /// Get a raw connection from the primary pool.
    pub fn acquire_write(&self) -> Result<PooledClient, VedaError> {
        self.primary.acquire()
    }

    /// Get a raw connection from a read replica.
    pub fn acquire_read(&self) -> Result<PooledClient, VedaError> {
        if self.replicas.is_empty() {
            return self.primary.acquire();
        }
        let idx = self.read_counter.fetch_add(1, Ordering::SeqCst) % self.replicas.len();
        self.replicas[idx].acquire()
    }

    /// Get pool statistics.
    pub fn stats(&self) -> RwSplitStats {
        RwSplitStats {
            primary: self.primary.stats(),
            replicas: self.replicas.iter().map(|p| p.stats()).collect(),
            replica_count: self.replicas.len(),
        }
    }

    /// Classify a SQL statement as read or write.
    fn classify(&self, sql: &str) -> ConnectionRole {
        let trimmed = sql.trim().to_uppercase();

        if trimmed.starts_with("SELECT")
            || trimmed.starts_with("SHOW")
            || trimmed.starts_with("DESCRIBE")
            || trimmed.starts_with("EXPLAIN")
            || trimmed.starts_with("WITH")
        {
            // Check for FOR UPDATE which makes it a write
            if trimmed.contains("FOR UPDATE") {
                return ConnectionRole::Write;
            }
            ConnectionRole::Read
        } else {
            ConnectionRole::Write
        }
    }

    /// Execute a transaction on the primary.
    pub fn transaction<F, R>(&self, f: F) -> Result<R, VedaError>
    where
        F: FnOnce(&mut PooledClient) -> Result<R, VedaError>,
    {
        let mut client = self.primary.acquire()?;
        // We would need to expose transaction on PooledClient
        // For now, route to primary
        f(&mut client)
    }

    /// Close all pools.
    pub fn close(&self) {
        self.primary.close();
        for replica in &self.replicas {
            replica.close();
        }
    }
}

/// Read/Write split statistics.
#[derive(Debug, Clone)]
pub struct RwSplitStats {
    pub primary: crate::pool::PoolStats,
    pub replicas: Vec<crate::pool::PoolStats>,
    pub replica_count: usize,
}

impl std::fmt::Display for RwSplitStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "RW Split {{ primary={}, replicas={}, stats=[{}; {}] }}",
            self.primary,
            self.replica_count,
            self.primary,
            self.replicas
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}
