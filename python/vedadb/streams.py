"""
Change streams (CDC) for VedaDB — watch for database changes in real-time.

Simulates a MongoDB-style Change Stream by polling the query log / WAL
or leveraging server-side change notifications if available.

Example::

    from vedadb.streams import ChangeStream, ChangeEvent

    async for event in ChangeStream(db).watch("users"):
        print(f"{event.operation_type} on {event.table}: {event.full_document}")
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable, Dict, Iterator, List, Optional, Set

from .exceptions import VedaDBConnectionError, VedaDBQueryError

logger = logging.getLogger("vedadb.streams")


@dataclass
class ChangeEvent:
    """A single change event from the database.

    Attributes:
        operation_type: One of ``"insert"``, ``"update"``, ``"delete"``,
            or ``"replace"``.
        table: The table that was modified.
        document_key: The primary key of the modified row.
        full_document: The complete row data (for inserts and updates).
        update_description: Dict describing which fields changed.
        cluster_time: Timestamp of the change.
    """

    operation_type: str
    table: str
    document_key: str
    full_document: dict = field(default_factory=dict)
    update_description: dict = field(default_factory=dict)
    cluster_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_json(self) -> str:
        """Serialize the event to JSON."""
        return json.dumps(
            {
                "operation_type": self.operation_type,
                "table": self.table,
                "document_key": self.document_key,
                "full_document": self.full_document,
                "update_description": self.update_description,
                "cluster_time": self.cluster_time.isoformat(),
            }
        )


class ChangeStream:
    """Watch for database changes in real-time.

    Uses a combination of polling and (optionally) server push to
    deliver change events.  Events are delivered in near-real-time
    with configurable poll intervals.

    Args:
        client: A :class:`VedaDB` or compatible client with ``query()``, 
            ``ping()`` methods.
        poll_interval: Seconds between polls when no events are available.
        resume_after: Optional event ID to resume from after a disconnect.

    Example::

        stream = ChangeStream(db, poll_interval=1.0)
        async for event in stream.watch("users"):
            handle_change(event)
    """

    def __init__(
        self,
        client: Any,
        poll_interval: float = 1.0,
        resume_after: str | None = None,
    ):
        self._client = client
        self._poll_interval = poll_interval
        self._resume_after = resume_after
        self._running = False
        self._sequence = 0
        self._tracked_tables: Set[str] = set()

    # ------------------------------------------------------------------
    # Core watch
    # ------------------------------------------------------------------

    async def watch(self, table: str | None = None) -> AsyncIterator[ChangeEvent]:
        """Yield change events as they occur.

        Args:
            table: If provided, only watch changes on this table.

        Yields:
            :class:`ChangeEvent` objects.
        """
        self._running = True
        if table:
            self._tracked_tables.add(table)

        # Track last seen IDs to avoid duplicate events
        last_seen: Set[str] = set()
        if self._resume_after:
            last_seen.add(self._resume_after)

        logger.info(
            "ChangeStream started watching %s (poll=%.1fs)",
            table or "all tables",
            self._poll_interval,
        )

        try:
            while self._running:
                try:
                    events = await self._poll_changes(table, last_seen)
                    for event in events:
                        yield event
                except VedaDBConnectionError:
                    logger.warning("ChangeStream connection lost, retrying...")
                    await asyncio.sleep(self._poll_interval * 2)
                except Exception as exc:
                    logger.error("ChangeStream error: %s", exc)
                    await asyncio.sleep(self._poll_interval)

                if not events:
                    await asyncio.sleep(self._poll_interval)
        finally:
            logger.info("ChangeStream stopped")

    def watch_sync(self, table: str | None = None) -> Iterator[ChangeEvent]:
        """Synchronous variant of :meth:`watch`.

        Yields :class:`ChangeEvent` objects.  Blocks between polls.
        """
        self._running = True
        if table:
            self._tracked_tables.add(table)

        last_seen: Set[str] = set()
        logger.info(
            "ChangeStream (sync) started watching %s",
            table or "all tables",
        )

        while self._running:
            try:
                events = self._poll_changes_sync(table, last_seen)
                for event in events:
                    yield event
            except VedaDBConnectionError:
                logger.warning("ChangeStream connection lost, retrying...")
                time.sleep(self._poll_interval * 2)
            except Exception as exc:
                logger.error("ChangeStream error: %s", exc)
                time.sleep(self._poll_interval)

            if not events:
                time.sleep(self._poll_interval)

    # ------------------------------------------------------------------
    # Polling implementations
    # ------------------------------------------------------------------

    async def _poll_changes(
        self, table: str | None, last_seen: Set[str]
    ) -> list[ChangeEvent]:
        """Poll the database for recent changes."""
        events: list[ChangeEvent] = []

        # Query the WAL / change log
        query = self._build_changelog_query(table)
        try:
            result = await self._async_query(query)
        except Exception:
            # Fall back to sync query
            result = self._client.query(query)

        if result and hasattr(result, "to_dicts"):
            for row in result.to_dicts():
                event_id = f"{row.get('table', '')}:{row.get('key', '')}:{row.get('ts', '')}"
                if event_id in last_seen:
                    continue
                last_seen.add(event_id)
                if len(last_seen) > 10000:
                    last_seen = set(list(last_seen)[-5000:])

                event = ChangeEvent(
                    operation_type=row.get("operation", "unknown"),
                    table=row.get("table", table or "unknown"),
                    document_key=str(row.get("key", "")),
                    full_document=self._parse_json(row.get("data", "")),
                    update_description=self._parse_json(row.get("changes", "")),
                    cluster_time=self._parse_timestamp(row.get("ts", "")),
                )
                events.append(event)

        return events

    def _poll_changes_sync(
        self, table: str | None, last_seen: Set[str]
    ) -> list[ChangeEvent]:
        """Synchronous poll for changes."""
        events: list[ChangeEvent] = []

        query = self._build_changelog_query(table)
        result = self._client.query(query)

        if result and hasattr(result, "to_dicts"):
            for row in result.to_dicts():
                event_id = f"{row.get('table', '')}:{row.get('key', '')}:{row.get('ts', '')}"
                if event_id in last_seen:
                    continue
                last_seen.add(event_id)
                if len(last_seen) > 10000:
                    last_seen = set(list(last_seen)[-5000:])

                event = ChangeEvent(
                    operation_type=row.get("operation", "unknown"),
                    table=row.get("table", table or "unknown"),
                    document_key=str(row.get("key", "")),
                    full_document=self._parse_json(row.get("data", "")),
                    update_description=self._parse_json(row.get("changes", "")),
                    cluster_time=self._parse_timestamp(row.get("ts", "")),
                )
                events.append(event)

        return events

    def _build_changelog_query(self, table: str | None) -> str:
        """Build a query to fetch recent changes from the WAL."""
        base = "SELECT * FROM _changelog WHERE 1=1"
        if table:
            base += f" AND table_name = '{table}'"
        base += f" AND ts > datetime('now', '-{int(max(self._poll_interval * 2, 1))} seconds')"
        base += " ORDER BY ts ASC LIMIT 1000"
        return base

    async def _async_query(self, query: str):
        """Execute a query, handling both sync and async clients."""
        import asyncio

        result = self._client.query(query)
        if asyncio.iscoroutine(result):
            return await result
        return result

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_json(value: Any) -> dict:
        if isinstance(value, dict):
            return value
        if isinstance(value, str) and value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return {"raw": value}
        return {}

    @staticmethod
    def _parse_timestamp(value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                pass
        return datetime.now(timezone.utc)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Stop the change stream."""
        self._running = False

    def close(self) -> None:
        """Alias for :meth:`stop`."""
        self.stop()

    def __enter__(self) -> "ChangeStream":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.stop()

    def __repr__(self) -> str:
        return f"<ChangeStream tables={self._tracked_tables} running={self._running}>"


# ---------------------------------------------------------------------------
# Helper: build ChangeEvent from raw dict
# ---------------------------------------------------------------------------


def make_change_event(raw: dict) -> ChangeEvent:
    """Create a :class:`ChangeEvent` from a raw dict (e.g. JSON payload)."""
    ts = raw.get("cluster_time", datetime.now(timezone.utc))
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            ts = datetime.now(timezone.utc)
    return ChangeEvent(
        operation_type=raw.get("operation_type", "unknown"),
        table=raw.get("table", "unknown"),
        document_key=str(raw.get("document_key", "")),
        full_document=raw.get("full_document", {}),
        update_description=raw.get("update_description", {}),
        cluster_time=ts,
    )
