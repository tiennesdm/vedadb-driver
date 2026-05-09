"""
Synchronous VedaDB client with prepared statement support.

Example::

    from vedadb import connect, PreparedStatement

    db = connect(host="localhost", username="admin", password="secret")

    # Prepared statement (server-side via params binding)
    stmt = db.prepare("SELECT * FROM users WHERE age > ? AND city = ?")
    result = stmt.execute([21, "NYC"])

    # Direct query with params
    result = db.query("SELECT * FROM products WHERE price < ?", params=[100])
    for row in result.to_dicts():
        print(row)
"""

from __future__ import annotations

import logging
import re
import threading
import weakref
from typing import Any

from .exceptions import VedaDBQueryError, VedaDBValidationError
from .protocol import Protocol, Result

logger = logging.getLogger("vedadb.driver")

# Valid placeholder patterns: ? (positional) and $N (numbered)
_PLACEHOLDER_RE = re.compile(r"\?|\$[0-9]+")


def _count_placeholders(sql: str) -> int:
    """Count the number of parameter placeholders in a SQL string."""
    matches = _PLACEHOLDER_RE.findall(sql)
    # ?-style: each ? is one param
    # $N-style: find the highest N
    if any(m.startswith("$") for m in matches):
        max_n = 0
        for m in matches:
            if m.startswith("$"):
                max_n = max(max_n, int(m[1:]))
        return max_n
    return len(matches)


class PreparedStatement:
    """Server-side prepared statement with client-side parameter binding.

    This implementation uses VedaDB's server-side ``params`` binding
    (``?`` / ``$N`` placeholders). The query template is stored on the
    client; parameters are sent to the server on each ``execute()``.

    PreparedStatements are NOT thread-safe. Create one per thread, or
    use the connection pool which handles this automatically.

    Example::

        stmt = db.prepare("SELECT * FROM users WHERE id = ?")
        result = stmt.execute([42])

        # Re-use with different parameters
        result = stmt.execute([99])

        # Clean up when done (optional — will be cleaned on GC)
        stmt.close()
    """

    def __init__(self, protocol: Protocol, name: str, sql: str):
        self._protocol = protocol
        self._name = name
        self._sql = sql
        self._param_count = _count_placeholders(sql)
        self._closed = False

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def execute(self, params: list | None = None) -> Result:
        """Execute the prepared statement with the given parameters.

        Args:
            params: Parameter values matching the placeholders in the SQL.

        Returns:
            Query :class:`Result`.

        Raises:
            VedaDBQueryError: If the query is rejected by the server.
            VedaDBValidationError: If param count doesn't match placeholders.
        """
        if self._closed:
            raise VedaDBQueryError("prepared statement is closed")
        if params is None:
            params = []
        if len(params) != self._param_count:
            raise VedaDBValidationError(
                f"expected {self._param_count} params, got {len(params)}"
            )
        return self._protocol.query(self._sql, params=params)

    def __call__(self, *params: Any) -> Result:
        """Convenience: ``stmt(42, 'hello')`` is equivalent to ``stmt.execute([42, 'hello'])``."""
        return self.execute(list(params))

    def close(self) -> None:
        """Release this prepared statement."""
        self._closed = True

    def __repr__(self) -> str:
        return f"<PreparedStatement {self._name!r} params={self._param_count}>"

    def __del__(self) -> None:
        if not self._closed:
            try:
                self.close()
            except Exception:
                pass


