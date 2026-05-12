"""
VedaDB ORM — AggregationBuilder.

Provides a fluent API for GROUP BY / HAVING / aggregate-function queries.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TYPE_CHECKING

from .exceptions import QueryError
from .utils import format_where_value

if TYPE_CHECKING:
    from .session import Session


class AggregationBuilder:
    """Fluent builder for aggregate queries (COUNT, SUM, AVG, etc.)."""

    def __init__(self, model_cls: type) -> None:
        self._model_cls = model_cls
        self._group_fields: List[str] = []
        self._having_clauses: List[str] = []
        self._aggregates: List[str] = []
        self._where_clauses: List[str] = []
        self._order_clauses: List[str] = []
        self._limit_val: Optional[int] = None
        self._session: Optional["Session"] = None

    # -- grouping -----------------------------------------------------------

    def group_by(self, *fields: str) -> "AggregationBuilder":
        self._group_fields.extend(fields)
        return self

    def having(self, field: str, op: str, value: Any) -> "AggregationBuilder":
        self._having_clauses.append(f"{field} {op} {format_where_value(value)}")
        return self

    # -- aggregate functions ------------------------------------------------

    def count(self, field: str = "*", alias: Optional[str] = None) -> "AggregationBuilder":
        alias = alias or f"count_{field}".replace("*", "all")
        self._aggregates.append(f"COUNT({field}) AS {alias}")
        return self

    def sum(self, field: str, alias: Optional[str] = None) -> "AggregationBuilder":
        alias = alias or f"sum_{field}"
        self._aggregates.append(f"SUM({field}) AS {alias}")
        return self

    def avg(self, field: str, alias: Optional[str] = None) -> "AggregationBuilder":
        alias = alias or f"avg_{field}"
        self._aggregates.append(f"AVG({field}) AS {alias}")
        return self

    def min(self, field: str, alias: Optional[str] = None) -> "AggregationBuilder":
        alias = alias or f"min_{field}"
        self._aggregates.append(f"MIN({field}) AS {alias}")
        return self

    def max(self, field: str, alias: Optional[str] = None) -> "AggregationBuilder":
        alias = alias or f"max_{field}"
        self._aggregates.append(f"MAX({field}) AS {alias}")
        return self

    # -- filtering / ordering / paging --------------------------------------

    def where(self, **conditions: Any) -> "AggregationBuilder":
        for key, val in conditions.items():
            self._where_clauses.append(f"{key} = {format_where_value(val)}")
        return self

    def order_by(self, field: str, direction: str = "ASC") -> "AggregationBuilder":
        direction = direction.upper()
        if direction not in ("ASC", "DESC"):
            direction = "ASC"
        self._order_clauses.append(f"{field} {direction}")
        return self

    def limit(self, n: int) -> "AggregationBuilder":
        self._limit_val = n
        return self

    def use_session(self, session: "Session") -> "AggregationBuilder":
        self._session = session
        return self

    # -- terminal -----------------------------------------------------------

    def exec(self) -> List[Dict[str, Any]]:
        """Execute the aggregation and return a list of dicts."""
        sql = self.to_sql()
        result = self._run_sql(sql)
        return [dict(zip(result.columns, row)) for row in result.rows]

    def to_sql(self) -> str:
        """Generate the SQL string without executing it."""
        table = self._model_cls._table_name
        select_parts: List[str] = list(self._group_fields) + self._aggregates
        if not select_parts:
            select_parts = ["*"]

        sql = f"SELECT {', '.join(select_parts)} FROM {table}"

        if self._where_clauses:
            sql += " WHERE " + " AND ".join(self._where_clauses)

        if self._group_fields:
            sql += " GROUP BY " + ", ".join(self._group_fields)

        if self._having_clauses:
            sql += " HAVING " + " AND ".join(self._having_clauses)

        if self._order_clauses:
            sql += " ORDER BY " + ", ".join(self._order_clauses)

        if self._limit_val is not None:
            sql += f" LIMIT {self._limit_val}"

        return sql + ";"

    # -- internal -----------------------------------------------------------

    def _run_sql(self, sql: str) -> Any:
        if self._session is not None:
            return self._session.query(sql)
        orm = self._model_cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")
        return orm.query(sql)
