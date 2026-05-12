use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Prometheus-compatible metrics collector for VedaDB driver operations.
pub struct MetricsCollector {
    counters: Mutex<HashMap<String, AtomicU64>>,
    histograms: Mutex<HashMap<String, Vec<f64>>>,
    gauges: Mutex<HashMap<String, AtomicU64>>,
    labels: Mutex<HashMap<String, String>>,
    start_time: Instant,
}

/// Pre-defined metric names for common operations.
pub mod metric_names {
    pub const CONNECTION_CREATED: &str = "vedadb_connections_created_total";
    pub const CONNECTION_CLOSED: &str = "vedadb_connections_closed_total";
    pub const CONNECTION_FAILED: &str = "vedadb_connections_failed_total";
    pub const CONNECTION_POOL_SIZE: &str = "vedadb_connection_pool_size";
    pub const CONNECTION_POOL_WAIT: &str = "vedadb_connection_pool_wait_duration_seconds";

    pub const QUERY_TOTAL: &str = "vedadb_queries_total";
    pub const QUERY_DURATION: &str = "vedadb_query_duration_seconds";
    pub const QUERY_ERRORS: &str = "vedadb_query_errors_total";
    pub const QUERY_ROWS_RETURNED: &str = "vedadb_query_rows_returned_total";

    pub const RETRY_TOTAL: &str = "vedadb_retries_total";
    pub const CIRCUIT_BREAKER_STATE: &str = "vedadb_circuit_breaker_state";
    pub const CIRCUIT_BREAKER_FAILURES: &str = "vedadb_circuit_breaker_failures_total";

    pub const BULK_INSERT_ROWS: &str = "vedadb_bulk_insert_rows_total";
    pub const BULK_INSERT_BATCHES: &str = "vedadb_bulk_insert_batches_total";

    pub const CACHE_HIT: &str = "vedadb_cache_hits_total";
    pub const CACHE_MISS: &str = "vedadb_cache_misses_total";
    pub const CACHE_SIZE: &str = "vedadb_cache_size";

    pub const PUBSUB_MESSAGES_SENT: &str = "vedadb_pubsub_messages_sent_total";
    pub const PUBSUB_MESSAGES_RECEIVED: &str = "vedadb_pubsub_messages_received_total";

    pub const HEALTH_CHECK_DURATION: &str = "vedadb_health_check_duration_seconds";
    pub const HEALTH_CHECK_FAILURES: &str = "vedadb_health_check_failures_total";

    pub const FAILOVER_SWITCHES: &str = "vedadb_failover_switches_total";
    pub const ACTIVE_NODE: &str = "vedadb_active_node";
}

impl MetricsCollector {
    /// Create a new metrics collector.
    pub fn new() -> Arc<Self> {
        Arc::new(MetricsCollector {
            counters: Mutex::new(HashMap::new()),
            histograms: Mutex::new(HashMap::new()),
            gauges: Mutex::new(HashMap::new()),
            labels: Mutex::new(HashMap::new()),
            start_time: Instant::now(),
        })
    }

    /// Add a label to all metrics.
    pub fn with_label(&self, key: &str, value: &str) {
        self.labels
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
    }

    /// Increment a counter.
    pub fn inc_counter(&self, name: &str) {
        let mut counters = self.counters.lock().unwrap();
        let counter = counters
            .entry(name.to_string())
            .or_insert_with(|| AtomicU64::new(0));
        counter.fetch_add(1, Ordering::SeqCst);
    }

    /// Increment a counter by a value.
    pub fn add_counter(&self, name: &str, value: u64) {
        let mut counters = self.counters.lock().unwrap();
        let counter = counters
            .entry(name.to_string())
            .or_insert_with(|| AtomicU64::new(0));
        counter.fetch_add(value, Ordering::SeqCst);
    }

    /// Record a histogram observation.
    pub fn record_histogram(&self, name: &str, value: f64) {
        let mut histograms = self.histograms.lock().unwrap();
        let hist = histograms.entry(name.to_string()).or_insert_with(Vec::new);
        hist.push(value);
    }

    /// Record duration as histogram.
    pub fn record_duration(&self, name: &str, duration: Duration) {
        self.record_histogram(name, duration.as_secs_f64());
    }

    /// Set a gauge value.
    pub fn set_gauge(&self, name: &str, value: u64) {
        let mut gauges = self.gauges.lock().unwrap();
        let gauge = gauges
            .entry(name.to_string())
            .or_insert_with(|| AtomicU64::new(0));
        gauge.store(value, Ordering::SeqCst);
    }

    /// Get a counter value.
    pub fn get_counter(&self, name: &str) -> u64 {
        let counters = self.counters.lock().unwrap();
        counters
            .get(name)
            .map(|c| c.load(Ordering::SeqCst))
            .unwrap_or(0)
    }