class VedaDB:
    """Synchronous VedaDB client.

    This is the primary interface for interacting with VedaDB from Python.
    It wraps the low-level :class:`Protocol` with a convenient API that
    supports queries, prepared statements, transactions (via SAVEPOINT),
    cache operations, vector search, and table CRUD.

    **Thread safety:** :class:`VedaDB` instances are thread-safe. Each
    method call is independent (HTTP is stateless). Prepared statements
    are NOT thread-safe — create one per thread or use :meth:`execute`.

    Args:
        host: Server hostname.
        rest_port: REST API port (default 8080).
        base_url: Full base URL (overrides host/port/tls).
        username: Authentication username.
        password: Authentication password.
        database: Default database for all queries.
        timeout: Request timeout in seconds.
        tls: Enable HTTPS.
        tls_insecure: Skip TLS certificate verification (dev only).
        tls_ca_file: Path to CA certificate file.
        max_retries: Maximum retry attempts on failure.
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
    ):
        self._protocol = Protocol(
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
        )
        self._prepared: dict[str, PreparedStatement] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def protocol(self) -> Protocol:
        return self._protocol

    @property
    def database(self) -> str | None:
        return self._protocol.database

    @database.setter
    def database(self, value: str | None) -> None:
        self._protocol.database = value

    # ------------------------------------------------------------------
    # Core query methods
    # ------------------------------------------------------------------

    def query(self, sql: str, *, params: list | None = None) -> Result:
        """Execute a VedaQL query and return results.

        Args:
            sql: VedaQL statement.
            params: Optional server-side parameter values.
        """
        return self._protocol.query(sql, params=params)

    def exec(self, sql: str, *, params: list | None = None) -> Result:
        """Alias for :meth:`query` — execute a statement."""
        return self.query(sql, params=params)

    def execute(self, sql: str, params: list | None = None) -> Result:
        """Execute a query, with optional params. Alias for :meth:`query`."""
        return self.query(sql, params=params)

    def query_one(self, sql: str, *, params: list | None = None) -> dict[str, str] | None:
        """Execute a query and return the first row as a dict, or None."""
        result = self.query(sql, params=params)
        if not result.rows:
            return None
        return result.to_dicts()[0]

    def query_value(self, sql: str, *, params: list | None = None) -> str | None:
        """Execute a query returning a single scalar value, or None."""
        result = self.query(sql, params=params)
        if result.rows and len(result.rows[0]) > 0:
            return result.rows[0][0]
        return None

    # ------------------------------------------------------------------
    # Prepared statements
    # ------------------------------------------------------------------

    def prepare(self, sql: str, *, name: str | None = None) -> PreparedStatement:
        """Create a :class:`PreparedStatement` from a SQL template.

        Args:
            sql: Query template with ``?`` or ``$N`` placeholders.
            name: Optional identifier for later lookup via :meth:`get_prepared`.

        Returns:
            A new :class:`PreparedStatement`.
        """
        if name is None:
            name = f"stmt_{id(sql):x}"
        stmt = PreparedStatement(self._protocol, name, sql)
        with self._lock:
            self._prepared[name] = stmt
        logger.debug("Prepared statement %r (%d params)", name, stmt.param_count)
        return stmt

    def get_prepared(self, name: str) -> PreparedStatement | None:
        """Retrieve a previously prepared statement by name."""
        with self._lock:
            stmt = self._prepared.get(name)
            if stmt is not None and stmt.closed:
                del self._prepared[name]
                return None
            return stmt

    def deallocate(self, name: str) -> None:
        """Close and remove a named prepared statement."""
        with self._lock:
            stmt = self._prepared.pop(name, None)
        if stmt:
            stmt.close()

    def execute_prepared(self, name: str, params: list | None = None) -> Result:
        """Execute a previously prepared statement by name."""
        stmt = self.get_prepared(name)
        if stmt is None:
            raise VedaDBQueryError(f"prepared statement {name!r} not found")
        return stmt.execute(params)

    # ------------------------------------------------------------------
    # Batch operations
    # ------------------------------------------------------------------

    def batch(self, operations: list[dict]) -> list[dict]:
        """Execute multiple REST operations in a single batch request.

        See :meth:`Protocol.batch` for details.
        """
        return self._protocol.batch(operations)

    # ------------------------------------------------------------------
    # Transaction helpers (via SAVEPOINT)
    # ------------------------------------------------------------------

    def begin(self) -> None:
        """Start a transaction (BEGIN)."""
        self.query("BEGIN")

    def commit(self) -> None:
        """Commit the current transaction."""
        self.query("COMMIT")

    def rollback(self) -> None:
        """Roll back the current transaction."""
        self.query("ROLLBACK")

    def transaction(self):
        """Context manager for transactions.

        Example::

            with db.transaction():
                db.exec("INSERT INTO accounts (name) VALUES ('Alice')")
                db.exec("INSERT INTO accounts (name) VALUES ('Bob')")
        """
        return _TransactionContext(self)

    # ------------------------------------------------------------------
    # Table CRUD helpers
    # ------------------------------------------------------------------

    def insert(self, table: str, row: dict) -> dict:
        """Insert a row into a table via REST API."""
        return self._protocol.table_insert_row(table, row)

    def select(
        self,
        table: str,
        *,
        where: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> dict:
        """Select rows from a table via REST API."""
        return self._protocol.table_get_rows(table, where=where, limit=limit, offset=offset)

    def delete(self, table: str, where: str | None = None) -> dict:
        """Delete rows from a table via REST API."""
        return self._protocol.table_delete_rows(table, where=where)

    def tables(self) -> list[dict]:
        """List all tables."""
        return self._protocol.get_tables()

    def describe(self, table: str) -> dict:
        """Describe a table's schema."""
        return self._protocol.describe_table(table)

    # ------------------------------------------------------------------
    # Cache operations
    # ------------------------------------------------------------------

    def cache_set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """Set a cache key."""
        from .protocol import sql_literal
        query = f"CACHE SET {sql_literal(key)} {sql_literal(value)}"
        if ttl is not None:
            query += f" TTL {int(ttl)}"
        self.query(query + ";")

    def cache_get(self, key: str) -> str | None:
        """Get a cache value."""
        from .protocol import sql_literal
        result = self.query(f"CACHE GET {sql_literal(key)};")
        if result.rows:
            return result.rows[0][0]
        return None

    def cache_del(self, key: str) -> None:
        """Delete a cache key."""
        from .protocol import sql_literal
        self.query(f"CACHE DEL {sql_literal(key)};")

    def cache_incr(self, key: str) -> int:
        """Increment a cache key."""
        from .protocol import sql_literal
        result = self.query(f"CACHE INCR {sql_literal(key)};")
        if result.rows:
            return int(result.rows[0][0])
        return 0

    def cache_ttl(self, key: str) -> int:
        """Get remaining TTL for a cache key. Returns -2 if not found."""
        from .protocol import sql_literal
        result = self.query(f"CACHE TTL {sql_literal(key)};")
        if result.rows:
            return int(result.rows[0][0])
        return -2

    def cache_keys(self, pattern: str) -> list[dict]:
        """List cache keys matching a pattern."""
        from .protocol import sql_literal
        return self.query(f"CACHE KEYS {sql_literal(pattern)};").to_dicts()

    # ------------------------------------------------------------------
    # Vector operations
    # ------------------------------------------------------------------

    def vector_create_collection(self, name: str, dimension: int, metric: str = "cosine") -> None:
        """Create a vector collection."""
        self.query(
            f"VECTOR CREATE COLLECTION {name} DIMENSION {int(dimension)} METRIC {metric};"
        )

    def vector_insert(self, collection: str, vector_id: str, vector: list[float]) -> None:
        """Insert a vector into a collection."""
        import json
        encoded = json.dumps(vector)
        self.query(f"VECTOR INSERT INTO {collection} VALUES ('{vector_id}', {encoded});")

    def vector_search(self, collection: str, query_vector: list[float], top_k: int = 5, metric: str = "cosine") -> Result:
        """Search for similar vectors."""
        import json
        encoded = json.dumps(query_vector)
        return self.query(
            f"VECTOR SEARCH {collection} QUERY {encoded} TOP {int(top_k)} METRIC {metric};"
        )

    # ------------------------------------------------------------------
    # Health & lifecycle
    # ------------------------------------------------------------------

    def health(self):
        """Check server health."""
        return self._protocol.health()

    def ping(self) -> bool:
        """Quick connectivity check."""
        return self._protocol.ping()

    def close(self) -> None:
        """Close the client and release resources."""
        with self._lock:
            for stmt in list(self._prepared.values()):
                stmt.close()
            self._prepared.clear()
        self._protocol.close()

    def __enter__(self) -> VedaDB:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def __repr__(self) -> str:
        return f"<VedaDB {self._protocol.base_url}>"


