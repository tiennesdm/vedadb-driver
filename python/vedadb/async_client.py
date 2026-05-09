"""
AsyncIO client for VedaDB with connection pooling.

Example::

    from vedadb import AsyncVedaDB

    async def main():
        db = AsyncVedaDB(host="localhost", username="admin", password="secret")
        result = await db.query("SELECT * FROM users WHERE age > ?", params=[21])
        for row in result.to_dicts():
            print(row)
        await db.close()

    asyncio.run(main())
"""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
import time
import weakref
from collections import deque
from dataclasses import dataclass, field
from types import TracebackType
from typing import Any

import aiohttp

from .exceptions import (
    VedaDBAuthError,
    VedaDBConnectionError,
    VedaDBPoolError,
    VedaDBPoolExhausted,
    VedaDBQueryError,
    VedaDBRateLimitError,
    VedaDBTimeoutError,
    VedaDBValidationError,
)
from .protocol import HealthStatus, Result, sql_literal, validate_identifier

logger = logging.getLogger("vedadb.async")


# ---------------------------------------------------------------------------
# Async protocol
# ---------------------------------------------------------------------------

class AsyncProtocol:
    """AsyncIO HTTP transport for VedaDB REST API using ``aiohttp``."""

    def __init__(
        self,
        host: str = "localhost",
        port: int = 8080,
        *,
        base_url: str | None = None,
        username: str | None = None,
        password: str | None = None,
        database: str | None = None,
        timeout: float = 30.0,
        tls: bool = False,
        tls_insecure: bool = False,
        tls_ca_file: str | None = None,
        max_retries: int = 3,
        retry_backoff_base: float = 0.5,
        retry_max_backoff: float = 30.0,
        session: aiohttp.ClientSession | None = None,
    ):
        import base64

        scheme = "https" if tls else "http"
        self._base_url = (base_url or f"{scheme}://{host}:{port}").rstrip("/")
        self._database = database
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._max_retries = max_retries
        self._retry_backoff_base = retry_backoff_base
        self._retry_max_backoff = retry_max_backoff
        self._closed = False
        self._owner_session = session is None
        self._session = session

        # SSL context
        self._ssl_ctx: ssl.SSLContext | None = None
        if tls:
            if tls_ca_file:
                self._ssl_ctx = ssl.create_default_context(cafile=tls_ca_file)
            else:
                self._ssl_ctx = ssl.create_default_context()
            if tls_insecure:
                self._ssl_ctx.check_hostname = False
                self._ssl_ctx.verify_mode = ssl.CERT_NONE

        # Auth
        self._auth_header: str | None = None
        if username and password:
            token = base64.b64encode(f"{username}:{password}".encode()).decode()
            self._auth_header = f"Bearer {token}"

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def database(self) -> str | None:
        return self._database

    @database.setter
    def database(self, value: str | None) -> None:
        self._database = value

    @property
    def closed(self) -> bool:
        return self._closed

    async def _session(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = aiohttp.ClientSession(
                timeout=self._timeout,
                headers={"X-Client-Library": "vedadb-python-async"},
            )
        return self._session

    def _headers(self, content_type: bool = True) -> dict[str, str]:
        headers: dict[str, str] = {
            "Accept": "application/json",
            "X-Client-Library": "vedadb-python-async",
        }
        if content_type:
            headers["Content-Type"] = "application/json"
        if self._auth_header:
            headers["Authorization"] = self._auth_header
        if self._database:
            headers["X-VedaDB-Database"] = self._database
        return headers

    async def request(
        self,
        method: str,
        path: str,
        payload: dict | list | None = None,
        *,
        extra_headers: dict[str, str] | None = None,
        _skip_retry: bool = False,
    ) -> dict:
        if self._closed:
            raise VedaDBConnectionError("protocol is closed")

        url = f"{self._base_url}{path}"
        session = await self._session()
        headers = self._headers(content_type=payload is not None)
        if extra_headers:
            headers.update(extra_headers)

        max_attempts = 1 if _skip_retry else (1 + self._max_retries)
        last_error: Exception | None = None

        for attempt in range(max_attempts):
            try:
                async with session.request(
                    method.upper(),
                    url,
                    headers=headers,
                    json=payload,
                    ssl=self._ssl_ctx,
                ) as response:
                    body = await response.read()
                    if 200 <= response.status < 300:
                        if not body:
                            return {}
                        return json.loads(body.decode("utf-8"))

                    # Error response
                    try:
                        parsed = json.loads(body.decode("utf-8")) if body else {}
                    except json.JSONDecodeError:
                        parsed = {"error": body.decode("utf-8", errors="replace") or str(response.reason)}
                    error_msg = parsed.get("error", str(response.reason))

                    if response.status == 429:
                        retry_after = None
                        if "Retry-After" in response.headers:
                            try:
                                retry_after = float(response.headers["Retry-After"])
                            except ValueError:
                                pass
                        if attempt < max_attempts - 1:
                            backoff = retry_after or (self._retry_backoff_base * (2 ** attempt))
                            backoff = min(backoff, self._retry_max_backoff)
                            logger.warning("Rate limited, retrying in %.1fs", backoff)
                            await asyncio.sleep(backoff)
                            continue
                        raise VedaDBRateLimitError(error_msg, status_code=429, retry_after=retry_after)

                    if response.status in (401, 403):
                        raise VedaDBAuthError(error_msg, status_code=response.status)

                    if response.status == 400:
                        raise VedaDBQueryError(error_msg, status_code=400)

                    if 500 <= response.status < 600 and attempt < max_attempts - 1:
                        backoff = min(self._retry_backoff_base * (2 ** attempt), self._retry_max_backoff)
                        await asyncio.sleep(backoff)
                        continue

                    raise VedaDBConnectionError(f"HTTP {response.status}: {error_msg}", status_code=response.status)

            except (aiohttp.ClientConnectionError, aiohttp.ServerConnectionError) as exc:
                last_error = VedaDBConnectionError(str(exc))
                last_error.__cause__ = exc
                if attempt < max_attempts - 1:
                    backoff = min(self._retry_backoff_base * (2 ** attempt), self._retry_max_backoff)
                    await asyncio.sleep(backoff)
                    continue
                raise last_error

            except asyncio.TimeoutError as exc:
                last_error = VedaDBTimeoutError(f"Request timed out")
                last_error.__cause__ = exc
                if attempt < max_attempts - 1:
                    continue
                raise last_error

        raise last_error or VedaDBConnectionError("request failed after all retries")

    async def health(self) -> HealthStatus:
        raw = await self.request("GET", "/v1/health", _skip_retry=True)
        return HealthStatus(
            status=raw.get("status", "unknown"),
            timestamp=raw.get("timestamp", ""),
            raw=raw,
        )

    async def query(
        self,
        sql: str,
        *,
        database: str | None = None,
        params: list | None = None,
    ) -> Result:
        if not sql or not sql.strip():
            raise VedaDBValidationError("query must not be empty")
        if len(sql) > 1_000_000:
            raise VedaDBValidationError("query exceeds 1MB maximum")

        payload: dict[str, Any] = {"query": sql}
        if database:
            payload["database"] = database
        elif self._database:
            payload["database"] = self._database
        if params:
            if len(params) > 1024:
                raise VedaDBValidationError("maximum 1024 params per query")
            payload["params"] = [json.dumps(p, default=str) for p in params]

        data = await self.request("POST", "/v1/query", payload)
        return Result(
            columns=data.get("columns"),
            rows=data.get("rows"),
            row_count=int(data.get("row_count", 0)),
            message=data.get("message", ""),
        )

    async def ping(self) -> bool:
        try:
            health = await self.health()
            return health.status == "ok"
        except VedaDBError:
            return False

    async def close(self) -> None:
        self._closed = True
        if self._owner_session and self._session:
            await self._session.close()
            self._session = None

    async def __aenter__(self) -> AsyncProtocol:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.close()


# ---------------------------------------------------------------------------
# Async prepared statement
# ---------------------------------------------------------------------------

class AsyncPreparedStatement:
    """Async version of PreparedStatement."""

    def __init__(self, protocol: AsyncProtocol, name: str, sql: str, param_count: int):
        self._protocol = protocol
        self._name = name
        self._sql = sql
        self._param_count = param_count
        self._closed = False

    @property
    def name(self) -> str:
        return self._name

    @property
    def sql(self) -> str:
        return self._sql

    @property
    def param_count(self) -> int:
        return self._param_count

    @property
    def closed(self) -> bool:
        return self._closed

    async def execute(self, params: list | None = None) -> Result:
        if self._closed:
            raise VedaDBQueryError("prepared statement is closed")
        if params is None:
            params = []
        if len(params) != self._param_count:
            raise VedaDBValidationError(
                f"expected {self._param_count} params, got {len(params)}"
            )
        return await self._protocol.query(self._sql, params=params)

    async def __call__(self, *params: Any) -> Result:
        return await self.execute(list(params))

    def close(self) -> None:
        self._closed = True


# ---------------------------------------------------------------------------
# Async client
# ---------------------------------------------------------------------------

class AsyncVedaDB:
    """Asynchronous VedaDB client using asyncio and aiohttp.

    Example::

        db = AsyncVedaDB(host="localhost", username="admin", password="secret")
        result = await db.query("SELECT * FROM users")
        await db.close()

    Or use as an async context manager::

        async with AsyncVedaDB(host="localhost") as db:
            result = await db.query("SELECT * FROM users")
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
        max_retries: int = 3,
        session: aiohttp.ClientSession | None = None,
    ):
        self._protocol = AsyncProtocol(
            host=host,
            port=rest_port,
            base_url=base_url,
            username=username,
            password=password,
            database=database,
            timeout=timeout,
            tls=tls,
            tls_insecure=tls_insecure,
            tls_ca_file=tls_ca_file,
            max_retries=max_retries,
            session=session,
        )
        self._prepared: dict[str, AsyncPreparedStatement] = {}
        self._lock = asyncio.Lock()

    @property
    def protocol(self) -> AsyncProtocol:
        return self._protocol

    @property
    def database(self) -> str | None:
        return self._protocol.database

    @database.setter
    def database(self, value: str | None) -> None:
        self._protocol.database = value

    # Core methods
    async def query(self, sql: str, *, params: list | None = None) -> Result:
        return await self._protocol.query(sql, params=params)

    async def exec(self, sql: str, *, params: list | None = None) -> Result:
        return await self.query(sql, params=params)

    async def execute(self, sql: str, params: list | None = None) -> Result:
        return await self.query(sql, params=params)

    async def query_one(self, sql: str, *, params: list | None = None) -> dict[str, str] | None:
        result = await self.query(sql, params=params)
        if not result.rows:
            return None
        return result.to_dicts()[0]

    async def query_value(self, sql: str, *, params: list | None = None) -> str | None:
        result = await self.query(sql, params=params)
        if result.rows and len(result.rows[0]) > 0:
            return result.rows[0][0]
        return None

    # Prepared statements
    async def prepare(self, sql: str, *, name: str | None = None) -> AsyncPreparedStatement:
        import re
        if name is None:
            name = f"stmt_{id(sql):x}"
        _placeholder_re = re.compile(r"\?|\$[0-9]+")
        matches = _placeholder_re.findall(sql)
        if any(m.startswith("$") for m in matches):
            param_count = max(int(m[1:]) for m in matches if m.startswith("$"))
        else:
            param_count = len(matches)
        stmt = AsyncPreparedStatement(self._protocol, name, sql, param_count)
        async with self._lock:
            self._prepared[name] = stmt
        return stmt

    async def get_prepared(self, name: str) -> AsyncPreparedStatement | None:
        async with self._lock:
            stmt = self._prepared.get(name)
            if stmt is not None and stmt.closed:
                del self._prepared[name]
                return None
            return stmt

    async def deallocate(self, name: str) -> None:
        async with self._lock:
            stmt = self._prepared.pop(name, None)
        if stmt:
            stmt.close()

    async def execute_prepared(self, name: str, params: list | None = None) -> Result:
        stmt = await self.get_prepared(name)
        if stmt is None:
            raise VedaDBQueryError(f"prepared statement {name!r} not found")
        return await stmt.execute(params)

    # Transactions
    async def begin(self) -> None:
        await self.query("BEGIN")

    async def commit(self) -> None:
        await self.query("COMMIT")

    async def rollback(self) -> None:
        await self.query("ROLLBACK")

    def transaction(self):
        return _AsyncTransactionContext(self)

    # Cache
    async def cache_set(self, key: str, value: Any, ttl: int | None = None) -> None:
        query = f"CACHE SET {sql_literal(key)} {sql_literal(value)}"
        if ttl is not None:
            query += f" TTL {int(ttl)}"
        await self.query(query + ";")

    async def cache_get(self, key: str) -> str | None:
        result = await self.query(f"CACHE GET {sql_literal(key)};")
        if result.rows:
            return result.rows[0][0]
        return None

    async def cache_del(self, key: str) -> None:
        await self.query(f"CACHE DEL {sql_literal(key)};")

    # Vector
    async def vector_create_collection(self, name: str, dimension: int, metric: str = "cosine") -> None:
        await self.query(f"VECTOR CREATE COLLECTION {name} DIMENSION {int(dimension)} METRIC {metric};")

    async def vector_search(self, collection: str, query_vector: list[float], top_k: int = 5, metric: str = "cosine") -> Result:
        encoded = json.dumps(query_vector)
        return await self.query(f"VECTOR SEARCH {collection} QUERY {encoded} TOP {int(top_k)} METRIC {metric};")

    # Health
    async def health(self) -> HealthStatus:
        return await self._protocol.health()

    async def ping(self) -> bool:
        return await self._protocol.ping()

    async def close(self) -> None:
        async with self._lock:
            for stmt in list(self._prepared.values()):
                stmt.close()
            self._prepared.clear()
        await self._protocol.close()

    async def __aenter__(self) -> AsyncVedaDB:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.close()

    def __repr__(self) -> str:
        return f"<AsyncVedaDB {self._protocol.base_url}>"


# ---------------------------------------------------------------------------
# Async transaction context
# ---------------------------------------------------------------------------

class _AsyncTransactionContext:
    def __init__(self, db: AsyncVedaDB):
        self._db = db
        self._active = False

    async def __aenter__(self) -> AsyncVedaDB:
        await self._db.begin()
        self._active = True
        return self._db

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._active:
            if exc_type is None:
                await self._db.commit()
            else:
                try:
                    await self._db.rollback()
                except Exception:
                    pass
            self._active = False


# ---------------------------------------------------------------------------
# Async connection pool
# ---------------------------------------------------------------------------

@dataclass
class AsyncPoolStats:
    size: int = 0
    checked_in: int = 0
    checked_out: int = 0
    total_created: int = 0
    total_requests: int = 0
    failed_health_checks: int = 0


class _AsyncPoolConnection:
    def __init__(self, protocol: AsyncProtocol):
        self.protocol = protocol
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

    async def health_check(self) -> bool:
        try:
            return await self.protocol.ping()
        except Exception:
            self._invalid = True
            return False

    async def close(self) -> None:
        self._invalid = True
        await self.protocol.close()


class AsyncPooledConnection:
    """Proxy for an async pooled connection."""

    def __init__(self, pool_conn: _AsyncPoolConnection, pool: AsyncConnectionPool):
        self._pool_conn = pool_conn
        self._pool = pool
        self._returned = False

    async def query(self, sql: str, *, params: list | None = None) -> Result:
        self._pool_conn.touch()
        return await self._pool_conn.protocol.query(sql, params=params)

    async def exec(self, sql: str, *, params: list | None = None) -> Result:
        return await self.query(sql, params=params)

    async def ping(self) -> bool:
        return await self._pool_conn.protocol.ping()

    def close(self) -> None:
        if not self._returned:
            self._returned = True
            self._pool._checkin(self._pool_conn)

    async def __aenter__(self) -> AsyncPooledConnection:
        return self

    async def __aexit__(self, *exc) -> None:
        self.close()


class AsyncConnectionPool:
    """Async connection pool for VedaDB.

    Features the same semantics as :class:`ConnectionPool` but with
    asyncio-compatible APIs.

    Example::

        pool = AsyncConnectionPool(host="localhost", max_size=20)
        async with pool.acquire() as conn:
            result = await conn.query("SELECT * FROM users")
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
        pool_timeout: float = 30.0,
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
        self._pool_timeout = pool_timeout

        self._pool: deque[_AsyncPoolConnection] = deque()
        self._checked_out: set[_AsyncPoolConnection] = set()
        self._overflow = 0
        self._closed = False
        self._lock = asyncio.Lock()
        self._available = asyncio.Condition(self._lock)
        self._stats = AsyncPoolStats()
        self._total_requests = 0
        self._failed_health = 0

    def _create_connection(self) -> _AsyncPoolConnection:
        proto = AsyncProtocol(
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
        return _AsyncPoolConnection(proto)

    async def acquire(self, timeout: float | None = None) -> AsyncPooledConnection:
        if self._closed:
            raise VedaDBPoolError("pool is closed")

        deadline = time.monotonic() + (timeout or self._pool_timeout)
        self._total_requests += 1

        async with self._lock:
            while True:
                while self._pool:
                    conn = self._pool.popleft()
                    if not await conn.health_check():
                        self._failed_health += 1
                        await conn.close()
                        continue
                    self._checked_out.add(conn)
                    self._stats.checked_out = len(self._checked_out)
                    self._stats.checked_in = len(self._pool)
                    return AsyncPooledConnection(conn, self)

                current_size = len(self._checked_out) + len(self._pool)
                if current_size < self._max_size:
                    conn = self._create_connection()
                    if not await conn.health_check():
                        self._failed_health += 1
                        await conn.close()
                    else:
                        self._checked_out.add(conn)
                        self._stats.checked_out = len(self._checked_out)
                        return AsyncPooledConnection(conn, self)

                if self._overflow < self._max_overflow:
                    self._overflow += 1
                    conn = self._create_connection()
                    if not await conn.health_check():
                        self._failed_health += 1
                        self._overflow -= 1
                        await conn.close()
                    else:
                        self._checked_out.add(conn)
                        return AsyncPooledConnection(conn, self)

                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise VedaDBPoolExhausted(
                        f"pool exhausted: max={self._max_size}, overflow={self._max_overflow}"
                    )
                try:
                    await asyncio.wait_for(self._available.wait(), timeout=remaining)
                except asyncio.TimeoutError:
                    raise VedaDBPoolExhausted(
                        f"pool exhausted: max={self._max_size}, overflow={self._max_overflow}"
                    )

    def _checkin(self, conn: _AsyncPoolConnection) -> None:
        async def _do_checkin():
            async with self._lock:
                self._checked_out.discard(conn)
                if conn.is_expired(self._max_lifetime, self._max_idle_time) or conn._invalid:
                    await conn.close()
                else:
                    self._pool.append(conn)
                self._available.notify()
        # Schedule without awaiting — fire and forget is safe here
        asyncio.create_task(_do_checkin())

    async def query(self, sql: str, *, params: list | None = None) -> Result:
        async with self.acquire() as conn:
            return await conn.query(sql, params=params)

    async def ping(self) -> bool:
        async with self.acquire() as conn:
            return await conn.ping()

    async def stats(self) -> AsyncPoolStats:
        async with self._lock:
            return AsyncPoolStats(
                size=len(self._pool) + len(self._checked_out),
                checked_in=len(self._pool),
                checked_out=len(self._checked_out),
                total_created=self._stats.total_created,
                total_requests=self._total_requests,
                failed_health_checks=self._failed_health,
            )

    async def close(self) -> None:
        self._closed = True
        async with self._lock:
            all_conns = list(self._pool) + list(self._checked_out)
            self._pool.clear()
            self._checked_out.clear()
        for conn in all_conns:
            await conn.close()

    async def __aenter__(self) -> AsyncConnectionPool:
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()

    def __repr__(self) -> str:
        return f"<AsyncConnectionPool max={self._max_size}+{self._max_overflow}>"
