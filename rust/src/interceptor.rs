use std::sync::{Arc, Mutex};

use crate::error::VedaError;
use crate::result::{Value, VedaResult};

/// Context passed through the interceptor chain.
#[derive(Debug, Clone)]
pub struct InterceptorContext {
    pub sql: String,
    pub params: Vec<Value>,
    pub metadata: std::collections::HashMap<String, String>,
    pub start_time_ms: u64,
    pub operation: OperationType,
}

/// Type of database operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationType {
    Query,
    Execute,
    Begin,
    Commit,
    Rollback,
    Prepare,
    Ping,
    BulkInsert,
    Other,
}

impl InterceptorContext {
    /// Create a new context.
    pub fn new(sql: &str, params: Vec<Value>, operation: OperationType) -> Self {
        InterceptorContext {
            sql: sql.to_string(),
            params,
            metadata: std::collections::HashMap::new(),
            start_time_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            operation,
        }
    }

    /// Add metadata.
    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
}

/// Interceptor trait for middleware hooks.
///
/// Interceptors can inspect, modify, or reject queries before they
/// are sent to the database, and inspect results before they are
/// returned to the caller.
pub trait Interceptor: Send + Sync {
    /// Called before a query is executed.
    /// Return Ok(()) to continue, Err to abort.
    fn before(&self, ctx: &mut InterceptorContext) -> Result<(), VedaError>;

    /// Called after a query is executed.
    fn after(&self, ctx: &InterceptorContext, result: &mut VedaResult);

    /// Called when an error occurs.
    fn on_error(&self, ctx: &InterceptorContext, error: &VedaError);

    /// Get the interceptor name.
    fn name(&self) -> &str;
    
    /// Priority: lower numbers run first.
    fn priority(&self) -> i32 {
        100
    }
}

/// Logging interceptor that logs all queries and their timing.
pub struct LoggingInterceptor {
    name: String,
    log_params: bool,
    slow_query_threshold_ms: u64,
}

impl LoggingInterceptor {
    pub fn new() -> Self {
        LoggingInterceptor {
            name: "logging".to_string(),
            log_params: true,
            slow_query_threshold_ms: 1000,
        }
    }

    pub fn with_params(mut self, log_params: bool) -> Self {
        self.log_params = log_params;
        self
    }

    pub fn with_slow_query_threshold(mut self, ms: u64) -> Self {
        self.slow_query_threshold_ms = ms;
        self
    }
}

impl Interceptor for LoggingInterceptor {
    fn before(&self, ctx: &mut InterceptorContext) -> Result<(), VedaError> {
        Ok(())
    }

    fn after(&self, ctx: &InterceptorContext, result: &mut VedaResult) {
        let elapsed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
            - ctx.start_time_ms;

        if elapsed > self.slow_query_threshold_ms {
            eprintln!(
                "[VEDADB SLOW QUERY] {}ms: {}",
                elapsed, ctx.sql
            );
        }
    }

    fn on_error(&self, ctx: &InterceptorContext, error: &VedaError) {
        eprintln!("[VEDADB ERROR] query='{}' error={}", ctx.sql, error);
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn priority(&self) -> i32 {
        10
    }
}

/// Query validation interceptor that rejects dangerous queries.
pub struct ValidationInterceptor {
    name: String,
    forbidden_keywords: Vec<String>,
    max_query_length: usize,
    require_where_for_delete: bool,
}

impl ValidationInterceptor {
    pub fn new() -> Self {
        ValidationInterceptor {
            name: "validation".to_string(),
            forbidden_keywords: vec![
                "DROP DATABASE".to_string(),
                "SHUTDOWN".to_string(),
                "--".to_string(),
            ],
            max_query_length: 10000,
            require_where_for_delete: true,
        }
    }

    pub fn forbid_keyword(mut self, keyword: &str) -> Self {
        self.forbidden_keywords.push(keyword.to_string());
        self
    }

    pub fn with_max_query_length(mut self, len: usize) -> Self {
        self.max_query_length = len;
        self
    }
}

impl Interceptor for ValidationInterceptor {
    fn before(&self, ctx: &mut InterceptorContext) -> Result<(), VedaError> {
        let upper = ctx.sql.to_uppercase();

        if ctx.sql.len() > self.max_query_length {
            return Err(VedaError::Interceptor(format!(
                "query exceeds max length of {} characters",
                self.max_query_length
            )));
        }

        for keyword in &self.forbidden_keywords {
            if upper.contains(&keyword.to_uppercase()) {
                return Err(VedaError::Interceptor(format!(
                    "query contains forbidden keyword: '{}'",
                    keyword
                )));
            }
        }

        if self.require_where_for_delete && upper.starts_with("DELETE") {
            if !upper.contains("WHERE") {
                return Err(VedaError::Interceptor(
                    "DELETE without WHERE is not allowed".to_string(),
                ));
            }
        }

        Ok(())
    }

