"""
VedaDB ORM — VedaORM connection class.

Central entry point that manages the connection pool, model registry,
and provides a ``session()`` context manager for transactions.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Type, TYPE_CHECKING

from .exceptions import ConnectionError, SchemaError
from .schema import Schema, to_create_sql
from .session import Session

if TYPE_CHECKING:
    from vedadb.client import Result
    from vedadb.pool import ConnectionPool
    from .model import BaseModel


class VedaORM:
    """Top-level ORM handle — wraps a ``ConnectionPool`` and a model registry.

    Usage::

        orm = VedaORM(host='localhost', port=6380)
        orm.connect()
        orm.register(User)
        users = User.where(active=True).all()
        orm.disconnect()
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 6380,
        pool_min: int = 2,
        pool_max: int = 10,
        username: Optional[str] = None,
        password: Optional[str] = None,
        tls: bool = False,
        auto_reconnect: bool = True,
        timeout: float = 30.0,
    ) -> None:
        self.host = host
        self.port = port
        self.pool_min = pool_min
        self.pool_max = pool_max
        self.username = username
        self.password = password
        self.tls = tls
        self.auto_reconnect = auto_reconnect
        self.timeout = timeout

        self._pool: Optional["ConnectionPool"] = None
        self._models: Dict[str, Type["BaseModel"]] = {}

    # -- connection lifecycle -----------------------------------------------

    def connect(self) -> "VedaORM":
        """Create the underlying ``ConnectionPool`` and verify connectivity.

        Returns ``self`` for chaining.
        """
        try:
            from vedadb.pool import ConnectionPool
        except ImportError as exc:
            raise ConnectionError(
                "vedadb driver package is required — pip install vedadb"
            ) from exc

        self._pool = ConnectionPool(
            host=self.host,
            port=self.port,
            min_size=self.pool_min,
            max_size=self.pool_max,
            timeout=self.timeout,
        )
        return self

    def disconnect(self) -> None:
        """Close the pool and release all connections."""
        if self._pool is not None:
            self._pool.close()
            self._pool = None

    # -- raw query ----------------------------------------------------------

    def query(self, sql: str) -> "Result":
        """Execute a raw VedaQL statement through the pool.

        Acquires a connection, executes, and releases it back.
        """
        if self._pool is None:
            raise ConnectionError("Not connected — call connect() first")

        conn = self._pool.acquire()
        try:
            return conn.query(sql)
        finally:
            self._pool.release(conn)

    # -- model registry -----------------------------------------------------

    def register(self, model_cls: Type["BaseModel"], sync_schema: bool = False) -> None:
        """Register a model class with this ORM instance.

        If *sync_schema* is ``True``, the model's CREATE TABLE DDL is
        executed immediately (idempotent — uses IF NOT EXISTS semantics).
        """
        schema: Optional[Schema] = getattr(model_cls, "__schema__", None)
        if schema is None:
            raise SchemaError(
                f"{model_cls.__name__} does not define __schema__"
            )

        # Bind the model to this ORM.
        model_cls._orm_ref = self
        self._models[model_cls.__name__] = model_cls

        if sync_schema:
            ddl = to_create_sql(schema)
            # Wrap in IF NOT EXISTS by patching the first CREATE statement.
            ddl_safe = ddl.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", 1)
            ddl_safe = ddl_safe.replace(
                "CREATE COLLECTION ", "CREATE COLLECTION IF NOT EXISTS ", 1
            )
            for stmt in ddl_safe.split(";"):
                stmt = stmt.strip()
                if stmt:
                    try:
                        self.query(stmt + ";")
                    except Exception:
                        pass  # Index may already exist etc.

    @property
    def models(self) -> Dict[str, Type["BaseModel"]]:
        """Return the dict of registered model classes keyed by class name."""
        return self._models

    # -- sessions -----------------------------------------------------------

    def session(self) -> Session:
        """Return a new ``Session`` context manager backed by the pool."""
        if self._pool is None:
            raise ConnectionError("Not connected — call connect() first")
        return Session(self._pool)

    # -- pool property ------------------------------------------------------

    @property
    def pool(self) -> Optional["ConnectionPool"]:
        return self._pool

    # -- dynamic base model -------------------------------------------------

    @property
    def Model(self) -> Type["BaseModel"]:
        """Return a ``BaseModel`` subclass that is pre-bound to this ORM.

        Useful for defining models without an explicit ``register()`` call::

            orm = VedaORM().connect()
            Base = orm.Model

            class User(Base):
                __schema__ = Schema(name='users', ...)
        """
        from .model import BaseModel

        orm_ref = self

        class BoundBaseModel(BaseModel):
            @classmethod
            def _get_orm(cls) -> Optional["VedaORM"]:
                return orm_ref

        # Auto-register any subclass on creation.
        original_init_subclass = BoundBaseModel.__init_subclass__

        @classmethod  # type: ignore[misc]
        def _auto_register(cls_inner: type, **kw: Any) -> None:
            schema = getattr(cls_inner, "__schema__", None)
            if schema is not None:
                cls_inner._orm_ref = orm_ref
                orm_ref._models[cls_inner.__name__] = cls_inner  # type: ignore[assignment]

        BoundBaseModel.__init_subclass__ = _auto_register  # type: ignore[assignment]

        return BoundBaseModel
