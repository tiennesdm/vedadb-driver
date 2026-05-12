"""
VedaDB ORM — Relationship descriptors and lazy-loading.

Relationships are declared on the model class and resolved at query time
(or eagerly via ``include()``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional, TYPE_CHECKING

from .exceptions import RelationshipError

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Relationship definitions
# ---------------------------------------------------------------------------

@dataclass
class HasOne:
    """The current model has exactly one related record in *related_model*
    whose *foreign_key* points back to the local *local_key*.
    """

    related_model: str
    foreign_key: str
    local_key: str = "id"


@dataclass
class HasMany:
    """The current model has zero-or-more related records."""

    related_model: str
    foreign_key: str
    local_key: str = "id"


@dataclass
class BelongsTo:
    """The current model references a parent via *foreign_key*."""

    related_model: str
    foreign_key: str
    owner_key: str = "id"


@dataclass
class BelongsToMany:
    """Many-to-many through a pivot table."""

    related_model: str
    pivot_table: str
    foreign_pivot_key: str
    related_pivot_key: str


# ---------------------------------------------------------------------------
# Lazy loader
# ---------------------------------------------------------------------------

class LazyRelation:
    """Descriptor that loads a related model on first attribute access.

    Attached to model *instances* (not classes) during hydration.
    """

    def __init__(
        self,
        relation_def: Any,
        owner_instance: Any,
    ) -> None:
        self._relation = relation_def
        self._owner = owner_instance
        self._loaded = False
        self._value: Any = None

    def load(self) -> Any:
        """Execute the underlying query and cache the result."""
        if self._loaded:
            return self._value

        orm = self._owner._get_orm()
        if orm is None:
            raise RelationshipError(
                "Cannot resolve relationship: model is not bound to an ORM instance"
            )

        related_cls = orm.models.get(self._relation.related_model)
        if related_cls is None:
            raise RelationshipError(
                f"Related model {self._relation.related_model!r} is not registered"
            )

        if isinstance(self._relation, HasOne):
            local_val = self._owner._data.get(self._relation.local_key)
            if local_val is None:
                self._value = None
            else:
                self._value = related_cls.find_one(
                    **{self._relation.foreign_key: local_val}
                )

        elif isinstance(self._relation, HasMany):
            local_val = self._owner._data.get(self._relation.local_key)
            if local_val is None:
                self._value = []
            else:
                self._value = related_cls.find_many(
                    **{self._relation.foreign_key: local_val}
                )

        elif isinstance(self._relation, BelongsTo):
            fk_val = self._owner._data.get(self._relation.foreign_key)
            if fk_val is None:
                self._value = None
            else:
                self._value = related_cls.find_one(
                    **{self._relation.owner_key: fk_val}
                )

        elif isinstance(self._relation, BelongsToMany):
            local_val = self._owner._data.get("id")
            if local_val is None:
                self._value = []
            else:
                pivot = self._relation.pivot_table
                fk = self._relation.foreign_pivot_key
                rk = self._relation.related_pivot_key
                from .utils import format_where_value
                fk_sql = format_where_value(local_val)
                sql = (
                    f"SELECT {rk} FROM {pivot} WHERE {fk} = {fk_sql};"
                )
                result = orm.query(sql)
                related_ids = [row[0] for row in result.rows]
                if related_ids:
                    self._value = related_cls.where("id").where_in(
                        "id", related_ids
                    ).all()
                else:
                    self._value = []
        else:
            raise RelationshipError(
                f"Unknown relationship type: {type(self._relation).__name__}"
            )

        self._loaded = True
        return self._value

    def __repr__(self) -> str:
        if self._loaded:
            return repr(self._value)
        return f"<LazyRelation({type(self._relation).__name__}, not loaded)>"