    fn after(&self, _ctx: &InterceptorContext, _result: &mut VedaResult) {}

    fn on_error(&self, _ctx: &InterceptorContext, _error: &VedaError) {}

    fn name(&self) -> &str {
        &self.name
    }

    fn priority(&self) -> i32 {
        1 // Run first
    }
}

/// Metrics interceptor that records query metrics.
pub struct MetricsInterceptor {
    name: String,
    metrics: Arc<crate::metrics::MetricsCollector>,
}

impl MetricsInterceptor {
    pub fn new(metrics: Arc<crate::metrics::MetricsCollector>) -> Self {
        MetricsInterceptor {
            name: "metrics".to_string(),
            metrics,
        }
    }
}

impl Interceptor for MetricsInterceptor {
    fn before(&self, _ctx: &mut InterceptorContext) -> Result<(), VedaError> {
        Ok(())
    }

    fn after(&self, ctx: &InterceptorContext, result: &mut VedaResult) {
        let elapsed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
            - ctx.start_time_ms;

        self.metrics.inc_counter(crate::metrics::metric_names::QUERY_TOTAL);
        self.metrics.record_duration(
            crate::metrics::metric_names::QUERY_DURATION,
            std::time::Duration::from_millis(elapsed),
        );
        self.metrics.add_counter(
            crate::metrics::metric_names::QUERY_ROWS_RETURNED,
            result.row_count as u64,
        );
    }

    fn on_error(&self, _ctx: &InterceptorContext, _error: &VedaError) {
        self.metrics.inc_counter(crate::metrics::metric_names::QUERY_ERRORS);
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn priority(&self) -> i32 {
        50
    }
}

/// Chain of interceptors that process queries in order.
pub struct InterceptorChain {
    interceptors: Vec<Arc<dyn Interceptor>>,
}

impl InterceptorChain {
    /// Create a new empty chain.
    pub fn new() -> Self {
        InterceptorChain {
            interceptors: Vec::new(),
        }
    }

    /// Create a chain with common interceptors.
    pub fn default_chain() -> Self {
        let mut chain = InterceptorChain::new();
        chain.add(Arc::new(ValidationInterceptor::new()));
        chain.add(Arc::new(LoggingInterceptor::new()));
        chain
    }

    /// Add an interceptor to the chain.
    pub fn add(&mut self, interceptor: Arc<dyn Interceptor>) {
        self.interceptors.push(interceptor);
        // Sort by priority
        self.interceptors
            .sort_by_key(|i| i.priority());
    }

    /// Execute the 'before' phase of all interceptors.
    pub fn before(&self, ctx: &mut InterceptorContext) -> Result<(), VedaError> {
        for interceptor in &self.interceptors {
            interceptor.before(ctx)?;
        }
        Ok(())
    }

    /// Execute the 'after' phase of all interceptors.
    pub fn after(&self, ctx: &InterceptorContext, result: &mut VedaResult) {
        for interceptor in &self.interceptors {
            interceptor.after(ctx, result);
        }
    }

    /// Execute the 'on_error' phase of all interceptors.
    pub fn on_error(&self, ctx: &InterceptorContext, error: &VedaError) {
        for interceptor in &self.interceptors {
            interceptor.on_error(ctx, error);
        }
    }

    /// Execute a full query through the interceptor chain.
    pub fn execute<F>(
        &self,
        ctx: &mut InterceptorContext,
        operation: F,
    ) -> Result<VedaResult, VedaError>
    where
        F: FnOnce() -> Result<VedaResult, VedaError>,
    {
        self.before(ctx)?;

        match operation() {
            Ok(mut result) => {
                self.after(ctx, &mut result);
                Ok(result)
            }
            Err(e) => {
                self.on_error(ctx, &e);
                Err(e)
            }
        }
    }

    /// Get interceptor names.
    pub fn names(&self) -> Vec<&str> {
        self.interceptors
            .iter()
            .map(|i| i.name())
            .collect()
    }

    /// Get the number of interceptors.
    pub fn len(&self) -> usize {
        self.interceptors.len()
    }

    pub fn is_empty(&self) -> bool {
        self.interceptors.is_empty()
    }
}

impl Default for InterceptorChain {
    fn default() -> Self {
        Self::new()
    }
}

/// Interceptor-enhanced client wrapper.
pub struct InterceptedClient {
    chain: InterceptorChain,
}

impl InterceptedClient {
    pub fn new(chain: InterceptorChain) -> Self {
        InterceptedClient { chain }
    }

    pub fn query<F>(
        &self,
        sql: &str,
        params: Vec<Value>,
        operation: F,
    ) -> Result<VedaResult, VedaError>
    where
        F: FnOnce() -> Result<VedaResult, VedaError>,
    {
        let mut ctx = InterceptorContext::new(sql, params, OperationType::Query);
        self.chain.execute(&mut ctx, operation)
    }
}
