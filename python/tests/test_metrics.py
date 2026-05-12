"""test_metrics.py — Metrics collector tests for VedaDB Python driver."""
import pytest
import time
import threading
from typing import Dict, Any, List, Callable
from collections import defaultdict


class Metric:
    """Represents a single metric measurement."""

    def __init__(self, name: str, value: float, labels: Dict[str, str] = None,
                 timestamp: float = None):
        self.name = name
        self.value = value
        self.labels = labels or {}
        self.timestamp = timestamp or time.time()


class MetricsCollector:
    """Collects and aggregates metrics for VedaDB operations."""

    def __init__(self):
        self._counters: Dict[str, int] = defaultdict(int)
        self._gauges: Dict[str, float] = {}
        self._histograms: Dict[str, List[float]] = defaultdict(list)
        self._timers: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def increment(self, name: str, value: int = 1, labels: Dict[str, str] = None):
        key = self._key(name, labels)
        with self._lock:
            self._counters[key] += value

    def gauge(self, name: str, value: float, labels: Dict[str, str] = None):
        key = self._key(name, labels)
        with self._lock:
            self._gauges[key] = value

    def record_histogram(self, name: str, value: float,
                         labels: Dict[str, str] = None):
        key = self._key(name, labels)
        with self._lock:
            self._histograms[key].append(value)

    def timer(self, name: str) -> 'Timer':
        return Timer(self, name)

    def get_counter(self, name: str, labels: Dict[str, str] = None) -> int:
        key = self._key(name, labels)
        with self._lock:
            return self._counters[key]

    def get_gauge(self, name: str, labels: Dict[str, str] = None) -> float:
        key = self._key(name, labels)
        with self._lock:
            return self._gauges.get(key, 0.0)

    def get_histogram_stats(self, name: str,
                            labels: Dict[str, str] = None) -> Dict[str, float]:
        key = self._key(name, labels)
        with self._lock:
            values = sorted(self._histograms[key])
            if not values:
                return {"count": 0, "min": 0, "max": 0, "avg": 0, "p99": 0}
            return {
                "count": len(values),
                "min": values[0],
                "max": values[-1],
                "avg": sum(values) / len(values),
                "p99": values[int(len(values) * 0.99)] if len(values) > 1 else values[0],
            }

    def get_all_metrics(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "counters": dict(self._counters),
                "gauges": dict(self._gauges),
                "histograms": {
                    k: {"count": len(v), "avg": sum(v) / len(v) if v else 0}
                    for k, v in self._histograms.items()
                },
            }

    def reset(self):
        with self._lock:
            self._counters.clear()
            self._gauges.clear()
            self._histograms.clear()
            self._timers.clear()

    @staticmethod
    def _key(name: str, labels: Dict[str, str] = None) -> str:
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"


class Timer:
    """Context manager for timing operations."""

    def __init__(self, collector: MetricsCollector, name: str):
        self._collector = collector
        self._name = name
        self._start = None
        self._elapsed = None

    def __enter__(self):
        self._start = time.time()
        return self

    def __exit__(self, *args):
        self._elapsed = time.time() - self._start
        self._collector.record_histogram(f"{self._name}_duration", self._elapsed)

    @property
    def elapsed(self) -> float:
        return self._elapsed or 0.0


class TestMetricsCollector:
    """Test suite for metrics collector."""

    def test_counter_increment(self):
        """Test counter increment."""
        mc = MetricsCollector()
        mc.increment("queries")
        assert mc.get_counter("queries") == 1
        mc.increment("queries", 5)
        assert mc.get_counter("queries") == 6

    def test_counter_with_labels(self):
        """Test counter with labels."""
        mc = MetricsCollector()
        mc.increment("queries", labels={"table": "users"})
        mc.increment("queries", labels={"table": "orders"})
        mc.increment("queries", labels={"table": "users"})
        assert mc.get_counter("queries", {"table": "users"}) == 2
        assert mc.get_counter("queries", {"table": "orders"}) == 1

    def test_gauge(self):
        """Test gauge."""
        mc = MetricsCollector()
        mc.gauge("connections", 5.0)
        assert mc.get_gauge("connections") == 5.0
        mc.gauge("connections", 3.0)
        assert mc.get_gauge("connections") == 3.0

    def test_histogram(self):
        """Test histogram."""
        mc = MetricsCollector()
        mc.record_histogram("query_time", 0.1)
        mc.record_histogram("query_time", 0.2)
        mc.record_histogram("query_time", 0.3)
        stats = mc.get_histogram_stats("query_time")
        assert stats["count"] == 3
        assert stats["min"] == 0.1
        assert stats["max"] == 0.3

    def test_histogram_percentile(self):
        """Test histogram percentile calculation."""
        mc = MetricsCollector()
        for i in range(100):
            mc.record_histogram("latency", float(i) / 1000)
        stats = mc.get_histogram_stats("latency")
        assert stats["count"] == 100
        assert stats["p99"] >= 0.098

    def test_timer(self):
        """Test timer context manager."""
        mc = MetricsCollector()
        with mc.timer("operation") as t:
            time.sleep(0.01)
        assert t.elapsed >= 0.01
        stats = mc.get_histogram_stats("operation_duration")
        assert stats["count"] == 1

    def test_timer_without_context(self):
        """Test timer manual usage."""
        mc = MetricsCollector()
        timer = mc.timer("manual")
        with timer:
            time.sleep(0.001)
        assert timer.elapsed > 0

    def test_all_metrics(self):
        """Test getting all metrics."""
        mc = MetricsCollector()
        mc.increment("queries")
        mc.gauge("connections", 5.0)
        mc.record_histogram("time", 0.1)
        all_metrics = mc.get_all_metrics()
        assert "counters" in all_metrics
        assert "gauges" in all_metrics
        assert "histograms" in all_metrics

    def test_reset(self):
        """Test metrics reset."""
        mc = MetricsCollector()
        mc.increment("queries")
        mc.gauge("connections", 5.0)
        mc.reset()
        assert mc.get_counter("queries") == 0
        assert mc.get_gauge("connections") == 0.0

    def test_empty_histogram_stats(self):
        """Test histogram stats with no data."""
        mc = MetricsCollector()
        stats = mc.get_histogram_stats("nonexistent")
        assert stats["count"] == 0
        assert stats["avg"] == 0

    def test_concurrent_increments(self):
        """Test thread-safe concurrent increments."""
        mc = MetricsCollector()
        threads = []

        for _ in range(50):
            t = threading.Thread(target=lambda: mc.increment("counter"))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        assert mc.get_counter("counter") == 50

    def test_timer_exception(self):
        """Test timer still records on exception."""
        mc = MetricsCollector()
        try:
            with mc.timer("failing_op"):
                raise ValueError("error")
        except ValueError:
            pass
        stats = mc.get_histogram_stats("failing_op_duration")
        assert stats["count"] == 1
