"""
VedaDB ORM — Migration system.

Provides automatic migration generation by diffing the current registered
schemas against a stored snapshot, plus forward / rollback execution.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from .exceptions import MigrationError
from .schema import Schema, to_create_sql
from .types import PYTHON_TO_VEDAQL, FieldType

if TYPE_CHECKING:
    from .connection import VedaORM


# ---------------------------------------------------------------------------
# Migration dataclass
# ---------------------------------------------------------------------------

@dataclass
class Migration:
    """A single, versioned migration consisting of forward and reverse SQL."""

    version: str
    name: str
    up_sql: str
    down_sql: str
    applied_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------

class MigrationGenerator:
    """Compare two schema snapshots and produce a ``Migration``."""

    @staticmethod
    def generate(
        current_schemas: Dict[str, Schema],
        snapshot: Dict[str, Schema],
    ) -> Migration:
        """Diff *current_schemas* (desired) against *snapshot* (DB state) and
        return a ``Migration`` that brings the DB up to date.
        """
        up_parts: List[str] = []
        down_parts: List[str] = []

        # 1. New tables -------------------------------------------------
        for name, schema in current_schemas.items():
            if name not in snapshot:
                up_parts.append(to_create_sql(schema))
                down_parts.append(f"DROP TABLE {name};")

        # 2. Dropped tables ---------------------------------------------
        for name in snapshot:
            if name not in current_schemas:
                old_schema = snapshot[name]
                down_parts.append(to_create_sql(old_schema))
                up_parts.append(f"DROP TABLE {name};")

        # 3. Altered tables (add / drop / alter columns) -----------------
        for name, schema in current_schemas.items():
            if name not in snapshot:
                continue
            old = snapshot[name]
            # Added columns
            for col_name, field in schema.fields.items():
                if col_name not in old.fields:
                    vedaql_type = PYTHON_TO_VEDAQL.get(field.type, "STRING")
                    nullable = "" if field.nullable else " NOT NULL"
                    up_parts.append(
                        f"ALTER TABLE {name} ADD COLUMN {col_name} {vedaql_type}{nullable};"
                    )
                    down_parts.append(
                        f"ALTER TABLE {name} DROP COLUMN {col_name};"
                    )
            # Removed columns
            for col_name, field in old.fields.items():
                if col_name not in schema.fields:
                    vedaql_type = PYTHON_TO_VEDAQL.get(field.type, "STRING")
                    up_parts.append(
                        f"ALTER TABLE {name} DROP COLUMN {col_name};"
                    )
                    down_parts.append(
                        f"ALTER TABLE {name} ADD COLUMN {col_name} {vedaql_type};"
                    )
            # Type changes
            for col_name, field in schema.fields.items():
                if col_name in old.fields:
                    old_field = old.fields[col_name]
                    if field.type != old_field.type:
                        new_type = PYTHON_TO_VEDAQL.get(field.type, "STRING")
                        old_type = PYTHON_TO_VEDAQL.get(old_field.type, "STRING")
                        up_parts.append(
                            f"ALTER TABLE {name} ALTER COLUMN {col_name} TYPE {new_type};"
                        )
                        down_parts.append(
                            f"ALTER TABLE {name} ALTER COLUMN {col_name} TYPE {old_type};"
                        )

            # Index diffs
            old_idx_names = {
                (idx.name or f"idx_{name}_{'_'.join(idx.fields)}")
                for idx in old.indexes
            }
            new_idx_names = {
                (idx.name or f"idx_{name}_{'_'.join(idx.fields)}")
                for idx in schema.indexes
            }
            for idx in schema.indexes:
                idx_name = idx.name or f"idx_{name}_{'_'.join(idx.fields)}"
                if idx_name not in old_idx_names:
                    unique = "UNIQUE " if idx.unique else ""
                    up_parts.append(
                        f"CREATE {unique}INDEX {idx_name} ON {name} "
                        f"({', '.join(idx.fields)});"
                    )
                    down_parts.append(f"DROP INDEX {idx_name};")
            for idx in old.indexes:
                idx_name = idx.name or f"idx_{name}_{'_'.join(idx.fields)}"
                if idx_name not in new_idx_names:
                    up_parts.append(f"DROP INDEX {idx_name};")
                    unique = "UNIQUE " if idx.unique else ""
                    down_parts.append(
                        f"CREATE {unique}INDEX {idx_name} ON {name} "
                        f"({', '.join(idx.fields)});"
                    )

        ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        version = f"{ts}_{hashlib.md5(('\n'.join(up_parts)).encode()).hexdigest()[:8]}"

        return Migration(
            version=version,
            name=f"auto_{ts}",
            up_sql="\n".join(up_parts),
            down_sql="\n".join(down_parts),
        )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

_MIGRATION_TABLE = "_vedadb_migrations"
_CREATE_MIGRATION_TABLE = (
    f"CREATE TABLE IF NOT EXISTS {_MIGRATION_TABLE} ("
    f"  version STRING PRIMARY KEY,"
    f"  name STRING,"
    f"  applied_at TIMESTAMP"
    f");"
)


class MigrationRunner:
    """Applies and rolls back migrations against a live VedaDB instance."""

    def __init__(self, orm: "VedaORM") -> None:
        self._orm = orm
        self._ensure_table()

    def _ensure_table(self) -> None:
        try:
            self._orm.query(_CREATE_MIGRATION_TABLE)
        except Exception:
            pass  # Table may already exist.

    # -- public API ---------------------------------------------------------

    def migrate(self, migrations: List[Migration]) -> List[str]:
        """Apply all unapplied migrations in order.

        Returns a list of applied version strings.
        """
        applied = self._applied_versions()
        results: List[str] = []
        for m in migrations:
            if m.version in applied:
                continue
            try:
                for stmt in self._split_statements(m.up_sql):
                    self._orm.query(stmt)
                self._record(m)
                results.append(m.version)
            except Exception as exc:
                raise MigrationError(
                    f"Migration {m.version} ({m.name}) failed: {exc}"
                ) from exc
        return results

    def rollback(self, migrations: List[Migration], steps: int = 1) -> List[str]:
        """Roll back the last *steps* applied migrations.

        *migrations* must be the full ordered list so that down SQL can be
        located.
        """
        applied = self._applied_versions()
        if not applied:
            return []

        by_version = {m.version: m for m in migrations}
        rolled: List[str] = []

        for version in reversed(applied):
            if steps <= 0:
                break
            m = by_version.get(version)
            if m is None:
                raise MigrationError(
                    f"Cannot rollback {version}: migration definition not found"
                )
            try:
                for stmt in self._split_statements(m.down_sql):
                    self._orm.query(stmt)
                self._unrecord(version)
                rolled.append(version)
                steps -= 1
            except Exception as exc:
                raise MigrationError(
                    f"Rollback of {version} failed: {exc}"
                ) from exc
        return rolled

    def status(self) -> List[Dict[str, Any]]:
        """Return a list of applied migration records."""
        result = self._orm.query(
            f"SELECT version, name, applied_at FROM {_MIGRATION_TABLE} "
            f"ORDER BY applied_at;"
        )
        return [dict(zip(result.columns, row)) for row in result.rows]

    # -- internals ----------------------------------------------------------

    def _applied_versions(self) -> List[str]:
        result = self._orm.query(
            f"SELECT version FROM {_MIGRATION_TABLE} ORDER BY applied_at;"
        )
        return [row[0] for row in result.rows]

    def _record(self, m: Migration) -> None:
        now = datetime.utcnow().isoformat()
        escaped_name = m.name.replace("'", "''")
        self._orm.query(
            f"INSERT INTO {_MIGRATION_TABLE} (version, name, applied_at) "
            f"VALUES ('{m.version}', '{escaped_name}', '{now}');"
        )

    def _unrecord(self, version: str) -> None:
        self._orm.query(
            f"DELETE FROM {_MIGRATION_TABLE} WHERE version = '{version}';"
        )

    @staticmethod
    def _split_statements(sql: str) -> List[str]:
        """Split a multi-statement SQL string on ``;`` boundaries, skipping
        empty parts.
        """
        stmts: List[str] = []
        for part in sql.split(";"):
            part = part.strip()
            if part:
                stmts.append(part + ";")
        return stmts
