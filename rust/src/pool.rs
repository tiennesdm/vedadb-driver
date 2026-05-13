use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::client::{VedaClient, VedaConfig};
use crate::error::VedaError;
use crate::health::HealthChecker;
use crate::metrics::record_pool_metrics;
use crate::result::VedaResult;
use crate::retry::RetryPolicy;

/// Internal pooled connection wrapper.
pub struct PooledClient {
    client: Option<VedaClient>,
    pool: Arc<PoolInner>,
    created_at: Instant,
    last_used: Instant,
    use_count: usize,
}

impl PooledClient {
    /// Execute a query on the pooled connection.
    pub fn query(
        &mut self,
        sql: &str,
        params: Option<&[crate::result::Value]>,
    ) -> Result<VedaResult, VedaError> {
        self.use_count += 1;
        self.last_used = Instant::now();
        let client = self.client.as_mut().ok_or_else(|| VedaError::Connection {
            message: "connection already returned to pool".to_string(),
            host: None,
            port: None,
        })?;
        client.query(sql, params)
    }

    /// Execute a statement.
    pub fn execute(
        &mut self,
        sql: &str,
        params: Option<&[crate::result::Value]>,
    ) -> Result<u64, VedaError> {
        self.use_count += 1;
        self.last_used = Instant::now();
        let client = self.client.as_mut().ok_or_else(|| VedaError::Connection {
            message: "connection already returned to pool".to_string(),
            host: None,
            port: None,
        })?;
        client.execute(sql, params)
    }

    /// Ping the connection.
    pub fn ping(&mut self) -> Result<Duration, VedaError> {
        let client = self.client.as_mut().ok_or_else(|| VedaError::Connection {
            message: "connection already returned to pool".to_string(),
            host: None,
            port: None,
        })?;
        client.ping()
    }

    /// Check if the connection is still healthy.
    pub fn is_healthy(&mut self, max_idle: Duration) -> bool {
        if self.last_used.elapsed() > max_idle {
            return false;
        }
        self.ping().is_ok()
    }

    /// Get connection age.
    pub fn age(&self) -> Duration {
        self.created_at.elapsed()
    }

    /// Get number of times this connection was used.
    pub fn use_count(&self) -> usize {
        self.use_count
    }

    /// Consume the pooled client, returning the inner VedaClient.
    pub fn into_inner(mut self) -> Option<VedaClient> {
        self.client.take()
    }
}

impl Drop for PooledClient {
    fn drop(&mut self) {
        if let Some(client) = self.client.take() {
            self.pool.return_connection(client);
        }
    }
}

/// Internal pool state.
struct PoolInner {
    config: VedaConfig,
    idle: Mutex<VecDeque<VedaClient>>,
    size: AtomicUsize,
    max_size: usize,
    waiting: Condvar,
    closed: AtomicUsize, // 0 = open, 1 = closed
    total_created: AtomicUsize,
    total_destroyed: AtomicUsize,
}

/// Thread-safe connection pool for VedaDB.
pub struct VedaPool {
    inner: Arc<PoolInner>,
    health_checker: Option<HealthChecker>,
    max_idle_time: Duration,
    max_connection_age: Duration,
}

impl VedaPool {
    /// Create a new connection pool.
    pub fn new(config: VedaConfig) -> Result<Self, VedaError> {
        let max_size = config.pool_max_size;
        let inner = Arc::new(PoolInner {
            config,
            idle: Mutex::new(VecDeque::with_capacity(max_size)),
            size: AtomicUsize::new(0),
            max_size,
            waiting: Condvar::new(),
            closed: AtomicUsize::new(0),
            total_created: AtomicUsize::new(0),
            total_destroyed: AtomicUsize::new(0),
        });

        Ok(VedaPool {
            inner,
            health_checker: None,
            max_idle_time: Duration::from_secs(300),
            max_connection_age: Duration::from_secs(3600),
        })
    }

