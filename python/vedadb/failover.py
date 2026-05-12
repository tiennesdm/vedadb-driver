"""
Multi-node failover with sentinel support for VedaDB.

Provides automatic failover to backup nodes when the primary becomes
unavailable.  Monitors node health and switches seamlessly.

Example::

    from vedadb.failover import FailoverClient

    client = FailoverClient(
        nodes=[
            "vedadb://admin:pass@primary:7480/mydb",
            "vedadb://admin:pass@secondary:7480/mydb",
            "vedadb://admin:pass@tertiary:7480/mydb",
        ],
        health_check_interval=5.0,
    )

    # Automatically routes to the first healthy node
    result = client.query("SELECT * FROM users")
"""

from __future__ import annotations

import logging
import random
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from .exceptions import VedaDBConnectionError
from .protocol import Result

logger = logging.getLogger("vedadb.failover")


class NodeState(str, Enum):
    """States for a failover node."""
    HEALTHY = "HEALTHY"
    UNHEALTHY = "UNHEALTHY"
    DEGRADED = "DEGRADED"


@dataclass
class FailoverNode:
    """A node in the failover cluster.

    Attributes:
        address: Connection address (e.g. ``"host:port"``).
        client: The actual client instance.
        state: Current node state.
        priority: Lower = higher priority (tried first).
        last_check: Timestamp of last health check.
        consecutive_failures: Number of consecutive failures.
        total_requests: Total requests sent to this node.
    """

    address: str
    client: Any
    state: NodeState = NodeState.HEALTHY
    priority: int = 0
    last_check: float = field(default_factory=time.monotonic)
    consecutive_failures: int = 0
    total_requests: int = 0
    response_time_ms: float = 0.0

    def __repr__(self) -> str:
        return (
            f"<FailoverNode {self.address!r} "
            f"state={self.state.value} "
            f"priority={self.priority}>"
        )


