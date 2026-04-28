"""
VedaDB ORM — DocumentProxy.

Convenience wrapper for VedaDB's document-engine collections, providing
a MongoDB-style insert / find / update / delete interface.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from .exceptions import QueryError
from .utils import format_where_value

if TYPE_CHECKING:
    pass


class DocumentProxy:
    """Model-scoped document-store operations."""

    def __init__(self, model_cls: type) -> None:
        self._model_cls = model_cls

    def _orm(self) -> Any:
        orm = self._model_cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")
        return orm

    @property
    def _collection(self) -> str:
        return self._model_cls._table_name

    # -- CRUD ---------------------------------------------------------------

    def insert(self, id: Any, data: Dict[str, Any]) -> None:
        """Insert a document with a given *id*."""
        doc_json = json.dumps(data).replace("'", "''")
        sql = (
            f"INSERT INTO {self._collection} "
            f"(id, data) VALUES ({format_where_value(id)}, '{doc_json}');"
        )
        self._orm().query(sql)

    def find(self, filter: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Query documents matching *filter* (field-equality predicates).

        Returns a list of raw dicts.
        """
        sql = f"SELECT * FROM {self._collection}"
        if filter:
            clauses = [
                f"{k} = {format_where_value(v)}" for k, v in filter.items()
            ]
            sql += " WHERE " + " AND ".join(clauses)
        sql += ";"

        result = self._orm().query(sql)
        rows: List[Dict[str, Any]] = []
        for row in result.rows:
            d = dict(zip(result.columns, row))
            # If there is a 'data' column stored as JSON, parse it.
            if "data" in d and isinstance(d["data"], str):
                try:
                    d["data"] = json.loads(d["data"])
                except json.JSONDecodeError:
                    pass
            rows.append(d)
        return rows

    def find_by_id(self, id: Any) -> Optional[Dict[str, Any]]:
        """Retrieve a single document by its primary key."""
        sql = (
            f"SELECT * FROM {self._collection} "
            f"WHERE id = {format_where_value(id)};"
        )
        result = self._orm().query(sql)
        if not result.rows:
            return None
        d = dict(zip(result.columns, result.rows[0]))
        if "data" in d and isinstance(d["data"], str):
            try:
                d["data"] = json.loads(d["data"])
            except json.JSONDecodeError:
                pass
        return d

    def update(self, id: Any, data: Dict[str, Any]) -> None:
        """Replace the document body for *id*."""
        doc_json = json.dumps(data).replace("'", "''")
        sql = (
            f"UPDATE {self._collection} SET data = '{doc_json}' "
            f"WHERE id = {format_where_value(id)};"
        )
        self._orm().query(sql)

    def delete(self, id: Any) -> None:
        """Remove a document by *id*."""
        sql = (
            f"DELETE FROM {self._collection} "
            f"WHERE id = {format_where_value(id)};"
        )
        self._orm().query(sql)
