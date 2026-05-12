use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::client::VedaConfig;
use crate::error::VedaError;
use crate::pool::{PoolStats, PooledClient, VedaPool};
use crate::result::{Value, VedaResult};

/// Load balancing strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BalanceStrategy {
    /// Round-robin across all nodes.
    RoundRobin,
    /// Random selection.
    Random,
    /// Least connections.
    LeastConnections,
    /// Weighted round-robin.
    Weighted,
    /// First available (failover style).
    FirstAvailable,
}

/// Node in the load-balanced cluster.
pub struct BalancedNode {
    pool: VedaPool,
    weight: usize,
    failures: AtomicUsize,
    last_failure: Mutex<Option<Instant>>,
    total_requests: AtomicUsize,
}

/// Load balancer across multiple VedaDB nodes.
pub struct LoadBalancer {
    nodes: Vec<Arc<BalancedNode>>,
    strategy: BalanceStrategy,
    counter: AtomicUsize,
    unhealthy_threshold: usize,
    recovery_delay: Duration,
}

impl LoadBalancer {
    /// Create a new load balancer.
    pub fn new(configs: Vec<VedaConfig>, strategy: BalanceStrategy) -> Result<Self, VedaError> {
        let mut nodes = Vec::with_capacity(configs.len());
        for config in configs {
            let pool = VedaPool::new(config)?;
            nodes.push(Arc::new(BalancedNode {
                pool,
                weight: 1,
                failures: AtomicUsize::new(0),
                last_failure: Mutex::new(None),
                total_requests: AtomicUsize::new(0),
            }));
        }

        Ok(LoadBalancer {
            nodes,
            strategy,
            counter: AtomicUsize::new(0),
            unhealthy_threshold: 3,
            recovery_delay: Duration::from_secs(30),
        })
    }

    /// Create with weighted nodes.
    pub fn with_weights(
        configs: Vec<VedaConfig>,
        weights: Vec<usize>,
        strategy: BalanceStrategy,
    ) -> Result<Self, VedaError> {
        let mut lb = Self::new(configs, strategy)?;
        for (i, weight) in weights.iter().enumerate() {
            if let Some(node) = lb.nodes.get_mut(i) {
                // Need to recreate the Arc with new weight
                let pool = node.pool.clone();
                *node = Arc::new(BalancedNode {
                    pool,
                    weight: *weight,
                    failures: AtomicUsize::new(0),
                    last_failure: Mutex::new(None),
                    total_requests: AtomicUsize::new(0),
                });
            }
        }
        Ok(lb)
    }

