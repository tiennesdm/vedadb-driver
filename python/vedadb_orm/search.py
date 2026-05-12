"""
VedaDB ORM — SearchProxy.

Full-text search proxy that maps to VedaDB's SEARCH command and hydrates
results back into model instances.
"""

from __future__ import annotations

from typing import Any, List, Optional, TYPE_CHECKING

from .exceptions import QueryError

if TYPE_CHECKING:
    pass


class SearchProxy:
    """Model-scoped full-text search builder."""

    def __init__(
        self,
        model_cls: type,
        query: str,
        fuzzy: int = 0,
    ) -> None:
        self._model_cls = model_cls
        self._query = query
        self._fuzzy = fuzzy
        self._fields_list: List[str] = []
        self._limit_val: Optional[int] = None

    def fields(self, *field_names: str) -> "SearchProxy":
        """Restrict the search to specific columns."""
        self._fields_list = list(field_names)
        return self

    def limit(self, n: int) -> "SearchProxy":
        self._limit_val = n
        return self

    def exec(self) -> List[Any]:
        """Execute the search and return model instances."""
        orm = self._model_cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")

        table = self._model_cls._table_name
        search_fields = self._fields_list
        if not search_fields:
            schema = getattr(self._model_cls, "__schema__", None)
            if schema and schema.search.enabled and schema.search.fields:
                search_fields = schema.search.fields
            else:
                # Fall back to all STRING fields.
                from .types import FieldType
                if schema:
                    search_fields = [
                        name
                        for name, f in schema.fields.items()
                        if f.type == FieldType.STRING and f.searchable
                    ]

        if not search_fields:
            raise QueryError("No searchable fields defined for this model")

        escaped_query = self._query.replace("'", "''")

        # Use the first searchable field for the MATCH clause (VedaDB SEARCH
        # syntax uses a single column target).  For multiple fields we issue
        # separate searches and merge.
        all_instances: List[Any] = []
        seen_ids: set = set()

        for field in search_fields:
            sql = f"SEARCH {table} WHERE {field} MATCH '{escaped_query}'"
            if self._fuzzy > 0:
                sql += f" FUZZY {self._fuzzy}"
            if self._limit_val is not None:
                sql += f" LIMIT {self._limit_val}"
            sql += ";"

            result = orm.query(sql)
            for row in result.rows:
                inst = self._model_cls._from_row(result.columns, row)
                row_id = inst._data.get("id")
                if row_id not in seen_ids:
                    seen_ids.add(row_id)
                    all_instances.append(inst)

            if self._limit_val and len(all_instances) >= self._limit_val:
                all_instances = all_instances[: self._limit_val]
                break

        return all_instances
