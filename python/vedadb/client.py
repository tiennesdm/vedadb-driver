"""
VedaDB Python Driver

A synchronous TCP client for VedaDB, the multi-model database engine.

Usage:
    from vedadb import VedaDB

    with VedaDB(host='localhost', port=6380) as db:
        result = db.query("SELECT * FROM users;")
        for row in result.rows:
            print(row)
        for record in result.to_dicts():
            print(record)
"""

import socket
import ssl
import json
import threading
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class VedaDBError(Exception):
    """Base exception for all VedaDB errors."""


class ConnectionError(VedaDBError):
    """Raised when a TCP connection cannot be established or is lost."""


class QueryError(VedaDBError):
    """Raised when the server returns an error for a query."""


class AuthError(VedaDBError):
    """Raised when authentication fails."""


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

class Result:
    """Structured result returned by VedaDB queries.

    Attributes:
        columns:   List of column names.
        rows:      List of row tuples (each row is a list of values).
        row_count: Number of rows affected or returned.
        message:   Human-readable status message (for DDL/DML).
        error:     Error string (empty on success).
    """

    def __init__(self, data: dict):
        self.columns: List[str] = data.get("columns", [])
        self.rows: List[list] = data.get("rows", [])
        self.row_count: int = data.get("row_count", 0)
        self.message: str = data.get("message", "")
        self.error: str = data.get("error", "")

    def to_dicts(self) -> List[Dict[str, Any]]:
        """Convert rows into a list of ``{column: value}`` dicts."""
        return [dict(zip(self.columns, row)) for row in self.rows]

    def first(self) -> Optional[Dict[str, Any]]:
        """Return the first row as a dict, or ``None`` if empty."""
        if self.rows:
            return dict(zip(self.columns, self.rows[0]))
        return None

    def scalar(self) -> Any:
        """Return the single value from a one-row, one-column result."""
        if self.rows and self.rows[0]:
            return self.rows[0][0]
        return None

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self):
        return iter(self.rows)

    def __bool__(self) -> bool:
        return bool(self.rows) or bool(self.message)

    def __repr__(self) -> str:
        if self.message:
            return f"Result(message='{self.message}')"
        return f"Result(rows={self.row_count}, columns={self.columns})"


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class VedaDB:
    """Synchronous VedaDB TCP client.

    Parameters:
        host:          Server hostname (default ``'localhost'``).
        port:          Server port (default ``6380``).
        timeout:       Socket timeout in seconds (default ``30``).
        auto_reconnect: Retry once on connection loss (default ``True``).
        tls:           Enable STARTTLS upgrade (default ``False``).
        tls_verify:    Verify TLS certificates (default ``True``).
        username:      Username for AUTH (default ``None``).
        password:      Password for AUTH (default ``None``).
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 6380,
        timeout: float = 30.0,
        auto_reconnect: bool = True,
        tls: bool = False,
        tls_verify: bool = True,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.auto_reconnect = auto_reconnect
        self.tls = tls
        self.tls_verify = tls_verify
        self.username = username
        self.password = password
        self._sock: Optional[socket.socket] = None
        self._file = None
        self._lock = threading.Lock()
        self._connected = False

    # -- connection lifecycle ------------------------------------------------

    def connect(self) -> "VedaDB":
        """Open a TCP connection to the VedaDB server.

        Returns:
            ``self``, so you can write ``db = VedaDB().connect()``.
        """
        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self._sock.settimeout(self.timeout)
            self._sock.connect((self.host, self.port))
            self._file = self._sock.makefile("r", encoding="utf-8")
            # Consume the welcome banner the server sends on connect.
            self._file.readline()
            self._connected = True
        except OSError as exc:
            self._connected = False
            raise ConnectionError(f"Failed to connect to {self.host}:{self.port}: {exc}") from exc

        # STARTTLS upgrade.
        if self.tls:
            self._starttls()

        # AUTH.
        if self.username is not None:
            self._auth()

        return self

    def _starttls(self) -> None:
        """Perform STARTTLS upgrade on the current socket."""
        try:
            self._sock.sendall(b"STARTTLS\n")
            response = self._file.readline()
            if not response:
                raise ConnectionError("Server closed the connection during STARTTLS")

            data = json.loads(response)
            if data.get("error"):
                raise ConnectionError(f"STARTTLS failed: {data['error']}")

            # Close the old makefile before wrapping.
            self._file.close()

            # Wrap socket with TLS.
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            if not self.tls_verify:
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            else:
                ctx.check_hostname = True
                ctx.verify_mode = ssl.CERT_REQUIRED
                ctx.load_default_certs()

            self._sock = ctx.wrap_socket(self._sock, server_hostname=self.host)
            self._file = self._sock.makefile("r", encoding="utf-8")
        except (OSError, json.JSONDecodeError) as exc:
            self._connected = False
            raise ConnectionError(f"STARTTLS upgrade failed: {exc}") from exc

    def _auth(self) -> None:
        """Perform AUTH handshake."""
        try:
            cmd = f"AUTH {self.username} {self.password}\n"
            self._sock.sendall(cmd.encode("utf-8"))
            response = self._file.readline()
            if not response:
                raise ConnectionError("Server closed the connection during AUTH")

            data = json.loads(response)
            if data.get("error"):
                self._connected = False
                raise AuthError(f"Authentication failed: {data['error']}")
        except (OSError, json.JSONDecodeError) as exc:
            self._connected = False
            raise ConnectionError(f"AUTH failed: {exc}") from exc

    def close(self) -> None:
        """Close the connection gracefully."""
        self._connected = False
        if self._sock is not None:
            try:
                self._sock.sendall(b"QUIT\n")
            except OSError:
                pass
            try:
                if self._file:
                    self._file.close()
                self._sock.close()
            except OSError:
                pass
            self._sock = None
            self._file = None

    def _reconnect(self) -> None:
        """Drop the current socket and re-establish the connection."""
        self.close()
        self.connect()

    # -- context manager -----------------------------------------------------

    def __enter__(self) -> "VedaDB":
        if not self._connected:
            self.connect()
        return self

    def __exit__(self, *args) -> None:
        self.close()

    # -- core query ----------------------------------------------------------

    def query(self, sql: str) -> Result:
        """Execute a VedaQL statement and return a :class:`Result`.

        Raises:
            ConnectionError: If the server is unreachable.
            QueryError:      If the server reports a query error.
        """
        if not self._connected:
            if self.auto_reconnect:
                self.connect()
            else:
                raise ConnectionError("Not connected to VedaDB")

        try:
            return self._send(sql)
        except ConnectionError:
            if self.auto_reconnect:
                self._reconnect()
                return self._send(sql)
            raise

    def _send(self, sql: str) -> Result:
        """Low-level send/receive on the current socket."""
        with self._lock:
            try:
                self._sock.sendall((sql.strip() + "\n").encode("utf-8"))
                response = self._file.readline()
                if not response:
                    self._connected = False
                    raise ConnectionError("Server closed the connection")
            except (OSError, AttributeError) as exc:
                self._connected = False
                raise ConnectionError(f"Communication error: {exc}") from exc

        try:
            data = json.loads(response)
        except json.JSONDecodeError as exc:
            raise QueryError(f"Invalid JSON response: {exc}") from exc

        if data.get("error"):
            err_msg = data["error"]
            if "auth" in err_msg.lower() or "permission" in err_msg.lower():
                raise AuthError(err_msg)
            raise QueryError(err_msg)

        return Result(data)

    # -- prepared statements -------------------------------------------------

    def prepare(self, name: str, query: str) -> Result:
        """Create a prepared statement on the server.

        Args:
            name:  The statement name.
            query: The SQL query with $1, $2, ... placeholders.

        Returns:
            Result with the server confirmation message.
        """
        return self._send(f"PREPARE {name} AS {query}")

    def execute_prepared(self, name: str, *args: Any) -> Result:
        """Execute a previously prepared statement.

        Args:
            name: The prepared statement name.
            *args: Values to bind to the placeholders. Strings are
                SQL-escaped (single quotes doubled, NUL bytes
                rejected) before interpolation. ints/floats/bools
                serialized as numeric / bool literals (no quoting).
                None becomes NULL.

        Returns:
            Result with query results.

        Raises:
            QueryError: if any arg contains a NUL byte (undefined
                behaviour in most SQL parsers; we refuse rather than
                produce undefined wire output).

        Audit #23 fix: the previous implementation did
            quoted = ", ".join(f"'{a}'" for a in args)
        — naive single-quote wrap with NO escaping. An arg
        containing a single quote terminated the literal early and
        opened an SQL-injection window. _format_prepared_arg
        applies proper SQL escaping (double the quotes, reject NUL)
        AND type-distinguishes numeric / bool / NULL from string.
        """
        quoted = ", ".join(_format_prepared_arg(a) for a in args)
        return self._send(f"EXECUTE {name} ({quoted})")

    def deallocate(self, name: str) -> Result:
        """Remove a prepared statement from the server.

        Args:
            name: The prepared statement name.

        Returns:
            Result with the server confirmation message.
        """
        return self._send(f"DEALLOCATE {name}")

    # -- transactions --------------------------------------------------------

    def begin(self) -> Result:
        """Start a transaction."""
        return self.query("BEGIN")

    def commit(self) -> Result:
        """Commit the current transaction."""
        return self.query("COMMIT")

    def rollback(self) -> Result:
        """Roll back the current transaction."""
        return self.query("ROLLBACK")

    def transaction(self, fn):
        """Execute *fn* inside a transaction.

        The callable receives ``self`` as its only argument.  If *fn*
        raises, the transaction is rolled back and the exception re-raised.

        Example::

            def transfer(db):
                db.query("UPDATE accounts SET balance = balance - 100 WHERE id = 1;")
                db.query("UPDATE accounts SET balance = balance + 100 WHERE id = 2;")
            db.transaction(transfer)
        """
        self.begin()
        try:
            result = fn(self)
            self.commit()
            return result
        except Exception as e:
            self.rollback()
            raise e

    # -- convenience helpers -------------------------------------------------

    def execute(self, sql: str) -> Result:
        """Alias for :meth:`query` (useful when the intent is DDL/DML)."""
        return self.query(sql)

    def insert(self, table: str, data: Dict[str, Any]) -> Result:
        """Insert a single row from a dict.

        Example::

            db.insert("users", {"name": "Alice", "age": 30})
        """
        cols = ", ".join(data.keys())
        vals = ", ".join(_format_value(v) for v in data.values())
        return self.query(f"INSERT INTO {table} ({cols}) VALUES ({vals});")

    def select(
        self,
        table: str,
        columns: str = "*",
        where: Optional[Dict[str, Any]] = None,
        order_by: Optional[str] = None,
        desc: bool = False,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Result:
        """Build and execute a SELECT query.

        Example::

            result = db.select("users", where={"active": True}, limit=10)
        """
        sql = f"SELECT {columns} FROM {table}"
        if where:
            conditions = " AND ".join(
                f"{k} = {_format_value(v)}" for k, v in where.items()
            )
            sql += f" WHERE {conditions}"
        if order_by:
            sql += f" ORDER BY {order_by}"
            if desc:
                sql += " DESC"
        if limit is not None:
            sql += f" LIMIT {limit}"
        if offset is not None:
            sql += f" OFFSET {offset}"
        return self.query(sql + ";")

    def update(
        self,
        table: str,
        set_values: Dict[str, Any],
        where: Optional[Dict[str, Any]] = None,
    ) -> Result:
        """Build and execute an UPDATE query."""
        set_clause = ", ".join(
            f"{k} = {_format_value(v)}" for k, v in set_values.items()
        )
        sql = f"UPDATE {table} SET {set_clause}"
        if where:
            conditions = " AND ".join(
                f"{k} = {_format_value(v)}" for k, v in where.items()
            )
            sql += f" WHERE {conditions}"
        return self.query(sql + ";")

    def delete(
        self, table: str, where: Optional[Dict[str, Any]] = None
    ) -> Result:
        """Build and execute a DELETE query."""
        sql = f"DELETE FROM {table}"
        if where:
            conditions = " AND ".join(
                f"{k} = {_format_value(v)}" for k, v in where.items()
            )
            sql += f" WHERE {conditions}"
        return self.query(sql + ";")

    def insert_many(self, table: str, columns: List[str], rows: List[list]) -> Result:
        """Insert multiple rows in a single statement.

        Example::

            db.insert_many("users", ["name", "age"], [["Alice", 30], ["Bob", 25]])
        """
        vals = ", ".join(
            ["(" + ", ".join(["'" + str(v).replace("'", "''") + "'" for v in row]) + ")" for row in rows]
        )
        return self.query(f"INSERT INTO {table} ({', '.join(columns)}) VALUES {vals}")

    def show_tables(self) -> List[str]:
        """Return a list of table names."""
        result = self.query("SHOW TABLES;")
        if result.rows:
            return [row[0] for row in result.rows]
        return []

    def drop_table(self, table: str) -> Result:
        """Drop a table."""
        return self.query(f"DROP TABLE {table};")

    def count(self, table: str, where: Optional[Dict[str, Any]] = None) -> int:
        """Return the row count for a table (with optional filter)."""
        sql = f"SELECT COUNT(*) FROM {table}"
        if where:
            conditions = " AND ".join(
                f"{k} = {_format_value(v)}" for k, v in where.items()
            )
            sql += f" WHERE {conditions}"
        result = self.query(sql + ";")
        return int(result.scalar()) if result.scalar() is not None else 0

    # -- cache ---------------------------------------------------------------

    def cache_set(self, key: str, value: Any, ttl: Optional[int] = None) -> Result:
        """Set a cache key.

        Bugfix history:
        - dict/list values were being json.dumped without escaping inner
          double-quotes, so the SQL parser truncated the value. Fixed by
          json-encoding then routing through _format_value.
        - _format_value previously only escaped single quotes; multi-line
          strings broke the parser as it treated newlines as statement
          boundaries. Fixed in _format_value and now reused here.

        cache_get below mirrors the JSON decode for transparent roundtrip."""
        if isinstance(value, (dict, list)):
            payload = json.dumps(value, separators=(",", ":"))
        else:
            payload = str(value)
        sql = f"CACHE SET {_format_value(key)} {_format_value(payload)}"
        if ttl is not None:
            sql += f" TTL {ttl}"
        return self.query(sql + ";")

    def cache_get(self, key: str) -> Result:
        """Get a cache value.

        Auto-decodes JSON-shaped payloads (those starting with '{' or '[')
        so callers don't have to. Plain strings/numbers pass through. Stays
        a Result for backward compat with code that reads .rows directly."""
        result = self.query(f"CACHE GET {_format_value(key)};")
        if result.rows and result.rows[0]:
            raw = result.rows[0][0]
            if isinstance(raw, str) and raw and raw[0] in "{[":
                try:
                    decoded = json.loads(raw)
                    result.rows[0][0] = decoded
                except (json.JSONDecodeError, TypeError):
                    pass
        return result

    def cache_del(self, key: str) -> Result:
        """Delete a cache key."""
        return self.query(f"CACHE DEL '{key}';")

    def cache_keys(self, pattern: str = "*") -> Result:
        """List cache keys matching *pattern*."""
        return self.query(f"CACHE KEYS '{pattern}';")

    def cache_incr(self, key: str) -> Result:
        """Increment a cache counter."""
        return self.query(f"CACHE INCR '{key}';")

    # -- search --------------------------------------------------------------

    def search(
        self, table: str, column: str, query: str, fuzzy: int = 0
    ) -> Result:
        """Full-text search on a column."""
        sql = f"SEARCH {table} WHERE {column} MATCH '{query}'"
        if fuzzy > 0:
            sql += f" FUZZY {fuzzy}"
        return self.query(sql + ";")

    # -- graph ---------------------------------------------------------------

    def graph_add_node(self, node_id: str, label: str, props: Optional[Dict[str, Any]] = None) -> Result:
        """Add a node to the graph.

        Args:
            node_id: Unique identifier for the node.
            label:   Node label / type.
            props:   Optional dictionary of properties.
        """
        sql = f"GRAPH ADD NODE '{node_id}' LABEL '{label}'"
        if props:
            props_json = json.dumps(props)
            sql += f" PROPERTIES {props_json}"
        return self.query(sql + ";")

    def graph_add_edge(self, from_id: str, to_id: str, edge_type: str) -> Result:
        """Add an edge between two nodes.

        Args:
            from_id:   Source node identifier.
            to_id:     Target node identifier.
            edge_type: Relationship type / label.
        """
        return self.query(f"GRAPH ADD EDGE '{from_id}' -> '{to_id}' TYPE '{edge_type}';")

    def graph_bfs(self, start: str, depth: int = 3) -> Result:
        """Breadth-first search from *start* up to *depth* hops."""
        return self.query(f"GRAPH BFS '{start}' DEPTH {depth};")

    # -- utilities -----------------------------------------------------------

    def ping(self) -> bool:
        """Return ``True`` if the server is reachable."""
        try:
            self.query("SHOW TABLES;")
            return True
        except VedaDBError:
            return False

    def __del__(self) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_value(value: Any) -> str:
    """Format a Python value for inclusion in a VedaQL query string.

    Bugfix: the previous version only escaped single quotes, so any
    multi-line string (transcripts, free-form text, JSON blobs) corrupted
    the connection -- VedaDB's parser treats raw newlines as statement
    boundaries and rejects the second line as an unexpected token.

    We now also escape backslashes and the control whitespace that the
    parser splits on (newline / carriage return / form feed). The escape
    sequences (``\\n`` etc.) are stored literally so a roundtrip preserves
    the data; callers can call ``.replace('\\n', '\n')`` on read if they
    need the original line breaks.
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, str):
        escaped = (
            value.replace("\\", "\\\\")
                 .replace("'", "''")
                 .replace("\n", "\\n")
                 .replace("\r", "\\r")
                 .replace("\f", "\\f")
        )
        return f"'{escaped}'"
    return str(value)


def _format_prepared_arg(value: Any) -> str:
    """Format an EXECUTE-prepared argument with proper SQL escaping.

    Audit #23 closure for the Python driver: the previous
    execute_prepared call did naive single-quote wrap with no
    escaping, opening an SQL-injection window for any arg
    containing a single quote.

    Behaviour matches _format_value with one extra safety check:
    NUL bytes anywhere in a string arg raise QueryError. NUL is
    undefined behaviour in most SQL parsers and never appears in
    a legitimate value — refusing is safer than producing
    undefined wire output.
    """
    if isinstance(value, str) and "\x00" in value:
        raise QueryError("vedadb: prepared arg contains NUL byte")
    return _format_value(value)
