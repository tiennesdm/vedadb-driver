"""
Schema migration runner for VedaDB.

Manages database schema migrations with versioning, rollback support,
and dependency tracking.  Migrations are defined as Python classes with
``upgrade`` and ``downgrade`` methods.

Example — define a migration::

    from vedadb.migrations import Migration, MigrationRunner

    class AddUsersTable(Migration):
        version = 1
        name = "add_users_table"
        dependencies = []

        def upgrade(self, db):
            db.query('''
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT UNIQUE
                );
            ''')

        def downgrade(self, db):
            db.query("DROP TABLE users;")

    runner = MigrationRunner(db, migrations=[AddUsersTable])
    runner.migrate()  # Runs all pending migrations
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, ClassVar, Dict, List, Optional, Type

from .exceptions import VedaDBQueryError, VedaDBValidationError

logger = logging.getLogger("vedadb.migrations")


# ---------------------------------------------------------------------------
# Migration base class
# ---------------------------------------------------------------------------

class Migration:
    """Base class for schema migrations.

    Subclasses must define ``version``, ``name``, and implement
    ``upgrade`` and ``downgrade`` methods.

    Attributes:
        version: Integer version number (must be unique, monotonic).
        name: Human-readable migration name.
        dependencies: List of version numbers this migration depends on.
    """

    version: ClassVar[int] = 0
    name: ClassVar[str] = ""
    dependencies: ClassVar[list[int]] = []

    def upgrade(self, db: Any) -> None:
        """Apply this migration. Must be implemented by subclasses."""
        raise NotImplementedError

    def downgrade(self, db: Any) -> None:
        """Revert this migration. Must be implemented by subclasses."""
        raise NotImplementedError

    @classmethod
    def describe(cls) -> str:
        return f"{cls.version}: {cls.name}"

    def __repr__(self) -> str:
        return f"<Migration v{self.version} {self.name!r}>"


# ---------------------------------------------------------------------------
# Migration record
# ---------------------------------------------------------------------------

@dataclass
class MigrationRecord:
    """A record of an applied migration in the database."""

    version: int
    name: str
    applied_at: float
    checksum: str = ""

    def to_row(self) -> dict:
        return {
            "version": self.version,
            "name": self.name,
            "applied_at": self.applied_at,
            "checksum": self.checksum,
        }


# ---------------------------------------------------------------------------
# MigrationRunner
# ---------------------------------------------------------------------------

class MigrationRunner:
    """Schema migration runner.

    Manages the migration lifecycle: tracks which migrations have been
    applied, runs pending ones in order, and supports rollback.

    Args:
        db: A :class:`VedaDB` or compatible client.
        migrations: List of :class:`Migration` subclasses to manage.
        table_name: Name of the migrations tracking table.
        auto_create_table: Whether to auto-create the tracking table.

    Example::

        runner = MigrationRunner(db, migrations=[
            AddUsersTable,
            AddPostsTable,
        ])
        runner.migrate()      # Apply all pending
        runner.rollback(1)    # Rollback one migration
        runner.status()       # Show current state
    """

    def __init__(
        self,
        db: Any,
        migrations: list[Type[Migration]] | None = None,
        table_name: str = "_migrations",
        auto_create_table: bool = True,
    ):
        self._db = db
        self._migrations: list[Type[Migration]] = sorted(
            (migrations or []), key=lambda m: m.version
        )
        self._table_name = table_name
        self._auto_create = auto_create_table

        if auto_create_table:
            self._ensure_migration_table()

    # ------------------------------------------------------------------
    # Core migration logic
    # ------------------------------------------------------------------

    def migrate(self, target_version: int | None = None) -> list[MigrationRecord]:
        """Apply all pending migrations (or up to *target_version*).

        Args:
            target_version: If provided, stop at this version.

        Returns:
            List of :class:`MigrationRecord` for applied migrations.
        """
        applied = self._get_applied_versions()
        records: list[MigrationRecord] = []

        for migration_class in self._migrations:
            if migration_class.version in applied:
                continue
            if target_version is not None and migration_class.version > target_version:
                break

            # Check dependencies
            for dep in migration_class.dependencies:
                if dep not in applied:
                    raise VedaDBValidationError(
                        f"Migration {migration_class.version} depends on {dep} "
                        f"which has not been applied"
                    )

            # Apply
            instance = migration_class()
            logger.info("Applying migration %s", instance.describe())
            start = time.perf_counter()
            instance.upgrade(self._db)
            elapsed = (time.perf_counter() - start) * 1000.0

            record = MigrationRecord(
                version=migration_class.version,
                name=migration_class.name,
                applied_at=time.time(),
            )
            self._record_migration(record)
            records.append(record)
            logger.info(
                "Migration %s applied in %.1fms", instance.describe(), elapsed
            )

        if not records:
            logger.info("No pending migrations")
        else:
            logger.info("Applied %d migration(s)", len(records))

        return records

    def rollback(self, steps: int = 1) -> list[MigrationRecord]:
        """Rollback the last *steps* migrations.

        Args:
            steps: Number of migrations to rollback.

        Returns:
            List of :class:`MigrationRecord` for rolled back migrations.
        """
        applied = self._get_applied_migrations()
        to_rollback = list(reversed(applied))[:steps]
        records: list[MigrationRecord] = []

        for record in to_rollback:
            migration_class = self._find_migration(record.version)
            if migration_class is None:
                logger.warning("Migration %d not found, skipping rollback", record.version)
                continue

            instance = migration_class()
            logger.info("Rolling back migration %s", instance.describe())
            instance.downgrade(self._db)
            self._remove_migration(record.version)
            records.append(record)
            logger.info("Rolled back migration %s", instance.describe())

        return records

    def rollback_to(self, target_version: int) -> list[MigrationRecord]:
        """Rollback all migrations down to (but not including) *target_version*.

        Args:
            target_version: Target version to rollback to.

        Returns:
            List of rolled back :class:`MigrationRecord`.
        """
        applied = self._get_applied_migrations()
        to_rollback = [r for r in reversed(applied) if r.version > target_version]
        records: list[MigrationRecord] = []

        for record in to_rollback:
            migration_class = self._find_migration(record.version)
            if migration_class is None:
                continue
            instance = migration_class()
            logger.info("Rolling back migration %s", instance.describe())
            instance.downgrade(self._db)
            self._remove_migration(record.version)
            records.append(record)

        return records

    # ------------------------------------------------------------------
    # Status and inspection
    # ------------------------------------------------------------------

    def status(self) -> dict:
        """Return current migration status.

        Returns:
            Dict with ``current_version``, ``pending``, and ``applied``.
        """
        applied_versions = self._get_applied_versions()
        all_versions = {m.version for m in self._migrations}
        pending = sorted(all_versions - applied_versions)

        return {
            "current_version": max(applied_versions) if applied_versions else 0,
            "applied_count": len(applied_versions),
            "pending_count": len(pending),
            "pending": pending,
            "applied": sorted(applied_versions),
        }

    def pending(self) -> list[Type[Migration]]:
        """Return list of pending migration classes."""
        applied = self._get_applied_versions()
        return [m for m in self._migrations if m.version not in applied]

    def applied(self) -> list[MigrationRecord]:
        """Return list of applied migration records."""
        return self._get_applied_migrations()

    def is_at_latest(self) -> bool:
        """Return True if all migrations have been applied."""
        return len(self.pending()) == 0

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_migration_table(self) -> None:
        """Create the migrations tracking table if it doesn't exist."""
        sql = f"""
            CREATE TABLE IF NOT EXISTS {self._table_name} (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at REAL NOT NULL,
                checksum TEXT
            );
        """
        try:
            self._db.query(sql)
        except VedaDBQueryError:
            pass

    def _get_applied_versions(self) -> set[int]:
        """Return the set of already-applied migration versions."""
        try:
            result = self._db.query(f"SELECT version FROM {self._table_name};")
            if result and result.rows:
                return {int(row[0]) for row in result.rows}
        except VedaDBQueryError:
            pass
        return set()

    def _get_applied_migrations(self) -> list[MigrationRecord]:
        """Return ordered list of applied migration records."""
        try:
            result = self._db.query(
                f"SELECT version, name, applied_at, checksum "
                f"FROM {self._table_name} ORDER BY version DESC;"
            )
            if result and result.rows:
                return [
                    MigrationRecord(
                        version=int(row[0]),
                        name=str(row[1]),
                        applied_at=float(row[2]),
                        checksum=str(row[3]) if len(row) > 3 else "",
                    )
                    for row in result.rows
                ]
        except VedaDBQueryError:
            pass
        return []

    def _record_migration(self, record: MigrationRecord) -> None:
        """Record a migration as applied."""
        from .protocol import sql_literal
        sql = (
            f"INSERT INTO {self._table_name} "
            f"(version, name, applied_at, checksum) "
            f"VALUES ({record.version}, {sql_literal(record.name)}, "
            f"{record.applied_at}, {sql_literal(record.checksum)});"
        )
        self._db.query(sql)

    def _remove_migration(self, version: int) -> None:
        """Remove a migration record (for rollback)."""
        self._db.query(f"DELETE FROM {self._table_name} WHERE version = {version};")

    def _find_migration(self, version: int) -> Type[Migration] | None:
        """Find a migration class by version."""
        for m in self._migrations:
            if m.version == version:
                return m
        return None

    def __repr__(self) -> str:
        status = self.status()
        return (
            f"<MigrationRunner current=v{status['current_version']} "
            f"pending={status['pending_count']}>"
        )


# ---------------------------------------------------------------------------
# Decorator for inline migrations
# ---------------------------------------------------------------------------


def migration(version: int, name: str | None = None, dependencies: list[int] | None = None):
    """Decorator to register a function as a migration.

    Example::

        @migration(version=1, name="create_users")
        def create_users(db):
            db.query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);")

        @migration(version=2, name="add_email", dependencies=[1])
        def add_email(db):
            db.query("ALTER TABLE users ADD COLUMN email TEXT;")
    """
    def decorator(fn: Callable[[Any], None]) -> Type[Migration]:
        class_name = f"Migration_{version}_{fn.__name__}"
        attrs = {
            "version": version,
            "name": name or fn.__name__,
            "dependencies": dependencies or [],
            "upgrade": lambda self, db: fn(db),
            "downgrade": lambda self, db: None,
        }
        return type(class_name, (Migration,), attrs)

    return decorator
