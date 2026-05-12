use std::thread;
use std::time::Duration;

use crate::error::VedaError;

/// Retry policy with exponential backoff and jitter.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_attempts: usize,
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub jitter: bool,
    pub retryable_errors: Vec<String>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        RetryPolicy {
            max_attempts: 3,
            base_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(5),
            jitter: true,
            retryable_errors: Vec::new(),
        }
    }
}

impl RetryPolicy {
    /// Create a new retry policy.
    pub fn new(max_attempts: usize) -> Self {
        RetryPolicy {
            max_attempts,
            ..Default::default()
        }
    }

    /// Set base delay.
    pub fn with_base_delay(mut self, delay: Duration) -> Self {
        self.base_delay = delay;
        self
    }

    /// Set max delay cap.
    pub fn with_max_delay(mut self, delay: Duration) -> Self {
        self.max_delay = delay;
        self
    }

    /// Enable/disable jitter.
    pub fn with_jitter(mut self, jitter: bool) -> Self {
        self.jitter = jitter;
        self
    }

    /// Calculate the delay for a given attempt (0-indexed).
    pub fn delay_for_attempt(&self, attempt: usize) -> Duration {
        let exp_delay = self
            .base_delay
            .saturating_mul(2_u32.saturating_pow(attempt as u32));
        let capped = std::cmp::min(exp_delay, self.max_delay);

        if self.jitter {
            let jitter_ms = if capped.as_millis() > 0 {
                let jitter_nanos = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .subsec_nanos() as u64;
                jitter_nanos % (capped.as_millis() as u64 / 2).max(1)
            } else {
                0
            };
            capped + Duration::from_millis(jitter_ms)
        } else {
            capped
        }
    }

    /// Execute a fallible operation with retry.
    pub fn execute<F, T>(&self, mut operation: F) -> Result<T, VedaError>
    where
        F: FnMut() -> Result<T, VedaError>,
    {
        let mut last_error = None;

        for attempt in 0..self.max_attempts {
            match operation() {
                Ok(result) => return Ok(result),
                Err(e) => {
                    if !e.is_retryable() {
                        return Err(e);
                    }
                    last_error = Some(e);
                    if attempt < self.max_attempts - 1 {
                        let delay = self.delay_for_attempt(attempt);
                        thread::sleep(delay);
                    }
                }
            }
        }

        Err(VedaError::RetryExhausted {
            attempts: self.max_attempts,
            last_error: last_error.map(|e| e.to_string()).unwrap_or_default(),
        })
    }

    /// Execute with a custom should-retry predicate.
    pub fn execute_with_predicate<F, T, P>(
        &self,
        mut operation: F,
        should_retry: P,
    ) -> Result<T, VedaError>
    where
        F: FnMut() -> Result<T, VedaError>,
        P: Fn(&VedaError) -> bool,
    {
        let mut last_error = None;

        for attempt in 0..self.max_attempts {
            match operation() {
                Ok(result) => return Ok(result),
                Err(e) => {
                    if !should_retry(&e) {
                        return Err(e);
                    }
                    last_error = Some(e);
                    if attempt < self.max_attempts - 1 {
                        let delay = self.delay_for_attempt(attempt);
                        thread::sleep(delay);
                    }
                }
            }
        }

        Err(VedaError::RetryExhausted {
            attempts: self.max_attempts,
            last_error: last_error.map(|e| e.to_string()).unwrap_or_default(),
        })
    }
}

/// Async retry policy for use with tokio.
#[cfg(feature = "tokio")]
pub struct AsyncRetryPolicy {
    pub inner: RetryPolicy,
}

#[cfg(feature = "tokio")]
impl AsyncRetryPolicy {
    pub fn new(max_attempts: usize) -> Self {
        AsyncRetryPolicy {
            inner: RetryPolicy::new(max_attempts),
        }
    }

    /// Execute an async fallible operation with retry.
    pub async fn execute<F, Fut, T>(&self, mut operation: F) -> Result<T, VedaError>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, VedaError>>,
    {
        let mut last_error = None;

        for attempt in 0..self.inner.max_attempts {
            match operation().await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    if !e.is_retryable() {
                        return Err(e);
                    }
                    last_error = Some(e);
                    if attempt < self.inner.max_attempts - 1 {
                        let delay = self.inner.delay_for_attempt(attempt);
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }

        Err(VedaError::RetryExhausted {
            attempts: self.inner.max_attempts,
            last_error: last_error.map(|e| e.to_string()).unwrap_or_default(),
        })
    }
}
