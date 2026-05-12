"""
Fluent query builder for VedaDB — MongoDB-style query construction.

Provides a chainable API for building SELECT, INSERT, UPDATE, and DELETE
queries without writing raw SQL.

Example — SELECT::

    result = db.table("users").where("age", ">", 18).order_by("name").limit(10).get()

Example — INSERT::

    result = db.table("users").insert({"name": "Alice", "email": "alice@example.com"})

Example — UPDATE::

    result = db.table("users").where("id", "=", 42).update({"name": "Bob"})

Example — DELETE::

    result = db.table("users").where("active", "=", False).delete()

Example — raw SQL::

    sql = db.table("users").select("name", "email").where("age", ">", 18).to_sql()
    print(sql)  # SELECT name, email FROM users WHERE age > 18
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple, Union

from .exceptions import VedaDBQueryError, VedaDBValidationError
from .protocol import Result, sql_literal

logger = logging.getLogger("vedadb.query_builder")

# Valid SQL identifier pattern
_RE_IDENTIFIER = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

# Valid comparison operators
_VALID_OPS = {
    "=", "!=", "<>", "<", ">", "<=", ">=",
    "LIKE", "NOT LIKE", "ILIKE", "NOT ILIKE",
    "IN", "NOT IN", "IS", "IS NOT",
    "BETWEEN", "NOT BETWEEN",
}


def _validate_identifier(name: str) -> None:
    """Validate a SQL identifier."""
    if not _RE_IDENTIFIER.match(name):
        raise VedaDBValidationError(f"invalid SQL identifier: {name!r}")


def _validate_operator(op: str) -> None:
    """Validate a comparison operator."""
    if op.upper() not in _VALID_OPS:
        raise VedaDBValidationError(f"invalid operator: {op!r}")


class QueryBuilder:
    """MongoDB-style fluent query builder for VedaDB.

    Provides a chainable API for constructing SQL queries.  The builder
    accumulates clauses and compiles them to SQL when :meth:`get`,
    :meth:`insert`, :meth:`update`, :meth:`delete`, or :meth:`to_sql`
    is called.

    Args:
        client: A :class:`VedaDB` or compatible client with a
            ``query(sql)`` method.

    Example::

        result = (
            db.table("users")
            .select("name", "email")
            .where("age", ">", 18)
            .and_where("active", "=", True)
            .order_by("name")
            .limit(10)
            .get()
        )
    """

    def __init__(self, client: Any):
        self._client = client
        self._table: str | None = None
        self._columns: list[str] = ["*"]
        self._wheres: list[tuple] = []
        self._joins: list[str] = []
        self._group_by: list[str] = []
        self._havings: list[tuple] = []
        self._order_by: list[tuple] = []
        self._limit_val: int | None = None
        self._offset_val: int | None = None
        self._distinct_flag: bool = False
        self._for_update_flag: bool = False

    # ------------------------------------------------------------------
    # Builder methods
    # ------------------------------------------------------------------

    def table(self, table: str) -> "QueryBuilder":
        """Set the target table.

        Args:
            table: Table name.

        Returns:
            Self for chaining.
        """
        _validate_identifier(table)
        self._table = table
        return self

    def select(self, *columns: str) -> "QueryBuilder":
        """Set the columns to select (default: ``*``).

        Args:
            *columns: Column names.

        Returns:
            Self for chaining.
        """
        if columns:
            for col in columns:
                if col != "*":
                    _validate_identifier(col)
            self._columns = list(columns)
        return self

    def distinct(self) -> "QueryBuilder":
        """Add DISTINCT to the SELECT."""
        self._distinct_flag = True
        return self

    def where(self, column: str, op: str, value: Any) -> "QueryBuilder":
        """Add a WHERE condition.

        Args:
            column: Column name.
            op: Comparison operator (``=``, ``!=``, ``<``, ``>``, ``<=``,
                ``>=``, ``LIKE``, ``IN``, etc.).
            value: Value to compare against.

        Returns:
            Self for chaining.
        """
        _validate_identifier(column)
        _validate_operator(op)
        self._wheres.append(("AND", column, op.upper(), value))
        return self

    def and_where(self, column: str, op: str, value: Any) -> "QueryBuilder":
        """Alias for :meth:`where`."""
        return self.where(column, op, value)

    def or_where(self, column: str, op: str, value: Any) -> "QueryBuilder":
        """Add an OR WHERE condition.

        Args:
            column: Column name.
            op: Comparison operator.
            value: Value to compare against.

        Returns:
            Self for chaining.
        """
        _validate_identifier(column)
        _validate_operator(op)
        self._wheres.append(("OR", column, op.upper(), value))
        return self

    def where_in(self, column: str, values: list) -> "QueryBuilder":
        """Add a WHERE ... IN (...) condition.

        Args:
            column: Column name.
            values: List of values.

        Returns:
            Self for chaining.
        """
        _validate_identifier(column)
        self._wheres.append(("AND", column, "IN", values))
        return self

    def where_null(self, column: str) -> "QueryBuilder":
        """Add a WHERE ... IS NULL condition."""
        _validate_identifier(column)
        self._wheres.append(("AND", column, "IS", "NULL"))
        return self

    def where_not_null(self, column: str) -> "QueryBuilder":
        """Add a WHERE ... IS NOT NULL condition."""
        _validate_identifier(column)
        self._wheres.append(("AND", column, "IS NOT", "NULL"))
        return self

    def where_between(self, column: str, low: Any, high: Any) -> "QueryBuilder":
        """Add a WHERE ... BETWEEN condition."""
        _validate_identifier(column)
        self._wheres.append(("AND", column, "BETWEEN", (low, high)))
        return self

    def join(
        self, table: str, on: str, join_type: str = "INNER"
    ) -> "QueryBuilder":
        """Add a JOIN clause.

        Args:
            table: Table to join.
            on: Join condition (e.g. ``"users.id = orders.user_id"``).
            join_type: JOIN type (INNER, LEFT, RIGHT, FULL).

        Returns:
            Self for chaining.
        """
        _validate_identifier(table)
        join_type = join_type.upper()
        if join_type not in ("INNER", "LEFT", "RIGHT", "FULL", "CROSS"):
            raise VedaDBValidationError(f"invalid join type: {join_type!r}")
        self._joins.append(f"{join_type} JOIN {table} ON {on}")
        return self

    def left_join(self, table: str, on: str) -> "QueryBuilder":
        """Add a LEFT JOIN."""
        return self.join(table, on, "LEFT")

    def right_join(self, table: str, on: str) -> "QueryBuilder":
        """Add a RIGHT JOIN."""
        return self.join(table, on, "RIGHT")

    def group_by(self, *columns: str) -> "QueryBuilder":
        """Add GROUP BY clause."""
        for col in columns:
            _validate_identifier(col)
        self._group_by.extend(columns)
        return self

    def having(self, column: str, op: str, value: Any) -> "QueryBuilder":
        """Add a HAVING condition."""
        _validate_identifier(column)
        _validate_operator(op)
        self._havings.append(("AND", column, op.upper(), value))
        return self

    def order_by(self, column: str, direction: str = "ASC") -> "QueryBuilder":
        """Add an ORDER BY clause.

        Args:
            column: Column to order by.
            direction: ``"ASC"`` or ``"DESC"``.

        Returns:
            Self for chaining.
        """
        _validate_identifier(column)
        direction = direction.upper()
        if direction not in ("ASC", "DESC"):
            raise VedaDBValidationError(f"order direction must be ASC or DESC, got {direction!r}")
        self._order_by.append((column, direction))
        return self

    def limit(self, n: int) -> "QueryBuilder":
        """Set the LIMIT."""
        if n < 0:
            raise VedaDBValidationError("limit must be >= 0")
        self._limit_val = n
        return self

    def offset(self, n: int) -> "QueryBuilder":
        """Set the OFFSET."""
        if n < 0:
            raise VedaDBValidationError("offset must be >= 0")
        self._offset_val = n
        return self

    def for_update(self) -> "QueryBuilder":
        """Add FOR UPDATE (row-level locking hint)."""
        self._for_update_flag = True
        return self

    # ------------------------------------------------------------------
    # SQL compilation
    # ------------------------------------------------------------------

    def to_sql(self) -> str:
        """Compile the query to a SQL string.

        Returns:
            The generated SQL.

        Raises:
            VedaDBValidationError: If the query is invalid (no table, etc.).
        """
        if not self._table:
            raise VedaDBValidationError("no table specified — call .table(name) first")

        parts: list[str] = ["SELECT"]

        if self._distinct_flag:
            parts.append("DISTINCT")

        parts.append(", ".join(self._columns))
        parts.append("FROM")
        parts.append(self._table)

        for join in self._joins:
            parts.append(join)

        if self._wheres:
            parts.append(self._build_where())

        if self._group_by:
            parts.append("GROUP BY")
            parts.append(", ".join(self._group_by))

        if self._havings:
            parts.append(self._build_having())

        if self._order_by:
            clauses = [f"{col} {dir}" for col, dir in self._order_by]
            parts.append("ORDER BY")
            parts.append(", ".join(clauses))

        if self._limit_val is not None:
            parts.append(f"LIMIT {self._limit_val}")

        if self._offset_val is not None:
            parts.append(f"OFFSET {self._offset_val}")

        if self._for_update_flag:
            parts.append("FOR UPDATE")

        return " ".join(parts) + ";"

    def _build_where(self) -> str:
        """Build the WHERE clause."""
        clauses: list[str] = []
        for i, (logic, col, op, value) in enumerate(self._wheres):
            prefix = f" {logic} " if i > 0 else ""
            if op in ("IN", "NOT IN") and isinstance(value, (list, tuple)):
                vals = ", ".join(sql_literal(v) for v in value)
                clauses.append(f"{prefix}{col} {op} ({vals})")
            elif op in ("IS", "IS NOT") and value == "NULL":
                clauses.append(f"{prefix}{col} {op} NULL")
            elif op == "BETWEEN" and isinstance(value, (tuple, list)) and len(value) == 2:
                clauses.append(f"{prefix}{col} BETWEEN {sql_literal(value[0])} AND {sql_literal(value[1])}")
            else:
                clauses.append(f"{prefix}{col} {op} {sql_literal(value)}")
        return "WHERE " + "".join(clauses)

    def _build_having(self) -> str:
        """Build the HAVING clause."""
        clauses: list[str] = []
        for i, (logic, col, op, value) in enumerate(self._havings):
            prefix = f" {logic} " if i > 0 else ""
            clauses.append(f"{prefix}{col} {op} {sql_literal(value)}")
        return "HAVING " + "".join(clauses)

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def get(self) -> Result:
        """Execute the built SELECT query and return results.

        Returns:
            :class:`Result` from the query.
        """
        sql = self.to_sql()
        logger.debug("QueryBuilder executing: %s", sql[:200])
        result = self._client.query(sql)
        self._reset_select_state()
        return result

    def count(self) -> int:
        """Execute a COUNT query and return the count."""
        saved_columns = self._columns
        self._columns = ["COUNT(*)"]
        sql = self.to_sql()
        self._columns = saved_columns

        result = self._client.query(sql)
        if result.rows and len(result.rows[0]) > 0:
            return int(result.rows[0][0])
        return 0

    def insert(self, data: dict) -> Result:
        """Execute an INSERT with the given data.

        Args:
            data: Dict of column-name → value mappings.

        Returns:
            :class:`Result` from the INSERT.
        """
        if not self._table:
            raise VedaDBValidationError("no table specified")
        if not data:
            raise VedaDBValidationError("insert data must not be empty")

        columns = list(data.keys())
        for col in columns:
            _validate_identifier(col)
        values = [sql_literal(data[c]) for c in columns]

        sql = (
            f"INSERT INTO {self._table} "
            f"({', '.join(columns)}) "
            f"VALUES ({', '.join(values)});"
        )
        logger.debug("QueryBuilder INSERT: %s", sql[:200])
        return self._client.query(sql)

    def update(self, data: dict) -> Result:
        """Execute an UPDATE with the given data.

        Only rows matching the accumulated WHERE clauses are updated.

        Args:
            data: Dict of column-name → new value mappings.

        Returns:
            :class:`Result` from the UPDATE.
        """
        if not self._table:
            raise VedaDBValidationError("no table specified")
        if not data:
            raise VedaDBValidationError("update data must not be empty")

        for col in data:
            _validate_identifier(col)

        sets = ", ".join(f"{k} = {sql_literal(v)}" for k, v in data.items())
        sql = f"UPDATE {self._table} SET {sets}"

        if self._wheres:
            sql += " " + self._build_where()
        else:
            logger.warning("UPDATE without WHERE clause — all rows will be updated")

        sql += ";"
        logger.debug("QueryBuilder UPDATE: %s", sql[:200])
        result = self._client.query(sql)
        self._reset_select_state()
        return result

    def delete(self) -> Result:
        """Execute a DELETE.

        Only rows matching the accumulated WHERE clauses are deleted.

        Returns:
            :class:`Result` from the DELETE.
        """
        if not self._table:
            raise VedaDBValidationError("no table specified")

        sql = f"DELETE FROM {self._table}"

        if self._wheres:
            sql += " " + self._build_where()
        else:
            logger.warning("DELETE without WHERE clause — all rows will be deleted")

        sql += ";"
        logger.debug("QueryBuilder DELETE: %s", sql[:200])
        result = self._client.query(sql)
        self._reset_select_state()
        return result

    def exists(self) -> bool:
        """Return True if any rows match the query."""
        saved_columns = self._columns
        saved_limit = self._limit_val
        self._columns = ["1"]
        self._limit_val = 1
        sql = self.to_sql()
        self._columns = saved_columns
        self._limit_val = saved_limit

        result = self._client.query(sql)
        return bool(result.rows)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _reset_select_state(self) -> None:
        """Reset only the SELECT-specific state (columns, order, limit, etc.).

        Table and WHERE are preserved for subsequent operations.
        """
        self._columns = ["*"]
        self._order_by = []
        self._limit_val = None
        self._offset_val = None
        self._distinct_flag = False
        self._for_update_flag = False

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    def clone(self) -> "QueryBuilder":
        """Create a copy of this query builder with the same state."""
        qb = QueryBuilder(self._client)
        qb._table = self._table
        qb._columns = list(self._columns)
        qb._wheres = list(self._wheres)
        qb._joins = list(self._joins)
        qb._group_by = list(self._group_by)
        qb._havings = list(self._havings)
        qb._order_by = list(self._order_by)
        qb._limit_val = self._limit_val
        qb._offset_val = self._offset_val
        qb._distinct_flag = self._distinct_flag
        return qb

    def __repr__(self) -> str:
        return f"<QueryBuilder table={self._table!r} wheres={len(self._wheres)}>"
