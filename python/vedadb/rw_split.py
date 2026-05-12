"""
Read/write splitting for VedaDB.

Routes read queries (SELECT) to replica nodes and write queries
(INSERT, UPDATE, DELETE) to the primary node.  Provides automatic
fallback to the primary for reads if replicas are unavailable.

Example::

    from vedadb.rw_split import RWSplitClient

    client = RWSplitClient(
        primary="vedadb://admin:pass@primary:7480/mydb",
        replicas=[
            "vedadb://admin:pass@replica1:7480/mydb",
            "vedadb://admin:pass@replica2:7480/mydb",
        ],
    )

    # This goes to a replica
    result = client.query("SELECT * FROM users")

    # This goes to the primary
    result = client.execute("INSERT INTO users (name) VALUES ('Alice')")
"""

from __future__ import annotations

import logging
import random
import re
import threading
from typing import Any, Callable, Dict, List, Optional

from .exceptions import VedaDBConnectionError, VedaDBQueryError
from .protocol import Result

logger = logging.getLogger("vedadb.rw_split")

# SQL statement type detection
_RE_SELECT = re.compile(r"^\s*SELECT\b", re.IGNORECASE)
_RE_WRITE = re.compile(r"^\s*(INSERT|UPDATE|DELETE|REPLACE|MERGE|CREATE|DROP|ALTER|TRUNCATE)\b", re.IGNORECASE)
_RE_TRANSACTION = re.compile(r"^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b", re.IGNORECASE)


