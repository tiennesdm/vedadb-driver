"""
Real connection pool for VedaDB with max_size, timeout, and health checks.

Example::

    from vedadb import ConnectionPool

    pool = ConnectionPool(
        host="localhost",
        username="admin",
        password="secret",
        max_size=20,
        max_overflow=5,
        timeout=10.0,
    )

    with pool.acquire() as conn:
        result = conn.query("SELECT * FROM users")
        for row in result.to_dicts():
            print(row)

    pool.close()
"""

from __future__ import annotations

import logging
import threading
import time
import weakref
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Generator

from .driver import VedaDB
from .exceptions import VedaDBPoolError, VedaDBPoolExhausted, VedaDBConnectionError
from .protocol import Protocol, Result

logger = logging.getLogger("vedadb.pool")


@dataclass
class PoolStats:
    """Real-time statistics for a connection pool."""

    size: int = 0          # Connections currently created
    checked_in: int = 0    # Available (idle) connections
    checked_out: int = 0   # In-use connections
    waiting: int = 0       # Threads waiting for a connection
    total_created: int = 0 # Cumulative connections created
    total_requests: int = 0 # Cumulative checkout requests
    failed_health_checks: int = 0


class _PoolConnection:
    """Internal wrapper that tracks per-connection metadata."""

    def __init__(self, protocol: Protocol, pool: ConnectionPool):
        self.protocol = protocol
        self.pool_ref = weakref.ref(pool)
        self.created_at = time.monotonic()
        self.last_used = self.created_at
        self.use_count = 0
        self._invalid = False

    def is_expired(self, max_lifetime: float, max_idle: float) -> bool:
        now = time.monotonic()
        if max_lifetime > 0 and (now - self.created_at) > max_lifetime:
            return True
        if max_idle > 0 and (now - self.last_used) > max_idle:
            return True
        return self._invalid

    def mark_invalid(self) -> None:
        self._invalid = True

    def touch(self) -> None:
        self.last_used = time.monotonic()
        self.use_count += 1

    def health_check(self) -> bool:
        try:
            self.protocol.ping()
            return True
        except Exception:
            self._invalid = True
            return False

    def close(self) -> None:
        self._invalid = True
        try:
            self.protocol.close()
        except Exception:
            pass


class PooledConnection:
    """Proxy that wraps a pooled connection for the duration of a checkout.

    Automatically returns the connection to the pool when the context
    manager exits or ``close()`` is called.
    """

    def __init__(self, pool_conn: _PoolConnection, pool: ConnectionPool):
        self._pool_conn = pool_conn
        self._pool = pool
        self._returned = False

    def query(self, sql: str, *, params: list | None = None) -> Result:
        self._pool_conn.touch()
        return self._pool_conn.protocol.query(sql, params=params)

    def exec(self, sql: str, *, params: list | None = None) -> Result:
        return self.query(sql, params=params)

    def execute(self, sql: str, params: list | None = None) -> Result:
        return self.query(sql, params=params)

    def health(self):
        return self._pool_conn.protocol.health()

    def ping(self) -> bool:
        return self._pool_conn.protocol.ping()

    def close(self) -> None:
        """Return the connection to the pool (does NOT physically close)."""
        if not self._returned:
            self._returned = True
            self._pool._checkin(self._pool_conn)

    def __enter__(self) -> PooledConnection:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def __repr__(self) -> str:
        return f"<PooledConnection uses={self._pool_conn.use_count}>"


