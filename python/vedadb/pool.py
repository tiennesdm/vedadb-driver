"""
VedaDB Connection Pool

Thread-safe connection pool for VedaDB.

Usage:
    from vedadb import ConnectionPool

    pool = ConnectionPool(host='localhost', port=6380, min_size=2, max_size=10)
    conn = pool.acquire()
    try:
        result = conn.query("SELECT * FROM users;")
    finally:
        pool.release(conn)
    pool.close()
"""

import threading
from typing import Optional

from .client import VedaDB, ConnectionError


class ConnectionPool:
    """Thread-safe connection pool for VedaDB.

    Pre-creates *min_size* connections on init and grows up to *max_size*
    on demand.  Connections are returned to the pool with :meth:`release`.

    Parameters:
        host:     Server hostname (default ``'localhost'``).
        port:     Server port (default ``6380``).
        min_size: Connections to open eagerly (default ``2``).
        max_size: Hard upper limit (default ``10``).
        timeout:  Socket timeout passed to each connection (default ``30``).
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 6380,
        min_size: int = 2,
        max_size: int = 10,
        timeout: float = 30.0,
    ):
        if min_size < 0:
            raise ValueError("min_size must be >= 0")
        if max_size < 1:
            raise ValueError("max_size must be >= 1")
        if min_size > max_size:
            raise ValueError("min_size must be <= max_size")

        self.host = host
        self.port = port
        self.min_size = min_size
        self.max_size = max_size
        self.timeout = timeout

        self._pool: list[VedaDB] = []
        self._lock = threading.Lock()
        self._size = 0
        self._closed = False

        # Eagerly create the minimum connections.
        for _ in range(min_size):
            self._pool.append(self._new_conn())
            self._size += 1

    # -- public API ----------------------------------------------------------

    def acquire(self) -> VedaDB:
        """Take a connection from the pool (or create one if room remains).

        Raises:
            ConnectionError: If the pool is exhausted or closed.
        """
        with self._lock:
            if self._closed:
                raise ConnectionError("Pool is closed")
            # Return an idle connection if available (skip stale ones).
            while self._pool:
                conn = self._pool.pop()
                if conn._connected:
                    return conn
                # Stale connection — close and decrement size.
                conn.close()
                self._size -= 1
            if self._size < self.max_size:
                conn = self._new_conn()
                self._size += 1
                return conn
        raise ConnectionError("Connection pool exhausted")

    def release(self, conn: VedaDB) -> None:
        """Return a connection to the pool.

        If the pool is already at capacity or the connection is dead,
        the connection is closed instead.
        """
        with self._lock:
            if self._closed or not conn._connected:
                conn.close()
                self._size -= 1
                return
            if len(self._pool) < self.max_size:
                self._pool.append(conn)
            else:
                conn.close()
                self._size -= 1

    def close(self) -> None:
        """Close every connection in the pool."""
        with self._lock:
            self._closed = True
            for conn in self._pool:
                conn.close()
            self._pool.clear()
            self._size = 0

    @property
    def size(self) -> int:
        """Total number of managed connections (in-pool + checked-out)."""
        with self._lock:
            return self._size

    @property
    def available(self) -> int:
        """Number of idle connections sitting in the pool."""
        with self._lock:
            return len(self._pool)

    # -- internals -----------------------------------------------------------

    def _new_conn(self) -> VedaDB:
        conn = VedaDB(
            host=self.host,
            port=self.port,
            timeout=self.timeout,
            auto_reconnect=True,
        )
        conn.connect()
        return conn
