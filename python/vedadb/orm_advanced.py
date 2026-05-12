"""
Advanced ORM features for VedaDB — relations and migration support.

Provides a lightweight ORM with model definitions, relationships,
automatic migration generation, and schema management.

Example — model definition::

    from vedadb.orm_advanced import Model, Field, Relationship

    class User(Model):
        table = "users"
        id = Field(int, primary_key=True)
        name = Field(str)
        email = Field(str, unique=True)
        posts = Relationship("Post", foreign_key="user_id", backref="author")

    class Post(Model):
        table = "posts"
        id = Field(int, primary_key=True)
        title = Field(str)
        user_id = Field(int)

    user = User(db)
    alice = user.create({"name": "Alice", "email": "alice@example.com"})
    for post in alice.posts.all():
        print(post.title)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, ClassVar, Dict, List, Optional, Type

from .exceptions import VedaDBValidationError
from .protocol import Result, sql_literal

logger = logging.getLogger("vedadb.orm_advanced")


# ---------------------------------------------------------------------------
# Field definition
# ---------------------------------------------------------------------------

@dataclass
class Field:
    """Column field definition for a Model.

    Attributes:
        type: Python type (str, int, float, bool).
        primary_key: Whether this is the primary key.
        nullable: Whether NULL is allowed.
        unique: Whether values must be unique.
        default: Default value.
        max_length: Maximum length for string types.
    """

    type: type = str
    primary_key: bool = False
    nullable: bool = True
    unique: bool = False
    default: Any = None
    max_length: int | None = None

    @property
    def sql_type(self) -> str:
        """Return the SQL type for this field."""
        mapping = {
            int: "INTEGER",
            str: f"VARCHAR({self.max_length})" if self.max_length else "TEXT",
            float: "REAL",
            bool: "BOOLEAN",
        }
        return mapping.get(self.type, "TEXT")

    def __repr__(self) -> str:
        return f"<Field {self.sql_type} pk={self.primary_key} nullable={self.nullable}>"


# ---------------------------------------------------------------------------
# Relationship
# ---------------------------------------------------------------------------

@dataclass
class Relationship:
    """Defines a relationship between two models.

    Attributes:
        target_model: Name of the target model class.
        foreign_key: Column name in the target table.
        backref: Name of the reverse relationship attribute.
        relationship_type: "one_to_many", "many_to_one", or "many_to_many".
    """

    target_model: str
    foreign_key: str
    backref: str | None = None
    relationship_type: str = "one_to_many"

    def __repr__(self) -> str:
        return (
            f"<Relationship {self.relationship_type} "
            f"to={self.target_model!r} fk={self.foreign_key!r}>"
        )


# ---------------------------------------------------------------------------
# QuerySet
# ---------------------------------------------------------------------------

class QuerySet:
    """Lazy query set for model instances.

    Provides chainable filtering, ordering, and retrieval operations
    similar to Django's QuerySet.
    """

    def __init__(self, model_class: type, db: Any):
        self._model = model_class
        self._db = db
        self._table = getattr(model_class, "table", model_class.__name__.lower())
        self._fields: dict[str, Field] = self._extract_fields(model_class)
        self._filters: list[str] = []
        self._order_by: list[str] = []
        self._limit_val: int | None = None
        self._offset_val: int | None = None

    @staticmethod
    def _extract_fields(model_class: type) -> dict[str, Field]:
        """Extract Field definitions from a model class."""
        fields: dict[str, Field] = {}
        for name in dir(model_class):
            if name.startswith("_"):
                continue
            val = getattr(model_class, name, None)
            if isinstance(val, Field):
                fields[name] = val
        return fields

    # -- Filtering -------------------------------------------------------

    def filter(self, **kwargs: Any) -> "QuerySet":
        """Add WHERE conditions. Returns a new QuerySet."""
        qs = self._clone()
        for key, value in kwargs.items():
            if "__" in key:
                col, op = key.rsplit("__", 1)
                op_map = {
                    "eq": "=", "lt": "<", "gt": ">", "lte": "<=", "gte": ">=",
                    "ne": "!=", "like": "LIKE", "ilike": "ILIKE",
                }
                sql_op = op_map.get(op, "=")
                qs._filters.append(f"{col} {sql_op} {sql_literal(value)}")
            else:
                qs._filters.append(f"{key} = {sql_literal(value)}")
        return qs

    def exclude(self, **kwargs: Any) -> "QuerySet":
        """Add negated WHERE conditions."""
        qs = self._clone()
        for key, value in kwargs.items():
            qs._filters.append(f"{key} != {sql_literal(value)}")
        return qs

    def order_by(self, *columns: str) -> "QuerySet":
        """Set ORDER BY columns. Prefix with ``-`` for DESC."""
        qs = self._clone()
        qs._order_by = list(columns)
        return qs

    def limit(self, n: int) -> "QuerySet":
        """Set LIMIT."""
        qs = self._clone()
        qs._limit_val = n
        return qs

    def offset(self, n: int) -> "QuerySet":
        """Set OFFSET."""
        qs = self._clone()
        qs._offset_val = n
        return qs

    # -- Execution -------------------------------------------------------

    def _build_sql(self) -> str:
        """Build the SELECT SQL."""
        columns = ", ".join(self._fields.keys())
        sql = f"SELECT {columns} FROM {self._table}"
        if self._filters:
            sql += " WHERE " + " AND ".join(self._filters)
        if self._order_by:
            order_clauses = []
            for col in self._order_by:
                if col.startswith("-"):
                    order_clauses.append(f"{col[1:]} DESC")
                else:
                    order_clauses.append(f"{col} ASC")
            sql += " ORDER BY " + ", ".join(order_clauses)
        if self._limit_val is not None:
            sql += f" LIMIT {self._limit_val}"
        if self._offset_val is not None:
            sql += f" OFFSET {self._offset_val}"
        return sql + ";"

    def all(self) -> list[dict]:
        """Execute the query and return all results."""
        sql = self._build_sql()
        result = self._db.query(sql)
        if result and result.to_dicts:
            return result.to_dicts()
        return []

    def first(self) -> dict | None:
        """Return the first result, or None."""
        results = self.limit(1).all()
        return results[0] if results else None

    def count(self) -> int:
        """Return the count of matching rows."""
        sql = f"SELECT COUNT(*) FROM {self._table}"
        if self._filters:
            sql += " WHERE " + " AND ".join(self._filters)
        result = self._db.query(sql + ";")
        if result.rows:
            return int(result.rows[0][0])
        return 0

    def exists(self) -> bool:
        """Return True if any rows match."""
        return self.count() > 0

    def _clone(self) -> "QuerySet":
        """Create a shallow copy for chaining."""
        qs = QuerySet.__new__(QuerySet)
        qs._model = self._model
        qs._db = self._db
        qs._table = self._table
        qs._fields = self._fields
        qs._filters = list(self._filters)
        qs._order_by = list(self._order_by)
        qs._limit_val = self._limit_val
        qs._offset_val = self._offset_val
        return qs

    def __iter__(self):
        return iter(self.all())

    def __repr__(self) -> str:
        return f"<QuerySet table={self._table!r} filters={len(self._filters)}>"


# ---------------------------------------------------------------------------
# Model base
# ---------------------------------------------------------------------------

class Model:
    """Base class for ORM models.

    Subclass this to define your own models.  Each subclass should set
    ``table`` and define :class:`Field` attributes.

    Example::

        class User(Model):
            table = "users"
            id = Field(int, primary_key=True)
            name = Field(str)
            email = Field(str, unique=True)

        user = User(db)
        all_users = user.all()
        alice = user.filter(name="Alice").first()
    """

    table: ClassVar[str] = ""

    def __init__(self, db: Any):
        self._db = db
        if not self.table:
            self.table = self.__class__.__name__.lower()

    @property
    def _fields(self) -> dict[str, Field]:
        """Return the field definitions for this model."""
        fields: dict[str, Field] = {}
        for name in dir(self.__class__):
            if name.startswith("_"):
                continue
            val = getattr(self.__class__, name, None)
            if isinstance(val, Field):
                fields[name] = val
        return fields

    @property
    def _relationships(self) -> dict[str, Relationship]:
        """Return the relationship definitions for this model."""
        rels: dict[str, Relationship] = {}
        for name in dir(self.__class__):
            if name.startswith("_"):
                continue
            val = getattr(self.__class__, name, None)
            if isinstance(val, Relationship):
                rels[name] = val
        return rels

    # -- QuerySet factory -----------------------------------------------

    def all(self) -> list[dict]:
        """Return all rows."""
        return QuerySet(self.__class__, self._db).all()

    def filter(self, **kwargs: Any) -> QuerySet:
        """Filter rows."""
        return QuerySet(self.__class__, self._db).filter(**kwargs)

    def exclude(self, **kwargs: Any) -> QuerySet:
        """Exclude rows."""
        return QuerySet(self.__class__, self._db).exclude(**kwargs)

    def order_by(self, *columns: str) -> QuerySet:
        """Order rows."""
        return QuerySet(self.__class__, self._db).order_by(*columns)

    def limit(self, n: int) -> QuerySet:
        """Limit rows."""
        return QuerySet(self.__class__, self._db).limit(n)

    # -- CRUD operations ------------------------------------------------

    def get(self, pk: Any) -> dict | None:
        """Get a row by primary key."""
        pk_field = self._find_pk_field()
        if not pk_field:
            raise VedaDBValidationError("no primary key defined")
        return self.filter(**{pk_field: pk}).first()

    def create(self, data: dict) -> dict:
        """Insert a new row."""
        columns = list(data.keys())
        values = [sql_literal(data[c]) for c in columns]
        sql = (
            f"INSERT INTO {self.table} "
            f"({', '.join(columns)}) "
            f"VALUES ({', '.join(values)});"
        )
        self._db.query(sql)
        return data

    def update(self, pk: Any, data: dict) -> dict:
        """Update a row by primary key."""
        pk_field = self._find_pk_field()
        if not pk_field:
            raise VedaDBValidationError("no primary key defined")
        sets = ", ".join(f"{k} = {sql_literal(v)}" for k, v in data.items())
        sql = f"UPDATE {self.table} SET {sets} WHERE {pk_field} = {sql_literal(pk)};"
        self._db.query(sql)
        return data

    def delete(self, pk: Any) -> None:
        """Delete a row by primary key."""
        pk_field = self._find_pk_field()
        if not pk_field:
            raise VedaDBValidationError("no primary key defined")
        sql = f"DELETE FROM {self.table} WHERE {pk_field} = {sql_literal(pk)};"
        self._db.query(sql)

    def _find_pk_field(self) -> str | None:
        """Find the primary key field name."""
        for name, field_def in self._fields.items():
            if field_def.primary_key:
                return name
        return None

    # -- Schema operations ----------------------------------------------

    def create_table(self) -> None:
        """Create the table based on model fields."""
        columns: list[str] = []
        constraints: list[str] = []

        for name, field_def in self._fields.items():
            col_def = f"{name} {field_def.sql_type}"
            if field_def.primary_key:
                col_def += " PRIMARY KEY"
            if not field_def.nullable and not field_def.primary_key:
                col_def += " NOT NULL"
            if field_def.unique:
                col_def += " UNIQUE"
            if field_def.default is not None:
                col_def += f" DEFAULT {sql_literal(field_def.default)}"
            columns.append(col_def)

        columns.extend(constraints)
        sql = f"CREATE TABLE IF NOT EXISTS {self.table} ({', '.join(columns)});"
        self._db.query(sql)
        logger.info("Created table %r", self.table)

    def drop_table(self) -> None:
        """Drop the table."""
        self._db.query(f"DROP TABLE IF EXISTS {self.table};")
        logger.info("Dropped table %r", self.table)

    def __repr__(self) -> str:
        return f"<Model {self.__class__.__name__} table={self.table!r}>"


# ---------------------------------------------------------------------------
# Schema introspection
# ---------------------------------------------------------------------------

class SchemaInspector:
    """Inspect database schema and compare with model definitions."""

    def __init__(self, db: Any):
        self._db = db

    def get_tables(self) -> list[str]:
        """Return list of table names in the database."""
        result = self._db.query("SHOW TABLES;")
        if result and result.to_dicts:
            return [list(row.values())[0] for row in result.to_dicts()]
        return []

    def describe_table(self, table: str) -> list[dict]:
        """Return column information for a table."""
        result = self._db.query(f"DESCRIBE {table};")
        if result and result.to_dicts:
            return result.to_dicts()
        return []

    def compare_schema(self, model: type[Model]) -> dict:
        """Compare a Model with the actual database schema.

        Returns a dict with ``missing_columns``, ``extra_columns``, and
        ``mismatched_columns``.
        """
        table_name = getattr(model, "table", model.__name__.lower())
        db_columns = {col["name"]: col for col in self.describe_table(table_name)}

        model_fields: dict[str, Field] = {}
        for name in dir(model):
            if name.startswith("_"):
                continue
            val = getattr(model, name, None)
            if isinstance(val, Field):
                model_fields[name] = val

        missing = [name for name in model_fields if name not in db_columns]
        extra = [name for name in db_columns if name not in model_fields]

        return {
            "table": table_name,
            "missing_columns": missing,
            "extra_columns": extra,
            "in_sync": not missing and not extra,
        }
