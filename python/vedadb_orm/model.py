"""
VedaDB ORM — BaseModel and ModelMeta metaclass.

Every user-defined model subclasses ``BaseModel`` and declares a
``__schema__`` attribute.  The metaclass wires up hooks, field metadata,
and binds the model to the ORM instance at registration time.
"""

from __future__ import annotations

from datetime import datetime
from typing import (
    Any,
    Callable,
    ClassVar,
    Dict,
    List,
    Optional,
    Set,
    Type,
    TYPE_CHECKING,
)

from .aggregation import AggregationBuilder
from .cache import CacheProxy
from .document import DocumentProxy
from .exceptions import QueryError, ValidationError
from .graph import GraphProxy
from .hooks import (
    HookContext,
    HookRegistry,
    HookType,
    SoftDeleteHook,
    TimestampHook,
    ValidationHook,
)
from .query import QueryBuilder
from .relationships import (
    BelongsTo,
    BelongsToMany,
    HasMany,
    HasOne,
    LazyRelation,
)
from .schema import Schema
from .search import SearchProxy
from .types import FieldType, cast_value, format_value
from .utils import camel_to_snake, format_where_value, pluralize
from .vector import VectorProxy

if TYPE_CHECKING:
    from .connection import VedaORM
    from .session import Session


# ---------------------------------------------------------------------------
# Metaclass
# ---------------------------------------------------------------------------

class ModelMeta(type):
    """Metaclass that processes ``__schema__`` on model classes and sets up
    internal bookkeeping attributes.
    """

    def __new__(
        mcs,
        name: str,
        bases: tuple,
        namespace: dict,
        **kwargs: Any,
    ) -> "ModelMeta":
        cls = super().__new__(mcs, name, bases, namespace)

        # Skip setup for BaseModel itself.
        if name == "BaseModel":
            return cls

        schema: Optional[Schema] = getattr(cls, "__schema__", None)
        if schema is None:
            # Allow abstract intermediate classes.
            return cls

        # Derive table name from schema.name (or from class name).
        cls._table_name = schema.name or pluralize(camel_to_snake(name))

        # Field metadata.
        cls._fields: Dict[str, Any] = dict(schema.fields)
        cls._pk: Optional[str] = None
        for fname, fdef in schema.fields.items():
            if fdef.primary_key:
                cls._pk = fname
                break

        # Hook registry.
        cls._hook_registry = HookRegistry()

        # Register built-in hooks based on schema flags.
        if schema.timestamps:
            cls._hook_registry.register(HookType.BEFORE_CREATE, TimestampHook.before_create)
            cls._hook_registry.register(HookType.BEFORE_UPDATE, TimestampHook.before_update)

        if schema.soft_delete:
            cls._hook_registry.register(HookType.BEFORE_DELETE, SoftDeleteHook.before_delete)

        # Validation hook runs for every model with validators.
        cls._hook_registry.register(HookType.BEFORE_VALIDATE, ValidationHook.before_validate)

        # Relationship attributes remain as-is (HasOne, HasMany, etc.) on the
        # class; they are resolved lazily on instances.

        return cls


# ---------------------------------------------------------------------------
# BaseModel
# ---------------------------------------------------------------------------

