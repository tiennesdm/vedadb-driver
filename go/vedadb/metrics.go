package vedadb

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Prometheus-compatible Metrics
// ---------------------------------------------------------------------------

// MetricsCollector collects and exposes metrics for the VedaDB driver.
type MetricsCollector struct {
	prefix string

	// Connection metrics
	connectionsOpened   atomic.Int64
	connectionsClosed   atomic.Int64
	connectionsInUse    atomic.Int64
	connectionFailures  atomic.Int64

	// Query metrics
	queriesTotal        atomic.Int64
	queriesFailed       atomic.Int64
	queriesRetried      atomic.Int64
	queryDuration       atomic.Int64 // nanoseconds

	// Pool metrics
	poolWaitCount       atomic.Int64
	poolWaitDuration    atomic.Int64 // nanoseconds
	poolSize            atomic.Int64

	// Circuit breaker metrics
	circuitOpenCount    atomic.Int64
	circuitState        atomic.Int32

	// Bulk metrics
	bulkRowsFlushed     atomic.Int64
	bulkBatchesSent     atomic.Int64
	bulkFailures        atomic.Int64

	// Health metrics
	healthCheckFailures atomic.Int64
	lastHealthCheck     atomic.Int64 // Unix nanoseconds

	// Custom counters and gauges
	customCounters      sync.Map
	customGauges        sync.Map

	mu         sync.RWMutex
	onCollect  func()
	labels     map[string]string
}

// MetricSnapshot holds a point-in-time snapshot of all metrics.
type MetricSnapshot struct {
	Timestamp           time.Time
	ConnectionsOpened   int64
	ConnectionsClosed   int64
	ConnectionsInUse    int64
	ConnectionFailures  int64
	QueriesTotal        int64
	QueriesFailed       int64
	QueriesRetried      int64
	QueryDuration       time.Duration
	PoolWaitCount       int64
	PoolWaitDuration    time.Duration
	PoolSize            int64
	CircuitOpenCount    int64
	CircuitState        int32
	BulkRowsFlushed     int64
	BulkBatchesSent     int64
	BulkFailures        int64
	HealthCheckFailures int64
	LastHealthCheck     time.Time
	CustomCounters      map[string]int64
	CustomGauges        map[string]int64
}

// NewMetricsCollector creates a new metrics collector.
func NewMetricsCollector(prefix string) *MetricsCollector {
	if prefix != "" && prefix[len(prefix)-1] != '_' {
		prefix += "_"
	}
	return &MetricsCollector{
		prefix: prefix,
		labels: make(map[string]string),
	}
}

// DefaultMetricsCollector creates a metrics collector with default prefix "vedadb".
func DefaultMetricsCollector() *MetricsCollector {
	return NewMetricsCollector("vedadb")
}

// WithLabel adds a static label to all metrics.
func (m *MetricsCollector) WithLabel(key, value string) *MetricsCollector {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.labels[key] = value
	return m
}

// RecordConnectionOpened records a connection open event.
func (m *MetricsCollector) RecordConnectionOpened() {
	m.connectionsOpened.Add(1)
	m.connectionsInUse.Add(1)
}

// RecordConnectionClosed records a connection close event.
func (m *MetricsCollector) RecordConnectionClosed() {
	m.connectionsClosed.Add(1)
	m.connectionsInUse.Add(-1)
}

// RecordConnectionFailure records a connection failure.
func (m *MetricsCollector) RecordConnectionFailure() {
	m.connectionFailures.Add(1)
}

// RecordQuery records a query execution.
func (m *MetricsCollector) RecordQuery(duration time.Duration) {
	m.queriesTotal.Add(1)
	m.queryDuration.Add(int64(duration))
}

// RecordQueryFailure records a failed query.
func (m *MetricsCollector) RecordQueryFailure() {
	m.queriesFailed.Add(1)
}

// RecordQueryRetry records a query retry.
func (m *MetricsCollector) RecordQueryRetry() {
	m.queriesRetried.Add(1)
}

