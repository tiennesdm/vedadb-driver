"""
Connection load balancing for VedaDB.

Distributes connections across multiple backend nodes using various
load balancing strategies.  Integrates with health checking to skip
unhealthy nodes.

Example::

    from vedadb.load_balance import LoadBalancer

    lb = LoadBalancer(
        nodes=["host1:7480", "host2:7480", "host3:7480"],
        strategy="least_connections",
    )

    node = lb.get_node()  # Returns the best node
    db = connect(host=node)
"""

from __future__ import annotations

import logging
import random
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set

logger = logging.getLogger("vedadb.load_balance")


@dataclass
class Node:
    """A single backend node in the load balancer."""

    address: str
    weight: int = 1
    active_connections: int = 0
    healthy: bool = True
    last_used: float = field(default_factory=time.monotonic)
    total_requests: int = 0
    failure_count: int = 0
    response_time_ms: float = 0.0

    @property
    def load_score(self) -> float:
        """Lower score = better candidate."""
        if not self.healthy:
            return float("inf")
        # Weighted least-connections
        if self.weight > 0:
            return self.active_connections / self.weight
        return float("inf")

    def __repr__(self) -> str:
        return (
            f"<Node {self.address!r} "
            f"conns={self.active_connections} "
            f"healthy={self.healthy} "
            f"weight={self.weight}>"
        )