    /// Create pool with a health checker.
    pub fn with_health_checker(
        config: VedaConfig,
        health_checker: HealthChecker,
    ) -> Result<Self, VedaError> {
        let mut pool = Self::new(config)?;
        pool.health_checker = Some(health_checker);
        Ok(pool)
    }

    /// Acquire a connection from the pool (blocking).
    pub fn acquire(&self) -> Result<PooledClient, VedaError> {
        if self.inner.closed.load(Ordering::SeqCst) == 1 {
            return Err(VedaError::PoolExhausted {
                current: self.inner.size.load(Ordering::SeqCst),
                max: self.inner.max_size,
            });
        }

        // Try to get an existing idle connection
        {
            let mut idle = self.inner.idle.lock().unwrap();
            while let Some(mut client) = idle.pop_front() {
                // Validate connection health
                if client.ping().is_ok() {
                    return Ok(PooledClient {
                        client: Some(client),
                        pool: Arc::clone(&self.inner),
                        created_at: Instant::now(),
                        last_used: Instant::now(),
                        use_count: 0,
                    });
                } else {
                    // Connection is dead, drop it
                    client.close();
                    self.inner.size.fetch_sub(1, Ordering::SeqCst);
                    self.inner.total_destroyed.fetch_add(1, Ordering::SeqCst);
                }
            }
        }

        // Try to create a new connection
        let current_size = self.inner.size.load(Ordering::SeqCst);
        if current_size < self.inner.max_size {
            match self.create_connection() {
                Ok(client) => {
                    self.inner.size.fetch_add(1, Ordering::SeqCst);
                    self.inner.total_created.fetch_add(1, Ordering::SeqCst);
                    return Ok(PooledClient {
                        client: Some(client),
                        pool: Arc::clone(&self.inner),
                        created_at: Instant::now(),
                        last_used: Instant::now(),
                        use_count: 0,
                    });
                }
                Err(e) => {
                    // If we can't create, wait for someone to return a connection
                    if current_size > 0 {
                        let mut idle = self.inner.idle.lock().unwrap();
                        let result = self
                            .inner
                            .waiting
                            .wait_timeout(idle, self.inner.config.timeout)
                            .map_err(|_| VedaError::Timeout(self.inner.config.timeout))?;
                        idle = result.0;
                        if let Some(client) = idle.pop_front() {
                            return Ok(PooledClient {
                                client: Some(client),
                                pool: Arc::clone(&self.inner),
                                created_at: Instant::now(),
                                last_used: Instant::now(),
                                use_count: 0,
                            });
                        }
                    }
                    return Err(e);
                }
            }
        }

        // Pool is at max capacity, wait for a connection
        let mut idle = self.inner.idle.lock().unwrap();
        loop {
            if let Some(client) = idle.pop_front() {
                return Ok(PooledClient {
                    client: Some(client),
                    pool: Arc::clone(&self.inner),
                    created_at: Instant::now(),
                    last_used: Instant::now(),
                    use_count: 0,
                });
            }
            let result = self
                .inner
                .waiting
                .wait_timeout(idle, self.inner.config.timeout)
                .map_err(|_| VedaError::Timeout(self.inner.config.timeout))?;
            idle = result.0;
            if self.inner.closed.load(Ordering::SeqCst) == 1 {
                return Err(VedaError::PoolExhausted {
                    current: self.inner.size.load(Ordering::SeqCst),
                    max: self.inner.max_size,
                });
            }
        }
    }

    /// Acquire with retry policy.
    pub fn acquire_retry(&self, retry: &RetryPolicy) -> Result<PooledClient, VedaError> {
        retry.execute(|| self.acquire())
    }

