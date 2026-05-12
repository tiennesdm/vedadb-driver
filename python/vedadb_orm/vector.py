"""
VedaDB ORM — VectorProxy.

Wraps VedaDB's vector-similarity search and returns typed model instances
alongside their distance/similarity scores.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

from .exceptions import QueryError
from .utils import format_where_value

if TYPE_CHECKING:
    pass


class VectorProxy:
    """Model-scoped vector search builder."""

    def __init__(
        self,
        model_cls: type,
        embedding: List[float],
        top_k: int = 10,
        metric: Optional[str] = None,
    ) -> None:
        self._model_cls = model_cls
        self._embedding = embedding
        self._top_k = top_k
        self._metric = metric
        self._filters: Dict[str, Any] = {}

    def filter(self, **where: Any) -> "VectorProxy":
        """Add equality filters applied *before* the vector search."""
        self._filters.update(where)
        return self

    def exec(self) -> List[Tuple[Any, float]]:
        """Execute the vector search.

        Returns a list of ``(model_instance, score)`` tuples ordered by
        similarity.
        """
        orm = self._model_cls._get_orm()
        if orm is None:
            raise QueryError("Model is not bound to a VedaORM instance")

        table = self._model_cls._table_name
        schema = getattr(self._model_cls, "__schema__", None)

        vec_field = None
        metric = self._metric
        if schema and schema.vector.enabled:
            vec_field = schema.vector.field
            if metric is None:
                metric = schema.vector.metric

        if vec_field is None:
            raise QueryError("No vector field configured for this model")

        if metric is None:
            metric = "cosine"

        vec_json = json.dumps(self._embedding)

        sql = (
            f"SELECT *, VECTOR_DISTANCE({vec_field}, '{vec_json}', '{metric}') AS _score "
            f"FROM {table}"
        )

        if self._filters:
            clauses = [
                f"{k} = {format_where_value(v)}" for k, v in self._filters.items()
            ]
            sql += " WHERE " + " AND ".join(clauses)

        sql += f" ORDER BY _score ASC LIMIT {self._top_k};"

        result = orm.query(sql)

        pairs: List[Tuple[Any, float]] = []
        score_idx: Optional[int] = None
        if "_score" in result.columns:
            score_idx = result.columns.index("_score")

        for row in result.rows:
            score = float(row[score_idx]) if score_idx is not None else 0.0
            inst = self._model_cls._from_row(result.columns, row)
            pairs.append((inst, score))

        return pairs
