use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::client::VedaConfig;
use crate::error::VedaError;

/// Health status of a single node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
}

/// Health check result for a node.
#[derive(Debug, Clone)]
pub struct HealthCheckResult {
    pub node_id: String,
    pub status: HealthStatus,
    pub latency: Duration,
    pub last_check: Instant,
    pub consecutive_failures: u64,
    pub consecutive_successes: u64,
    pub message: Option<String>,
}

/// Configuration for health checks.
#[derive(Debug, Clone)]
pub struct HealthConfig {
    pub check_interval: Duration,
    pub timeout: Duration,
    pub unhealthy_threshold: u64,
    pub healthy_threshold: u64,
    pub check_command: String,
}

impl Default for HealthConfig {
    fn default() -> Self {
        HealthConfig {
            check_interval: Duration::from_secs(10),
            timeout: Duration::from_secs(5),
            unhealthy_threshold: 3,
            healthy_threshold: 2,
            check_command: "SELECT 1".to_string(),
        }
    }
}

/// Health checker that monitors VedaDB nodes.
pub struct HealthChecker {
    config: HealthConfig,
    nodes: Mutex<HashMap<String, NodeHealth>>,
    running: AtomicBool,
    check_handle: Mutex<Option<thread::JoinHandle<()>>>,
}

#[derive(Debug, Clone)]
struct NodeHealth {
    config: VedaConfig,
    status: HealthStatus,
    latency: Duration,
    last_check: Option<Instant>,
    consecutive_failures: u64,
    consecutive_successes: u64,
    message: Option<String>,
}

impl HealthChecker {
    /// Create a new health checker.
    pub fn new(config: HealthConfig) -> Arc<Self> {
        Arc::new(HealthChecker {
            config,
            nodes: Mutex::new(HashMap::new()),
            running: AtomicBool::new(false),
            check_handle: Mutex::new(None),
        })
    }

    /// Register a node to monitor.
    pub fn register_node(&self, node_id: &str, node_config: VedaConfig) {
        let mut nodes = self.nodes.lock().unwrap();
        nodes.insert(
            node_id.to_string(),
            NodeHealth {
                config: node_config,
                status: HealthStatus::Unknown,
                latency: Duration::from_secs(0),
                last_check: None,
                consecutive_failures: 0,
                consecutive_successes: 0,
                message: None,
            },
        );
    }

    /// Remove a node from monitoring.
    pub fn unregister_node(&self, node_id: &str) {
        self.nodes.lock().unwrap().remove(node_id);
    }

    /// Get health status for a specific node.
    pub fn node_status(&self, node_id: &str) -> Option<HealthCheckResult> {
        let nodes = self.nodes.lock().unwrap();
        nodes.get(node_id).map(|node| HealthCheckResult {
            node_id: node_id.to_string(),
            status: node.status.clone(),
            latency: node.latency,
            last_check: node.last_check.unwrap_or_else(Instant::now),
            consecutive_failures: node.consecutive_failures,
            consecutive_successes: node.consecutive_successes,
            message: node.message.clone(),
        })
    }

    /// Get all node statuses.
    pub fn all_statuses(&self) -> Vec<HealthCheckResult> {
        let nodes = self.nodes.lock().unwrap();
        nodes
            .iter()
            .map(|(id, node)| HealthCheckResult {
                node_id: id.clone(),
                status: node.status.clone(),
                latency: node.latency,
                last_check: node.last_check.unwrap_or_else(Instant::now),
                consecutive_failures: node.consecutive_failures,
                consecutive_successes: node.consecutive_successes,
                message: node.message.clone(),
            })
            .collect()
    }

    /// Get healthy nodes.
    pub fn healthy_nodes(&self) -> Vec<String> {
        let nodes = self.nodes.lock().unwrap();
        nodes
            .iter()
            .filter(|(_, node)| matches!(node.status, HealthStatus::Healthy))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Start background health checking.
    pub fn start(&self) {
        if self.running.swap(true, Ordering::SeqCst) {
            return; // Already running
        }

        let checker = Arc::new(HealthChecker {
            config: self.config.clone(),
            nodes: Mutex::new(HashMap::new()),
            running: AtomicBool::new(true),
            check_handle: Mutex::new(None),
        });

        let handle = thread::spawn(move || {
            while checker.running.load(Ordering::SeqCst) {
                // Clone node configs to avoid holding the lock during checks
                let node_configs: Vec<(String, VedaConfig)> = {
                    let nodes = checker.nodes.lock().unwrap();
                    nodes
                        .iter()
                        .map(|(id, node)| (id.clone(), node.config.clone()))
                        .collect()
                };

                for (node_id, config) in node_configs {
                    let start = Instant::now();
                    let result = Self::check_node(&config);
                    let latency = start.elapsed();

                    let mut nodes = checker.nodes.lock().unwrap();
                    if let Some(node) = nodes.get_mut(&node_id) {
                        node.latency = latency;
                        node.last_check = Some(Instant::now());

                        match result {
                            Ok(_) => {
                                node.consecutive_successes += 1;
                                node.consecutive_failures = 0;
                                if node.consecutive_successes
                                    >= checker.config.healthy_threshold
                                {
                                    node.status = HealthStatus::Healthy;
                                }
                                node.message = Some(format!(
                                    "healthy ({}ms)",
                                    latency.as_millis()
                                ));
                            }
                            Err(e) => {
                                node.consecutive_failures += 1;
                                node.consecutive_successes = 0;
                                if node.consecutive_failures
                                    >= checker.config.unhealthy_threshold
                                {
                                    node.status = HealthStatus::Unhealthy;
                                } else if node.consecutive_failures > 0 {
                                    node.status = HealthStatus::Degraded;
                                }
                                node.message = Some(format!(
                                    "unhealthy: {} ({}ms)",
                                    e,
                                    latency.as_millis()
                                ));
                            }
                        }
                    }
                }

                thread::sleep(checker.config.check_interval);
            }
        });

        let mut guard = self.check_handle.lock().unwrap();
        *guard = Some(handle);
    }

    /// Stop background health checking.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.check_handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }

    /// Check if the checker is running.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Perform a single health check on a node.
    fn check_node(config: &VedaConfig) -> Result<(), VedaError> {
        use crate::client::VedaClient;
        let mut client = VedaClient::new(config.clone())?;
        client.connect()?;
        client.ping()?;
        client.close();
        Ok(())
    }

    /// Check if any nodes are healthy.
    pub fn has_healthy_nodes(&self) -> bool {
        let nodes = self.nodes.lock().unwrap();
        nodes
            .values()
            .any(|node| matches!(node.status, HealthStatus::Healthy))
    }

    /// Get the number of registered nodes.
    pub fn node_count(&self) -> usize {
        self.nodes.lock().unwrap().len()
    }
}

impl Clone for HealthChecker {
    fn clone(&self) -> Self {
        HealthChecker {
            config: self.config.clone(),
            nodes: Mutex::new(HashMap::new()),
            running: AtomicBool::new(false),
            check_handle: Mutex::new(None),
        }
    }
}