class ConnectionPool:
    """Real connection pool with max_size, timeout, and health checks.

    Features:
      - **Bounded size:** ``max_size`` hard limit + ``max_overflow`` for
        temporary burst capacity.
      - **Blocking acquire:** Threads wait up to ``timeout`` seconds for
        a connection to become available.
      - **Health checks:** Connections are validated on checkout; stale
        connections are transparently replaced.
      - **Expiration:** Connections exceeding ``max_lifetime`` or
        ``max_idle_time`` are recycled.
      - **Background housekeeping:** A daemon thread periodically cleans
        expired/idle connections.
      - **Statistics:** :meth:`stats` returns real-time pool metrics.

    The pool is thread-safe and can be shared across threads.

    Args:
        host: Server hostname.
        rest_port: REST API port.
        base_url: Full base URL override.
        username: Authentication username.
        password: Authentication password.
        database: Default database.
        timeout: **Pool** timeout — max seconds to wait for a connection.
        tls, tls_insecure, tls_ca_file: TLS configuration.
        max_size: Maximum number of persistent connections.
        max_overflow: Extra connections allowed during burst.
        max_lifetime: Max seconds a connection may live (0 = infinite).
        max_idle_time: Max seconds a connection may be idle (0 = infinite).
        health_check_interval: Seconds between background health checks.
        housekeeping_interval: Seconds between cleanup runs.
    """

    def __init__(
        self,
        host: str = "localhost",
        rest_port: int = 8080,
        *,
        base_url: str | None = None,
        username: str | None = None,
        password: str | None = None,
        database: str | None = None,
        timeout: float = 30.0,
        tls: bool = False,
        tls_insecure: bool = False,
        tls_ca_file: str | None = None,
        max_size: int = 10,
        max_overflow: int = 5,
        max_lifetime: float = 3600.0,
        max_idle_time: float = 600.0,
        health_check_interval: float = 30.0,
        housekeeping_interval: float = 60.0,
    ):
        self._host = host
        self._rest_port = rest_port
        self._base_url = base_url
        self._username = username
        self._password = password
        self._database = database
        self._timeout = timeout
        self._tls = tls
        self._tls_insecure = tls_insecure
        self._tls_ca_file = tls_ca_file
        self._max_size = max_size
        self._max_overflow = max_overflow
        self._max_lifetime = max_lifetime
        self._max_idle_time = max_idle_time
        self._health_check_interval = health_check_interval

        self._pool: deque[_PoolConnection] = deque()
        self._checked_out: set[_PoolConnection] = set()
        self._overflow = 0  # Current overflow connections checked out
        self._condition = threading.Condition(threading.RLock())
        self._closed = False
        self._stats = PoolStats()
        self._total_requests = 0
        self._failed_health = 0

        # Background housekeeping
        self._housekeeper: threading.Thread | None = None
        if housekeeping_interval > 0:
            self._housekeeper = threading.Thread(
                target=self._housekeeping_loop,
                args=(housekeeping_interval,),
                daemon=True,
                name="vedadb-pool-housekeeper",
            )
            self._housekeeper.start()

        # Pre-warm pool (non-blocking)
        self._prewarm()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _create_connection(self) -> _PoolConnection:
        """Create a new underlying Protocol + wrapper."""
        proto = Protocol(
            host=self._host,
            port=self._rest_port,
            base_url=self._base_url,
            username=self._username,
            password=self._password,
            database=self._database,
            timeout=self._timeout,
            tls=self._tls,
            tls_insecure=self._tls_insecure,
            tls_ca_file=self._tls_ca_file,
        )
        self._stats.total_created += 1
        logger.debug("Created new pool connection (total=%d)", self._stats.total_created)
        return _PoolConnection(proto, self)

    def _prewarm(self, count: int | None = None) -> None:
        """Pre-create connections up to min(max_size, count)."""
        if count is None:
            count = min(2, self._max_size)
        for _ in range(count):
            if len(self._pool) >= self._max_size:
                break
            try:
                conn = self._create_connection()
                self._pool.append(conn)
            except Exception as exc:
                logger.warning("Pre-warm connection failed: %s", exc)
                break

    def _housekeeping_loop(self, interval: float) -> None:
        """Background thread: evict expired/idle connections."""
        while not self._closed:
            time.sleep(interval)
            if self._closed:
                break
            with self._condition:
                to_close: list[_PoolConnection] = []
                keep: deque[_PoolConnection] = deque()
                for conn in self._pool:
                    if conn.is_expired(self._max_lifetime, self._max_idle_time):
                        to_close.append(conn)
                    else:
                        keep.append(conn)
                self._pool = keep
            for conn in to_close:
                conn.close()
                logger.debug("Housekeeper closed expired connection")

    # ------------------------------------------------------------------
    # Checkout / checkin
    # ------------------------------------------------------------------

    def acquire(self, timeout: float | None = None) -> PooledConnection:
        """Check out a connection from the pool.

        Blocks until a connection is available or *timeout* expires.

        Args:
            timeout: Override the pool's default timeout for this call.

        Returns:
            A :class:`PooledConnection` proxy.

        Raises:
            VedaDBPoolExhausted: If no connection is available in time.
        """
        if self._closed:
            raise VedaDBPoolError("pool is closed")

        deadline = time.monotonic() + (timeout or self._timeout)
        self._total_requests += 1

        with self._condition:
            while True:
                # Try to get an existing idle connection
                while self._pool:
                    conn = self._pool.popleft()
                    # Health check
                    if not conn.health_check():
                        self._failed_health += 1
                        conn.close()
                        continue
                    self._checked_out.add(conn)
                    self._stats.checked_out = len(self._checked_out)
                    self._stats.checked_in = len(self._pool)
                    return PooledConnection(conn, self)

                # Can we create a new connection?
                current_size = len(self._checked_out) + len(self._pool)
                if current_size < self._max_size:
                    conn = self._create_connection()
                    if not conn.health_check():
                        self._failed_health += 1
                        conn.close()
                    else:
                        self._checked_out.add(conn)
                        self._stats.checked_out = len(self._checked_out)
                        return PooledConnection(conn, self)

                # Can we overflow?
                if self._overflow < self._max_overflow:
                    self._overflow += 1
                    conn = self._create_connection()
                    if not conn.health_check():
                        self._failed_health += 1
                        self._overflow -= 1
                        conn.close()
                    else:
                        self._checked_out.add(conn)
                        self._stats.checked_out = len(self._checked_out)
                        return PooledConnection(conn, self)

                # Wait for a connection to be returned
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise VedaDBPoolExhausted(
                        f"pool exhausted: max={self._max_size}, "
                        f"overflow={self._max_overflow}, all connections in use"
                    )
                self._condition.wait(timeout=remaining)

    def _checkin(self, conn: _PoolConnection) -> None:
        """Return a connection to the pool."""
        with self._condition:
            self._checked_out.discard(conn)
            if conn.is_expired(self._max_lifetime, self._max_idle_time) or conn._invalid:
                conn.close()
                if conn in self._checked_out:
                    self._overflow = max(0, self._overflow - 1)
            else:
                self._pool.append(conn)
            self._stats.checked_out = len(self._checked_out)
            self._stats.checked_in = len(self._pool)
            self._condition.notify()

    @contextmanager
    def connection(self, timeout: float | None = None) -> Generator[PooledConnection, None, None]:
        """Context manager equivalent of :meth:`acquire`.

        Example::

            with pool.connection() as conn:
                conn.query("SELECT * FROM users")
        """
        conn = self.acquire(timeout=timeout)
        try:
            yield conn
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Direct query (acquire + query + return)
    # ------------------------------------------------------------------

    def query(self, sql: str, *, params: list | None = None) -> Result:
        """Acquire a connection, run a query, and return it. Convenience method."""
        with self.connection() as conn:
            return conn.query(sql, params=params)

    def exec(self, sql: str, *, params: list | None = None) -> Result:
        return self.query(sql, params=params)

    def execute(self, sql: str, params: list | None = None) -> Result:
        return self.query(sql, params=params)

    def ping(self) -> bool:
        """Ping the server via a pooled connection."""
        with self.connection() as conn:
            return conn.ping()

    # ------------------------------------------------------------------
    # Stats & introspection
    # ------------------------------------------------------------------

    def stats(self) -> PoolStats:
        """Return current pool statistics."""
        with self._condition:
            return PoolStats(
                size=len(self._pool) + len(self._checked_out),
                checked_in=len(self._pool),
                checked_out=len(self._checked_out),
                waiting=0,  # Cannot easily track with Condition
                total_created=self._stats.total_created,
                total_requests=self._total_requests,
                failed_health_checks=self._failed_health,
            )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close all connections and shut down the pool."""
        self._closed = True
        with self._condition:
            all_conns = list(self._pool) + list(self._checked_out)
            self._pool.clear()
            self._checked_out.clear()
        for conn in all_conns:
            conn.close()
        logger.info("Connection pool closed")

    def __enter__(self) -> ConnectionPool:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def __repr__(self) -> str:
        return (
            f"<ConnectionPool max={self._max_size}+{self._max_overflow} "
            f"idle={len(self._pool)} out={len(self._checked_out)}>"
        )