class BaseModel(metaclass=ModelMeta):
    """Base class for all VedaDB ORM models.

    Subclasses must define a ``__schema__`` class attribute.
    """

    __schema__: ClassVar[Optional[Schema]] = None

    # Set by the metaclass:
    _table_name: ClassVar[str] = ""
    _fields: ClassVar[Dict[str, Any]] = {}
    _pk: ClassVar[Optional[str]] = None
    _hook_registry: ClassVar[HookRegistry]

    # Set by VedaORM.register():
    _orm_ref: ClassVar[Optional["VedaORM"]] = None

    # -----------------------------------------------------------------------
    # Instance lifecycle
    # -----------------------------------------------------------------------

    def __init__(self, **kwargs: Any) -> None:
        object.__setattr__(self, "_data", {})
        object.__setattr__(self, "_dirty", set())
        object.__setattr__(self, "_is_new", True)

        # Populate from kwargs.
        for key, value in kwargs.items():
            self._data[key] = value

    def __getattr__(self, name: str) -> Any:
        data = object.__getattribute__(self, "_data")
        if name in data:
            val = data[name]
            # Auto-resolve lazy relations.
            if isinstance(val, LazyRelation):
                resolved = val.load()
                data[name] = resolved
                return resolved
            return val
        # Check for relationship descriptors on the class.
        cls_val = getattr(type(self), name, None)
        if isinstance(cls_val, (HasOne, HasMany, BelongsTo, BelongsToMany)):
            lazy = LazyRelation(cls_val, self)
            data[name] = lazy
            return lazy.load()
        raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")

    def __setattr__(self, name: str, value: Any) -> None:
        if name.startswith("_"):
            object.__setattr__(self, name, value)
        else:
            self._data[name] = value
            self._dirty.add(name)

    def __repr__(self) -> str:
        pk = self._data.get(self._pk, "?") if self._pk else "?"
        return f"<{type(self).__name__} {self._pk}={pk}>"

    # -----------------------------------------------------------------------
    # Instance methods
    # -----------------------------------------------------------------------

    def save(self, session: Optional["Session"] = None) -> None:
        """INSERT if new, UPDATE (dirty fields only) if existing."""
        orm = self._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")

        data = dict(self._data)

        if self._is_new:
            # Validation
            ctx = HookContext(model=type(self), instance=self, data=data)
            ctx = self._hook_registry.execute(HookType.BEFORE_VALIDATE, ctx)
            data = ctx.data or data

            # Before-create
            ctx = HookContext(model=type(self), instance=self, data=data)
            ctx = self._hook_registry.execute(HookType.BEFORE_CREATE, ctx)
            data = ctx.data or data

            # Build INSERT
            cols = ", ".join(data.keys())
            vals = ", ".join(self._format_field(k, v) for k, v in data.items())
            sql = f"INSERT INTO {self._table_name} ({cols}) VALUES ({vals});"

            if session:
                result = session.query(sql)
            else:
                result = orm.query(sql)

            # If the server returned an auto-generated id, capture it.
            if result.rows and result.columns:
                returned = dict(zip(result.columns, result.rows[0]))
                data.update(returned)

            self._data.update(data)
            object.__setattr__(self, "_is_new", False)
            object.__setattr__(self, "_dirty", set())

            # After-create
            ctx = HookContext(model=type(self), instance=self, data=data)
            self._hook_registry.execute(HookType.AFTER_CREATE, ctx)
        else:
            dirty_data = {k: self._data[k] for k in self._dirty if k in self._data}
            if not dirty_data:
                return

            # Validation
            ctx = HookContext(model=type(self), instance=self, data=dirty_data)
            ctx = self._hook_registry.execute(HookType.BEFORE_VALIDATE, ctx)
            dirty_data = ctx.data or dirty_data

            # Before-update
            ctx = HookContext(model=type(self), instance=self, data=dirty_data)
            ctx = self._hook_registry.execute(HookType.BEFORE_UPDATE, ctx)
            dirty_data = ctx.data or dirty_data

            set_clause = ", ".join(
                f"{k} = {self._format_field(k, v)}" for k, v in dirty_data.items()
            )
            pk_val = self._data.get(self._pk)
            if pk_val is None:
                raise QueryError("Cannot update a model without a primary key value")

            sql = (
                f"UPDATE {self._table_name} SET {set_clause} "
                f"WHERE {self._pk} = {format_where_value(pk_val)};"
            )

            if session:
                session.query(sql)
            else:
                orm.query(sql)

            self._data.update(dirty_data)
            object.__setattr__(self, "_dirty", set())

            # After-update
            ctx = HookContext(model=type(self), instance=self, data=dirty_data)
            self._hook_registry.execute(HookType.AFTER_UPDATE, ctx)

    def delete(self, session: Optional["Session"] = None) -> None:
        """DELETE the row (or soft-delete if configured)."""
        orm = self._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")

        ctx = HookContext(model=type(self), instance=self, data={})
        ctx = self._hook_registry.execute(HookType.BEFORE_DELETE, ctx)

        pk_val = self._data.get(self._pk)
        if pk_val is None:
            raise QueryError("Cannot delete a model without a primary key value")

        if ctx.data and ctx.data.get("_soft_delete"):
            ts = ctx.data.get("deleted_at", datetime.utcnow().isoformat())
            sql = (
                f"UPDATE {self._table_name} SET deleted_at = '{ts}' "
                f"WHERE {self._pk} = {format_where_value(pk_val)};"
            )
        else:
            sql = (
                f"DELETE FROM {self._table_name} "
                f"WHERE {self._pk} = {format_where_value(pk_val)};"
            )

        if session:
            session.query(sql)
        else:
            orm.query(sql)

        ctx = HookContext(model=type(self), instance=self, data=self._data)
        self._hook_registry.execute(HookType.AFTER_DELETE, ctx)

    def reload(self) -> None:
        """Re-fetch the current row from the database."""
        orm = self._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")

        pk_val = self._data.get(self._pk)
        if pk_val is None:
            raise QueryError("Cannot reload without a primary key value")

        sql = (
            f"SELECT * FROM {self._table_name} "
            f"WHERE {self._pk} = {format_where_value(pk_val)};"
        )
        result = orm.query(sql)
        if not result.rows:
            raise QueryError(f"Row not found for {self._pk}={pk_val}")

        new_data = dict(zip(result.columns, result.rows[0]))
        self._data.clear()
        self._data.update(self._cast_row(new_data))
        object.__setattr__(self, "_dirty", set())
        object.__setattr__(self, "_is_new", False)

    def to_dict(self) -> Dict[str, Any]:
        """Return a plain dict of the instance's data."""
        out: Dict[str, Any] = {}
        for k, v in self._data.items():
            if isinstance(v, BaseModel):
                out[k] = v.to_dict()
            elif isinstance(v, list) and v and isinstance(v[0], BaseModel):
                out[k] = [item.to_dict() for item in v]
            elif isinstance(v, LazyRelation):
                continue  # Don't auto-trigger lazy loads in serialization.
            else:
                out[k] = v
        return out

    # -----------------------------------------------------------------------
    # Class methods — CRUD
    # -----------------------------------------------------------------------

    @classmethod
    def create(cls, session: Optional["Session"] = None, **kwargs: Any) -> "BaseModel":
        """Create and persist a new instance."""
        instance = cls(**kwargs)
        instance.save(session=session)
        return instance

    @classmethod
    def create_many(
        cls,
        items: List[Dict[str, Any]],
        session: Optional["Session"] = None,
    ) -> List["BaseModel"]:
        """Batch-create multiple instances."""
        instances = []
        for data in items:
            inst = cls.create(session=session, **data)
            instances.append(inst)
        return instances

    @classmethod
    def find_by_id(cls, id: Any, session: Optional["Session"] = None) -> Optional["BaseModel"]:
        """Find a single record by primary key."""
        if cls._pk is None:
            raise QueryError("Model has no primary key defined")

        orm = cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")

        sql = (
            f"SELECT * FROM {cls._table_name} "
            f"WHERE {cls._pk} = {format_where_value(id)};"
        )
        result = session.query(sql) if session else orm.query(sql)
        if not result.rows:
            return None
        return cls._from_row(result.columns, result.rows[0])

    @classmethod
    def find_one(cls, session: Optional["Session"] = None, **kwargs: Any) -> Optional["BaseModel"]:
        """Find the first record matching the given filters."""
        qb = cls.where()
        for k, v in kwargs.items():
            qb = qb.where(k, "=", v)
        if session:
            qb = qb.use_session(session)
        return qb.first()

    @classmethod
    def find_many(cls, session: Optional["Session"] = None, **kwargs: Any) -> List["BaseModel"]:
        """Find all records matching the given filters."""
        qb = cls.where()
        for k, v in kwargs.items():
            qb = qb.where(k, "=", v)
        if session:
            qb = qb.use_session(session)
        return qb.all()

    @classmethod
    def update_one(
        cls,
        where: Dict[str, Any],
        set_values: Dict[str, Any],
        session: Optional["Session"] = None,
    ) -> None:
        """Update a single matching row."""
        orm = cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")

        set_clause = ", ".join(
            f"{k} = {format_where_value(v)}" for k, v in set_values.items()
        )
        where_clause = " AND ".join(
            f"{k} = {format_where_value(v)}" for k, v in where.items()
        )
        sql = f"UPDATE {cls._table_name} SET {set_clause} WHERE {where_clause};"
        if session:
            session.query(sql)
        else:
            orm.query(sql)

    @classmethod
    def update_many(
        cls,
        where: Dict[str, Any],
        set_values: Dict[str, Any],
        session: Optional["Session"] = None,
    ) -> None:
        """Update all matching rows."""
        cls.update_one(where, set_values, session=session)

    @classmethod
    def delete_one(cls, session: Optional["Session"] = None, **where: Any) -> None:
        """Delete a single matching row."""
        orm = cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")

        where_clause = " AND ".join(
            f"{k} = {format_where_value(v)}" for k, v in where.items()
        )
        sql = f"DELETE FROM {cls._table_name} WHERE {where_clause};"
        if session:
            session.query(sql)
        else:
            orm.query(sql)

    @classmethod
    def delete_many(cls, session: Optional["Session"] = None, **where: Any) -> None:
        """Delete all matching rows."""
        cls.delete_one(session=session, **where)

    @classmethod
    def count(cls, session: Optional["Session"] = None, **where: Any) -> int:
        """Count rows matching the filters."""
        qb = cls.where()
        for k, v in where.items():
            qb = qb.where(k, "=", v)
        if session:
            qb = qb.use_session(session)
        return qb.count()

    @classmethod
    def exists(cls, session: Optional["Session"] = None, **where: Any) -> bool:
        """Return True if at least one matching row exists."""
        return cls.count(session=session, **where) > 0

    # -----------------------------------------------------------------------
    # Class methods — builders
    # -----------------------------------------------------------------------

    @classmethod
    def where(cls, field: Optional[str] = None, op: str = "=", value: Any = None, **kwargs: Any) -> QueryBuilder:
        """Return a fresh ``QueryBuilder`` optionally seeded with a condition."""
        qb = QueryBuilder(cls)
        if field is not None and value is not None:
            qb = qb.where(field, op, value)
        if kwargs:
            qb = qb.where("", **kwargs)
        return qb

    @classmethod
    def aggregate(cls) -> AggregationBuilder:
        """Return a fresh ``AggregationBuilder`` for this model."""
        return AggregationBuilder(cls)

    # -----------------------------------------------------------------------
    # Class methods — engine proxies
    # -----------------------------------------------------------------------

    @classmethod
    def cache_proxy(cls) -> CacheProxy:
        return CacheProxy(cls)

    @classmethod
    def search_proxy(cls, query: str, fuzzy: int = 0) -> SearchProxy:
        return SearchProxy(cls, query, fuzzy)

    @classmethod
    def vector_search(
        cls,
        embedding: List[float],
        top_k: int = 10,
        metric: Optional[str] = None,
    ) -> VectorProxy:
        return VectorProxy(cls, embedding, top_k, metric)

    @classmethod
    def graph_proxy(cls) -> GraphProxy:
        return GraphProxy(cls)

    @classmethod
    def doc_proxy(cls) -> DocumentProxy:
        return DocumentProxy(cls)

    # -----------------------------------------------------------------------
    # Hook decorator
    # -----------------------------------------------------------------------

    @classmethod
    def hook(cls, event: HookType) -> Callable:
        """Decorator to register a lifecycle hook::

            @User.hook(HookType.BEFORE_CREATE)
            def hash_password(ctx):
                ctx.data['password'] = bcrypt.hash(ctx.data['password'])
                return ctx
        """
        def decorator(fn: Callable) -> Callable:
            cls._hook_registry.register(event, fn)
            return fn
        return decorator

    # -----------------------------------------------------------------------
    # Hydration helpers
    # -----------------------------------------------------------------------

    @classmethod
    def _from_row(cls, columns: List[str], row: list) -> "BaseModel":
        """Create a model instance from a result row."""
        data = dict(zip(columns, row))
        data = cls._cast_row(data)
        inst = cls.__new__(cls)
        object.__setattr__(inst, "_data", data)
        object.__setattr__(inst, "_dirty", set())
        object.__setattr__(inst, "_is_new", False)
        return inst

    @classmethod
    def _cast_row(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """Cast raw row values to their declared Python types."""
        schema = getattr(cls, "__schema__", None)
        if schema is None:
            return data
        casted: Dict[str, Any] = {}
        for key, value in data.items():
            field_def = schema.fields.get(key)
            if field_def is not None:
                casted[key] = cast_value(value, field_def.type)
            else:
                casted[key] = value
        return casted

    @classmethod
    def _get_orm(cls) -> Optional["VedaORM"]:
        return cls._orm_ref

    # -----------------------------------------------------------------------
    # Value formatting helper
    # -----------------------------------------------------------------------

    def _format_field(self, field_name: str, value: Any) -> str:
        """Format a field value for SQL."""
        schema = getattr(type(self), "__schema__", None)
        if schema and field_name in schema.fields:
            return format_value(value, schema.fields[field_name].type)
        return format_where_value(value)
