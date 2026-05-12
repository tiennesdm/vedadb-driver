use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::client::VedaConfig;
use crate::error::VedaError;
use crate::health::{HealthChecker, HealthConfig, HealthStatus};
use crate::pool::{PooledClient, VedaPool};
use crate::result::{Value, VedaResult};
use crate::retry::RetryPolicy;

/// Failover strategy when the primary node fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailoverStrategy {
    /// Switch to the next node in order.
    Failover,
    /// Try the next node but keep primary as preferred.
    FailoverWithFallback,
    /// Round-robin across all nodes.
    RoundRobin,
    /// Read from replicas, always write to primary.
    ReadReplicas,
}

/// A node in the failover cluster.
pub struct ClusterNode {
    pub id: String,
    pub config: VedaConfig,
    pool: VedaPool,
    priority: usize,
    is_primary: bool,
    failures: AtomicUsize,
    last_failure: Mutex<Option<Instant>>,
    total_requests: AtomicUsize,
}

impl ClusterNode {
    /// Create a new cluster node.
    pub fn new(id: &str, config: VedaConfig, is_primary: bool, priority: usize) -> Result<Self, VedaError> {
        let pool = VedaPool::new(config.clone())?;
        Ok(ClusterNode {
            id: id.to_string(),
            config,
            pool,
            priority,
            is_primary,
            failures: AtomicUsize::new(0),
            last_failure: Mutex::new(None),
            total_requests: AtomicUsize::new(0),
        })
    }

    /// Check if this node is healthy (recent failures are acceptable).
    pub fn is_healthy(&self) -> bool {
        let failures = self.failures.load(Ordering::SeqCst);
        if failures >= 3 {
            // Check if enough time has passed for recovery
            if let Some(last_fail) = *self.last_failure.lock().unwrap() {
                if last_fail.elapsed() < Duration::from_secs(30) {
                    return false;
                }
            }
        }
        true
    }

    /// Reset failure count (called on successful operation).
    pub fn mark_success(&self) {
        self.failures.store(0, Ordering::SeqCst);
        *self.last_failure.lock().unwrap() = None;
    }

    /// Mark a failure.
    pub fn mark_failure(&self) {
        self.failures.fetch_add(1, Ordering::SeqCst);
        *self.last_failure.lock().unwrap() = Some(Instant::now());
    }

    /// Acquire a connection from this node.
    pub fn acquire(&self) -> Result<PooledClient, VedaError> {
        self.total_requests.fetch_add(1, Ordering::SeqCst);
        self.pool.acquire()
    }

    /// Get pool stats for this node.
    pub fn stats(&self) -> crate::pool::PoolStats {
        self.pool.stats()
    }

    /// Close the node pool.
    pub fn close(&self) {
        self.pool.close();
    }
}

/// Multi-node failover cluster for high availability.
pub struct FailoverCluster {
    nodes: Vec<Arc<ClusterNode>>,
    strategy: FailoverStrategy,
    current_node: AtomicUsize,
    retry_policy: RetryPolicy,
    health_checker: Option<HealthChecker>,
    primary_index: AtomicUsize,
    auto_failover: bool,
    failover_count: AtomicUsize,
    last_failover: Mutex<Option<Instant>>,
}

impl FailoverCluster {
    /// Create a new failover cluster.
    pub fn new(
        nodes: Vec<(String, VedaConfig)>,
        strategy: FailoverStrategy,
    ) -> Result<Self, VedaError> {
        let mut cluster_nodes = Vec::with_capacity(nodes.len());
        for (i, (id, config)) in nodes.into_iter().enumerate() {
            let is_primary = i == 0;
            cluster_nodes.push(Arc::new(ClusterNode::new(
                &id,
                config,
                is_primary,
                nodes.len() - i, // Higher priority for earlier nodes
            )?));
        }

        Ok(FailoverCluster {
            nodes: cluster_nodes,
            strategy,
            current_node: AtomicUsize::new(0),
            retry_policy: RetryPolicy::new(3),
            health_checker: None,
            primary_index: AtomicUsize::new(0),
            auto_failover: true,
            failover_count: AtomicUsize::new(0),
            last_failover: Mutex::new(None),
        })
    }

