"""
VedaDB ORM — Transaction session.

A ``Session`` wraps a single pooled connection in a BEGIN / COMMIT / ROLLBACK
lifecycle.  It is used as a context manager::

    with orm.session() as s:
        User.create(name="Alice", session=s)
        Order.create(user_id=1, total=9.99, session=s)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from .exceptions import SessionError

if TYPE_CHECKING:
    from vedadb.client import VedaDB, Result
    from vedadb.pool import ConnectionPool


class Session:
    """Wraps a dedicated pool connection inside a transaction.

    Usage::

        session = Session(pool)
        with session:
            session.query("INSERT INTO ...")
    """

    def __init__(self, pool: "ConnectionPool") -> None:
        self._pool = pool
        self._conn: Optional["VedaDB"] = None
        self._active = False

    # -- context manager ----------------------------------------------------

    def __enter__(self) -> "Session":
        self._conn = self._pool.acquire()
        try:
            self._conn.query("BEGIN;")
        except Exception as exc:
            self._pool.release(self._conn)
            self._conn = None
            raise SessionError(f"Failed to BEGIN transaction: {exc}") from exc
        self._active = True
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._conn is None:
            return
        try:
            if exc_type is not None:
                self._conn.query("ROLLBACK;")
            else:
                self._conn.query("COMMIT;")
        except Exception as commit_exc:
            # Best-effort rollback on commit failure.
            try:
                self._conn.query("ROLLBACK;")
            except Exception:
                pass
            if exc_type is None:
                raise SessionError(
                    f"COMMIT failed, rolled back: {commit_exc}"
                ) from commit_exc
        finally:
            self._active = False
            self._pool.release(self._conn)
            self._conn = None

    # -- public API ---------------------------------------------------------

    def query(self, sql: str) -> "Result":
        """Execute a SQL statement within this transaction."""
        if not self._active or self._conn is None:
            raise SessionError("Session is not active — use it as a context manager")
        return self._conn.query(sql)

    @property
    def is_active(self) -> bool:
        return self._active
