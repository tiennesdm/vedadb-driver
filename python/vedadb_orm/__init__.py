"""
VedaDB ORM — A full-featured Object-Relational Mapper for VedaDB.

Public API
----------
::

    from vedadb_orm import (
        VedaORM, Field, FieldType, Schema, EngineType, BaseModel,
        QueryBuilder, Index, CacheConfig, SearchConfig, VectorConfig,
        HasOne, HasMany, BelongsTo, BelongsToMany,
        required, min_length, max_length, min_value, max_value, regex, email,
    )
"""

# Connection
from .connection import VedaORM

# Schema building blocks
from .schema import (
    CacheConfig,
    EngineType,
    Field,
    Index,
    Reference,
    Schema,
    SearchConfig,
    VectorConfig,
)

# Type system
from .types import FieldType

# Model
from .model import BaseModel

# Query
from .query import QueryBuilder

# Aggregation
from .aggregation import AggregationBuilder

# Relationships
from .relationships import BelongsTo, BelongsToMany, HasMany, HasOne

# Validators
from .validators import (
    custom,
    email,
    max_length,
    max_value,
    min_length,
    min_value,
    one_of,
    regex,
    required,
)

# Hooks
from .hooks import HookContext, HookRegistry, HookType

# Session
from .session import Session

# Exceptions
from .exceptions import (
    ConnectionError,
    HookError,
    MigrationError,
    QueryError,
    RelationshipError,
    SchemaError,
    SessionError,
    ValidationError,
    VedaORMError,
)

# Migration
from .migration import Migration, MigrationGenerator, MigrationRunner

# Proxies
from .cache import CacheProxy
from .search import SearchProxy
from .vector import VectorProxy
from .graph import GraphProxy
from .document import DocumentProxy

# Population
from .population import PopulationResolver

__all__ = [
    # Core
    "VedaORM",
    "BaseModel",
    "QueryBuilder",
    "AggregationBuilder",
    "Session",
    # Schema
    "Field",
    "FieldType",
    "Schema",
    "EngineType",
    "Index",
    "Reference",
    "CacheConfig",
    "SearchConfig",
    "VectorConfig",
    # Relationships
    "HasOne",
    "HasMany",
    "BelongsTo",
    "BelongsToMany",
    # Validators
    "required",
    "min_length",
    "max_length",
    "min_value",
    "max_value",
    "regex",
    "email",
    "one_of",
    "custom",
    # Hooks
    "HookType",
    "HookContext",
    "HookRegistry",
    # Exceptions
    "VedaORMError",
    "ConnectionError",
    "ValidationError",
    "SchemaError",
    "QueryError",
    "HookError",
    "RelationshipError",
    "MigrationError",
    "SessionError",
    # Migration
    "Migration",
    "MigrationGenerator",
    "MigrationRunner",
    # Proxies
    "CacheProxy",
    "SearchProxy",
    "VectorProxy",
    "GraphProxy",
    "DocumentProxy",
    # Population
    "PopulationResolver",
]