class FailoverClient:
    """Multi-node failover client with sentinel support.

    Manages a list of VedaDB nodes and automatically routes queries to
    the first healthy node.  Periodically checks node health and
    updates routing accordingly.

    Args:
        nodes: List of client instances or connection dicts.
        node_addresses: Optional list of addresses corresponding to nodes.
        health_check_interval: Seconds between health checks.
        failure_threshold: Consecutive failures before marking unhealthy.
        recovery_interval: Seconds before retrying an unhealthy node.
        auto_failback: Whether to switch back to primary when it recovers.

    Example::

        client = FailoverClient(
            nodes=[primary_db, secondary_db, tertiary_db],
            node_addresses=["primary:7480", "secondary:7480", "tertiary:7480"],
            health_check_interval=5.0,
        )
        result = client.query("SELECT * FROM users")
    """

    def __init__(
        self,
        nodes: list[Any],
        node_addresses: list[str] | None = None,
        health_check_interval: float = 5.0,
        failure_threshold: int = 3,
        recovery_interval: float = 30.0,
        auto_failback: bool = True,
    ):
        if not nodes:
            raise ValueError("at least one node is required")

        self._failure_threshold = failure_threshold
        self._recovery_interval = recovery_interval
        self._auto_failback = auto_failback
        self._health_check_interval = health_check_interval

        # Build failover nodes
        self._nodes: list[FailoverNode] = []
        addresses = node_addresses or [f"node_{i}" for i in range(len(nodes))]
        for i, (addr, client) in enumerate(zip(addresses, nodes)):
            node = FailoverNode(
                address=addr,
                client=client,
                priority=i,  # Lower index = higher priority
            )
            self._nodes.append(node)

        self._current_idx = 0
        self._lock = threading.RLock()
        self._closed = False

        # Background health checker
        self._health_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        if health_check_interval > 0:
            self._start_health_checks()

        logger.info(
            "FailoverClient initialized with %d nodes (health_check=%.1fs)",
            len(self._nodes),
            health_check_interval,
        )

    # ------------------------------------------------------------------
    # Core routing
    # ------------------------------------------------------------------

    def query(self, sql: str, *, params: list | None = None) -> Result:
        """Execute a query, routing to the current best node.

        Args:
            sql: SQL statement.
            params: Optional parameters.

        Returns:
            :class:`Result`.

        Raises:
            VedaDBConnectionError: If no healthy nodes are available.
        """
        node = self._get_current_node()
        if node is None:
            raise VedaDBConnectionError("no healthy nodes available")

        try:
            start = time.perf_counter()
            if params:
                result = node.client.query(sql, params=params)
            else:
                result = node.client.query(sql)
            elapsed = (time.perf_counter() - start) * 1000.0

            node.total_requests += 1
            node.response_time_ms = elapsed
            self._on_success(node)
            return result

        except Exception as exc:
            self._on_failure(node)
            # Try next node
            next_node = self._failover()
            if next_node:
                logger.warning(
                    "Failover from %r to %r after error: %s",
                    node.address, next_node.address, exc,
                )
                if params:
                    return next_node.client.query(sql, params=params)
                return next_node.client.query(sql)
            raise VedaDBConnectionError(f"all nodes failed, last error: {exc}") from exc

    def execute(self, sql: str, params: list | None = None) -> Result:
        """Alias for :meth:`query`."""
        return self.query(sql, params=params)

    def ping(self) -> bool:
        """Ping the current node."""
        node = self._get_current_node()
        if node is None:
            return False
        try:
            return node.client.ping()
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Internal routing logic
    # ------------------------------------------------------------------

    def _get_current_node(self) -> FailoverNode | None:
        """Get the current best node."""
        with self._lock:
            # Try in priority order
            sorted_nodes = sorted(self._nodes, key=lambda n: n.priority)
            for node in sorted_nodes:
                if node.state == NodeState.HEALTHY:
                    return node
                if node.state == NodeState.DEGRADED:
                    return node
            # Try recovery for unhealthy nodes
            for node in sorted_nodes:
                if node.state == NodeState.UNHEALTHY:
                    elapsed = time.monotonic() - node.last_check
                    if elapsed >= self._recovery_interval:
                        node.state = NodeState.DEGRADED
                        logger.info("Node %r entering DEGRADED for recovery probe", node.address)
                        return node
            return None

    def _failover(self) -> FailoverNode | None:
        """Move to the next healthy node and return it."""
        with self._lock:
            sorted_nodes = sorted(self._nodes, key=lambda n: n.priority)
            for node in sorted_nodes:
                if node.state in (NodeState.HEALTHY, NodeState.DEGRADED):
                    self._current_idx = self._nodes.index(node)
                    return node
            return None

    def _on_success(self, node: FailoverNode) -> None:
        """Record a successful operation on a node."""
        node.consecutive_failures = 0
        if node.state == NodeState.DEGRADED:
            node.state = NodeState.HEALTHY
            logger.info("Node %r recovered to HEALTHY", node.address)

        # Auto-failback: if we're not on the primary and it recovered
        if self._auto_failback and node.priority > 0:
            primary = min(self._nodes, key=lambda n: n.priority)
            if primary.state == NodeState.HEALTHY and primary != node:
                logger.info("Auto-failback to primary node %r", primary.address)
                self._current_idx = self._nodes.index(primary)

    def _on_failure(self, node: FailoverNode) -> None:
        """Record a failed operation on a node."""
        node.consecutive_failures += 1
        node.last_check = time.monotonic()

        if node.consecutive_failures >= self._failure_threshold:
            node.state = NodeState.UNHEALTHY
            logger.warning(
                "Node %r marked UNHEALTHY after %d consecutive failures",
                node.address, node.consecutive_failures,
            )

    # ------------------------------------------------------------------
    # Health checks
    # ------------------------------------------------------------------

    def _start_health_checks(self) -> None:
        """Start the background health check thread."""
        self._health_thread = threading.Thread(
            target=self._health_check_loop,
            daemon=True,
            name="vedadb-failover-health",
        )
        self._health_thread.start()

    def _health_check_loop(self) -> None:
        """Background loop for health checks."""
        while not self._stop_event.wait(self._health_check_interval):
            if self._closed:
                break
            try:
                self._check_all_nodes()
            except Exception as exc:
                logger.debug("Health check loop error: %s", exc)

    def _check_all_nodes(self) -> None:
        """Check health of all nodes."""
        for node in self._nodes:
            try:
                healthy = node.client.ping()
                node.last_check = time.monotonic()
                if healthy:
                    if node.state == NodeState.UNHEALTHY:
                        node.state = NodeState.DEGRADED
                        logger.info("Node %r recovered to DEGRADED", node.address)
                    node.consecutive_failures = 0
                else:
                    node.consecutive_failures += 1
                    if node.consecutive_failures >= self._failure_threshold:
                        node.state = NodeState.UNHEALTHY
            except Exception:
                node.consecutive_failures += 1
                node.last_check = time.monotonic()
                if node.consecutive_failures >= self._failure_threshold:
                    node.state = NodeState.UNHEALTHY

    def check_health(self) -> dict[str, str]:
        """Manually check health of all nodes.

        Returns:
            Dict mapping node address to state string.
        """
        self._check_all_nodes()
        return {n.address: n.state.value for n in self._nodes}

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def current_node(self) -> FailoverNode | None:
        """The currently active node."""
        return self._get_current_node()

    @property
    def node_count(self) -> int:
        """Total number of nodes."""
        return len(self._nodes)

    @property
    def healthy_node_count(self) -> int:
        """Number of healthy nodes."""
        return sum(1 for n in self._nodes if n.state == NodeState.HEALTHY)

    @property
    def stats(self) -> dict:
        """Failover statistics."""
        return {
            "node_count": self.node_count,
            "healthy_nodes": self.healthy_node_count,
            "current_node": self.current_node.address if self.current_node else None,
            "nodes": [
                {
                    "address": n.address,
                    "state": n.state.value,
                    "priority": n.priority,
                    "total_requests": n.total_requests,
                    "consecutive_failures": n.consecutive_failures,
                }
                for n in self._nodes
            ],
        }

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the failover client and all node connections."""
        self._closed = True
        self._stop_event.set()
        if self._health_thread:
            self._health_thread.join(timeout=5.0)
        for node in self._nodes:
            try:
                if hasattr(node.client, "close"):
                    node.client.close()
            except Exception:
                pass
        logger.info("FailoverClient closed")

    def __enter__(self) -> "FailoverClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def __repr__(self) -> str:
        current = self.current_node
        return (
            f"<FailoverClient nodes={self.node_count} "
            f"healthy={self.healthy_node_count} "
            f"current={current.address if current else 'NONE'}>"
        )
