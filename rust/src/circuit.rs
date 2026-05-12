use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::error::VedaError;

/// Circuit breaker state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,      // Normal operation
    Open,        // Failing, rejecting requests
    HalfOpen,    // Testing if service recovered
}

/// Circuit breaker configuration.
#[derive(Debug, Clone)]
pub struct CircuitConfig {
    pub failure_threshold: usize,
    pub success_threshold: usize,
    pub open_duration: Duration,
    pub half_open_max_requests: usize,
}

impl Default for CircuitConfig {
    fn default() -> Self {
        CircuitConfig {
            failure_threshold: 5,
            success_threshold: 2,
            open_duration: Duration::from_secs(30),
            half_open_max_requests: 3,
        }
    }
}

/// Circuit breaker for protecting against cascading failures.
pub struct CircuitBreaker {
    config: CircuitConfig,
    state: Mutex<CircuitState>,
    failures: AtomicUsize,
    successes: AtomicUsize,
    last_failure_time: Mutex<Option<Instant>>,
    half_open_requests: AtomicUsize,
    total_requests: AtomicU64,
    total_failures: AtomicU64,
    total_successes: AtomicU64,
    name: String,
}

impl CircuitBreaker {
    /// Create a new circuit breaker with default config.
    pub fn new(name: &str) -> Arc<Self> {
        Arc::new(CircuitBreaker {
            config: CircuitConfig::default(),
            state: Mutex::new(CircuitState::Closed),
            failures: AtomicUsize::new(0),
            successes: AtomicUsize::new(0),
            last_failure_time: Mutex::new(None),
            half_open_requests: AtomicUsize::new(0),
            total_requests: AtomicU64::new(0),
            total_failures: AtomicU64::new(0),
            total_successes: AtomicU64::new(0),
            name: name.to_string(),
        })
    }

    /// Create with custom config.
    pub fn with_config(name: &str, config: CircuitConfig) -> Arc<Self> {
        Arc::new(CircuitBreaker {
            config,
            state: Mutex::new(CircuitState::Closed),
            failures: AtomicUsize::new(0),
            successes: AtomicUsize::new(0),
            last_failure_time: Mutex::new(None),
            half_open_requests: AtomicUsize::new(0),
            total_requests: AtomicU64::new(0),
            total_failures: AtomicU64::new(0),
            total_successes: AtomicU64::new(0),
            name: name.to_string(),
        })
    }

    /// Check if the circuit allows a request through.
    pub fn allow(&self) -> Result<(), VedaError> {
        self.total_requests.fetch_add(1, Ordering::SeqCst);

        let mut state = self.state.lock().unwrap();

        match *state {
            CircuitState::Closed => Ok(()),
            CircuitState::Open => {
                // Check if open duration has elapsed
                let should_try = {
                    let last_fail = self.last_failure_time.lock().unwrap();
                    match *last_fail {
                        Some(t) if t.elapsed() >= self.config.open_duration => true,
                        None => true,
                        _ => false,
                    }
                };

                if should_try {
                    *state = CircuitState::HalfOpen;
                    self.half_open_requests.store(0, Ordering::SeqCst);
                    self.failures.store(0, Ordering::SeqCst);
                    self.successes.store(0, Ordering::SeqCst);
                    drop(state);
                    self.half_open_requests.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                } else {
                    Err(VedaError::CircuitOpen(self.name.clone()))
                }
            }
            CircuitState::HalfOpen => {
                let current = self.half_open_requests.load(Ordering::SeqCst);
                if current < self.config.half_open_max_requests {
                    self.half_open_requests.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                } else {
                    Err(VedaError::CircuitOpen(format!(
                        "{} (half-open limit reached)",
                        self.name
                    )))
                }
            }
        }
    }

    /// Record a successful request.
    pub fn record_success(&self) {
        self.total_successes.fetch_add(1, Ordering::SeqCst);

        let mut state = self.state.lock().unwrap();
        match *state {
            CircuitState::HalfOpen => {
                let successes = self.successes.fetch_add(1, Ordering::SeqCst) + 1;
                if successes >= self.config.success_threshold {
                    *state = CircuitState::Closed;
                    self.failures.store(0, Ordering::SeqCst);
                    self.half_open_requests.store(0, Ordering::SeqCst);
                }
            }
            CircuitState::Closed => {
                // Reset failure count on success
                self.failures.store(0, Ordering::SeqCst);
            }
            _ => {}
        }
    }