    /// Create with a health checker.
    pub fn with_health_checker(
        nodes: Vec<(String, VedaConfig)>,
        strategy: FailoverStrategy,
        health_config: HealthConfig,
    ) -> Result<Self, VedaError> {
        let mut cluster = Self::new(nodes.clone(), strategy)?;
        let checker = HealthChecker::new(health_config);
        for (id, config) in nodes {
            checker.register_node(&id, config);
        }
        cluster.health_checker = Some((*checker).clone());
        Ok(cluster)
    }

    /// Set retry policy.
    pub fn with_retry_policy(mut self, policy: RetryPolicy) -> Self {
        self.retry_policy = policy;
        self
    }

    /// Disable auto-failover.
    pub fn disable_auto_failover(mut self) -> Self {
        self.auto_failover = false;
        self
    }

    /// Execute a query with automatic failover.
    pub fn query(
        &self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<VedaResult, VedaError> {
        self.execute_with_failover(|client| client.query(sql, params))
    }

    /// Execute a statement with automatic failover.
    pub fn execute(
        &self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<u64, VedaError> {
        let mut last_err = None;
        let start_node = self.current_node.load(Ordering::SeqCst);

        for i in 0..self.nodes.len() {
            let idx = (start_node + i) % self.nodes.len();
            let node = &self.nodes[idx];

            if !node.is_healthy() {
                continue;
            }

            match node.acquire() {
                Ok(mut client) => match client.execute(sql, params) {
                    Ok(result) => {
                        node.mark_success();
                        self.current_node.store(idx, Ordering::SeqCst);
                        return Ok(result);
                    }
                    Err(e) => {
                        node.mark_failure();
                        last_err = Some(e);
                    }
                },
                Err(e) => {
                    node.mark_failure();
                    last_err = Some(e);
                }
            }
        }

        Err(last_err.unwrap_or_else(|| VedaError::Failover {
            attempts: self.nodes.len(),
        }))
    }

    /// Internal: execute with failover across nodes.
    fn execute_with_failover<F>(&self, operation: F) -> Result<VedaResult, VedaError>
    where
        F: Fn(&mut PooledClient) -> Result<VedaResult, VedaError>,
    {
        let mut last_err = None;
        let start_node = self.current_node.load(Ordering::SeqCst);

        for i in 0..self.nodes.len() {
            let idx = (start_node + i) % self.nodes.len();
            let node = &self.nodes[idx];

            if !node.is_healthy() {
                continue;
            }

            match node.acquire() {
                Ok(mut client) => match operation(&mut client) {
                    Ok(result) => {
                        node.mark_success();
                        self.current_node.store(idx, Ordering::SeqCst);
                        return Ok(result);
                    }
                    Err(e) => {
                        if e.is_disconnect() && self.auto_failover {
                            node.mark_failure();
                            // Trigger failover to next node
                            self.perform_failover(idx);
                            last_err = Some(e);
                        } else {
                            return Err(e);
                        }
                    }
                },
                Err(e) => {
                    node.mark_failure();
                    last_err = Some(e);
                }
            }
        }

        Err(last_err.unwrap_or_else(|| VedaError::Failover {
            attempts: self.nodes.len(),
        }))
    }

    /// Perform failover to the next node.
    fn perform_failover(&self, failed_idx: usize) {
        let next_idx = (failed_idx + 1) % self.nodes.len();
        self.current_node.store(next_idx, Ordering::SeqCst);
        self.failover_count.fetch_add(1, Ordering::SeqCst);
        *self.last_failover.lock().unwrap() = Some(Instant::now());

        eprintln!(
            "[VEDADB FAILOVER] Node {} failed, switched to node {}",
            failed_idx, next_idx
        );
    }

    /// Get the current active node ID.
    pub fn current_node_id(&self) -> Option<String> {
        let idx = self.current_node.load(Ordering::SeqCst);
        self.nodes.get(idx).map(|n| n.id.clone())
    }

    /// Get all node IDs.
    pub fn node_ids(&self) -> Vec<String> {
        self.nodes.iter().map(|n| n.id.clone()).collect()
    }

    /// Get cluster statistics.
    pub fn stats(&self) -> FailoverStats {
        FailoverStats {
            node_count: self.nodes.len(),
            current_node: self.current_node.load(Ordering::SeqCst),
            current_node_id: self.current_node_id(),
            failover_count: self.failover_count.load(Ordering::SeqCst),
            node_stats: self
                .nodes
                .iter()
                .map(|node| NodeFailoverStats {
                    id: node.id.clone(),
                    is_primary: node.is_primary,
                    is_healthy: node.is_healthy(),
                    failures: node.failures.load(Ordering::SeqCst),
                    total_requests: node.total_requests.load(Ordering::SeqCst),
                    pool_stats: node.stats(),
                })
                .collect(),
            auto_failover: self.auto_failover,
            strategy: self.strategy,
        }
    }

    /// Manually failover to a specific node.
    pub fn failover_to(&self, node_id: &str) -> Result<(), VedaError> {
        for (i, node) in self.nodes.iter().enumerate() {
            if node.id == node_id {
                self.current_node.store(i, Ordering::SeqCst);
                self.failover_count.fetch_add(1, Ordering::SeqCst);
                *self.last_failover.lock().unwrap() = Some(Instant::now());
                return Ok(());
            }
        }
        Err(VedaError::Failover {
            attempts: self.nodes.len(),
        })
    }

    /// Get the primary node ID.
    pub fn primary_id(&self) -> Option<String> {
        let idx = self.primary_index.load(Ordering::SeqCst);
        self.nodes.get(idx).map(|n| n.id.clone())
    }

    /// Check if the cluster has any healthy nodes.
    pub fn has_healthy_nodes(&self) -> bool {
        self.nodes.iter().any(|n| n.is_healthy())
    }

    /// Close all node connections.
    pub fn close(&self) {
        for node in &self.nodes {
            node.close();
        }
    }

    /// Start health checking.
    pub fn start_health_checks(&self) {
        if let Some(ref checker) = self.health_checker {
            checker.start();
        }
    }

    /// Stop health checking.
    pub fn stop_health_checks(&self) {
        if let Some(ref checker) = self.health_checker {
            checker.stop();
        }
    }
}

/// Statistics for an individual node in the failover cluster.
#[derive(Debug, Clone)]
pub struct NodeFailoverStats {
    pub id: String,
    pub is_primary: bool,
    pub is_healthy: bool,
    pub failures: usize,
    pub total_requests: usize,
    pub pool_stats: crate::pool::PoolStats,
}

/// Overall failover cluster statistics.
#[derive(Debug, Clone)]
pub struct FailoverStats {
    pub node_count: usize,
    pub current_node: usize,
    pub current_node_id: Option<String>,
    pub failover_count: usize,
    pub node_stats: Vec<NodeFailoverStats>,
    pub auto_failover: bool,
    pub strategy: FailoverStrategy,
}

impl std::fmt::Display for FailoverStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "FailoverCluster {{ nodes={}, current={}, failovers={}, strategy={:?} }}\n",
            self.node_count,
            self.current_node_id.as_deref().unwrap_or("unknown"),
            self.failover_count,
            self.strategy,
        )?;
        for node in &self.node_stats {
            write!(
                f,
                "  Node {}: primary={}, healthy={}, failures={}, requests={}\n",
                node.id, node.is_primary, node.is_healthy, node.failures, node.total_requests
            )?;
        }
        Ok(())
    }
}
