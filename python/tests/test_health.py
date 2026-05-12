"""test_health.py — Health check tests for VedaDB Python driver."""
import pytest
import time
import threading
from typing import Callable, Optional
from unittest.mock import Mock, patch


class HealthChecker:
    """Health checker for VedaDB connections."""

    def __init__(self, check_fn: Callable, interval: float = 30.0,
                 fail_threshold: int = 3):
        self._check_fn = check_fn
        self._interval = interval
        self._fail_threshold = fail_threshold
        self._healthy = True
        self._consecutive_fails = 0
        self._last_check = None
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    def check(self) -> bool:
        """Perform a health check."""
        try:
            self._check_fn()
            with self._lock:
                self._healthy = True
                self._consecutive_fails = 0
                self._last_check = time.time()
            return True
        except Exception:
            with self._lock:
                self._consecutive_fails += 1
                self._last_check = time.time()
                if self._consecutive_fails >= self._fail_threshold:
                    self._healthy = False
            return False

    @property
    def is_healthy(self) -> bool:
        with self._lock:
            return self._healthy

    @property
    def consecutive_fails(self) -> int:
        with self._lock:
            return self._consecutive_fails

    def start(self):
        """Start periodic health checks."""
        self._running = True
        self._thread = threading.Thread(target=self._run)
        self._thread.daemon = True
        self._thread.start()

    def stop(self):
        """Stop periodic health checks."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)

    def _run(self):
        while self._running:
            self.check()
            time.sleep(self._interval)


class TestHealthChecker:
    """Test suite for health checker."""

    def test_check_pass(self):
        """Test successful health check."""
        checker = HealthChecker(lambda: None)
        result = checker.check()
        assert result is True
        assert checker.is_healthy is True

    def test_check_fail(self):
        """Test failing health check."""
        checker = HealthChecker(
            lambda: (_ for _ in ()).throw(ConnectionError("fail")),
            fail_threshold=1
        )
        result = checker.check()
        assert result is False
        assert checker.is_healthy is False

    def test_consecutive_fails_threshold(self):
        """Test that health is maintained until threshold."""
        fail_count = [0]
        def check():
            fail_count[0] += 1
            if fail_count[0] <= 2:
                raise ConnectionError("fail")

        checker = HealthChecker(check, fail_threshold=3)
        checker.check()
        assert checker.is_healthy is True  # 1 fail, threshold=3
        checker.check()
        assert checker.is_healthy is True  # 2 fails, threshold=3
        checker.check()
        assert checker.is_healthy is False  # 3 fails, threshold met

    def test_recovery_after_failure(self):
        """Test health recovery after failures."""
        should_fail = [True]
        def check():
            if should_fail[0]:
                raise ConnectionError("fail")

        checker = HealthChecker(check, fail_threshold=1)
        checker.check()
        assert checker.is_healthy is False

        should_fail[0] = False
        checker.check()
        assert checker.is_healthy is True
        assert checker.consecutive_fails == 0

    def test_consecutive_fails_counter(self):
        """Test consecutive fails counter."""
        checker = HealthChecker(
            lambda: (_ for _ in ()).throw(ConnectionError("fail")),
            fail_threshold=10
        )
        checker.check()
        checker.check()
        checker.check()
        assert checker.consecutive_fails == 3

    def test_start_stop(self):
        """Test starting and stopping periodic checks."""
        call_count = [0]
        def check():
            call_count[0] += 1

        checker = HealthChecker(check, interval=0.05)
        checker.start()
        time.sleep(0.13)
        checker.stop()

        assert call_count[0] >= 2

    def test_is_healthy_thread_safe(self):
        """Test thread-safe health property."""
        checker = HealthChecker(lambda: None)
        results = []
        lock = threading.Lock()

        def reader():
            for _ in range(100):
                val = checker.is_healthy
                with lock:
                    results.append(val)

        threads = [threading.Thread(target=reader) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert all(isinstance(r, bool) for r in results)
