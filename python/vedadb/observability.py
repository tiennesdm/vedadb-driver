"""
Observability and metrics collection for VedaDB.

Collects driver metrics compatible with Prometheus and OpenTelemetry.
Provides counters, histograms, and gauges for monitoring query
performance, connection health, and pool utilization.

Example — Prometheus export::

    from vedadb.observability import MetricsCollector

    metrics = MetricsCollector()
    metrics.record_query_duration("SELECT * FROM users", 45.2)
    metrics.record_connection_open()

    print(metrics.prometheus_metrics)

Example — with VedaDB client::

    db = connect(host="localhost")
    db._metrics = MetricsCollector()
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, DefaultDict, Dict, List, Optional

logger = logging.getLogger("vedadb.observability")


# ---------------------------------------------------------------------------
# Internal metric storage
# ---------------------------------------------------------------------------

@dataclass
class _Counter:
    """Simple monotonic counter."""
    value: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def inc(self, delta: int = 1) -> None:
        with self.lock:
            self.value += delta


@dataclass
class _Histogram:
    """Bucketed histogram for latency / size distributions."""
    buckets: list[float] = field(default_factory=lambda: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000])
    counts: DefaultDict[float, int] = field(default_factory=lambda: defaultdict(int))
    sum_val: float = 0.0
    count: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def observe(self, value: float) -> None:
        with self.lock:
            self.sum_val += value
            self.count += 1
            for bucket in self.buckets:
                if value <= bucket:
                    self.counts[bucket] += 1

    def get_counts(self) -> dict[float, int]:
        with self.lock:
            return dict(self.counts)


@dataclass
class _Gauge:
    """Gauge that can go up and down."""
    value: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def set(self, value: float) -> None:
        with self.lock:
            self.value = value

    def inc(self, delta: float = 1.0) -> None:
        with self.lock:
            self.value += delta

    def dec(self, delta: float = 1.0) -> None:
        with self.lock:
            self.value -= delta


# ---------------------------------------------------------------------------
# MetricsCollector
# ---------------------------------------------------------------------------


class MetricsCollector:
    """Collect driver metrics for monitoring.

    Tracks query counts, durations, connection lifecycle, errors, and
    pool statistics.  Supports Prometheus text format export.

    All methods are thread-safe.

    Args:
        prefix: Prefix for all metric names (default: ``vedadb``).
        slow_query_threshold_ms: Queries taking longer than this are
            logged as slow queries.

    Example::

        metrics = MetricsCollector(prefix="myapp_db")
        metrics.record_query_duration("SELECT * FROM users", 45.2)
        print(metrics.prometheus_metrics)
    """

    def __init__(
        self,
        prefix: str = "vedadb",
        slow_query_threshold_ms: float = 500.0,
    ):
        self._prefix = prefix
        self._slow_query_threshold_ms = slow_query_threshold_ms

        # Counters
        self._query_total = _Counter()
        self._query_errors = _Counter()
        self._connection_opens = _Counter()
        self._connection_closes = _Counter()
        self._connection_failures = _Counter()
        self._pool_exhausted = _Counter()
        self._retry_count = _Counter()
        self._circuit_open_count = _Counter()

        # Histograms
        self._query_duration = _Histogram()
        self._query_result_size = _Histogram(buckets=[1, 10, 50, 100, 500, 1000, 5000, 10000])
        self._connection_latency = _Histogram()

        # Gauges
        self._active_connections = _Gauge()
        self._pool_size = _Gauge()
        self._pool_available = _Gauge()
        self._pool_waiting = _Gauge()

        # Error breakdown by type
        self._error_by_type: DefaultDict[str, int] = defaultdict(int)
        self._error_lock = threading.Lock()

        # Query breakdown by operation
        self._query_by_op: DefaultDict[str, int] = defaultdict(int)
        self._query_op_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Recording methods
    # ------------------------------------------------------------------

    def record_query(self, sql: str, duration_ms: float, row_count: int = 0) -> None:
        """Record a completed query.

        Args:
            sql: The SQL statement (used to determine operation type).
            duration_ms: Query execution time in milliseconds.
            row_count: Number of rows returned.
        """
        self._query_total.inc()
        self._query_duration.observe(duration_ms)
        self._query_result_size.observe(row_count)
        self._active_connections.dec()

        # Track by operation type
        op = self._classify_sql(sql)
        with self._query_op_lock:
            self._query_by_op[op] += 1

        if duration_ms > self._slow_query_threshold_ms:
            logger.warning(
                "Slow query detected: %.1fms — %s", duration_ms, sql[:200]
            )

    def record_query_duration(self, sql: str, duration_ms: float) -> None:
        """Record query duration in milliseconds.

        Args:
            sql: The SQL statement.
            duration_ms: Execution time in milliseconds.
        """
        self.record_query(sql, duration_ms)

    def record_query_error(self, sql: str, error_type: str) -> None:
        """Record a query error.

        Args:
            sql: The SQL statement that failed.
            error_type: Category of error (e.g. ``"connection"``,
                ``"timeout"``, ``"syntax"``).
        """
        self._query_errors.inc()
        with self._error_lock:
            self._error_by_type[error_type] += 1

    def record_connection_open(self) -> None:
        """Record that a connection was opened."""
        self._connection_opens.inc()
        self._active_connections.inc()

    def record_connection_close(self) -> None:
        """Record that a connection was closed."""
        self._connection_closes.inc()
        self._active_connections.dec()

    def record_connection_failure(self) -> None:
        """Record a connection failure."""
        self._connection_failures.inc()

    def record_connection_latency(self, latency_ms: float) -> None:
        """Record connection establishment latency.

        Args:
            latency_ms: Time to establish connection in milliseconds.
        """
        self._connection_latency.observe(latency_ms)

    def record_pool_stats(self, size: int, available: int, waiting: int) -> None:
        """Record pool statistics.

        Args:
            size: Total pool size.
            available: Number of idle connections.
            waiting: Number of threads waiting for a connection.
        """
        self._pool_size.set(size)
        self._pool_available.set(available)
        self._pool_waiting.set(waiting)

    def record_pool_exhausted(self) -> None:
        """Record a pool-exhausted event."""
        self._pool_exhausted.inc()

    def record_retry(self) -> None:
        """Record that a retry occurred."""
        self._retry_count.inc()

    def record_circuit_open(self) -> None:
        """Record a circuit breaker open event."""
        self._circuit_open_count.inc()

    # ------------------------------------------------------------------
    # Prometheus export
    # ------------------------------------------------------------------

    @property
    def prometheus_metrics(self) -> str:
        """Export metrics in Prometheus text format.

        Returns:
            Multi-line string in Prometheus exposition format.
        """
        lines: list[str] = []
        p = self._prefix

        #Counters
        lines.append(f"# HELP {p}_query_total Total number of queries executed.")
        lines.append(f"# TYPE {p}_query_total counter")
        lines.append(f'{p}_query_total {self._query_total.value}')

        lines.append(f"# HELP {p}_query_errors_total Total number of query errors.")
        lines.append(f"# TYPE {p}_query_errors_total counter")
        lines.append(f'{p}_query_errors_total {self._query_errors.value}')

        for err_type, count in sorted(self._error_by_type.items()):
            lines.append(f'{p}_query_errors_total{{type="{err_type}"}} {count}')

        lines.append(f"# HELP {p}_connection_opens_total Total connection opens.")
        lines.append(f"# TYPE {p}_connection_opens_total counter")
        lines.append(f'{p}_connection_opens_total {self._connection_opens.value}')

        lines.append(f"# HELP {p}_connection_closes_total Total connection closes.")
        lines.append(f"# TYPE {p}_connection_closes_total counter")
        lines.append(f'{p}_connection_closes_total {self._connection_closes.value}')

        lines.append(f"# HELP {p}_connection_failures_total Total connection failures.")
        lines.append(f"# TYPE {p}_connection_failures_total counter")
        lines.append(f'{p}_connection_failures_total {self._connection_failures.value}')

        lines.append(f"# HELP {p}_pool_exhausted_total Total pool exhausted events.")
        lines.append(f"# TYPE {p}_pool_exhausted_total counter")
        lines.append(f'{p}_pool_exhausted_total {self._pool_exhausted.value}')

        lines.append(f"# HELP {p}_retry_total Total retries.")
        lines.append(f"# TYPE {p}_retry_total counter")
        lines.append(f'{p}_retry_total {self._retry_count.value}')

        lines.append(f"# HELP {p}_circuit_open_total Total circuit breaker opens.")
        lines.append(f"# TYPE {p}_circuit_open_total counter")
        lines.append(f'{p}_circuit_open_total {self._circuit_open_count.value}')

        # Query by operation
        lines.append(f"# HELP {p}_queries_by_operation_total Queries by operation type.")
        lines.append(f"# TYPE {p}_queries_by_operation_total counter")
        for op, count in sorted(self._query_by_op.items()):
            lines.append(f'{p}_queries_by_operation_total{{op="{op}"}} {count}')

        # Gauges
        lines.append(f"# HELP {p}_active_connections Current active connections.")
        lines.append(f"# TYPE {p}_active_connections gauge")
        lines.append(f'{p}_active_connections {self._active_connections.value}')

        lines.append(f"# HELP {p}_pool_size Current pool size.")
        lines.append(f"# TYPE {p}_pool_size gauge")
        lines.append(f'{p}_pool_size {self._pool_size.value}')

        lines.append(f"# HELP {p}_pool_available Current available (idle) connections.")
        lines.append(f"# TYPE {p}_pool_available gauge")
        lines.append(f'{p}_pool_available {self._pool_available.value}')

        lines.append(f"# HELP {p}_pool_waiting Current threads waiting for connections.")
        lines.append(f"# TYPE {p}_pool_waiting gauge")
        lines.append(f'{p}_pool_waiting {self._pool_waiting.value}')

        # Histograms
        lines.extend(self._format_histogram(f"{p}_query_duration_ms", self._query_duration))
        lines.extend(self._format_histogram(f"{p}_query_result_size", self._query_result_size))
        lines.extend(self._format_histogram(f"{p}_connection_latency_ms", self._connection_latency))

        return "\n".join(lines) + "\n"

    def _format_histogram(self, name: str, hist: _Histogram) -> list[str]:
        """Format a histogram in Prometheus format."""
        lines: list[str] = []
        lines.append(f"# HELP {name} Histogram.")
        lines.append(f"# TYPE {name} histogram")

        counts = hist.get_counts()
        cumulative = 0
        for bucket in sorted(hist.buckets):
            cumulative += counts.get(bucket, 0)
            lines.append(f'{name}_bucket{{le="{bucket}"}} {cumulative}')
        lines.append(f'{name}_bucket{{le="+Inf"}} {hist.count}')
        lines.append(f"{name}_sum {hist.sum_val}")
        lines.append(f"{name}_count {hist.count}")
        return lines

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    @property
    def stats(self) -> dict:
        """Return all metrics as a plain dict."""
        return {
            "queries_total": self._query_total.value,
            "query_errors": self._query_errors.value,
            "error_breakdown": dict(self._error_by_type),
            "connection_opens": self._connection_opens.value,
            "connection_closes": self._connection_closes.value,
            "connection_failures": self._connection_failures.value,
            "active_connections": self._active_connections.value,
            "pool_exhausted": self._pool_exhausted.value,
            "retries": self._retry_count.value,
            "circuit_opens": self._circuit_open_count.value,
            "query_by_operation": dict(self._query_by_op),
        }

    @staticmethod
    def _classify_sql(sql: str) -> str:
        """Classify a SQL statement by operation type."""
        sql_upper = sql.strip().upper()
        if sql_upper.startswith("SELECT"):
            return "select"
        if sql_upper.startswith("INSERT"):
            return "insert"
        if sql_upper.startswith("UPDATE"):
            return "update"
        if sql_upper.startswith("DELETE"):
            return "delete"
        if sql_upper.startswith("CREATE"):
            return "create"
        if sql_upper.startswith("DROP"):
            return "drop"
        if sql_upper.startswith("BEGIN") or sql_upper.startswith("COMMIT") or sql_upper.startswith("ROLLBACK"):
            return "transaction"
        return "other"

    # ------------------------------------------------------------------
    # Decorator for automatic instrumentation
    # ------------------------------------------------------------------

    def instrument_query(self, fn: Callable) -> Callable:
        """Decorator that instruments a query function.

        Example::

            @metrics.instrument_query
            def fetch_users(db):
                return db.query("SELECT * FROM users")
        """
        import functools

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            try:
                result = fn(*args, **kwargs)
                elapsed_ms = (time.perf_counter() - start) * 1000.0
                row_count = getattr(result, "row_count", 0)
                self.record_query(fn.__name__, elapsed_ms, row_count)
                return result
            except Exception as exc:
                elapsed_ms = (time.perf_counter() - start) * 1000.0
                self.record_query(fn.__name__, elapsed_ms)
                self.record_query_error(fn.__name__, type(exc).__name__)
                raise

        return wrapper

    def __repr__(self) -> str:
        return (
            f"<MetricsCollector queries={self._query_total.value} "
            f"errors={self._query_errors.value} "
            f"prefix={self._prefix!r}>"
        )
