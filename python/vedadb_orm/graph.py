"""
VedaDB ORM — GraphProxy.

Provides a model-scoped interface to VedaDB's graph-engine features:
node/edge management, traversal, shortest-path, and PageRank.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from .exceptions import QueryError
from .utils import format_where_value

if TYPE_CHECKING:
    pass


class GraphProxy:
    """Model-scoped graph operations."""

    def __init__(self, model_cls: type) -> None:
        self._model_cls = model_cls

    def _orm(self) -> Any:
        orm = self._model_cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")
        return orm

    @property
    def _table(self) -> str:
        return self._model_cls._table_name

    # -- node / edge management ---------------------------------------------

    def add_node(self, id: Any, label: str, **props: Any) -> None:
        """Insert a graph node."""
        props_json = json.dumps(props) if props else "{}"
        sql = (
            f"GRAPH ADD NODE {self._table} "
            f"ID {format_where_value(id)} "
            f"LABEL '{label}' "
            f"PROPERTIES '{props_json}';"
        )
        self._orm().query(sql)

    def add_edge(
        self,
        from_id: Any,
        to_id: Any,
        edge_type: str,
        **props: Any,
    ) -> None:
        """Insert a directed edge between two nodes."""
        props_json = json.dumps(props) if props else "{}"
        sql = (
            f"GRAPH ADD EDGE {self._table} "
            f"FROM {format_where_value(from_id)} "
            f"TO {format_where_value(to_id)} "
            f"TYPE '{edge_type}' "
            f"PROPERTIES '{props_json}';"
        )
        self._orm().query(sql)

    # -- traversal ----------------------------------------------------------

    def traverse(
        self,
        start: Any,
        depth: int = 1,
        edge_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Breadth-first traversal from *start* up to *depth* hops.

        Returns a list of node dicts.
        """
        sql = (
            f"GRAPH TRAVERSE {self._table} "
            f"FROM {format_where_value(start)} "
            f"DEPTH {depth}"
        )
        if edge_type:
            sql += f" EDGE_TYPE '{edge_type}'"
        sql += ";"

        result = self._orm().query(sql)
        return [dict(zip(result.columns, row)) for row in result.rows]

    def shortest_path(self, start: Any, end: Any) -> List[Dict[str, Any]]:
        """Find the shortest path between two nodes.

        Returns a list of node dicts representing the path.
        """
        sql = (
            f"GRAPH SHORTEST_PATH {self._table} "
            f"FROM {format_where_value(start)} "
            f"TO {format_where_value(end)};"
        )
        result = self._orm().query(sql)
        return [dict(zip(result.columns, row)) for row in result.rows]

    def pagerank(self) -> List[Dict[str, Any]]:
        """Run PageRank on the graph and return ranked nodes.

        Returns a list of dicts with at least ``id`` and ``rank`` keys.
        """
        sql = f"GRAPH PAGERANK {self._table};"
        result = self._orm().query(sql)
        return [dict(zip(result.columns, row)) for row in result.rows]