class RWSplitClient:
    """Route reads to replicas, writes to primary.

    Automatically classifies SQL statements as read or write and routes
    them to the appropriate node.  Maintains separate connection pools
    for the primary and each replica.

    Args:
        primary: Connection URI or :class:`VedaDB` instance for the
            primary (write) node.
        replicas: List of connection URIs or client instances for
            replica (read) nodes.
        strategy: Load balancing strategy for replicas:
            ``"round_robin"`` | ``"random"`` | ``"least_loaded"``.
        fallback_to_primary: If True, route reads to the primary when
            all replicas are unavailable.

    Example::

        client = RWSplitClient(
            primary=primary_db,
            replicas=[replica1_db, replica2_db],
            strategy="round_robin",
        )
        result = client.query("SELECT * FROM users")  # → replica
        client.execute("INSERT INTO ...")               # → primary
    """

    STRATEGIES = {"round_robin", "random", "least_loaded"}

    def __init__(
        self,
        primary: Any,
        replicas: list[Any] | None = None,
        strategy: str = "round_robin",
        fallback_to_primary: bool = True,
    ):
        self._primary = primary
        self._replicas: list[Any] = list(replicas) if replicas else []
        self._strategy = strategy
        self._fallback_to_primary = fallback_to_primary

        if strategy not in self.STRATEGIES:
            raise ValueError(f"invalid strategy {strategy!r}, must be one of {self.STRATEGIES}")

        self._replica_idx = 0
        self._replica_lock = threading.Lock()
        self._replica_health: Dict[int, bool] = {i: True for i in range(len(self._replicas))}
        self._replica_load: Dict[int, int] = {i: 0 for i in range(len(self._replicas))}

    # ------------------------------------------------------------------
    # SQL classification
    # ------------------------------------------------------------------

    @staticmethod
    def is_read(sql: str) -> bool:
        """Return True if *sql* is a read (SELECT) query."""
        return bool(_RE_SELECT.match(sql))

    @staticmethod
    def is_write(sql: str) -> bool:
        """Return True if *sql* is a write query."""
        return bool(_RE_WRITE.match(sql))

    @staticmethod
    def is_transaction(sql: str) -> bool:
        """Return True if *sql* is a transaction control statement."""
        return bool(_RE_TRANSACTION.match(sql))

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def query(self, sql: str, *, params: list | None = None) -> Result:
        """Execute a query, routing to the appropriate node.

        Reads (SELECT) go to a replica; writes go to the primary.

        Args:
            sql: SQL statement.
            params: Optional parameters.

        Returns:
            :class:`Result`.
        """
        client = self._route(sql)
        if params:
            return client.query(sql, params=params)
        return client.query(sql)

    def execute(self, sql: str, params: list | None = None) -> Result:
        """Execute a statement (always routed to the primary).

        Args:
            sql: SQL statement.
            params: Optional parameters.

        Returns:
            :class:`Result`.
        """
        if params:
            return self._primary.query(sql, params=params)
        return self._primary.query(sql)

    def _route(self, sql: str) -> Any:
        """Determine which client to use for *sql*."""
        # Transaction statements and writes always go to primary
        if self.is_transaction(sql) or self.is_write(sql):
            logger.debug("Routing write/transaction to primary")
            return self._primary

        # Reads go to replicas if available
        if self.is_read(sql) and self._replicas:
            replica = self._pick_replica()
            if replica is not None:
                logger.debug("Routing read to replica")
                return replica
            if self._fallback_to_primary:
                logger.debug("All replicas down — falling back to primary for read")
                return self._primary

        # Default to primary
        logger.debug("Routing to primary")
        return self._primary

    def _pick_replica(self) -> Any | None:
        """Pick a replica based on the load balancing strategy."""
        if not self._replicas:
            return None

        with self._replica_lock:
            healthy = [i for i, ok in self._replica_health.items() if ok]
            if not healthy:
                return None

            if self._strategy == "round_robin":
                idx = healthy[self._replica_idx % len(healthy)]
                self._replica_idx = (self._replica_idx + 1) % len(healthy)
                return self._replicas[idx]

            if self._strategy == "random":
                idx = random.choice(healthy)
                return self._replicas[idx]

            if self._strategy == "least_loaded":
                idx = min(healthy, key=lambda i: self._replica_load.get(i, 0))
                self._replica_load[idx] = self._replica_load.get(idx, 0) + 1
                return self._replicas[idx]

        return None

    def _release_replica(self, idx: int) -> None:
        """Decrement load counter for a replica."""
        if self._strategy == "least_loaded":
            with self._replica_lock:
                self._replica_load[idx] = max(0, self._replica_load.get(idx, 0) - 1)

    # ------------------------------------------------------------------
    # Health management
    # ------------------------------------------------------------------

    def set_replica_health(self, idx: int, healthy: bool) -> None:
        """Manually set the health status of a replica.

        Args:
            idx: Replica index.
            healthy: True if the replica is healthy.
        """
        with self._replica_lock:
            self._replica_health[idx] = healthy

    def check_replica_health(self) -> dict[int, bool]:
        """Check health of all replicas by pinging them.

        Returns:
            Dict mapping replica index to health status.
        """
        results: dict[int, bool] = {}
        for i, replica in enumerate(self._replicas):
            try:
                healthy = replica.ping()
            except Exception:
                healthy = False
            self.set_replica_health(i, healthy)
            results[i] = healthy
        return results

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def primary(self) -> Any:
        """The primary (write) node client."""
        return self._primary

    @property
    def replicas(self) -> list[Any]:
        """List of replica (read) node clients."""
        return list(self._replicas)

    @property
    def replica_count(self) -> int:
        """Number of configured replicas."""
        return len(self._replicas)

    @property
    def healthy_replica_count(self) -> int:
        """Number of currently healthy replicas."""
        return sum(1 for ok in self._replica_health.values() if ok)

    # ------------------------------------------------------------------
    # Pass-through methods
    # ------------------------------------------------------------------

    def ping(self) -> bool:
        """Ping the primary node."""
        try:
            return self._primary.ping()
        except Exception:
            return False

    def close(self) -> None:
        """Close all connections (primary + replicas)."""
        errors: list[Exception] = []
        for client in [self._primary, *self._replicas]:
            try:
                if hasattr(client, "close"):
                    client.close()
            except Exception as exc:
                errors.append(exc)
        if errors:
            logger.warning("Errors closing RW split clients: %s", errors)

    def __enter__(self) -> "RWSplitClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def __repr__(self) -> str:
        return (
            f"<RWSplitClient replicas={self.replica_count} "
            f"healthy={self.healthy_replica_count} "
            f"strategy={self._strategy!r}>"
        )
