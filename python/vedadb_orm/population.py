"""
VedaDB ORM — Eager / lazy loading (population).

``PopulationResolver`` is invoked by ``QueryBuilder.all()`` when ``.include()``
was used.  It performs batch queries for related models and stitches them
onto the parent instances in memory.
"""

from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING

from .exceptions import RelationshipError
from .relationships import BelongsTo, BelongsToMany, HasMany, HasOne
from .utils import format_where_value

if TYPE_CHECKING:
    pass


class PopulationResolver:
    """Resolves relationships for a batch of model instances."""

    @staticmethod
    def eager_load(instances: List[Any], relations: List[str]) -> None:
        """Batch-load *relations* for all *instances* and set the loaded
        values directly on each instance's ``_data`` dict.

        For same-engine models this issues ``WHERE ... IN (...)`` queries.
        """
        if not instances:
            return

        model_cls = type(instances[0])
        schema = getattr(model_cls, "__schema__", None)
        orm = model_cls._get_orm()
        if orm is None:
            return

        for rel_name in relations:
            rel_def = getattr(model_cls, rel_name, None)
            if rel_def is None:
                raise RelationshipError(
                    f"Relation {rel_name!r} is not defined on {model_cls.__name__}"
                )

            related_cls = orm.models.get(rel_def.related_model)
            if related_cls is None:
                raise RelationshipError(
                    f"Related model {rel_def.related_model!r} is not registered"
                )

            if isinstance(rel_def, HasOne):
                _load_has_one(instances, rel_name, rel_def, related_cls, orm)
            elif isinstance(rel_def, HasMany):
                _load_has_many(instances, rel_name, rel_def, related_cls, orm)
            elif isinstance(rel_def, BelongsTo):
                _load_belongs_to(instances, rel_name, rel_def, related_cls, orm)
            elif isinstance(rel_def, BelongsToMany):
                _load_belongs_to_many(instances, rel_name, rel_def, related_cls, orm)
            else:
                raise RelationshipError(
                    f"Unknown relationship type for {rel_name}"
                )


# ---------------------------------------------------------------------------
# Internal loaders
# ---------------------------------------------------------------------------

def _load_has_one(
    instances: List[Any],
    rel_name: str,
    rel_def: HasOne,
    related_cls: type,
    orm: Any,
) -> None:
    local_key = rel_def.local_key
    fk = rel_def.foreign_key
    ids = [inst._data.get(local_key) for inst in instances if inst._data.get(local_key) is not None]
    if not ids:
        for inst in instances:
            inst._data[rel_name] = None
        return

    formatted = ", ".join(format_where_value(v) for v in ids)
    sql = f"SELECT * FROM {related_cls._table_name} WHERE {fk} IN ({formatted});"
    result = orm.query(sql)

    by_fk: Dict[Any, Any] = {}
    for row in result.rows:
        related_inst = related_cls._from_row(result.columns, row)
        key_val = related_inst._data.get(fk)
        by_fk[key_val] = related_inst

    for inst in instances:
        inst._data[rel_name] = by_fk.get(inst._data.get(local_key))


def _load_has_many(
    instances: List[Any],
    rel_name: str,
    rel_def: HasMany,
    related_cls: type,
    orm: Any,
) -> None:
    local_key = rel_def.local_key
    fk = rel_def.foreign_key
    ids = [inst._data.get(local_key) for inst in instances if inst._data.get(local_key) is not None]
    if not ids:
        for inst in instances:
            inst._data[rel_name] = []
        return

    formatted = ", ".join(format_where_value(v) for v in ids)
    sql = f"SELECT * FROM {related_cls._table_name} WHERE {fk} IN ({formatted});"
    result = orm.query(sql)

    by_fk: Dict[Any, List[Any]] = {}
    for row in result.rows:
        related_inst = related_cls._from_row(result.columns, row)
        key_val = related_inst._data.get(fk)
        by_fk.setdefault(key_val, []).append(related_inst)

    for inst in instances:
        inst._data[rel_name] = by_fk.get(inst._data.get(local_key), [])


def _load_belongs_to(
    instances: List[Any],
    rel_name: str,
    rel_def: BelongsTo,
    related_cls: type,
    orm: Any,
) -> None:
    fk = rel_def.foreign_key
    owner_key = rel_def.owner_key
    ids = [inst._data.get(fk) for inst in instances if inst._data.get(fk) is not None]
    if not ids:
        for inst in instances:
            inst._data[rel_name] = None
        return

    formatted = ", ".join(format_where_value(v) for v in ids)
    sql = f"SELECT * FROM {related_cls._table_name} WHERE {owner_key} IN ({formatted});"
    result = orm.query(sql)

    by_pk: Dict[Any, Any] = {}
    for row in result.rows:
        related_inst = related_cls._from_row(result.columns, row)
        key_val = related_inst._data.get(owner_key)
        by_pk[key_val] = related_inst

    for inst in instances:
        inst._data[rel_name] = by_pk.get(inst._data.get(fk))


def _load_belongs_to_many(
    instances: List[Any],
    rel_name: str,
    rel_def: BelongsToMany,
    related_cls: type,
    orm: Any,
) -> None:
    pivot = rel_def.pivot_table
    fk = rel_def.foreign_pivot_key
    rk = rel_def.related_pivot_key

    ids = [inst._data.get("id") for inst in instances if inst._data.get("id") is not None]
    if not ids:
        for inst in instances:
            inst._data[rel_name] = []
        return

    formatted = ", ".join(format_where_value(v) for v in ids)
    pivot_sql = f"SELECT {fk}, {rk} FROM {pivot} WHERE {fk} IN ({formatted});"
    pivot_result = orm.query(pivot_sql)

    # Map local_id -> [related_id, ...]
    fk_idx = pivot_result.columns.index(fk) if fk in pivot_result.columns else 0
    rk_idx = pivot_result.columns.index(rk) if rk in pivot_result.columns else 1
    mapping: Dict[Any, List[Any]] = {}
    related_ids: set = set()
    for row in pivot_result.rows:
        local_id = row[fk_idx]
        rel_id = row[rk_idx]
        mapping.setdefault(local_id, []).append(rel_id)
        related_ids.add(rel_id)

    if not related_ids:
        for inst in instances:
            inst._data[rel_name] = []
        return

    # Fetch related records in one query.
    formatted_rel = ", ".join(format_where_value(v) for v in related_ids)
    sql = f"SELECT * FROM {related_cls._table_name} WHERE id IN ({formatted_rel});"
    result = orm.query(sql)

    by_id: Dict[Any, Any] = {}
    for row in result.rows:
        related_inst = related_cls._from_row(result.columns, row)
        by_id[related_inst._data.get("id")] = related_inst

    for inst in instances:
        local_id = inst._data.get("id")
        rel_ids = mapping.get(local_id, [])
        inst._data[rel_name] = [by_id[rid] for rid in rel_ids if rid in by_id]
