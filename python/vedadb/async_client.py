"""
VedaDB Async Client

An asyncio TCP client for VedaDB with connection pooling.

Usage:
    import asyncio
    from vedadb import AsyncVedaDB

    async def main():
        pool = AsyncVedaDB(host='localhost', port=6380, pool_size=10)
        result = await pool.query("SELECT * FROM users;")
        for row in result.to_dicts():
            print(row)
        await pool.close()

    asyncio.run(main())
"""

import asyncio
import json
import ssl
from typing import Any, Dict, List, Optional, Union

from .client import VedaDBError, ConnectionError, QueryError, Result


# ---------------------------------------------------------------------------
# Async Connection Pool
# ---------------------------------------------------------------------------

class AsyncConnectionPool:
    """An asyncio connection pool for VedaDB.

    Maintains a pool of reusable connections. All public methods are
    awaitable. The pool automatically creates new connections up to
    ``max_size`` and reclaims idle connections after ``idle_timeout``.
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 6380,
        pool_size: int = 10,
        idle_timeout: float = 300.0,
        ssl_context: Optional[ssl.SSLContext] = None,
    ):
        self.host = host
        self.port = port
        self.max_size = pool_size
        self.idle_timeout = idle_timeout
        self.ssl = ssl_context
        self._semaphore = asyncio.Semaphore(pool_size)
        self._pool: asyncio.Queue["AsyncVedaConnection"] = asyncio.Queue(
            maxsize=pool_size
        )
        self._closed = False
        self._total_created = 0

    # -- Pool management --

    async def _acquire(self) -> "AsyncVedaConnection":
        """Get a connection from the pool or create a new one."""
        if self._closed:
            raise ConnectionError("pool is closed")

        async with self._semaphore:
            try:
                conn = self._pool.get_nowait()
                if conn.is_stale(self.idle_timeout):
                    await conn.close()
                    return await self._create_connection()
                return conn
            except asyncio.QueueEmpty:
                return await self._create_connection()

    async def _release(self, conn: "AsyncVedaConnection") -> None:
        """Return a connection to the pool."""
        if self._closed or conn.is_broken():
            await conn.close()
            return
        try:
            self._pool.put_nowait(conn)
        except asyncio.QueueFull:
            await conn.close()

    async def _create_connection(self) -> "AsyncVedaConnection":
        """Create a new VedaDB connection."""
        conn = AsyncVedaConnection(self.host, self.port, ssl=self.ssl)
        await conn.connect()
        self._total_created += 1
        return conn

    async def close(self) -> None:
        """Close all connections in the pool."""
        self._closed = True
        while not self._pool.empty():
            try:
                conn = self._pool.get_nowait()
                await conn.close()
            except asyncio.QueueEmpty:
                break

    # -- Query interface --

    async def query(self, sql: str) -> Result:
        """Execute a query using a pooled connection."""
        conn = await self._acquire()
        try:
            result = await conn.query(sql)
            return result
        finally:
            await self._release(conn)

    async def execute(self, sql: str) -> Dict[str, Any]:
        """Execute a statement (INSERT, UPDATE, DELETE)."""
        conn = await self._acquire()
        try:
            result = await conn.execute(sql)
            return result
        finally:
            await self._release(conn)

    # -- Stats --

    @property
    def stats(self) -> Dict[str, Any]:
        return {
            "pool_size": self.max_size,
            "available": self._pool.qsize(),
            "total_created": self._total_created,
        }


# ---------------------------------------------------------------------------
# Async Connection
# ---------------------------------------------------------------------------

class AsyncVedaConnection:
    """A single asyncio TCP connection to VedaDB."""

    def __init__(
        self,
        host: str,
        port: int,
        ssl: Optional[ssl.SSLContext] = None,
    ):
        self.host = host
        self.port = port
        self.ssl = ssl
        self.reader: Optional[asyncio.StreamReader] = None
        self.writer: Optional[asyncio.StreamWriter] = None
        self._last_used: float = 0.0
        self._broken = False

    async def connect(self) -> None:
        """Establish the TCP connection."""
        try:
            self.reader, self.writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port, ssl=self.ssl),
                timeout=5.0,
            )
            self._last_used = asyncio.get_event_loop().time()
        except asyncio.TimeoutError:
            raise ConnectionError(
                f"timed out connecting to {self.host}:{self.port}"
            )
        except OSError as exc:
            raise ConnectionError(f"cannot connect: {exc}")

    async def close(self) -> None:
        """Close the connection."""
        if self.writer:
            self.writer.close()
            try:
                await self.writer.wait_closed()
            except Exception:
                pass
        self.reader = None
        self.writer = None

    def is_stale(self, timeout: float) -> bool:
        """Return True if the connection has been idle too long."""
        return (
            asyncio.get_event_loop().time() - self._last_used
        ) > timeout

    def is_broken(self) -> bool:
        return self._broken

    # -- Protocol --

    async def query(self, sql: str) -> Result:
        """Send a query and return the parsed result."""
        response = await self._send(sql)
        if response.get("error"):
            raise QueryError(response["error"])
        return Result(response)

    async def execute(self, sql: str) -> Dict[str, Any]:
        """Send a statement and return the raw response."""
        response = await self._send(sql)
        return response

    async def _send(self, sql: str) -> Dict[str, Any]:
        if not self.writer or not self.reader:
            raise ConnectionError("not connected")

        message = (sql.strip() + "\n").encode("utf-8")
        self.writer.write(message)
        try:
            await asyncio.wait_for(self.writer.drain(), timeout=30.0)
        except asyncio.TimeoutError:
            self._broken = True
            raise ConnectionError("write timeout")

        try:
            line = await asyncio.wait_for(
                self.reader.readline(), timeout=30.0
            )
        except asyncio.TimeoutError:
            self._broken = True
            raise ConnectionError("read timeout")

        if not line:
            self._broken = True
            raise ConnectionError("server closed connection")

        self._last_used = asyncio.get_event_loop().time()

        try:
            return json.loads(line.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise QueryError(f"invalid JSON from server: {exc}")


# ---------------------------------------------------------------------------
# Convenience alias
# ---------------------------------------------------------------------------

AsyncVedaDB = AsyncConnectionPool
"""Alias for backward compatibility."""
