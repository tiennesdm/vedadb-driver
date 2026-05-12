"""
VedaDB ORM — Schema definitions.

Dataclasses that describe tables / collections and a ``to_create_sql``
helper that generates the DDL statement for a given schema.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Sequence

from .types import FieldType, PYTHON_TO_VEDAQL


# ---------------------------------------------------------------------------
# Engine type
# ---------------------------------------------------------------------------

class EngineType(Enum):
    """Storage engine backing a model."""

    STRUCTURED = "STRUCTURED"
    DOCUMENT = "DOCUMENT"
    GRAPH = "GRAPH"
    TIMESERIES = "TIMESERIES"


# ---------------------------------------------------------------------------
# Supporting dataclasses
# ---------------------------------------------------------------------------

@dataclass
class Reference:
    """Foreign-key reference from one field to another model's field."""

    model: str
    field: str = "id"
    on_delete: str = "CASCADE"


@dataclass
class Field:
    """Column / field definition inside a Schema."""

    type: FieldType = FieldType.STRING
    primary_key: bool = False
    auto_increment: bool = False
    unique: bool = False
    nullable: bool = True
    default: Any = None
    references: Optional[Reference] = None
    validators: List[Callable] = dc_field(default_factory=list)
    searchable: bool = False
    vector_dimensions: Optional[int] = None


@dataclass
class Index:
    """Composite or single-column index."""

    fields: List[str]
    unique: bool = False
    name: Optional[str] = None


@dataclass
class CacheConfig:
    """Per-model cache-aside configuration."""

    enabled: bool = False
    ttl: int = 300  # seconds


@dataclass
class SearchConfig:
    """Full-text search configuration for a model."""

    enabled: bool = False
    fields: List[str] = dc_field(default_factory=list)


@dataclass
class VectorConfig:
    """Vector-search configuration for a model."""

    enabled: bool = False
    field: Optional[str] = None
    dimensions: int = 0
    metric: str = "cosine"


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

@dataclass
class Schema:
    """Complete schema definition for a VedaDB model.

    Usually assigned as ``__schema__`` on a :class:`BaseModel` subclass.
    """

    name: str
    engine: EngineType = EngineType.STRUCTURED
    fields: Dict[str, Field] = dc_field(default_factory=dict)
    indexes: List[Index] = dc_field(default_factory=list)
    cache: CacheConfig = dc_field(default_factory=CacheConfig)
    search: SearchConfig = dc_field(default_factory=SearchConfig)
    vector: VectorConfig = dc_field(default_factory=VectorConfig)
    timestamps: bool = True
    soft_delete: bool = False


# ---------------------------------------------------------------------------
# DDL generator
# ---------------------------------------------------------------------------

def to_create_sql(schema: Schema) -> str:
    """Generate a ``CREATE TABLE`` (or ``CREATE COLLECTION``) DDL statement
    from *schema*.
    """
    parts: List[str] = []

    if schema.engine == EngineType.DOCUMENT:
        parts.append(f"CREATE COLLECTION {schema.name}")
        if schema.search.enabled and schema.search.fields:
            parts.append(
                f"  SEARCH FIELDS ({', '.join(schema.search.fields)})"
            )
        if schema.vector.enabled and schema.vector.field:
            parts.append(
                f"  VECTOR FIELD {schema.vector.field} "
                f"DIMENSIONS {schema.vector.dimensions} "
                f"METRIC '{schema.vector.metric}'"
            )
        return " ".join(parts) + ";"

    # STRUCTURED / GRAPH / TIMESERIES  ->  CREATE TABLE
    keyword = "TABLE"
    if schema.engine == EngineType.GRAPH:
        keyword = "GRAPH TABLE"
    elif schema.engine == EngineType.TIMESERIES:
        keyword = "TIMESERIES TABLE"

    col_defs: List[str] = []

    for col_name, f in schema.fields.items():
        vedaql_type = PYTHON_TO_VEDAQL.get(f.type, "STRING")

        if f.type == FieldType.VECTOR and f.vector_dimensions:
            vedaql_type = f"VECTOR({f.vector_dimensions})"

        tokens: List[str] = [col_name, vedaql_type]

        if f.primary_key:
            tokens.append("PRIMARY KEY")
        if f.auto_increment:
            tokens.append("AUTO_INCREMENT")
        if f.unique and not f.primary_key:
            tokens.append("UNIQUE")
        if not f.nullable and not f.primary_key:
            tokens.append("NOT NULL")
        if f.default is not None:
            if isinstance(f.default, bool):
                tokens.append(f"DEFAULT {'TRUE' if f.default else 'FALSE'}")
            elif isinstance(f.default, str):
                tokens.append(f"DEFAULT '{f.default}'")
            else:
                tokens.append(f"DEFAULT {f.default}")

        if f.references:
            tokens.append(
                f"REFERENCES {f.references.model}({f.references.field}) "
                f"ON DELETE {f.references.on_delete}"
            )

        col_defs.append("  " + " ".join(tokens))

    # Auto-add timestamp columns.
    if schema.timestamps:
        if "created_at" not in schema.fields:
            col_defs.append("  created_at TIMESTAMP")
        if "updated_at" not in schema.fields:
            col_defs.append("  updated_at TIMESTAMP")

    # Soft-delete column.
    if schema.soft_delete:
        if "deleted_at" not in schema.fields:
            col_defs.append("  deleted_at TIMESTAMP")

    # Search fields.
    if schema.search.enabled and schema.search.fields:
        col_defs.append(
            f"  SEARCH INDEX ({', '.join(schema.search.fields)})"
        )

    lines = [f"CREATE {keyword} {schema.name} ("]
    lines.append(",\n".join(col_defs))
    lines.append(")")

    # Indexes are emitted as separate statements but returned together.
    stmts = ["\n".join(lines) + ";"]

    for idx in schema.indexes:
        idx_name = idx.name or f"idx_{schema.name}_{'_'.join(idx.fields)}"
        unique = "UNIQUE " if idx.unique else ""
        stmts.append(
            f"CREATE {unique}INDEX {idx_name} ON {schema.name} "
            f"({', '.join(idx.fields)});"
        )

    return "\n".join(stmts)
