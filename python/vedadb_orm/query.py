"""
VedaDB ORM — QueryBuilder.

Provides an immutable, chainable query API.  Every mutating method returns
a shallow clone so that the original builder can be reused safely.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

from .exceptions import QueryError
from .utils import format_where_value

if TYPE_CHECKING:
    from .model import BaseModel
    from .session import Session


# ---------------------------------------------------------------------------
# Operator mapping for Django-style lookups  (field__gt=25)
# ---------------------------------------------------------------------------

_LOOKUP_OPS: Dict[str, str] = {
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "ne": "!=",
    "like": "LIKE",
    "ilike": "ILIKE",
    "in": "IN",
    "not_in": "NOT IN",
    "is_null": "IS NULL",
    "is_not_null": "IS NOT NULL",
    "between": "BETWEEN",
}


class QueryBuilder:
    """Immutable, chainable SQL builder bound to a model class."""

    def __init__(self, model_cls: type) -> None:
        self._model_cls = model_cls
        self._select_fields: List[str] = []
        self._where_clauses: List[str] = []
        self._or_where_clauses: List[str] = []
        self._order_clauses: List[str] = []
        self._limit_val: Optional[int] = None
        self._offset_val: Optional[int] = None
        self._includes: List[str] = []
        self._cache_ttl: Optional[int] = None
        self._session: Optional["Session"] = None

    # -- cloning ------------------------------------------------------------

    def _clone(self) -> "QueryBuilder":
        """Return a shallow copy of this builder."""
        new = QueryBuilder.__new__(QueryBuilder)
        new._model_cls = self._model_cls
        new._select_fields = list(self._select_fields)
        new._where_clauses = list(self._where_clauses)
        new._or_where_clauses = list(self._or_where_clauses)
        new._order_clauses = list(self._order_clauses)
        new._limit_val = self._limit_val
        new._offset_val = self._offset_val
        new._includes = list(self._includes)
        new._cache_ttl = self._cache_ttl
        new._session = self._session
        return new

    # -- chainable predicates -----------------------------------------------

    def where(self, field: str, op: str = "=", value: Any = None, **kwargs: Any) -> "QueryBuilder":
        """Add an AND condition.  Also accepts Django-style keyword args::

            User.where(age__gt=25, name__like="A%")
        """
        clone = self._clone()

        # Positional style: where("age", ">", 25)
        if value is not None or op != "=":
            clause = self._make_clause(field, op, value)
            clone._where_clauses.append(clause)

        # Django-style kwargs
        for key, val in kwargs.items():
            parts = key.split("__")
            if len(parts) == 2:
                f, lookup = parts
                sql_op = _LOOKUP_OPS.get(lookup, "=")
                clause = self._make_clause(f, sql_op, val)
            else:
                clause = self._make_clause(key, "=", val)
            clone._where_clauses.append(clause)

        # If only field given with no op/value/kwargs, treat as field = <nothing>
        # — let caller use further chaining.
        if value is None and op == "=" and not kwargs:
            pass  # no clause added

        return clone

    def or_where(self, field: str, op: str = "=", value: Any = None) -> "QueryBuilder":
        clone = self._clone()
        clone._or_where_clauses.append(self._make_clause(field, op, value))
        return clone

    def where_in(self, field: str, values: List[Any]) -> "QueryBuilder":
        clone = self._clone()
        formatted = ", ".join(format_where_value(v) for v in values)
        clone._where_clauses.append(f"{field} IN ({formatted})")
        return clone

    def where_not_in(self, field: str, values: List[Any]) -> "QueryBuilder":
        clone = self._clone()
        formatted = ", ".join(format_where_value(v) for v in values)
        clone._where_clauses.append(f"{field} NOT IN ({formatted})")
        return clone

    def where_null(self, field: str) -> "QueryBuilder":
        clone = self._clone()
        clone._where_clauses.append(f"{field} IS NULL")
        return clone

    def where_not_null(self, field: str) -> "QueryBuilder":
        clone = self._clone()
        clone._where_clauses.append(f"{field} IS NOT NULL")
        return clone

    def where_between(self, field: str, low: Any, high: Any) -> "QueryBuilder":
        clone = self._clone()
        clone._where_clauses.append(
            f"{field} BETWEEN {format_where_value(low)} AND {format_where_value(high)}"
        )
        return clone

    def where_like(self, field: str, pattern: str) -> "QueryBuilder":
        clone = self._clone()
        escaped = pattern.replace("'", "''")
        clone._where_clauses.append(f"{field} LIKE '{escaped}'")
        return clone

    # -- projection / ordering / paging -------------------------------------

    def select(self, *fields: str) -> "QueryBuilder":
        clone = self._clone()
        clone._select_fields = list(fields)
        return clone

    def order_by(self, field: str, direction: str = "ASC") -> "QueryBuilder":
        clone = self._clone()
        direction = direction.upper()
        if direction not in ("ASC", "DESC"):
            direction = "ASC"
        clone._order_clauses.append(f"{field} {direction}")
        return clone

    def limit(self, n: int) -> "QueryBuilder":
        clone = self._clone()
        clone._limit_val = n
        return clone

    def offset(self, n: int) -> "QueryBuilder":
        clone = self._clone()
        clone._offset_val = n
        return clone

    # -- eager loading / caching -------------------------------------------

    def include(self, *relations: str) -> "QueryBuilder":
        clone = self._clone()
        clone._includes.extend(relations)
        return clone

    def cache(self, ttl: int) -> "QueryBuilder":
        clone = self._clone()
        clone._cache_ttl = ttl
        return clone

    def use_session(self, session: "Session") -> "QueryBuilder":
        clone = self._clone()
        clone._session = session
        return clone

    # -- terminal methods ---------------------------------------------------

    def all(self) -> List[Any]:
        """Execute the query and return a list of model instances."""
        result = self._execute()
        instances = [
            self._model_cls._from_row(result.columns, row)
            for row in result.rows
        ]
        # Eager-load requested relations.
        if self._includes:
            from .population import PopulationResolver
            PopulationResolver.eager_load(instances, self._includes)
        return instances

    def first(self) -> Optional[Any]:
        """Return the first matching instance or ``None``."""
        limited = self.limit(1)
        results = limited.all()
        return results[0] if results else None

    def count(self) -> int:
        """Return the count of matching rows."""
        sql = self._build_count_sql()
        result = self._run_sql(sql)
        if result.rows and result.rows[0]:
            return int(result.rows[0][0])
        return 0

    def exists(self) -> bool:
        """Return ``True`` if at least one row matches."""
        return self.count() > 0

    def to_sql(self) -> str:
        """Return the generated SQL without executing it."""
        return self._build_sql()

    # -- SQL generation -----------------------------------------------------

    def _build_sql(self) -> str:
        table = self._model_cls._table_name
        cols = ", ".join(self._select_fields) if self._select_fields else "*"
        sql = f"SELECT {cols} FROM {table}"
        sql += self._build_where()
        if self._order_clauses:
            sql += " ORDER BY " + ", ".join(self._order_clauses)
        if self._limit_val is not None:
            sql += f" LIMIT {self._limit_val}"
        if self._offset_val is not None:
            sql += f" OFFSET {self._offset_val}"
        return sql + ";"

    def _build_count_sql(self) -> str:
        table = self._model_cls._table_name
        sql = f"SELECT COUNT(*) FROM {table}"
        sql += self._build_where()
        return sql + ";"

    def _build_where(self) -> str:
        parts: List[str] = []
        if self._where_clauses:
            parts.append(" AND ".join(self._where_clauses))
        if self._or_where_clauses:
            if parts:
                parts.append("OR " + " OR ".join(self._or_where_clauses))
            else:
                parts.append(" OR ".join(self._or_where_clauses))

        # Soft-delete filter: exclude deleted rows unless the model opts out.
        schema = getattr(self._model_cls, "__schema__", None)
        if schema and schema.soft_delete:
            parts.append("deleted_at IS NULL")

        if not parts:
            return ""
        return " WHERE " + " AND ".join(parts)

    # -- execution ----------------------------------------------------------

    def _execute(self) -> Any:
        sql = self._build_sql()
        return self._run_sql(sql)

    def _run_sql(self, sql: str) -> Any:
        if self._session is not None:
            return self._session.query(sql)
        orm = self._model_cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")
        return orm.query(sql)

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _make_clause(field: str, op: str, value: Any) -> str:
        op = op.strip().upper()
        if op in ("IS NULL", "IS NOT NULL"):
            return f"{field} {op}"
        if op == "IN" or op == "NOT IN":
            if isinstance(value, (list, tuple)):
                formatted = ", ".join(format_where_value(v) for v in value)
                return f"{field} {op} ({formatted})"
            return f"{field} {op} ({format_where_value(value)})"
        if op == "BETWEEN":
            if isinstance(value, (list, tuple)) and len(value) == 2:
                return (
                    f"{field} BETWEEN {format_where_value(value[0])} "
                    f"AND {format_where_value(value[1])}"
                )
        return f"{field} {op} {format_where_value(value)}"
