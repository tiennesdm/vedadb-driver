"""
VedaDB async Python driver — Phase 0.5.1 of the 0.3→1.0 roadmap.

This module mirrors :mod:`vedadb.client` using asyncio primitives so
applications using ``asyncio`` / ``anyio`` / ``fastapi`` / ``aiohttp``
get first-class non-blocking I/O without thread-pool hacks.

Usage::

    import asyncio
    from vedadb.aio import AsyncVedaDB

    async def main() -> None:
        async with AsyncVedaDB(host="localhost", port=6380) as db:
            result = await db.query("SELECT * FROM users;")
            for row in result.rows:
                print(row)

    asyncio.run(main())

Async pools::

    from vedadb.aio import AsyncConnectionPool

    pool = AsyncConnectionPool(host="...", min_size=2, max_size=10)
    async with pool.acquire() as db:
        await db.execute("INSERT INTO …")

Exceptions (:class:`VedaDBError`, :class:`QueryError`, :class:`AuthError`)
are re-exported from :mod:`vedadb.client` — user code can catch them
against either the sync or async surface.

Design notes
------------
* Uses :class:`asyncio.StreamReader` / :class:`asyncio.StreamWriter`
  under the hood. TLS support is via :class:`ssl.SSLContext`.
* Wire framing is line-based — the existing server protocol is
  line-terminated so the async reader uses ``readline`` directly.
* Each connection is independent — concurrent queries on the same
  connection are **not** supported. Use the pool.
* Cancellations propagate cleanly: if the caller awaits ``query()`` and
  then cancels, the underlying connection is closed (aborting the
  in-flight query) rather than left in an inconsistent state.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import ssl
from typing import Any, AsyncIterator, Dict, List, Optional

from .client import AuthError, ConnectionError, QueryError, Result, VedaDBError

__all__ = [
    "AsyncVedaDB",
    "AsyncConnectionPool",
]


# ---------------------------------------------------------------------------
# AsyncVedaDB
# ---------------------------------------------------------------------------


class AsyncVedaDB:
    """Asynchronous TCP client for VedaDB.

    Instance members:

    * ``host``, ``port``  — connection endpoint.
    * ``tls``             — ``True`` to wrap the stream in TLS.
    * ``timeout``         — per-operation deadline in seconds.
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 6380,
        *,
        tls: bool = False,
        tls_verify: bool = True,
        timeout: float = 30.0,
        user: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.host = host
        self.port = port
        self.tls = tls
        self.tls_verify = tls_verify
        self.timeout = timeout
        self._user = user
        self._password = password
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None

    # -- lifecycle --------------------------------------------------------

    async def connect(self) -> None:
        """Open the connection. Idempotent — safe to call multiple times."""
        if self._writer is not None:
            return

        ssl_ctx: Optional[ssl.SSLContext] = None
        if self.tls:
            # Default: verify hostname + CA chain via the system trust store.
            # Pass tls_verify=False explicitly to opt out (dev only).
            ssl_ctx = ssl.create_default_context()
            if not self.tls_verify:
                ssl_ctx.check_hostname = False
                ssl_ctx.verify_mode = ssl.CERT_NONE

        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(
                    self.host,
                    self.port,
                    ssl=ssl_ctx,
                    server_hostname=self.host if ssl_ctx is not None else None,
                ),
                timeout=self.timeout,
            )
        except (OSError, asyncio.TimeoutError) as exc:
            raise ConnectionError(f"async connect {self.host}:{self.port}: {exc}") from exc

        if self._user is not None:
            try:
                auth_line = f"AUTH {self._user} {self._password or ''}\n"
                self._writer.write(auth_line.encode())
                await self._writer.drain()
                # Server replies with a JSON envelope on the first line.
                line = await self._readline()
                payload = json.loads(line)
                if payload.get("error"):
                    raise AuthError(str(payload["error"]))
            except AuthError:
                raise
            except Exception as exc:  # pragma: no cover — surface cleanly
                await self.close()
                raise AuthError(f"AUTH failed: {exc}") from exc

    async def close(self) -> None:
        """Shut the connection down cleanly. Idempotent."""
        if self._writer is None:
            return
        try:
            self._writer.close()
            with contextlib.suppress(Exception):
                await self._writer.wait_closed()
        finally:
            self._reader = None
            self._writer = None

    async def __aenter__(self) -> "AsyncVedaDB":
        await self.connect()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.close()

    # -- query / execute --------------------------------------------------

    async def query(self, sql: str) -> Result:
        """Run a SELECT-returning statement and return a :class:`Result`."""
        return await self._send(sql)

    async def execute(self, sql: str) -> Result:
        """Run a non-SELECT statement. Returned :class:`Result` carries row count.

        Semantically identical to :meth:`query` on the wire; split kept
        for readability — matches sync driver and psycopg/asyncpg style.
        """
        return await self._send(sql)

    async def ping(self) -> bool:
        """Round-trip a no-op. Returns True iff the server responds."""
        try:
            await self._send("SELECT 1;")
            return True
        except VedaDBError:
            return False

    # -- internals --------------------------------------------------------

    async def _send(self, sql: str) -> Result:
        if self._writer is None:
            await self.connect()
        assert self._writer is not None and self._reader is not None

        try:
            payload = sql if sql.endswith("\n") else sql + "\n"
            self._writer.write(payload.encode())
            await asyncio.wait_for(self._writer.drain(), timeout=self.timeout)

            line = await asyncio.wait_for(self._readline(), timeout=self.timeout)
        except asyncio.CancelledError:
            # Caller cancelled — close the socket so we don't leave the
            # server mid-response on a recycled connection.
            await self.close()
            raise
        except asyncio.TimeoutError as exc:
            await self.close()
            raise QueryError(f"timeout after {self.timeout}s") from exc
        except Exception as exc:
            await self.close()
            raise QueryError(str(exc)) from exc

        try:
            data = json.loads(line)
        except json.JSONDecodeError as exc:
            raise QueryError(f"malformed response: {line!r}") from exc

        if data.get("error"):
            raise QueryError(str(data["error"]))
        return Result(data)

    async def _readline(self) -> str:
        assert self._reader is not None
        raw = await self._reader.readline()
        if not raw:
            raise ConnectionError("connection closed by peer")
        return raw.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# AsyncConnectionPool