    /// Get a gauge value.
    pub fn get_gauge(&self, name: &str) -> u64 {
        let gauges = self.gauges.lock().unwrap();
        gauges
            .get(name)
            .map(|g| g.load(Ordering::SeqCst))
            .unwrap_or(0)
    }

    /// Get histogram percentiles.
    pub fn get_histogram_percentiles(&self, name: &str) -> Option<HistogramSummary> {
        let histograms = self.histograms.lock().unwrap();
        let values = histograms.get(name)?;
        if values.is_empty() {
            return None;
        }

        let mut sorted = values.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let len = sorted.len();
        let sum: f64 = sorted.iter().sum();
        let avg = sum / len as f64;

        let percentile = |p: f64| -> f64 {
            let idx = (len as f64 * p).floor() as usize;
            sorted[idx.min(len - 1)]
        };

        Some(HistogramSummary {
            count: len,
            sum,
            avg,
            min: sorted[0],
            max: sorted[len - 1],
            p50: percentile(0.5),
            p90: percentile(0.9),
            p95: percentile(0.95),
            p99: percentile(0.99),
        })
    }

    /// Export all metrics in Prometheus text format.
    pub fn export_prometheus(&self) -> String {
        let mut output = String::new();

        // Counters
        let counters = self.counters.lock().unwrap();
        for (name, counter) in counters.iter() {
            output.push_str(&format!(
                "# TYPE {} counter\n",
                name.replace("_total", "")
            ));
            output.push_str(&format!(
                "{} {}\n",
                name,
                counter.load(Ordering::SeqCst)
            ));
        }

        // Gauges
        let gauges = self.gauges.lock().unwrap();
        for (name, gauge) in gauges.iter() {
            output.push_str(&format!("# TYPE {} gauge\n", name));
            output.push_str(&format!(
                "{} {}\n",
                name,
                gauge.load(Ordering::SeqCst)
            ));
        }

        // Histograms
        let histograms = self.histograms.lock().unwrap();
        for (name, values) in histograms.iter() {
            output.push_str(&format!(
                "# TYPE {} histogram\n",
                name.replace("_seconds", "")
            ));

            let mut sorted = values.clone();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

            let buckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];
            let len = sorted.len();

            for &bucket in &buckets {
                let count = sorted.iter().filter(|&&v| v <= bucket).count();
                output.push_str(&format!(
                    "{}_bucket{{le=\"{}\"}} {}\n",
                    name, bucket, count
                ));
            }
            output.push_str(&format!("{}_bucket{{le=\"+Inf\"}} {}\n", name, len));
            output.push_str(&format!("{}_sum {}\n", name, sorted.iter().sum::<f64>()));
            output.push_str(&format!("{}_count {}\n", name, len));
        }

        output
    }

    /// Get uptime.
    pub fn uptime(&self) -> Duration {
        self.start_time.elapsed()
    }

    /// Reset all metrics.
    pub fn reset(&self) {
        self.counters.lock().unwrap().clear();
        self.histograms.lock().unwrap().clear();
        self.gauges.lock().unwrap().clear();
    }

    /// Get all counter names and values.
    pub fn counters(&self) -> Vec<(String, u64)> {
        self.counters
            .lock()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.load(Ordering::SeqCst)))
            .collect()
    }
}

/// Summary statistics for a histogram.
#[derive(Debug, Clone)]
pub struct HistogramSummary {
    pub count: usize,
    pub sum: f64,
    pub avg: f64,
    pub min: f64,
    pub max: f64,
    pub p50: f64,
    pub p90: f64,
    pub p95: f64,
    pub p99: f64,
}

/// Convenience function to record pool metrics.
pub fn record_pool_metrics(pool_stats: &crate::pool::PoolStats, metrics: &MetricsCollector) {
    metrics.set_gauge(metric_names::CONNECTION_POOL_SIZE, pool_stats.total_connections as u64);
    metrics.set_gauge("vedadb_connection_pool_idle", pool_stats.idle_connections as u64);
    metrics.set_gauge("vedadb_connection_pool_active", pool_stats.active_connections as u64);
}

/// Convenience function to record query metrics.
pub fn record_query_metrics(
    duration: Duration,
    row_count: usize,
    metrics: &MetricsCollector,
) {
    metrics.inc_counter(metric_names::QUERY_TOTAL);
    metrics.record_duration(metric_names::QUERY_DURATION, duration);
    metrics.add_counter(metric_names::QUERY_ROWS_RETURNED, row_count as u64);
}

impl Default for MetricsCollector {
    fn default() -> Self {
        // Can't easily return Arc from Default, so create without Arc wrapper
        MetricsCollector {
            counters: Mutex::new(HashMap::new()),
            histograms: Mutex::new(HashMap::new()),
            gauges: Mutex::new(HashMap::new()),
            labels: Mutex::new(HashMap::new()),
            start_time: Instant::now(),
        }
    }
}