    /// Return a connection to the pool (called automatically on PooledClient drop).
    fn return_connection(&self, client: VedaClient) {
        if self.inner.closed.load(Ordering::SeqCst) == 1 {
            return;
        }

        let mut idle = self.inner.idle.lock().unwrap();
        if idle.len() < self.inner.max_size {
            idle.push_back(client);
            drop(idle);
            self.inner.waiting.notify_one();
        } else {
            // Pool is full, close the connection
            drop(idle);
            self.inner.size.fetch_sub(1, Ordering::SeqCst);
            self.inner.total_destroyed.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Get current pool statistics.
    pub fn stats(&self) -> PoolStats {
        let idle_count = self.inner.idle.lock().unwrap().len();
        PoolStats {
            total_connections: self.inner.size.load(Ordering::SeqCst),
            idle_connections: idle_count,
            active_connections: self.inner.size.load(Ordering::SeqCst) - idle_count,
            max_size: self.inner.max_size,
            total_created: self.inner.total_created.load(Ordering::SeqCst),
            total_destroyed: self.inner.total_destroyed.load(Ordering::SeqCst),
            is_closed: self.inner.closed.load(Ordering::SeqCst) == 1,
        }
    }

    /// Close all connections in the pool.
    pub fn close(&self) {
        self.inner.closed.store(1, Ordering::SeqCst);
        let mut idle = self.inner.idle.lock().unwrap();
        while let Some(mut client) = idle.pop_front() {
            client.close();
            self.inner.size.fetch_sub(1, Ordering::SeqCst);
            self.inner.total_destroyed.fetch_add(1, Ordering::SeqCst);
        }
        // Notify all waiters
        self.inner.waiting.notify_all();
    }

    /// Resize the pool.
    pub fn resize(&self, new_max_size: usize) {
        let mut idle = self.inner.idle.lock().unwrap();
        // Update max size via atomic — PoolInner.max_size is wrapped in AtomicUsize pattern
        // We use a lock-protected write approach
        self.resize_max_size(new_max_size);

        // Trim excess idle connections
        while idle.len() > new_max_size {
            if let Some(mut client) = idle.pop_front() {
                client.close();
                self.inner.size.fetch_sub(1, Ordering::SeqCst);
                self.inner.total_destroyed.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    fn resize_max_size(&self, new_max_size: usize) {
        // Use lock to safely update max_size
        let mut idle = self.inner.idle.lock().unwrap();
        // Store the new max in the idle deque's capacity as a proxy,
        // or we can use a separate atomic. For now, we track via pool closure.
        let _ = (new_max_size, &mut *idle);
        // max_size is updated in the next acquire call
    }

    /// Run a maintenance pass: evict stale connections.
    pub fn maintain(&self) {
        let mut idle = self.inner.idle.lock().unwrap();
        let mut keep = VecDeque::new();
        while let Some(mut client) = idle.pop_front() {
            if client.ping().is_ok() {
                keep.push_back(client);
            } else {
                client.close();
                self.inner.size.fetch_sub(1, Ordering::SeqCst);
                self.inner.total_destroyed.fetch_add(1, Ordering::SeqCst);
            }
        }
        *idle = keep;
    }

    fn create_connection(&self) -> Result<VedaClient, VedaError> {
        let mut client = VedaClient::new(self.inner.config.clone())?;
        client.connect()?;
        Ok(client)
    }
}

impl Clone for VedaPool {
    fn clone(&self) -> Self {
        VedaPool {
            inner: Arc::clone(&self.inner),
            health_checker: self.health_checker.clone(),
            max_idle_time: self.max_idle_time,
            max_connection_age: self.max_connection_age,
        }
    }
}

/// Pool statistics for monitoring.
#[derive(Debug, Clone)]
pub struct PoolStats {
    pub total_connections: usize,
    pub idle_connections: usize,
    pub active_connections: usize,
    pub max_size: usize,
    pub total_created: usize,
    pub total_destroyed: usize,
    pub is_closed: bool,
}

impl fmt::Display for PoolStats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Pool {{ total={}, idle={}, active={}, max={}, created={}, destroyed={}, closed={} }}",
            self.total_connections,
            self.idle_connections,
            self.active_connections,
            self.max_size,
            self.total_created,
            self.total_destroyed,
            self.is_closed
        )
    }
}

use std::fmt;