// RecordPoolWait records time spent waiting for a pool connection.
func (m *MetricsCollector) RecordPoolWait(duration time.Duration) {
	m.poolWaitCount.Add(1)
	m.poolWaitDuration.Add(int64(duration))
}

// RecordPoolSize updates the current pool size gauge.
func (m *MetricsCollector) RecordPoolSize(size int64) {
	m.poolSize.Store(size)
}

// RecordCircuitOpen records a circuit breaker open event.
func (m *MetricsCollector) RecordCircuitOpen() {
	m.circuitOpenCount.Add(1)
	m.circuitState.Store(int32(StateOpen))
}

// RecordCircuitClose records a circuit breaker close event.
func (m *MetricsCollector) RecordCircuitClose() {
	m.circuitState.Store(int32(StateClosed))
}

// RecordCircuitHalfOpen records a circuit breaker half-open event.
func (m *MetricsCollector) RecordCircuitHalfOpen() {
	m.circuitState.Store(int32(StateHalfOpen))
}

// RecordBulkFlush records a bulk flush operation.
func (m *MetricsCollector) RecordBulkFlush(rows int, success bool) {
	m.bulkRowsFlushed.Add(int64(rows))
	m.bulkBatchesSent.Add(1)
	if !success {
		m.bulkFailures.Add(1)
	}
}

// RecordHealthCheck records a health check result.
func (m *MetricsCollector) RecordHealthCheck(failed bool) {
	m.lastHealthCheck.Store(time.Now().UnixNano())
	if failed {
		m.healthCheckFailures.Add(1)
	}
}

// IncrementCounter increments a custom counter.
func (m *MetricsCollector) IncrementCounter(name string, delta int64) {
	actual, _ := m.customCounters.LoadOrStore(name, &atomic.Int64{})
	actual.(*atomic.Int64).Add(delta)
}

// SetGauge sets a custom gauge value.
func (m *MetricsCollector) SetGauge(name string, value int64) {
	actual, _ := m.customGauges.LoadOrStore(name, &atomic.Int64{})
	actual.(*atomic.Int64).Store(value)
}

// Snapshot returns a point-in-time snapshot of all metrics.
func (m *MetricsCollector) Snapshot() MetricSnapshot {
	snap := MetricSnapshot{
		Timestamp:           time.Now(),
		ConnectionsOpened:   m.connectionsOpened.Load(),
		ConnectionsClosed:   m.connectionsClosed.Load(),
		ConnectionsInUse:    m.connectionsInUse.Load(),
		ConnectionFailures:  m.connectionFailures.Load(),
		QueriesTotal:        m.queriesTotal.Load(),
		QueriesFailed:       m.queriesFailed.Load(),
		QueriesRetried:      m.queriesRetried.Load(),
		QueryDuration:       time.Duration(m.queryDuration.Load()),
		PoolWaitCount:       m.poolWaitCount.Load(),
		PoolWaitDuration:    time.Duration(m.poolWaitDuration.Load()),
		PoolSize:            m.poolSize.Load(),
		CircuitOpenCount:    m.circuitOpenCount.Load(),
		CircuitState:        m.circuitState.Load(),
		BulkRowsFlushed:     m.bulkRowsFlushed.Load(),
		BulkBatchesSent:     m.bulkBatchesSent.Load(),
		BulkFailures:        m.bulkFailures.Load(),
		HealthCheckFailures: m.healthCheckFailures.Load(),
		CustomCounters:      make(map[string]int64),
		CustomGauges:        make(map[string]int64),
	}

	if t := m.lastHealthCheck.Load(); t > 0 {
		snap.LastHealthCheck = time.Unix(0, t)
	}

	m.customCounters.Range(func(key, value interface{}) bool {
		snap.CustomCounters[key.(string)] = value.(*atomic.Int64).Load()
		return true
	})
	m.customGauges.Range(func(key, value interface{}) bool {
		snap.CustomGauges[key.(string)] = value.(*atomic.Int64).Load()
		return true
	})

	return snap
}

