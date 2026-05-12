"""
Streaming cursor for large result sets — O(1) memory regardless of result size.

Provides both synchronous and asynchronous iteration over query results
with configurable batch sizes.  The cursor fetches rows in chunks from
the server, yielding them one at a time to the caller.

Example — sync::

    for row in db.cursor("SELECT * FROM huge_table"):
        process(row)

Example — async::

    async for row in db.cursor("SELECT * FROM huge_table"):
        await process(row)

Example — with context manager::

    with db.cursor("SELECT * FROM huge_table", batch_size=500) as cur:
        for row in cur:
            process(row)
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Protocol as TypingProtocol

from .exceptions import VedaDBQueryError, VedaDBConnectionError
from .protocol import Result

logger = logging.getLogger("vedadb.cursor")


# A protocol-like interface for what the cursor needs from a client
class _CursorClient(TypingProtocol):
    """Protocol for client objects that cursors can use."""

    def query(self, sql: str, *, params: list | None = None) -> Result: ...
    async def query_async(self, sql: str, *, params: list | None = None) -> Result: ...


class Row:
    """A single result row with dict-like and attribute access.

    Wraps a raw row (list of values) along with column names for
    convenient access.

    Example::

        row = Row(["Alice", "30"], ["name", "age"])
        print(row["name"])   # "Alice"
        print(row.name)      # "Alice"
        print(row[0])        # "Alice"
    """

    def __init__(self, values: list, columns: list[str] | None):
        self._values = values
        self._columns = columns or []
        self._col_map: Dict[str, int] = (
            {c: i for i, c in enumerate(self._columns)} if self._columns else {}
        )

    @property
    def values(self) -> list:
        """Raw list of values."""
        return self._values

    @property
    def columns(self) -> list[str]:
        """Column names."""
        return list(self._columns)

    def keys(self) -> list[str]:
        """Return column names."""
        return self.columns

    def get(self, key: str, default: Any = None) -> Any:
        """Get a value by column name with optional default."""
        idx = self._col_map.get(key)
        if idx is not None and idx < len(self._values):
            return self._values[idx]
        return default

    def __getitem__(self, key: str | int) -> Any:
        if isinstance(key, int):
            return self._values[key]
        idx = self._col_map.get(key)
        if idx is None:
            raise KeyError(key)
        return self._values[idx]

    def __getattr__(self, name: str) -> Any:
        idx = self._col_map.get(name)
        if idx is not None:
            return self._values[idx]
        raise AttributeError(f"Row has no column {name!r}")

    def __len__(self) -> int:
        return len(self._values)

    def __iter__(self):
        return iter(self._values)

    def __repr__(self) -> str:
        items = {c: self._values[i] for i, c in enumerate(self._columns) if i < len(self._values)}
        return f"<Row {items!r}>"

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Row):
            return self._values == other._values and self._columns == other._columns
        return NotImplemented

    def to_dict(self) -> Dict[str, Any]:
        """Convert the row to a dict."""
        return {c: self._values[i] for i, c in enumerate(self._columns) if i < len(self._values)}


class Cursor:
    """Memory-efficient streaming cursor for large result sets.

    Fetches results in batches (using ``LIMIT`` / ``OFFSET`` windowing)
    and yields individual rows.  This keeps memory usage O(1) regardless
    of the total result set size.

    Both sync and async iteration are supported.

    Args:
        client: A :class:`VedaDB` or compatible client.
        sql: SQL query to execute.
        params: Optional parameter values.
        batch_size: Number of rows to fetch per batch.

    Example::

        for row in db.cursor("SELECT * FROM huge_table"):
            process(row)
    """

    def __init__(
        self,
        client: Any,
        sql: str,
        params: list | None = None,
        batch_size: int = 1000,
    ):
        self._client = client
        self._sql = sql
        self._params = params
        self._batch_size = batch_size
        self._offset = 0
        self._buffer: list[Row] = []
        self._buffer_idx = 0
        self._columns: list[str] | None = None
        self._closed = False
        self._total_yielded = 0

    # ------------------------------------------------------------------
    # Core iteration
    # ------------------------------------------------------------------

    def _fetch_batch(self) -> bool:
        """Fetch the next batch of rows. Return True if any rows were fetched."""
        if self._closed:
            return False

        # Build a windowed query
        windowed_sql = self._sql.rstrip(";\n ")
        if "LIMIT " not in windowed_sql.upper():
            windowed_sql += f" LIMIT {self._batch_size}"
        if "OFFSET " not in windowed_sql.upper():
            windowed_sql += f" OFFSET {self._offset}"
        windowed_sql += ";"

        try:
            result = self._client.query(windowed_sql, params=self._params)
        except Exception as exc:
            logger.error("Cursor batch fetch failed at offset %d: %s", self._offset, exc)
            raise

        if not result or not result.rows:
            return False

        self._columns = result.columns
        self._buffer = [Row(row, result.columns) for row in result.rows]
        self._buffer_idx = 0
        self._offset += len(result.rows)

        logger.debug(
            "Cursor fetched batch: offset=%d count=%d",
            self._offset - len(result.rows),
            len(self._buffer),
        )
        return len(self._buffer) > 0

    async def _fetch_batch_async(self) -> bool:
        """Async variant of _fetch_batch."""
        if self._closed:
            return False

        windowed_sql = self._sql.rstrip(";\n ")
        if "LIMIT " not in windowed_sql.upper():
            windowed_sql += f" LIMIT {self._batch_size}"
        if "OFFSET " not in windowed_sql.upper():
            windowed_sql += f" OFFSET {self._offset}"
        windowed_sql += ";"

        import asyncio

        try:
            result = self._client.query(windowed_sql, params=self._params)
            if asyncio.iscoroutine(result):
                result = await result
        except Exception as exc:
            logger.error("Cursor async batch fetch failed at offset %d: %s", self._offset, exc)
            raise

        if not result or not result.rows:
            return False

        self._columns = result.columns
        self._buffer = [Row(row, result.columns) for row in result.rows]
        self._buffer_idx = 0
        self._offset += len(result.rows)
        return len(self._buffer) > 0

    # ------------------------------------------------------------------
    # Sync iterator
    # ------------------------------------------------------------------

    def __iter__(self) -> Iterator[Row]:
        return self

    def __next__(self) -> Row:
        if self._closed:
            raise StopIteration

        # Return from buffer if available
        if self._buffer_idx < len(self._buffer):
            row = self._buffer[self._buffer_idx]
            self._buffer_idx += 1
            self._total_yielded += 1
            return row

        # Fetch next batch
        if not self._fetch_batch():
            raise StopIteration

        # Return first row from new buffer
        row = self._buffer[self._buffer_idx]
        self._buffer_idx += 1
        self._total_yielded += 1
        return row

    # ------------------------------------------------------------------
    # Async iterator
    # ------------------------------------------------------------------

    def __aiter__(self) -> AsyncIterator[Row]:
        return self

    async def __anext__(self) -> Row:
        if self._closed:
            raise StopAsyncIteration

        if self._buffer_idx < len(self._buffer):
            row = self._buffer[self._buffer_idx]
            self._buffer_idx += 1
            self._total_yielded += 1
            return row

        if not await self._fetch_batch_async():
            raise StopAsyncIteration

        row = self._buffer[self._buffer_idx]
        self._buffer_idx += 1
        self._total_yielded += 1
        return row

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def __enter__(self) -> "Cursor":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()

    async def __aenter__(self) -> "Cursor":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def columns(self) -> list[str] | None:
        """Column names from the query result (available after first iteration)."""
        return self._columns

    @property
    def total_yielded(self) -> int:
        """Total number of rows yielded so far."""
        return self._total_yielded

    @property
    def closed(self) -> bool:
        """Whether the cursor is closed."""
        return self._closed

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the cursor and release resources."""
        self._closed = True
        self._buffer.clear()

    def fetchall(self) -> list[Row]:
        """Fetch all remaining rows (not recommended for large results).

        Returns:
            List of all remaining :class:`Row` objects.
        """
        return list(self)

    async def fetchall_async(self) -> list[Row]:
        """Async variant of :meth:`fetchall`."""
        rows: list[Row] = []
        async for row in self:
            rows.append(row)
        return rows

    def fetchone(self) -> Row | None:
        """Fetch the next row, or None if there are no more rows."""
        try:
            return next(self)
        except StopIteration:
            return None

    def fetchmany(self, size: int | None = None) -> list[Row]:
        """Fetch up to *size* rows (default: batch_size)."""
        size = size or self._batch_size
        rows: list[Row] = []
        for _ in range(size):
            try:
                rows.append(next(self))
            except StopIteration:
                break
        return rows

    def __repr__(self) -> str:
        return (
            f"<Cursor offset={self._offset} "
            f"yielded={self._total_yielded} "
            f"batch={self._batch_size} "
            f"closed={self._closed}>"
        )
