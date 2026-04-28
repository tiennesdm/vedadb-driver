"""
VedaDB ORM — CacheProxy.

Thin convenience layer on top of VedaDB's native CACHE commands, scoped
to a model class.
"""

from __future__ import annotations

import json
from typing import Any, Optional, TYPE_CHECKING

from .exceptions import QueryError

if TYPE_CHECKING:
    from .query import QueryBuilder


class CacheProxy:
    """Model-scoped cache operations using VedaDB's CACHE engine."""

    def __init__(self, model_cls: type) -> None:
        self._model_cls = model_cls
        self._prefix = model_cls._table_name

    def _orm(self) -> Any:
        orm = self._model_cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")
        return orm

    def _key(self, key: str) -> str:
        return f"{self._prefix}:{key}"

    def get(self, key: str) -> Any:
        """Retrieve a cached value by key."""
        result = self._orm().query(f"CACHE GET '{self._key(key)}';")
        if result.rows and result.rows[0]:
            raw = result.rows[0][0]
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return raw
        return None

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Store a value in the cache."""
        if isinstance(value, (dict, list)):
            formatted = json.dumps(value)
        else:
            formatted = f"'{value}'"
        sql = f"CACHE SET '{self._key(key)}' {formatted}"
        if ttl is not None:
            sql += f" TTL {ttl}"
        self._orm().query(sql + ";")

    def delete(self, key: str) -> None:
        """Remove a cached key."""
        self._orm().query(f"CACHE DEL '{self._key(key)}';")

    def invalidate(self, **where: Any) -> None:
        """Invalidate cache entries whose key contains the given predicates.

        A simple convention: keys are stored as ``table:field=value``, so
        this builds the matching key suffix and deletes it.
        """
        parts = [f"{k}={v}" for k, v in where.items()]
        key = ":".join(parts)
        self.delete(key)

    def wrap_query(self, query_builder: "QueryBuilder", ttl: Optional[int] = None) -> Any:
        """Cache-aside pattern: check cache first, fall back to query.

        The cache key is derived from the generated SQL.
        """
        import hashlib
        sql = query_builder.to_sql()
        cache_key = "qry:" + hashlib.md5(sql.encode()).hexdigest()

        cached = self.get(cache_key)
        if cached is not None:
            return cached

        results = query_builder.all()
        serialized = [inst.to_dict() for inst in results]

        effective_ttl = ttl
        if effective_ttl is None:
            schema = getattr(self._model_cls, "__schema__", None)
            if schema and schema.cache.enabled:
                effective_ttl = schema.cache.ttl

        self.set(cache_key, serialized, effective_ttl)
        return results
