"""test_circuit.py — Circuit breaker tests for VedaDB Python driver."""
import pytest
import time
import threading
from enum import Enum, auto
from unittest.mock import Mock


class CircuitState(Enum):
    CLOSED = auto()
    OPEN = auto()
    HALF_OPEN = auto()


class CircuitBreaker:
    """Circuit breaker implementation for VedaDB."""

    def __init__(self, failure_threshold: int = 5, success_threshold: int = 3,
                 timeout: float = 30.0):
        self.failure_threshold = failure_threshold
        self.success_threshold = success_threshold
        self.timeout = timeout
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time = None
        self._half_open_calls = 0
        self._half_open_max = 1
        self._lock = threading.RLock()

    @property
    def state(self) -> CircuitState:
        return self._state

    def allow(self) -> bool:
        with self._lock:
            if self._state == CircuitState.CLOSED:
                return True
            if self._state == CircuitState.OPEN:
                if time.time() - self._last_failure_time > self.timeout:
                    self._state = CircuitState.HALF_OPEN
                    self._half_open_calls = 0
                    self._success_count = 0
                    return True
                return False
            # HALF_OPEN
            if self._half_open_calls < self._half_open_max:
                self._half_open_calls += 1
                return True
            return False

    def record_success(self):
        with self._lock:
            if self._state == CircuitState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.success_threshold:
                    self._state = CircuitState.CLOSED
                    self._failure_count = 0
                    self._half_open_calls = 0
            elif self._state == CircuitState.CLOSED:
                self._failure_count = 0

    def record_failure(self):
        with self._lock:
            self._last_failure_time = time.time()
            if self._state == CircuitState.HALF_OPEN:
                self._state = CircuitState.OPEN
                self._half_open_calls = 0
                return
            self._failure_count += 1
            if self._failure_count >= self.failure_threshold:
                self._state = CircuitState.OPEN

    def execute(self, fn, *args, **kwargs):
        if not self.allow():
            raise CircuitBreakerOpenError("Circuit breaker is OPEN")
        try:
            result = fn(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            raise

    def reset(self):
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._success_count = 0
            self._half_open_calls = 0


class CircuitBreakerOpenError(Exception):
    """Raised when circuit breaker is open."""
    pass


class TestCircuitBreaker:
    """Test suite for circuit breaker."""

    def test_initial_state_closed(self):
        """Test that circuit breaker starts closed."""
        cb = CircuitBreaker()
        assert cb.state == CircuitState.CLOSED

    def test_allows_requests_when_closed(self):
        """Test that requests are allowed when closed."""
        cb = CircuitBreaker()
        assert cb.allow() is True

    def test_opens_after_failure_threshold(self):
        """Test circuit opens after reaching failure threshold."""
        cb = CircuitBreaker(failure_threshold=3)
        cb.record_failure()
        cb.record_failure()
        assert cb.state == CircuitState.CLOSED
        cb.record_failure()
        assert cb.state == CircuitState.OPEN

    def test_rejects_when_open(self):
        """Test that requests are rejected when open."""
        cb = CircuitBreaker(failure_threshold=1, timeout=60.0)
        cb.record_failure()
        assert cb.allow() is False

    def test_half_open_after_timeout(self):
        """Test transition to half-open after timeout."""
        cb = CircuitBreaker(failure_threshold=1, timeout=0.05)
        cb.record_failure()
        assert cb.state == CircuitState.OPEN
        time.sleep(0.1)
        assert cb.allow() is True
        assert cb.state == CircuitState.HALF_OPEN

    def test_closes_after_success_in_half_open(self):
        """Test circuit closes after success in half-open."""
        cb = CircuitBreaker(
            failure_threshold=5,
            success_threshold=1,
            timeout=0.01
        )
        cb.record_failure()
        time.sleep(0.02)
        cb.allow()  # Transition to half-open
        cb.record_success()
        assert cb.state == CircuitState.CLOSED

    def test_reopens_after_failure_in_half_open(self):
        """Test circuit reopens after failure in half-open."""
        cb = CircuitBreaker(
            failure_threshold=5,
            timeout=0.01
        )
        cb.record_failure()
        time.sleep(0.02)
        cb.allow()
        cb.record_failure()
        assert cb.state == CircuitState.OPEN

    def test_execute_success(self):
        """Test execute with successful function."""
        cb = CircuitBreaker()
        result = cb.execute(lambda: 42)
        assert result == 42

    def test_execute_failure(self):
        """Test execute with failing function."""
        cb = CircuitBreaker(failure_threshold=5)

        def fail():
            raise ValueError("error")

        with pytest.raises(ValueError):
            cb.execute(fail)
        assert cb._failure_count == 1

    def test_execute_when_open(self):
        """Test execute when circuit is open."""
        cb = CircuitBreaker(failure_threshold=1, timeout=60.0)
        cb.record_failure()

        with pytest.raises(CircuitBreakerOpenError):
            cb.execute(lambda: 42)

    def test_reset(self):
        """Test manual reset."""
        cb = CircuitBreaker(failure_threshold=1)
        cb.record_failure()
        assert cb.state == CircuitState.OPEN
        cb.reset()
        assert cb.state == CircuitState.CLOSED
        assert cb.allow() is True

    def test_failure_count_resets_on_success(self):
        """Test that failure count resets on success when closed."""
        cb = CircuitBreaker(failure_threshold=5)
        cb.record_failure()
        cb.record_failure()
        assert cb._failure_count == 2
        cb.record_success()
        assert cb._failure_count == 0

    def test_concurrent_record_failure(self):
        """Test thread-safe failure recording."""
        cb = CircuitBreaker(failure_threshold=100)
        threads = []

        for _ in range(50):
            t = threading.Thread(target=cb.record_failure)
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        assert cb._failure_count == 50

    def test_concurrent_allow_when_open(self):
        """Test thread-safe allow when open."""
        cb = CircuitBreaker(failure_threshold=1, timeout=60.0)
        cb.record_failure()

        results = []
        threads = []

        for _ in range(20):
            t = threading.Thread(target=lambda: results.append(cb.allow()))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        assert all(r is False for r in results)

    def test_multiple_successes_to_close(self):
        """Test that multiple successes are needed to close."""
        cb = CircuitBreaker(
            failure_threshold=5,
            success_threshold=3,
            timeout=0.01
        )
        cb.record_failure()
        time.sleep(0.02)
        cb.allow()

        assert cb.state == CircuitState.HALF_OPEN
        cb.record_success()
        assert cb.state == CircuitState.HALF_OPEN
        cb.allow()
        cb.record_success()
        assert cb.state == CircuitState.HALF_OPEN
        cb.allow()
        cb.record_success()
        assert cb.state == CircuitState.CLOSED