# ---------------------------------------------------------------------------
# Transaction context manager
# ---------------------------------------------------------------------------

class _TransactionContext:
    """Context manager for VedaDB transactions via SAVEPOINT."""

    def __init__(self, db: VedaDB):
        self._db = db
        self._active = False

    def __enter__(self) -> VedaDB:
        self._db.begin()
        self._active = True
        return self._db

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._active:
            if exc_type is None:
                self._db.commit()
            else:
                try:
                    self._db.rollback()
                except Exception:
                    pass
            self._active = False


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------

def connect(
    addr: str | None = None,
    *,
    host: str = "localhost",
    port: int = 8080,
    base_url: str | None = None,
    username: str | None = None,
    password: str | None = None,
    database: str | None = None,
    timeout: float = 30.0,
    tls: bool = False,
    tls_insecure: bool = False,
    tls_ca_file: str | None = None,
    max_retries: int = 3,
) -> VedaDB:
    """Create a new :class:`VedaDB` client.

    Args:
        addr: ``host:port`` shorthand (e.g. ``"localhost:8080"``).
        host: Server hostname.
        port: REST API port.
        base_url: Full base URL (overrides host/port/tls).
        username: Authentication username.
        password: Authentication password.
        database: Default database.
        timeout: Request timeout in seconds.
        tls: Enable HTTPS.
        tls_insecure: Skip TLS verification (dev only).
        tls_ca_file: Path to CA certificate.
        max_retries: Retry attempts on failure.

    Returns:
        Connected :class:`VedaDB` instance.
    """
    if addr and not base_url:
        import urllib.parse
        parsed = urllib.parse.urlparse(f"//{addr}")
        host = parsed.hostname or host
        port = parsed.port or port

    return VedaDB(
        host=host,
        rest_port=port,
        base_url=base_url,
        username=username,
        password=password,
        database=database,
        timeout=timeout,
        tls=tls,
        tls_insecure=tls_insecure,
        tls_ca_file=tls_ca_file,
        max_retries=max_retries,
    )