    /// Execute a query on the selected node.
    pub fn query(
        &self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<VedaResult, VedaError> {
        let node = self.select_node()?;
        node.total_requests.fetch_add(1, Ordering::SeqCst);

        let mut client = node.pool.acquire()?;
        match client.query(sql, params) {
            Ok(result) => {
                node.failures.store(0, Ordering::SeqCst);
                Ok(result)
            }
            Err(e) => {
                let failures = node.failures.fetch_add(1, Ordering::SeqCst) + 1;
                *node.last_failure.lock().unwrap() = Some(Instant::now());

                if failures >= self.unhealthy_threshold {
                    // Try another node
                    self.query_with_fallback(sql, params, &node)
                } else {
                    Err(e)
                }
            }
        }
    }

    /// Execute with fallback to other nodes.
    fn query_with_fallback(
        &self,
        sql: &str,
        params: Option<&[Value]>,
        skip_node: &Arc<BalancedNode>,
    ) -> Result<VedaResult, VedaError> {
        let mut last_err = None;
        for node in &self.nodes {
            if Arc::ptr_eq(node, skip_node) {
                continue;
            }
            let mut client = match node.pool.acquire() {
                Ok(c) => c,
                Err(e) => {
                    last_err = Some(e);
                    continue;
                }
            };
            match client.query(sql, params) {
                Ok(result) => return Ok(result),
                Err(e) => last_err = Some(e),
            }
        }
        Err(last_err.unwrap_or_else(|| VedaError::Failover {
            attempts: self.nodes.len(),
        }))
    }

    /// Execute a statement (always goes to first healthy node or primary).
    pub fn execute(&self, sql: &str, params: Option<&[Value]>) -> Result<u64, VedaError> {
        let node = self.select_node()?;
        let mut client = node.pool.acquire()?;
        client.execute(sql, params)
    }

    /// Select a node based on the strategy.
    fn select_node(&self) -> Result<&Arc<BalancedNode>, VedaError> {
        let healthy_nodes: Vec<&Arc<BalancedNode>> = self
            .nodes
            .iter()
            .filter(|node| {
                let failures = node.failures.load(Ordering::SeqCst);
                if failures >= self.unhealthy_threshold {
                    // Check if recovery delay has passed
                    if let Some(last_fail) = *node.last_failure.lock().unwrap() {
                        if last_fail.elapsed() < self.recovery_delay {
                            return false;
                        }
                    }
                }
                true
            })
            .collect();

        if healthy_nodes.is_empty() {
            return Err(VedaError::Failover {
                attempts: self.nodes.len(),
            });
        }

        match self.strategy {
            BalanceStrategy::RoundRobin => {
                let idx = self.counter.fetch_add(1, Ordering::SeqCst) % healthy_nodes.len();
                Ok(healthy_nodes[idx])
            }
            BalanceStrategy::Random => {
                let random_val = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .subsec_nanos() as usize;
                let idx = random_val % healthy_nodes.len();
                Ok(healthy_nodes[idx])
            }
            BalanceStrategy::LeastConnections => {
                // Find node with most idle connections
                healthy_nodes
                    .iter()
                    .min_by_key(|node| {
                        let stats = node.pool.stats();
                        stats.active_connections
                    })
                    .map(|&n| Ok(n))
                    .unwrap_or_else(|| Ok(healthy_nodes[0]))
            }
            BalanceStrategy::Weighted => {
                // Simple weighted selection
                let total_weight: usize = healthy_nodes.iter().map(|n| n.weight).sum();
                if total_weight == 0 {
                    return Ok(healthy_nodes[0]);
                }
                let mut choice = self.counter.fetch_add(1, Ordering::SeqCst) % total_weight;
                for node in healthy_nodes {
                    if choice < node.weight {
                        return Ok(node);
                    }
                    choice -= node.weight;
                }
                Ok(healthy_nodes[0])
            }
            BalanceStrategy::FirstAvailable => {
                Ok(healthy_nodes[0])
            }
        }
    }

    /// Get statistics for all nodes.
    pub fn stats(&self) -> LoadBalanceStats {
        LoadBalanceStats {
            node_count: self.nodes.len(),
            node_stats: self
                .nodes
                .iter()
                .map(|node| NodeStats {
                    pool_stats: node.pool.stats(),
                    weight: node.weight,
                    failures: node.failures.load(Ordering::SeqCst),
                    total_requests: node.total_requests.load(Ordering::SeqCst),
                })
                .collect(),
            strategy: self.strategy,
        }
    }

    /// Add a new node dynamically.
    pub fn add_node(&mut self, config: VedaConfig) -> Result<(), VedaError> {
        let pool = VedaPool::new(config)?;
        self.nodes.push(Arc::new(BalancedNode {
            pool,
            weight: 1,
            failures: AtomicUsize::new(0),
            last_failure: Mutex::new(None),
            total_requests: AtomicUsize::new(0),
        }));
        Ok(())
    }

    /// Remove a node by index.
    pub fn remove_node(&mut self, index: usize) {
        if index < self.nodes.len() {
            self.nodes.remove(index);
        }
    }

    /// Get the number of nodes.
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Close all node pools.
    pub fn close(&self) {
        for node in &self.nodes {
            node.pool.close();
        }
    }
}

/// Statistics for a single node in the load balancer.
#[derive(Debug, Clone)]
pub struct NodeStats {
    pub pool_stats: PoolStats,
    pub weight: usize,
    pub failures: usize,
    pub total_requests: usize,
}

/// Overall load balancer statistics.
#[derive(Debug, Clone)]
pub struct LoadBalanceStats {
    pub node_count: usize,
    pub node_stats: Vec<NodeStats>,
    pub strategy: BalanceStrategy,
}

impl std::fmt::Display for LoadBalanceStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "LoadBalancer {{ strategy={:?}, nodes={}, {:?} }}",
            self.strategy, self.node_count, self.node_stats
        )
    }
}