// PrometheusFormat returns metrics in Prometheus exposition format.
func (m *MetricsCollector) PrometheusFormat() string {
	snap := m.Snapshot()
	p := m.prefix

	var b string
	b += fmt.Sprintf("# HELP %sconnections_opened_total Total connections opened\n", p)
	b += fmt.Sprintf("# TYPE %sconnections_opened_total counter\n", p)
	b += fmt.Sprintf("%sconnections_opened_total %d\n", p, snap.ConnectionsOpened)

	b += fmt.Sprintf("# HELP %sconnections_closed_total Total connections closed\n", p)
	b += fmt.Sprintf("# TYPE %sconnections_closed_total counter\n", p)
	b += fmt.Sprintf("%sconnections_closed_total %d\n", p, snap.ConnectionsClosed)

	b += fmt.Sprintf("# HELP %sconnections_in_use Current connections in use\n", p)
	b += fmt.Sprintf("# TYPE %sconnections_in_use gauge\n", p)
	b += fmt.Sprintf("%sconnections_in_use %d\n", p, snap.ConnectionsInUse)

	b += fmt.Sprintf("# HELP %sconnection_failures_total Total connection failures\n", p)
	b += fmt.Sprintf("# TYPE %sconnection_failures_total counter\n", p)
	b += fmt.Sprintf("%sconnection_failures_total %d\n", p, snap.ConnectionFailures)

	b += fmt.Sprintf("# HELP %squeries_total Total queries executed\n", p)
	b += fmt.Sprintf("# TYPE %squeries_total counter\n", p)
	b += fmt.Sprintf("%squeries_total %d\n", p, snap.QueriesTotal)

	b += fmt.Sprintf("# HELP %squeries_failed_total Total failed queries\n", p)
	b += fmt.Sprintf("# TYPE %squeries_failed_total counter\n", p)
	b += fmt.Sprintf("%squeries_failed_total %d\n", p, snap.QueriesFailed)

	b += fmt.Sprintf("# HELP %squeries_retried_total Total query retries\n", p)
	b += fmt.Sprintf("# TYPE %squeries_retried_total counter\n", p)
	b += fmt.Sprintf("%squeries_retried_total %d\n", p, snap.QueriesRetried)

	b += fmt.Sprintf("# HELP %squery_duration_seconds_total Total query duration\n", p)
	b += fmt.Sprintf("# TYPE %squery_duration_seconds_total counter\n", p)
	b += fmt.Sprintf("%squery_duration_seconds_total %.6f\n", p, snap.QueryDuration.Seconds())

	b += fmt.Sprintf("# HELP %spool_wait_count_total Total pool waits\n", p)
	b += fmt.Sprintf("# TYPE %spool_wait_count_total counter\n", p)
	b += fmt.Sprintf("%spool_wait_count_total %d\n", p, snap.PoolWaitCount)

	b += fmt.Sprintf("# HELP %spool_size Current pool size\n", p)
	b += fmt.Sprintf("# TYPE %spool_size gauge\n", p)
	b += fmt.Sprintf("%spool_size %d\n", p, snap.PoolSize)

	b += fmt.Sprintf("# HELP %scircuit_open_count_total Total circuit breaker opens\n", p)
	b += fmt.Sprintf("# TYPE %scircuit_open_count_total counter\n", p)
	b += fmt.Sprintf("%scircuit_open_count_total %d\n", p, snap.CircuitOpenCount)

	b += fmt.Sprintf("# HELP %scircuit_state Current circuit breaker state (0=closed, 1=open, 2=half-open)\n", p)
	b += fmt.Sprintf("# TYPE %scircuit_state gauge\n", p)
	b += fmt.Sprintf("%scircuit_state %d\n", p, snap.CircuitState)

	b += fmt.Sprintf("# HELP %sbulk_rows_flushed_total Total bulk rows flushed\n", p)
	b += fmt.Sprintf("# TYPE %sbulk_rows_flushed_total counter\n", p)
	b += fmt.Sprintf("%sbulk_rows_flushed_total %d\n", p, snap.BulkRowsFlushed)

	b += fmt.Sprintf("# HELP %sbulk_batches_sent_total Total bulk batches sent\n", p)
	b += fmt.Sprintf("# TYPE %sbulk_batches_sent_total counter\n", p)
	b += fmt.Sprintf("%sbulk_batches_sent_total %d\n", p, snap.BulkBatchesSent)

	b += fmt.Sprintf("# HELP %sbulk_failures_total Total bulk operation failures\n", p)
	b += fmt.Sprintf("# TYPE %sbulk_failures_total counter\n", p)
	b += fmt.Sprintf("%sbulk_failures_total %d\n", p, snap.BulkFailures)

	b += fmt.Sprintf("# HELP %shealth_check_failures_total Total health check failures\n", p)
	b += fmt.Sprintf("# TYPE %shealth_check_failures_total counter\n", p)
	b += fmt.Sprintf("%shealth_check_failures_total %d\n", p, snap.HealthCheckFailures)

	for name, val := range snap.CustomCounters {
		b += fmt.Sprintf("%scustom_counter_%s %d\n", p, name, val)
	}
	for name, val := range snap.CustomGauges {
		b += fmt.Sprintf("%scustom_gauge_%s %d\n", p, name, val)
	}

	return b
}

