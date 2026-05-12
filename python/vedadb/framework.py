"""
Web framework integrations for VedaDB.

Provides ready-to-use integrations for:
- **Django**: Database backend and connection management
- **FastAPI**: Dependency injection for request-scoped connections
- **Flask**: Extension for application-bound connections

Example — FastAPI::

    from fastapi import FastAPI, Depends
    from vedadb.framework import FastAPIVedaDB

    veda = FastAPIVedaDB(host="localhost", username="admin", password="secret")
    app = FastAPI()

    @app.get("/users")
    def list_users(db=Depends(veda)):
        return db.query("SELECT * FROM users").to_dicts()

Example — Django settings::

    DATABASES = {
        "default": {
            "ENGINE": "vedadb.framework.django_backend",
            "HOST": "localhost",
            "PORT": 7480,
            "USER": "admin",
            "PASSWORD": "secret",
            "NAME": "mydb",
        }
    }
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Callable, Dict, Generator, Optional

logger = logging.getLogger("vedadb.framework")


# ---------------------------------------------------------------------------
# FastAPI Integration
# ---------------------------------------------------------------------------

class FastAPIVedaDB:
    """FastAPI dependency injection helper for VedaDB.

    Provides a ``Depends``-compatible callable that yields a database
    connection for each request.

    Args:
        host: Server hostname.
        port: Server port.
        username: Auth username.
        password: Auth password.
        database: Default database.
        pool: Optional shared :class:`ConnectionPool` to use.

    Example::

        veda = FastAPIVedaDB(host="localhost", username="admin", password="secret")
        app = FastAPI()

        @app.get("/users")
        def list_users(db=Depends(veda)):
            return db.query("SELECT * FROM users").to_dicts()

        @app.post("/users")
        def create_user(data: dict, db=Depends(veda)):
            return db.insert("users", data)
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 8080,
        username: str | None = None,
        password: str | None = None,
        database: str | None = None,
        pool: Any | None = None,
        **kwargs: Any,
    ):
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._database = database
        self._pool = pool
        self._kwargs = kwargs
        self._client: Any | None = None

    def _get_client(self) -> Any:
        """Get or create the underlying client."""
        if self._pool:
            return self._pool
        if self._client is None:
            from .driver import connect
            self._client = connect(
                host=self._host,
                port=self._port,
                username=self._username,
                password=self._password,
                database=self._database,
                **self._kwargs,
            )
        return self._client

    def __call__(self) -> Generator[Any, None, None]:
        """Yield a connection for FastAPI Depends."""
        if self._pool:
            with self._pool.connection() as conn:
                yield conn
        else:
            client = self._get_client()
            yield client

    def query(self, sql: str, **kwargs: Any) -> Any:
        """Execute a query on the underlying client."""
        client = self._get_client()
        return client.query(sql, **kwargs)

    def close(self) -> None:
        """Close the underlying client if one was created."""
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None

    def __repr__(self) -> str:
        return f"<FastAPIVedaDB host={self._host!r} port={self._port}>"


# ---------------------------------------------------------------------------
# Flask Extension
# ---------------------------------------------------------------------------

class FlaskVedaDB:
    """Flask extension for VedaDB integration.

    Binds a VedaDB client to the Flask application context.

    Args:
        app: Flask app (or call ``init_app`` later).
        host: Server hostname.
        port: Server port.
        username: Auth username.
        password: Auth password.
        database: Default database.

    Example::

        from flask import Flask, g
        from vedadb.framework import FlaskVedaDB

        app = Flask(__name__)
        veda = FlaskVedaDB(app, host="localhost", username="admin", password="secret")

        @app.route("/users")
        def list_users():
            return veda.db.query("SELECT * FROM users").to_dicts()
    """

    def __init__(
        self,
        app: Any | None = None,
        host: str = "localhost",
        port: int = 8080,
        username: str | None = None,
        password: str | None = None,
        database: str | None = None,
        **kwargs: Any,
    ):
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._database = database
        self._kwargs = kwargs

        if app is not None:
            self.init_app(app)

    def init_app(self, app: Any) -> None:
        """Initialize the extension with a Flask app."""
        app.extensions = getattr(app, "extensions", {})
        app.extensions["vedadb"] = self

        @app.before_request
        def open_connection() -> None:
            from flask import g
            from .driver import connect
            g.vedadb = connect(
                host=self._host,
                port=self._port,
                username=self._username,
                password=self._password,
                database=self._database,
                **self._kwargs,
            )

        @app.teardown_appcontext
        def close_connection(exc: Any) -> None:
            from flask import g
            db = getattr(g, "vedadb", None)
            if db is not None:
                try:
                    db.close()
                except Exception:
                    pass

    @property
    def db(self) -> Any:
        """Access the current request's database connection."""
        try:
            from flask import g
            return g.vedadb
        except ImportError:
            raise RuntimeError("Flask is not installed or not in an app context")

    def __repr__(self) -> str:
        return f"<FlaskVedaDB host={self._host!r} port={self._port}>"


