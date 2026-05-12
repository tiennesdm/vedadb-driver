"""test_query_builder.py — Query builder tests for VedaDB Python driver."""
import pytest
from typing import List, Optional, Any, Dict


class QueryBuilder:
    """SQL query builder for VedaDB."""

    def __init__(self):
        self._table = ""
        self._columns: List[str] = []
        self._where: List[tuple] = []
        self._joins: List[tuple] = []
        self._order_by: List[tuple] = []
        self._group_by: List[str] = []
        self._limit: Optional[int] = None
        self._offset: Optional[int] = None
        self._params: List[Any] = []

    def table(self, name: str) -> 'QueryBuilder':
        self._table = name
        return self

    def select(self, *columns: str) -> 'QueryBuilder':
        self._columns = list(columns)
        return self

    def where(self, condition: str, *params: Any) -> 'QueryBuilder':
        self._where.append(("AND", condition))
        self._params.extend(params)
        return self

    def or_where(self, condition: str, *params: Any) -> 'QueryBuilder':
        self._where.append(("OR", condition))
        self._params.extend(params)
        return self

    def join(self, table: str, on: str) -> 'QueryBuilder':
        self._joins.append(("INNER", table, on))
        return self

    def left_join(self, table: str, on: str) -> 'QueryBuilder':
        self._joins.append(("LEFT", table, on))
        return self

    def right_join(self, table: str, on: str) -> 'QueryBuilder':
        self._joins.append(("RIGHT", table, on))
        return self

    def order_by(self, column: str, desc: bool = False) -> 'QueryBuilder':
        self._order_by.append((column, desc))
        return self

    def order_by_desc(self, column: str) -> 'QueryBuilder':
        return self.order_by(column, desc=True)

    def group_by(self, *columns: str) -> 'QueryBuilder':
        self._group_by.extend(columns)
        return self

    def limit(self, n: int) -> 'QueryBuilder':
        self._limit = n
        self._params.append(n)
        return self

    def offset(self, n: int) -> 'QueryBuilder':
        self._offset = n
        self._params.append(n)
        return self

    def build(self) -> tuple:
        parts = []

        # SELECT
        if self._columns:
            parts.append(f"SELECT {', '.join(self._columns)}")
        else:
            parts.append("SELECT *")

        # FROM
        parts.append(f"FROM {self._table}")

        # JOINS
        for join_type, table, on in self._joins:
            parts.append(f"{join_type} JOIN {table} ON {on}")

        # WHERE
        if self._where:
            where_clauses = []
            for i, (op, condition) in enumerate(self._where):
                if i == 0:
                    where_clauses.append(condition)
                else:
                    where_clauses.append(f"{op} {condition}")
            parts.append(f"WHERE {' '.join(where_clauses)}")

        # GROUP BY
        if self._group_by:
            parts.append(f"GROUP BY {', '.join(self._group_by)}")

        # ORDER BY
        if self._order_by:
            order_clauses = []
            for col, desc in self._order_by:
                order_clauses.append(f"{col} DESC" if desc else f"{col} ASC")
            parts.append(f"ORDER BY {', '.join(order_clauses)}")

        # LIMIT
        if self._limit is not None:
            parts.append("LIMIT ?")

        # OFFSET
        if self._offset is not None:
            parts.append("OFFSET ?")

        return " ".join(parts), list(self._params)