// ServeHTTP implements http.Handler for Prometheus scraping.
func (m *MetricsCollector) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprint(w, m.PrometheusFormat())
}

// InstrumentClient wraps a Client to record metrics on all operations.
func (m *MetricsCollector) InstrumentClient(client *Client) *InstrumentedClient {
	return &InstrumentedClient{
		Client:  client,
		metrics: m,
	}
}

// InstrumentedClient wraps a Client with metrics collection.
type InstrumentedClient struct {
	*Client
	metrics *MetricsCollector
}

// Query executes a query with metrics collection.
func (ic *InstrumentedClient) Query(ctx context.Context, sql string, args ...interface{}) (*Result, error) {
	ic.metrics.RecordConnectionOpened()
	defer ic.metrics.RecordConnectionClosed()

	start := time.Now()
	result, err := ic.Client.Query(ctx, sql, args...)
	duration := time.Since(start)

	ic.metrics.RecordQuery(duration)
	if err != nil {
		ic.metrics.RecordQueryFailure()
	}

	return result, err
}

// Exec executes a statement with metrics collection.
func (ic *InstrumentedClient) Exec(ctx context.Context, sql string, args ...interface{}) (int64, error) {
	ic.metrics.RecordConnectionOpened()
	defer ic.metrics.RecordConnectionClosed()

	start := time.Now()
	result, err := ic.Client.Exec(ctx, sql, args...)
	duration := time.Since(start)

	ic.metrics.RecordQuery(duration)
	if err != nil {
		ic.metrics.RecordQueryFailure()
	}

	return result, err
}

// QueryRate returns the average queries per second since the given time.
func (m *MetricsCollector) QueryRate(since time.Time) float64 {
	duration := time.Since(since).Seconds()
	if duration <= 0 {
		return 0
	}
	return float64(m.queriesTotal.Load()) / duration
}

// AverageQueryDuration returns the average query duration.
func (m *MetricsCollector) AverageQueryDuration() time.Duration {
	total := m.queriesTotal.Load()
	if total == 0 {
		return 0
	}
	return time.Duration(m.queryDuration.Load()) / time.Duration(total)
}

// Reset resets all metrics to zero (use with caution in production).
func (m *MetricsCollector) Reset() {
	m.connectionsOpened.Store(0)
	m.connectionsClosed.Store(0)
	m.connectionsInUse.Store(0)
	m.connectionFailures.Store(0)
	m.queriesTotal.Store(0)
	m.queriesFailed.Store(0)
	m.queriesRetried.Store(0)
	m.queryDuration.Store(0)
	m.poolWaitCount.Store(0)
	m.poolWaitDuration.Store(0)
	m.circuitOpenCount.Store(0)
	m.bulkRowsFlushed.Store(0)
	m.bulkBatchesSent.Store(0)
	m.bulkFailures.Store(0)
	m.healthCheckFailures.Store(0)
	m.customCounters = sync.Map{}
	m.customGauges = sync.Map{}
}