class LoadBalancer:
    """Distribute connections across multiple VedaDB nodes.

    Supports multiple load balancing strategies and integrates with
    health checking to automatically exclude failed nodes.

    Strategies:
        - ``round_robin``: Distribute sequentially.
        - ``least_connections``: Route to the node with fewest active connections.
        - ``random``: Random selection.
        - ``weighted``: Select based on node weights.
        - ``fastest_response``: Route to the node with lowest latency.

    Args:
        nodes: List of node addresses (e.g. ``"host:port"``).
        strategy: Load balancing strategy name.
        weights: Optional dict mapping node address to weight.

    Example::

        lb = LoadBalancer(
            nodes=["db1:7480", "db2:7480", "db3:7480"],
            strategy="least_connections",
            weights={"db1:7480": 3, "db2:7480": 2, "db3:7480": 1},
        )
        node = lb.get_node()
    """

    STRATEGIES = {"round_robin", "least_connections", "random", "weighted", "fastest_response"}

    def __init__(
        self,
        nodes: list[str],
        strategy: str = "round_robin",
        weights: dict[str, int] | None = None,
    ):
        if not nodes:
            raise ValueError("at least one node is required")
        if strategy not in self.STRATEGIES:
            raise ValueError(f"invalid strategy {strategy!r}, must be one of {self.STRATEGIES}")

        self._strategy = strategy
        self._nodes: list[Node] = []
        self._node_map: Dict[str, Node] = {}
        self._lock = threading.Lock()
        self._rr_index = 0

        for addr in nodes:
            weight = (weights or {}).get(addr, 1)
            node = Node(address=addr, weight=weight)
            self._nodes.append(node)
            self._node_map[addr] = node

        logger.info(
            "LoadBalancer initialized with %d nodes (strategy=%s)",
            len(self._nodes),
            strategy,
        )

    # ------------------------------------------------------------------
    # Core: get node
    # ------------------------------------------------------------------

    def get_node(self) -> str:
        """Select and return the best node address.

        Returns:
            The address of the selected node.

        Raises:
            RuntimeError: If no healthy nodes are available.
        """
        with self._lock:
            healthy = [n for n in self._nodes if n.healthy]
            if not healthy:
                raise RuntimeError("no healthy nodes available")

            if self._strategy == "round_robin":
                node = healthy[self._rr_index % len(healthy)]
                self._rr_index = (self._rr_index + 1) % len(healthy)

            elif self._strategy == "least_connections":
                node = min(healthy, key=lambda n: n.load_score)

            elif self._strategy == "random":
                node = random.choice(healthy)

            elif self._strategy == "weighted":
                node = self._weighted_select(healthy)

            elif self._strategy == "fastest_response":
                node = min(healthy, key=lambda n: n.response_time_ms or float("inf"))

            else:
                node = healthy[0]

            node.active_connections += 1
            node.total_requests += 1
            node.last_used = time.monotonic()
            return node.address

    def release_node(self, address: str) -> None:
        """Decrement the active connection count for a node.

        Call this when a connection to *address* is closed.

        Args:
            address: Node address previously returned by :meth:`get_node`.
        """
        with self._lock:
            node = self._node_map.get(address)
            if node:
                node.active_connections = max(0, node.active_connections - 1)

    def report_response_time(self, address: str, elapsed_ms: float) -> None:
        """Report the response time for a node (used by ``fastest_response``).

        Args:
            address: Node address.
            elapsed_ms: Response time in milliseconds.
        """
        with self._lock:
            node = self._node_map.get(address)
            if node:
                # Exponential moving average
                alpha = 0.3
                if node.response_time_ms == 0:
                    node.response_time_ms = elapsed_ms
                else:
                    node.response_time_ms = (
                        alpha * elapsed_ms + (1 - alpha) * node.response_time_ms
                    )

    def report_failure(self, address: str) -> None:
        """Report a failure for a node.

        After a configurable number of consecutive failures, the node
        will be marked unhealthy.

        Args:
            address: Node address.
        """
        with self._lock:
            node = self._node_map.get(address)
            if node:
                node.failure_count += 1
                node.active_connections = max(0, node.active_connections - 1)
                if node.failure_count >= 3:
                    node.healthy = False
                    logger.warning("Node %r marked unhealthy after %d failures", address, node.failure_count)

    def report_success(self, address: str) -> None:
        """Report a successful connection to a node.

        Resets the failure count for the node.

        Args:
            address: Node address.
        """
        with self._lock:
            node = self._node_map.get(address)
            if node:
                node.failure_count = 0
                if not node.healthy:
                    node.healthy = True
                    logger.info("Node %r recovered and marked healthy", address)

    # ------------------------------------------------------------------
    # Weighted selection
    # ------------------------------------------------------------------

    def _weighted_select(self, nodes: list[Node]) -> Node:
        """Select a node using weighted random selection."""
        total_weight = sum(n.weight for n in nodes if n.healthy)
        if total_weight <= 0:
            return nodes[0]
        r = random.uniform(0, total_weight)
        cumulative = 0.0
        for node in nodes:
            if not node.healthy:
                continue
            cumulative += node.weight
            if r <= cumulative:
                return node
        return nodes[-1]

    # ------------------------------------------------------------------
    # Node management
    # ------------------------------------------------------------------

    def add_node(self, address: str, weight: int = 1) -> None:
        """Add a new node to the pool."""
        with self._lock:
            if address in self._node_map:
                return
            node = Node(address=address, weight=weight)
            self._nodes.append(node)
            self._node_map[address] = node
        logger.info("Added node %r to load balancer", address)

    def remove_node(self, address: str) -> None:
        """Remove a node from the pool."""
        with self._lock:
            node = self._node_map.pop(address, None)
            if node:
                self._nodes.remove(node)
        logger.info("Removed node %r from load balancer", address)

    def set_node_health(self, address: str, healthy: bool) -> None:
        """Manually set a node's health status."""
        with self._lock:
            node = self._node_map.get(address)
            if node:
                node.healthy = healthy

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def strategy(self) -> str:
        """Current load balancing strategy."""
        return self._strategy

    @property
    def node_count(self) -> int:
        """Total number of nodes."""
        return len(self._nodes)

    @property
    def healthy_node_count(self) -> int:
        """Number of healthy nodes."""
        return sum(1 for n in self._nodes if n.healthy)

    @property
    def total_active_connections(self) -> int:
        """Total active connections across all nodes."""
        return sum(n.active_connections for n in self._nodes)

    @property
    def stats(self) -> dict:
        """Load balancer statistics."""
        with self._lock:
            return {
                "strategy": self._strategy,
                "total_nodes": len(self._nodes),
                "healthy_nodes": self.healthy_node_count,
                "total_active_connections": self.total_active_connections,
                "total_requests": sum(n.total_requests for n in self._nodes),
                "nodes": [
                    {
                        "address": n.address,
                        "healthy": n.healthy,
                        "active_connections": n.active_connections,
                        "total_requests": n.total_requests,
                        "weight": n.weight,
                        "response_time_ms": n.response_time_ms,
                    }
                    for n in self._nodes
                ],
            }

    def __repr__(self) -> str:
        return (
            f"<LoadBalancer nodes={self.node_count} "
            f"healthy={self.healthy_node_count} "
            f"strategy={self._strategy!r} "
            f"conns={self.total_active_connections}>"
        )