    /// Record a failed request.
    pub fn record_failure(&self) {
        self.total_failures.fetch_add(1, Ordering::SeqCst);

        let mut state = self.state.lock().unwrap();
        match *state {
            CircuitState::HalfOpen => {
                // Any failure in half-open goes back to open
                *state = CircuitState::Open;
                let mut last_fail = self.last_failure_time.lock().unwrap();
                *last_fail = Some(Instant::now());
            }
            CircuitState::Closed => {
                let failures = self.failures.fetch_add(1, Ordering::SeqCst) + 1;
                if failures >= self.config.failure_threshold {
                    *state = CircuitState::Open;
                    let mut last_fail = self.last_failure_time.lock().unwrap();
                    *last_fail = Some(Instant::now());
                }
            }
            _ => {}
        }
    }

    /// Get current state.
    pub fn state(&self) -> CircuitState {
        *self.state.lock().unwrap()
    }

    /// Get statistics.
    pub fn stats(&self) -> CircuitStats {
        CircuitStats {
            state: self.state(),
            failures: self.failures.load(Ordering::SeqCst),
            successes: self.successes.load(Ordering::SeqCst),
            total_requests: self.total_requests.load(Ordering::SeqCst),
            total_failures: self.total_failures.load(Ordering::SeqCst),
            total_successes: self.total_successes.load(Ordering::SeqCst),
            failure_rate: self.failure_rate(),
        }
    }

    /// Calculate failure rate (0.0 to 1.0).
    pub fn failure_rate(&self) -> f64 {
        let total = self.total_requests.load(Ordering::SeqCst);
        if total == 0 {
            0.0
        } else {
            self.total_failures.load(Ordering::SeqCst) as f64 / total as f64
        }
    }

    /// Reset the circuit to Closed.
    pub fn reset(&self) {
        let mut state = self.state.lock().unwrap();
        *state = CircuitState::Closed;
        self.failures.store(0, Ordering::SeqCst);
        self.successes.store(0, Ordering::SeqCst);
        self.half_open_requests.store(0, Ordering::SeqCst);
        let mut last_fail = self.last_failure_time.lock().unwrap();
        *last_fail = None;
    }

    /// Execute a fallible operation through the circuit breaker.
    pub fn execute<F, T>(&self, operation: F) -> Result<T, VedaError>
    where
        F: FnOnce() -> Result<T, VedaError>,
    {
        self.allow()?;
        match operation() {
            Ok(result) => {
                self.record_success();
                Ok(result)
            }
            Err(e) => {
                self.record_failure();
                Err(e)
            }
        }
    }

    /// Get the circuit name.
    pub fn name(&self) -> &str {
        &self.name
    }
}

/// Circuit breaker statistics.
#[derive(Debug, Clone)]
pub struct CircuitStats {
    pub state: CircuitState,
    pub failures: usize,
    pub successes: usize,
    pub total_requests: u64,
    pub total_failures: u64,
    pub total_successes: u64,
    pub failure_rate: f64,
}

impl fmt::Display for CircuitStats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Circuit {{ state={:?}, failures={}, successes={}, total_req={}, failure_rate={:.2}% }}",
            self.state,
            self.failures,
            self.successes,
            self.total_requests,
            self.failure_rate * 100.0
        )
    }
}

use std::fmt;

/// Thread-safe circuit breaker registry for managing multiple circuits.
pub struct CircuitRegistry {
    circuits: Mutex<Vec<Arc<CircuitBreaker>>>,
}

impl CircuitRegistry {
    pub fn new() -> Self {
        CircuitRegistry {
            circuits: Mutex::new(Vec::new()),
        }
    }

    pub fn register(&self, cb: Arc<CircuitBreaker>) {
        self.circuits.lock().unwrap().push(cb);
    }

    pub fn stats(&self) -> Vec<(String, CircuitStats)> {
        self.circuits
            .lock()
            .unwrap()
            .iter()
            .map(|cb| (cb.name().to_string(), cb.stats()))
            .collect()
    }

    pub fn reset_all(&self) {
        for cb in self.circuits.lock().unwrap().iter() {
            cb.reset();
        }
    }
}
