"""
Circuit breaker pattern for VedaDB connections.

Implements the classic circuit breaker state machine:

    CLOSED (normal)  ──[failures>threshold]──►  OPEN (failing fast)
         ▲                                        │
         │     ◄──[timeout]───  HALF_OPEN (probing)
         └────────────────────[success]───────────┘

When the circuit is **OPEN**, calls fail immediately with
:class:`CircuitOpenError`, giving the upstream system time to recover.

Example::

    from vedadb.circuit import CircuitBreaker

    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)

    # Via call()
    result = cb.call(db.query, "SELECT * FROM users")

    # Via context manager
    with cb:
        result = db.query("SELECT * FROM users")

    # Check state
    print(cb.state)  # "CLOSED", "OPEN", or "HALF_OPEN"
"""

from __future__ import annotations

import functools
import logging
import threading
import time
from enum import Enum
from typing import Any, Callable, Optional

logger = logging.getLogger("vedadb.circuit")


class CircuitState(str, Enum):
    """Circuit breaker states."""

    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class CircuitOpenError(Exception):
    """Raised when a call is made while the circuit breaker is OPEN."""

    def __init__(self, message: str = "circuit breaker is OPEN", retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class CircuitBreaker:
    """Circuit breaker with CLOSED → OPEN → HALF_OPEN → CLOSED state machine.

    The circuit breaker monitors the failure rate of wrapped calls. When
    failures exceed *failure_threshold* within a single window, the circuit
    **opens** and subsequent calls fail fast with :class:`CircuitOpenError`.
    After *recovery_timeout* seconds, the circuit enters **half-open** and
    allows a limited number of probe calls. If any probe succeeds, the
    circuit **closes** again.

    This implementation is fully thread-safe.

    Args:
        failure_threshold: Number of consecutive failures before opening.
        recovery_timeout: Seconds to wait before entering half-open.
        half_open_max_calls: Max probe calls allowed in half-open state.
        success_threshold: Consecutive successes needed in half-open to close.
        name: Optional name for logging / metrics.
    """

    STATES = {"CLOSED", "OPEN", "HALF_OPEN"}

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        half_open_max_calls: int = 3,
        success_threshold: int = 2,
        name: str = "default",
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self.success_threshold = success_threshold
        self.name = name

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._half_open_calls = 0
        self._last_failure_time: float = 0.0
        self._lock = threading.RLock()

        # Statistics
        self._total_calls = 0
        self._total_failures = 0
        self._total_successes = 0
        self._total_rejected = 0

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def state(self) -> str:
        """Current circuit state: ``"CLOSED"``, ``"OPEN"``, or ``"HALF_OPEN"``."""
        with self._lock:
            return self._state.value

    @property
    def is_closed(self) -> bool:
        """Return True if the circuit is closed (normal operation)."""
        return self.state == CircuitState.CLOSED.value

    @property
    def is_open(self) -> bool:
        """Return True if the circuit is open (failing fast)."""
        return self.state == CircuitState.OPEN.value

    @property
    def failure_count(self) -> int:
        """Current consecutive failure count."""
        with self._lock:
            return self._failure_count

    @property
    def stats(self) -> dict:
        """Return cumulative statistics."""
        with self._lock:
            return {
                "total_calls": self._total_calls,
                "total_successes": self._total_successes,
                "total_failures": self._total_failures,
                "total_rejected": self._total_rejected,
                "failure_count": self._failure_count,
                "state": self._state.value,
                "name": self.name,
            }

    # ------------------------------------------------------------------
    # Core call-through
    # ------------------------------------------------------------------

    def call(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        """Call *fn* through the circuit breaker.

        Args:
            fn: Callable to execute.
            *args, **kwargs: Arguments forwarded to *fn*.

        Returns:
            The return value of *fn*.

        Raises:
            CircuitOpenError: If the circuit is OPEN.
            Exception: Any exception raised by *fn* (when circuit is closed
                or half-open and the call fails).
        """
        self._before_call()

        try:
            result = fn(*args, **kwargs)
            self._on_success()
            return result
        except Exception as exc:
            self._on_failure()
            raise

    async def call_async(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        """Async variant of :meth:`call`."""
        import asyncio

        self._before_call()

        try:
            result = fn(*args, **kwargs)
            if asyncio.iscoroutine(result):
                result = await result
            self._on_success()
            return result
        except Exception:
            self._on_failure()
            raise

    # ------------------------------------------------------------------
    # Context manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "CircuitBreaker":
        """Enter the circuit breaker context.

        Raises CircuitOpenError if the circuit is OPEN.
        """
        self._before_call()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Exit the circuit breaker context, recording success or failure."""
        if exc_type is None:
            self._on_success()
        else:
            self._on_failure()

    async def __aenter__(self) -> "CircuitBreaker":
        self._before_call()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if exc[0] is None:
            self._on_success()
        else:
            self._on_failure()

    # ------------------------------------------------------------------
    # State machine transitions
    # ------------------------------------------------------------------

    def _before_call(self) -> None:
        """Check if the call should proceed or be rejected."""
        with self._lock:
            self._total_calls += 1

            if self._state == CircuitState.OPEN:
                # Check if recovery timeout has elapsed
                elapsed = time.monotonic() - self._last_failure_time
                if elapsed >= self.recovery_timeout:
                    logger.info("Circuit %r: OPEN → HALF_OPEN", self.name)
                    self._state = CircuitState.HALF_OPEN
                    self._half_open_calls = 0
                    self._success_count = 0
                else:
                    self._total_rejected += 1
                    raise CircuitOpenError(
                        f"circuit breaker {self.name!r} is OPEN",
                        retry_after=self.recovery_timeout - elapsed,
                    )

            if self._state == CircuitState.HALF_OPEN:
                if self._half_open_calls >= self.half_open_max_calls:
                    self._total_rejected += 1
                    raise CircuitOpenError(
                        f"circuit breaker {self.name!r} is HALF_OPEN (max calls reached)",
                    )
                self._half_open_calls += 1

    def _on_success(self) -> None:
        """Record a successful call."""
        with self._lock:
            self._total_successes += 1
            self._failure_count = 0

            if self._state == CircuitState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.success_threshold:
                    logger.info("Circuit %r: HALF_OPEN → CLOSED", self.name)
                    self._state = CircuitState.CLOSED
                    self._half_open_calls = 0
                    self._success_count = 0

    def _on_failure(self) -> None:
        """Record a failed call."""
        with self._lock:
            self._total_failures += 1
            self._failure_count += 1
            self._last_failure_time = time.monotonic()

            if self._state == CircuitState.CLOSED:
                if self._failure_count >= self.failure_threshold:
                    logger.warning(
                        "Circuit %r: CLOSED → OPEN (failures=%d >= threshold=%d)",
                        self.name,
                        self._failure_count,
                        self.failure_threshold,
                    )
                    self._state = CircuitState.OPEN

            elif self._state == CircuitState.HALF_OPEN:
                logger.info("Circuit %r: HALF_OPEN → OPEN (probe failed)", self.name)
                self._state = CircuitState.OPEN

    # ------------------------------------------------------------------
    # Manual control
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Manually reset the circuit to CLOSED."""
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._success_count = 0
            self._half_open_calls = 0
            logger.info("Circuit %r: manually reset to CLOSED", self.name)

    def force_open(self) -> None:
        """Manually open the circuit."""
        with self._lock:
            self._state = CircuitState.OPEN
            self._last_failure_time = time.monotonic()
            logger.info("Circuit %r: manually forced OPEN", self.name)

    def force_closed(self) -> None:
        """Manually force the circuit closed."""
        self.reset()

    def __repr__(self) -> str:
        return (
            f"<CircuitBreaker name={self.name!r} state={self.state} "
            f"failures={self.failure_count}/{self.failure_threshold}>"
        )


# ---------------------------------------------------------------------------
# Decorator factory
# ---------------------------------------------------------------------------


def circuit_breaker(
    failure_threshold: int = 5,
    recovery_timeout: float = 30.0,
    half_open_max_calls: int = 3,
    name: str | None = None,
):
    """Decorator that wraps a function in a :class:`CircuitBreaker`.

    Example::

        @circuit_breaker(failure_threshold=3, recovery_timeout=10.0)
        def query_users(db):
            return db.query("SELECT * FROM users")
    """
    cb = CircuitBreaker(
        failure_threshold=failure_threshold,
        recovery_timeout=recovery_timeout,
        half_open_max_calls=half_open_max_calls,
        name=name or "decorated",
    )

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            return cb.call(fn, *args, **kwargs)

        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            return await cb.call_async(fn, *args, **kwargs)

        if hasattr(fn, "__code__") and fn.__code__.co_flags & 0x80:
            return async_wrapper
        wrapper._async_wrapper = async_wrapper  # type: ignore[attr-defined]
        wrapper._circuit_breaker = cb  # type: ignore[attr-defined]
        return wrapper

    return decorator