class TestQueryBuilder:
    """Test suite for query builder."""

    def test_select_all(self):
        """Test SELECT *."""
        qb = QueryBuilder().table("users")
        sql, params = qb.build()
        assert sql == "SELECT * FROM users"
        assert params == []

    def test_select_columns(self):
        """Test SELECT with specific columns."""
        qb = QueryBuilder().table("users").select("id", "name", "email")
        sql, params = qb.build()
        assert sql == "SELECT id, name, email FROM users"

    def test_single_where(self):
        """Test single WHERE clause."""
        qb = QueryBuilder().table("users").where("id = ?", 1)
        sql, params = qb.build()
        assert "WHERE id = ?" in sql
        assert params == [1]

    def test_multiple_where_and(self):
        """Test multiple WHERE with AND."""
        qb = QueryBuilder().table("users").where("age > ?", 18).where("active = ?", True)
        sql, params = qb.build()
        assert "AND" in sql
        assert params == [18, True]

    def test_or_where(self):
        """Test OR WHERE."""
        qb = QueryBuilder().table("users").where("role = ?", "admin").or_where("role = ?", "mod")
        sql, _ = qb.build()
        assert "OR" in sql

    def test_inner_join(self):
        """Test INNER JOIN."""
        qb = QueryBuilder().table("users").select("users.name", "orders.total")
        qb.join("orders", "users.id = orders.user_id")
        sql, _ = qb.build()
        assert "INNER JOIN orders" in sql
        assert "ON users.id = orders.user_id" in sql

    def test_left_join(self):
        """Test LEFT JOIN."""
        qb = QueryBuilder().table("users").left_join("profiles", "users.id = profiles.user_id")
        sql, _ = qb.build()
        assert "LEFT JOIN profiles" in sql

    def test_right_join(self):
        """Test RIGHT JOIN."""
        qb = QueryBuilder().table("orders").right_join("users", "orders.user_id = users.id")
        sql, _ = qb.build()
        assert "RIGHT JOIN users" in sql

    def test_order_by_asc(self):
        """Test ORDER BY ASC."""
        qb = QueryBuilder().table("users").order_by("name")
        sql, _ = qb.build()
        assert "ORDER BY name ASC" in sql

    def test_order_by_desc(self):
        """Test ORDER BY DESC."""
        qb = QueryBuilder().table("users").order_by_desc("created_at")
        sql, _ = qb.build()
        assert "ORDER BY created_at DESC" in sql

    def test_group_by(self):
        """Test GROUP BY."""
        qb = QueryBuilder().table("orders").group_by("status")
        sql, _ = qb.build()
        assert "GROUP BY status" in sql

    def test_limit(self):
        """Test LIMIT."""
        qb = QueryBuilder().table("users").limit(10)
        sql, params = qb.build()
        assert "LIMIT ?" in sql
        assert 10 in params

    def test_offset(self):
        """Test OFFSET."""
        qb = QueryBuilder().table("users").offset(20)
        sql, params = qb.build()
        assert "OFFSET ?" in sql
        assert 20 in params

    def test_limit_and_offset(self):
        """Test LIMIT and OFFSET together."""
        qb = QueryBuilder().table("users").limit(10).offset(20)
        sql, params = qb.build()
        assert "LIMIT ?" in sql
        assert "OFFSET ?" in sql
        assert params == [10, 20]

    def test_complex_query(self):
        """Test complex query with all features."""
        qb = QueryBuilder().table("users")
        qb.select("users.id", "users.name", "orders.total")
        qb.join("orders", "users.id = orders.user_id")
        qb.where("users.active = ?", True)
        qb.where("users.age >= ?", 18)
        qb.order_by_desc("orders.created_at")
        qb.limit(10)

        sql, params = qb.build()
        assert "SELECT" in sql
        assert "FROM users" in sql
        assert "INNER JOIN orders" in sql
        assert "WHERE" in sql
        assert "ORDER BY orders.created_at DESC" in sql
        assert "LIMIT ?" in sql
        assert params == [True, 18, 10]

    def test_chaining(self):
        """Test method chaining."""
        qb = QueryBuilder()
        result = qb.table("test").select("id").where("id = ?", 1)
        assert result is qb

    def test_multiple_joins(self):
        """Test multiple joins."""
        qb = QueryBuilder().table("users")
        qb.join("orders", "users.id = orders.user_id")
        qb.join("products", "orders.product_id = products.id")
        sql, _ = qb.build()
        assert sql.count("JOIN") == 2

    def test_multiple_order_by(self):
        """Test multiple ORDER BY columns."""
        qb = QueryBuilder().table("users")
        qb.order_by("status")
        qb.order_by_desc("created_at")
        sql, _ = qb.build()
        assert "status ASC" in sql
        assert "created_at DESC" in sql
