"""
Connection health checker for VedaDB.

Monitors connection health with periodic pings and tracks latency
statistics. Useful for connection pools, load balancers, and failover
systems that need to know whether a backend is healthy.

Example::

    from vedadb.health import HealthChecker

    checker = HealthChecker(check_interval=10.0, timeout=5.0)
    await checker.start(ping_fn=db.ping)

    # Check health
    if checker.is_healthy():
        print(f"Last ping: {checker.last_ping_ms:.1f}ms")
    else:
        print("Connection is unhealthy!")

    await checker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import statistics
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Deque, Optional

logger = logging.getLogger("vedadb.health")


@dataclass
class HealthSnapshot:
    """Snapshot of health check results at a point in time."""

    is_healthy: bool = False
    last_ping_ms: float = 0.0
    avg_ping_ms: float = 0.0
    min_ping_ms: float = 0.0
    max_ping_ms: float = 0.0
    consecutive_failures: int = 0
    total_checks: int = 0
    total_failures: int = 0
    timestamp: float = field(default_factory=time.monotonic)


class HealthChecker:
    """Monitors connection health with periodic pings.

    Runs a background task (threading or asyncio) that periodically pings
    the target.  Maintains a rolling history of ping latencies and
    tracks consecutive failures.

    Args:
        check_interval: Seconds between health checks.
        timeout: Max seconds to wait for a single ping.
        failure_threshold: Consecutive failures before marking unhealthy.
        history_size: Number of ping samples to retain for statistics.
        name: Optional name for logging.
    """

    def __init__(
        self,
        check_interval: float = 10.0,
        timeout: float = 5.0,
        failure_threshold: int = 3,
        history_size: int = 60,
        name: str = "default",
    ):
        self.check_interval = check_interval
        self.timeout = timeout
        self.failure_threshold = failure_threshold
        self.name = name

        self._is_healthy: bool = False
        self._consecutive_failures: int = 0
        self._total_checks: int = 0
        self._total_failures: int = 0
        self._last_ping_ms: float = 0.0
        self._history: Deque[float] = deque(maxlen=history_size)

        # Async state
        self._task: Optional[asyncio.Task] = None
        self._stop_event: Optional[asyncio.Event] = None

        # Sync state
        self._thread: Optional[threading.Thread] = None
        self._stop_flag = threading.Event()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def last_ping_ms(self) -> float:
        """Milliseconds for the most recent successful ping (0.0 if none)."""
        return self._last_ping_ms

    @property
    def avg_ping_ms(self) -> float:
        """Average ping latency in milliseconds (0.0 if no history)."""
        if not self._history:
            return 0.0
        return statistics.mean(self._history)

    @property
    def min_ping_ms(self) -> float:
        """Minimum ping latency in milliseconds (0.0 if no history)."""
        if not self._history:
            return 0.0
        return min(self._history)

    @property
    def max_ping_ms(self) -> float:
        """Maximum ping latency in milliseconds (0.0 if no history)."""
        if not self._history:
            return 0.0
        return max(self._history)

    def is_healthy(self) -> bool:
        """Return True if the target is currently considered healthy."""
        return self._is_healthy

    @property
    def stats(self) -> dict:
        """Return full health statistics."""
        return {
            "is_healthy": self._is_healthy,
            "last_ping_ms": self._last_ping_ms,
            "avg_ping_ms": self.avg_ping_ms,
            "min_ping_ms": self.min_ping_ms,
            "max_ping_ms": self.max_ping_ms,
            "consecutive_failures": self._consecutive_failures,
            "total_checks": self._total_checks,
            "total_failures": self._total_failures,
            "name": self.name,
        }

    def snapshot(self) -> HealthSnapshot:
        """Return a snapshot of current health state."""
        return HealthSnapshot(
            is_healthy=self._is_healthy,
            last_ping_ms=self._last_ping_ms,
            avg_ping_ms=self.avg_ping_ms,
            min_ping_ms=self.min_ping_ms,
            max_ping_ms=self.max_ping_ms,
            consecutive_failures=self._consecutive_failures,
            total_checks=self._total_checks,
            total_failures=self._total_failures,
        )

    # ------------------------------------------------------------------
    # Core ping logic
    # ------------------------------------------------------------------

    def check(self, ping_fn: Callable[[], bool]) -> bool:
        """Execute a single synchronous health check.

        Args:
            ping_fn: Callable that returns True if the target is alive.

        Returns:
            True if the ping succeeded.
        """
        self._total_checks += 1
        start = time.perf_counter()
        try:
            result = ping_fn()
            elapsed = (time.perf_counter() - start) * 1000.0
            if result:
                self._last_ping_ms = elapsed
                self._history.append(elapsed)
                self._consecutive_failures = 0
                self._is_healthy = True
                logger.debug("Health check %r: ok in %.2fms", self.name, elapsed)
                return True
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000.0
            logger.debug("Health check %r: exception after %.2fms: %s", self.name, elapsed, exc)

        self._consecutive_failures += 1
        self._total_failures += 1
        if self._consecutive_failures >= self.failure_threshold:
            self._is_healthy = False
        return False

    async def check_async(self, ping_fn: Callable[[], Any]) -> bool:
        """Execute a single async health check.

        Args:
            ping_fn: Async or sync callable that returns True if alive.

        Returns:
            True if the ping succeeded.
        """
        self._total_checks += 1
        start = time.perf_counter()
        try:
            if asyncio.iscoroutinefunction(ping_fn):
                result = await asyncio.wait_for(ping_fn(), timeout=self.timeout)
            else:
                result = ping_fn()
            elapsed = (time.perf_counter() - start) * 1000.0
            if result:
                self._last_ping_ms = elapsed
                self._history.append(elapsed)
                self._consecutive_failures = 0
                self._is_healthy = True
                logger.debug("Health check %r: ok in %.2fms", self.name, elapsed)
                return True
        except asyncio.TimeoutError:
            elapsed = (time.perf_counter() - start) * 1000.0
            logger.debug("Health check %r: timeout after %.2fms", self.name, elapsed)
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000.0
            logger.debug("Health check %r: exception after %.2fms: %s", self.name, elapsed, exc)

        self._consecutive_failures += 1
        self._total_failures += 1
        if self._consecutive_failures >= self.failure_threshold:
            self._is_healthy = False
        return False

    # ------------------------------------------------------------------
    # Background async monitoring
    # ------------------------------------------------------------------

    async def start(self, ping_fn: Callable[[], Any]) -> None:
        """Start periodic health checks in the background.

        Args:
            ping_fn: Async or sync callable used for health checks.
        """
        if self._task is not None and not self._task.done():
            logger.warning("Health checker %r already running", self.name)
            return

        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(
            self._health_loop(ping_fn),
            name=f"vedadb-health-{self.name}",
        )
        logger.info("Health checker %r started (interval=%.1fs)", self.name, self.check_interval)

    async def stop(self) -> None:
        """Stop the background health check loop."""
        if self._stop_event is not None:
            self._stop_event.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=self.timeout + 2.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
        self._task = None
        logger.info("Health checker %r stopped", self.name)

    async def _health_loop(self, ping_fn: Callable[[], Any]) -> None:
        """Background loop that runs health checks periodically."""
        assert self._stop_event is not None
        while not self._stop_event.is_set():
            await self.check_async(ping_fn)
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=self.check_interval
                )
            except asyncio.TimeoutError:
                pass

    # ------------------------------------------------------------------
    # Background sync monitoring (threading)
    # ------------------------------------------------------------------

    def start_sync(self, ping_fn: Callable[[], bool]) -> None:
        """Start periodic health checks in a daemon thread.

        Args:
            ping_fn: Sync callable used for health checks.
        """
        if self._thread is not None and self._thread.is_alive():
            logger.warning("Health checker %r (sync) already running", self.name)
            return

        self._stop_flag.clear()
        self._thread = threading.Thread(
            target=self._sync_health_loop,
            args=(ping_fn,),
            daemon=True,
            name=f"vedadb-health-{self.name}",
        )
        self._thread.start()
        logger.info(
            "Health checker %r (sync) started (interval=%.1fs)",
            self.name,
            self.check_interval,
        )

    def stop_sync(self) -> None:
        """Stop the background sync health check loop."""
        self._stop_flag.set()
        if self._thread is not None:
            self._thread.join(timeout=self.timeout + 2.0)
            self._thread = None
        logger.info("Health checker %r (sync) stopped", self.name)

    def _sync_health_loop(self, ping_fn: Callable[[], bool]) -> None:
        """Sync background loop for health checks."""
        while not self._stop_flag.wait(self.check_interval):
            if self._stop_flag.is_set():
                break
            try:
                self.check(ping_fn)
            except Exception as exc:
                logger.debug("Health check %r loop error: %s", self.name, exc)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"<HealthChecker name={self.name!r} healthy={self._is_healthy} "
            f"last_ping={self._last_ping_ms:.1f}ms "
            f"failures={self._consecutive_failures}/{self.failure_threshold}>"
        )
