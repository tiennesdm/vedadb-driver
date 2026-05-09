"""
HTTP wire-protocol layer for VedaDB.

Handles JSON serialization, authentication headers, retry logic with
exponential back-off, connection health checks, and response parsing.
"""

from __future__ import annotations

import base64
import json
import logging
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable

from .exceptions import (
    VedaDBAuthError,
    VedaDBConnectionError,
    VedaDBQueryError,
    VedaDBRateLimitError,
    VedaDBTimeoutError,
    VedaDBValidationError,
)

logger = logging.getLogger("vedadb.protocol")

# ---------------------------------------------------------------------------
# SQL-injection-safe literal formatting
# ---------------------------------------------------------------------------

_RE_VALID_IDENTIFIER = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_RE_VALID_LABEL = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def sql_literal(value: Any) -> str:
    """Convert a Python value to a SQL-safe literal string.

    Supports: None, bool, int, float, str, list (vectors).
    Raises VedaDBValidationError for unsupported types.
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        # Preserve integer-valued floats without trailing .0 where possible
        if value == int(value):
            return str(int(value))
        return repr(value)
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    if isinstance(value, (list, tuple)):
        # Vector / array literal
        elements = ",".join(str(sql_literal(v)).strip("'") if isinstance(v, str) else sql_literal(v) for v in value)
        return f"[{elements}]"
    raise VedaDBValidationError(f"unsupported parameter type: {type(value).__name__}")


def validate_identifier(name: str) -> None:
    """Validate that *name* is a safe SQL identifier."""
    if not name or len(name) > 128:
        raise VedaDBValidationError(f"invalid identifier length: {len(name) if name else 0}")
    if not _RE_VALID_IDENTIFIER.match(name):
        raise VedaDBValidationError(
            f"invalid identifier {name!r} (only alphanumeric and underscores allowed)"
        )


def validate_label(label: str) -> None:
    """Validate a human-friendly label (jobs, webhooks, etc.)."""
    if not _RE_VALID_LABEL.match(label):
        raise VedaDBValidationError(
            f"invalid name {label!r} (allowed: letters, digits, '_', '-', length 1-64)"
        )


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class Result:
    """Result of a VedaQL query."""

    columns: list[str] | None
    rows: list[list[str]] | None
    row_count: int
    message: str = ""

    def to_dicts(self) -> list[dict[str, str]]:
        """Convert rows to list of dicts keyed by column name."""
        if not self.columns or not self.rows:
            return []
        return [dict(zip(self.columns, row)) for row in self.rows]

    def to_tuple(self) -> tuple:
        """Return (columns, rows, row_count, message) for unpacking."""
        return (self.columns, self.rows, self.row_count, self.message)


@dataclass
class HealthStatus:
    """Response from /v1/health."""

    status: str
    timestamp: str = ""
    raw: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Protocol / HTTP transport
# ---------------------------------------------------------------------------


class Protocol:
    """Low-level HTTP transport for the VedaDB REST API.

    Responsible for:
      - Building requests with proper headers & auth
      - Retry logic with exponential back-off
      - JSON encoding/decoding
      - Mapping HTTP status codes to typed exceptions
    """

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
        retry_on_rate_limit: bool = True,
    ):
        scheme = "https" if tls else "http"
        self._base_url = (base_url or f"{scheme}://{host}:{port}").rstrip("/")
        self._username = username
        self._password = password
        self._database = database
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_backoff_base = retry_backoff_base
        self._retry_max_backoff = retry_max_backoff
        self._retry_on_rate_limit = retry_on_rate_limit
        self._closed = False

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

        # Auth header cache
        self._auth_header: str | None = None
        if username and password:
            token = base64.b64encode(f"{username}:{password}".encode()).decode()
            self._auth_header = f"Bearer {token}"

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

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
    def timeout(self) -> float:
        return self._timeout

    @timeout.setter
    def timeout(self, value: float) -> None:
        self._timeout = value

    @property
    def closed(self) -> bool:
        return self._closed

    # ------------------------------------------------------------------
    # Request building
    # ------------------------------------------------------------------

    def _headers(self, content_type: bool = True) -> dict[str, str]:
        headers: dict[str, str] = {
            "Accept": "application/json",
            "Connection": "keep-alive",
            "X-Client-Library": f"vedadb-python/{__import__('vedadb').__version__}",
        }
        if content_type:
            headers["Content-Type"] = "application/json"
        if self._auth_header:
            headers["Authorization"] = self._auth_header
        if self._database:
            headers["X-VedaDB-Database"] = self._database
        return headers

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    # ------------------------------------------------------------------
    # Core request method
    # ------------------------------------------------------------------

    def request(
        self,
        method: str,
        path: str,
        payload: dict | list | None = None,
        *,
        extra_headers: dict[str, str] | None = None,
        _skip_retry: bool = False,
    ) -> dict:
        """Execute an HTTP request with retries and error translation.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE, PATCH).
            path: URL path (e.g. ``/v1/query``).
            payload: JSON-serializable body (optional).
            extra_headers: Additional headers to send.
            _skip_retry: If True, do not retry on failure.

        Returns:
            Parsed JSON response body.

        Raises:
            VedaDBConnectionError: On network-level failure.
            VedaDBAuthError: On 401/403.
            VedaDBRateLimitError: On 429.
            VedaDBQueryError: On 400 (query rejected).
            VedaDBTimeoutError: On timeout.
        """
        if self._closed:
            raise VedaDBConnectionError("protocol is closed")

        url = self._url(path)
        data: bytes | None = None
        if payload is not None:
            data = json.dumps(payload, default=str).encode("utf-8")

        headers = self._headers(content_type=payload is not None)
        if extra_headers:
            headers.update(extra_headers)

        max_attempts = 1 if _skip_retry else (1 + self._max_retries)
        last_error: Exception | None = None

        for attempt in range(max_attempts):
            request = urllib.request.Request(
                url,
                data=data,
                headers=headers,
                method=method.upper(),
            )
            try:
                response = urllib.request.urlopen(
                    request,
                    timeout=self._timeout,
                    context=self._ssl_ctx,
                )
                body = response.read()
                if not body:
                    return {}
                return json.loads(body.decode("utf-8"))

            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(body) if body else {}
                except json.JSONDecodeError:
                    parsed = {"error": body or exc.reason}

                error_msg = parsed.get("error", exc.reason or str(exc))

                if exc.code == 429:
                    retry_after = None
                    retry_header = exc.headers.get("Retry-After") if exc.headers else None
                    if retry_header:
                        try:
                            retry_after = float(retry_header)
                        except ValueError:
                            pass
                    if self._retry_on_rate_limit and attempt < max_attempts - 1:
                        backoff = retry_after or (self._retry_backoff_base * (2 ** attempt))
                        backoff = min(backoff, self._retry_max_backoff)
                        logger.warning("Rate limited (429), retrying in %.1fs: %s", backoff, error_msg)
                        time.sleep(backoff)
                        continue
                    raise VedaDBRateLimitError(
                        error_msg,
                        status_code=exc.code,
                        response_body=body,
                        retry_after=retry_after,
                    ) from exc

                if exc.code in (401, 403):
                    raise VedaDBAuthError(
                        error_msg, status_code=exc.code, response_body=body
                    ) from exc

                if exc.code == 400:
                    raise VedaDBQueryError(
                        error_msg, status_code=exc.code, response_body=body
                    ) from exc

                # 5xx — retry if configured
                if 500 <= exc.code < 600 and attempt < max_attempts - 1:
                    backoff = min(self._retry_backoff_base * (2 ** attempt), self._retry_max_backoff)
                    logger.warning("Server error %d, retrying in %.1fs: %s", exc.code, backoff, error_msg)
                    time.sleep(backoff)
                    continue

                raise VedaDBConnectionError(
                    f"HTTP {exc.code}: {error_msg}", status_code=exc.code, response_body=body
                ) from exc

            except urllib.error.URLError as exc:
                cause = exc.reason
                # Attempt to unwrap SSL/socket errors for clarity
                if hasattr(cause, "__str__"):
                    cause_str = str(cause)
                else:
                    cause_str = repr(cause)
                last_error = VedaDBConnectionError(cause_str)
                last_error.__cause__ = exc
                if attempt < max_attempts - 1:
                    backoff = min(self._retry_backoff_base * (2 ** attempt), self._retry_max_backoff)
                    logger.warning("Connection error, retrying in %.1fs: %s", backoff, cause_str)
                    time.sleep(backoff)
                    continue
                raise last_error

            except TimeoutError as exc:
                last_error = VedaDBTimeoutError(f"Request timed out after {self._timeout}s")
                last_error.__cause__ = exc
                if attempt < max_attempts - 1:
                    continue
                raise last_error

        # Should not reach here, but defensive
        raise last_error or VedaDBConnectionError("request failed after all retries")

    # ------------------------------------------------------------------
    # Convenience wrappers
    # ------------------------------------------------------------------

    def health(self) -> HealthStatus:
        """GET /v1/health"""
        raw = self.request("GET", "/v1/health", _skip_retry=True)
        return HealthStatus(
            status=raw.get("status", "unknown"),
            timestamp=raw.get("timestamp", ""),
            raw=raw,
        )

    def query(
        self,
        sql: str,
        *,
        database: str | None = None,
        params: list | None = None,
    ) -> Result:
        """POST /v1/query — execute a VedaQL statement.

        Args:
            sql: The VedaQL query string.
            database: Override the default database for this query.
            params: Server-side parameter values (replaces ``?`` placeholders).
        """
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

        data = self.request("POST", "/v1/query", payload)
        return Result(
            columns=data.get("columns"),
            rows=data.get("rows"),
            row_count=int(data.get("row_count", 0)),
            message=data.get("message", ""),
        )

    def batch(self, operations: list[dict]) -> list[dict]:
        """POST /v1/batch — execute multiple operations atomically.

        Each operation is a dict with ``method``, ``path``, and optional ``body``.
        """
        if not operations:
            raise VedaDBValidationError("operations list must not be empty")
        if len(operations) > 100:
            raise VedaDBValidationError("maximum 100 operations per batch")

        # Auto-scope database if not present in operation paths
        if self._database:
            scoped = []
            for op in operations:
                op = dict(op)
                path = op.get("path", "")
                if "database=" not in path and "?" not in path:
                    op["path"] = f"{path}?" + urllib.parse.urlencode({"database": self._database})
                elif "database=" not in path:
                    op["path"] = f"{path}&" + urllib.parse.urlencode({"database": self._database})
                scoped.append(op)
            operations = scoped

        data = self.request("POST", "/v1/batch", {"operations": operations})
        return data.get("results", [])

    def get_tables(self) -> list[dict]:
        """GET /v1/tables — list all tables."""
        data = self.request("GET", "/v1/tables")
        return data.get("tables", [])

    def describe_table(self, table: str) -> dict:
        """GET /v1/tables/{table} — describe a table's schema."""
        validate_identifier(table)
        return self.request("GET", f"/v1/tables/{urllib.parse.quote(table, safe='')}")

    def table_insert_row(self, table: str, row: dict) -> dict:
        """POST /v1/tables/{table}/rows — insert a row."""
        validate_identifier(table)
        return self.request(
            "POST",
            f"/v1/tables/{urllib.parse.quote(table, safe='')}/rows",
            row,
        )

    def table_get_rows(
        self,
        table: str,
        *,
        where: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        page: int | None = None,
        per_page: int | None = None,
    ) -> dict:
        """GET /v1/tables/{table}/rows — get rows with optional filtering/pagination."""
        validate_identifier(table)
        params: dict[str, str] = {}
        if where is not None:
            params["where"] = where
        if limit is not None:
            params["limit"] = str(limit)
        if offset is not None:
            params["offset"] = str(offset)
        if page is not None:
            params["page"] = str(page)
        if per_page is not None:
            params["per_page"] = str(per_page)
        if self._database and "database=" not in "":
            params["database"] = self._database

        qs = urllib.parse.urlencode(params) if params else ""
        path = f"/v1/tables/{urllib.parse.quote(table, safe='')}/rows"
        if qs:
            path += f"?{qs}"
        return self.request("GET", path)

    def table_delete_rows(self, table: str, where: str | None = None) -> dict:
        """DELETE /v1/tables/{table}/rows — delete rows."""
        validate_identifier(table)
        params: dict[str, str] = {}
        if where is not None:
            params["where"] = where
        qs = urllib.parse.urlencode(params) if params else ""
        path = f"/v1/tables/{urllib.parse.quote(table, safe='')}/rows"
        if qs:
            path += f"?{qs}"
        return self.request("DELETE", path)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def ping(self) -> bool:
        """Quick health check. Returns True if server responds OK."""
        try:
            return self.health().status == "ok"
        except VedaDBError:
            return False

    def close(self) -> None:
        """Mark the protocol as closed. No further requests are permitted."""
        self._closed = True

    def __enter__(self) -> Protocol:
        return self

    def __exit__(self, *exc) -> None:
        self.close()