# ---------------------------------------------------------------------------


class AsyncConnectionPool:
    """Fixed-bound asyncio connection pool.

    Behaviour:

    * ``min_size`` connections are created up-front on first
      ``acquire``.
    * Up to ``max_size`` total connections are created on demand.
    * :meth:`acquire` returns an async context manager that checks the
      connection back in on exit. Broken connections (detected by
      ``ping()`` failure) are discarded and replaced.
    """

    def __init__(
        self,
        *,
        host: str = "localhost",
        port: int = 6380,
        min_size: int = 1,
        max_size: int = 8,
        tls: bool = False,
        tls_verify: bool = True,
        user: Optional[str] = None,
        password: Optional[str] = None,
        timeout: float = 30.0,
    ):
        if min_size < 0 or max_size <= 0 or min_size > max_size:
            raise ValueError("invalid min_size / max_size")
        self._host = host
        self._port = port
        self._tls = tls
        self._tls_verify = tls_verify
        self._user = user
        self._password = password
        self._timeout = timeout
        self._min = min_size
        self._max = max_size

        self._queue: asyncio.Queue[AsyncVedaDB] = asyncio.Queue(max_size)
        self._created = 0
        self._lock = asyncio.Lock()

    async def _make_connection(self) -> AsyncVedaDB:
        db = AsyncVedaDB(
            host=self._host, port=self._port, tls=self._tls,
            tls_verify=self._tls_verify,
            user=self._user, password=self._password, timeout=self._timeout,
        )
        await db.connect()
        return db

    async def _fill_to_min(self) -> None:
        while self._created < self._min:
            conn = await self._make_connection()
            self._created += 1
            self._queue.put_nowait(conn)

    @contextlib.asynccontextmanager
    async def acquire(self) -> AsyncIterator[AsyncVedaDB]:
        """Borrow a connection for the duration of the ``async with``.

        On exit, the connection returns to the pool unless it is known
        broken (in which case it is discarded and the pool creates a
        replacement on the next acquire).
        """
        async with self._lock:
            if self._created < self._min:
                await self._fill_to_min()

        conn: Optional[AsyncVedaDB] = None
        try:
            # Prefer a ready connection; otherwise expand up to max.
            try:
                conn = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                async with self._lock:
                    if self._created < self._max:
                        conn = await self._make_connection()
                        self._created += 1
                if conn is None:
                    conn = await self._queue.get()

            # Health check — pool must hand out live connections.
            if not await conn.ping():
                await conn.close()
                async with self._lock:
                    self._created -= 1
                conn = await self._make_connection()
                async with self._lock:
                    self._created += 1

            yield conn
        finally:
            if conn is not None:
                # Best-effort return. If the queue is full (shouldn't
                # happen but defensive), close the spare.
                try:
                    self._queue.put_nowait(conn)
                except asyncio.QueueFull:
                    await conn.close()
                    async with self._lock:
                        self._created -= 1

    async def close(self) -> None:
        """Close every pooled connection."""
        while not self._queue.empty():
            try:
                conn = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            await conn.close()
        self._created = 0

    async def __aenter__(self) -> "AsyncConnectionPool":
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.close()