# ---------------------------------------------------------------------------
# Django Backend
# ---------------------------------------------------------------------------

class DjangoVedaDBBackend:
    """Django database backend for VedaDB.

    Implements the Django database backend interface for read-only
    queries (Django ORM compatibility layer).

    To use, add to Django settings::

        DATABASES = {
            "default": {
                "ENGINE": "vedadb.framework.DjangoVedaDBBackend",
                "HOST": "localhost",
                "PORT": 7480,
                "USER": "admin",
                "PASSWORD": "secret",
                "NAME": "mydb",
            }
        }

    Args:
        settings_dict: Django DATABASES configuration dict.
    """

    display_name = "VedaDB"
    vendor = "vedadb"

    def __init__(self, settings_dict: dict):
        self.settings = settings_dict
        self.host = settings_dict.get("HOST", "localhost")
        self.port = settings_dict.get("PORT", 8080)
        self.username = settings_dict.get("USER")
        self.password = settings_dict.get("PASSWORD")
        self.database = settings_dict.get("NAME")
        self.options = settings_dict.get("OPTIONS", {})
        self._client: Any | None = None

    def get_new_connection(self, conn_params: dict) -> Any:
        """Create a new connection."""
        from .driver import connect
        self._client = connect(
            host=self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            database=self.database,
            **self.options,
        )
        return self._client

    def ensure_connection(self) -> None:
        """Ensure a connection is available."""
        if self._client is None:
            self.get_new_connection({})

    def cursor(self) -> Any:
        """Return a cursor-like object."""
        self.ensure_connection()
        return DjangoCursorWrapper(self._client)

    def close(self) -> None:
        """Close the connection."""
        if self._client:
            self._client.close()
            self._client = None

    def __repr__(self) -> str:
        return f"<DjangoVedaDBBackend host={self.host!r} db={self.database!r}>"


class DjangoCursorWrapper:
    """Cursor wrapper that presents a DB-API 2.0 interface."""

    def __init__(self, client: Any):
        self._client = client
        self._last_result: Any | None = None
        self._row_idx = 0

    def execute(self, sql: str, params: tuple | None = None) -> None:
        """Execute a query."""
        if params:
            # Convert ? placeholders to params
            self._last_result = self._client.query(sql, params=list(params))
        else:
            self._last_result = self._client.query(sql)
        self._row_idx = 0

    def fetchone(self) -> tuple | None:
        """Fetch the next row."""
        if not self._last_result or not self._last_result.rows:
            return None
        if self._row_idx >= len(self._last_result.rows):
            return None
        row = self._last_result.rows[self._row_idx]
        self._row_idx += 1
        return tuple(row)

    def fetchall(self) -> list[tuple]:
        """Fetch all remaining rows."""
        if not self._last_result or not self._last_result.rows:
            return []
        rows = self._last_result.rows[self._row_idx:]
        self._row_idx = len(self._last_result.rows)
        return [tuple(r) for r in rows]

    def close(self) -> None:
        """Close the cursor."""
        self._last_result = None

    @property
    def description(self) -> list[tuple] | None:
        """Return column descriptions."""
        if not self._last_result or not self._last_result.columns:
            return None
        return [(col, None, None, None, None, None, None) for col in self._last_result.columns]

    def __repr__(self) -> str:
        return f"<DjangoCursorWrapper rows={len(self._last_result.rows) if self._last_result else 0}>"


# ---------------------------------------------------------------------------
# ASGI Middleware
# ---------------------------------------------------------------------------

class VedaDBMiddleware:
    """ASGI middleware that adds a VedaDB connection to the scope.

    Usage with any ASGI framework (Starlette, FastAPI, etc.)::

        from vedadb.framework import VedaDBMiddleware

        app = VedaDBMiddleware(app, host="localhost", username="admin", password="secret")

        # In a handler:
        db = request.scope["vedadb"]
    """

    def __init__(
        self,
        app: Any,
        host: str = "localhost",
        port: int = 8080,
        username: str | None = None,
        password: str | None = None,
        database: str | None = None,
        pool: Any | None = None,
        **kwargs: Any,
    ):
        self._app = app
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._database = database
        self._pool = pool
        self._kwargs = kwargs

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        """ASGI entry point."""
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        if self._pool:
            with self._pool.connection() as conn:
                scope["vedadb"] = conn
                await self._app(scope, receive, send)
        else:
            from .driver import connect
            db = connect(
                host=self._host,
                port=self._port,
                username=self._username,
                password=self._password,
                database=self._database,
                **self._kwargs,
            )
            try:
                scope["vedadb"] = db
                await self._app(scope, receive, send)
            finally:
                db.close()

    def __repr__(self) -> str:
        return f"<VedaDBMiddleware host={self._host!r} port={self._port}>"
