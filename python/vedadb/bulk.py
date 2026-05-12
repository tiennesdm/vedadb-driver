"""
Bulk / batch operations for high-throughput data loading.

Provides:
- :class:`BulkInserter` — batch INSERT operations with automatic flushing
- :class:`Pipeline` — Redis-style pipeline for chaining queries into a single batch

Example — bulk insert::

    with db.bulk_insert("users", batch_size=1000) as bulk:
        for user in users:
            bulk.add({"name": user.name, "email": user.email})
    # 10000 users = 10 network calls (was 10000 calls)

Example — query pipeline::

    pipe = db.pipeline()
    for i in range(100):
        pipe.query("SELECT * FROM users WHERE id = ?", [i])
    results = pipe.run()  # 1 network call
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Protocol as TypingProtocol, Union

from .exceptions import VedaDBValidationError
from .protocol import Protocol, Result, sql_literal

logger = logging.getLogger("vedadb.bulk")

# ---------------------------------------------------------------------------
# _Row type helper
# ---------------------------------------------------------------------------

_Row = Dict[str, Any]


# ---------------------------------------------------------------------------
# BulkInserter
# ---------------------------------------------------------------------------


class BulkInserter:
    """Batch INSERT operations for high-throughput data loading.

    Accumulates rows in memory and flushes them to the server when the
    batch size is reached, or on explicit :meth:`flush` / exit.

    Args:
        table: Target table name.
        batch_size: Number of rows per batch.
        protocol: Optional :class:`Protocol` instance to use for queries.
            If not provided, ``flush_fn`` must be given.
        flush_fn: Optional callable ``(sql) -> Result`` to execute SQL.
    """

    def __init__(
        self,
        table: str,
        batch_size: int = 1000,
        *,
        protocol: Protocol | None = None,
        flush_fn: Callable[[str], Result] | None = None,
    ):
        if not table or not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table):
            raise VedaDBValidationError(f"invalid table name: {table!r}")
        if batch_size < 1:
            raise VedaDBValidationError("batch_size must be >= 1")

        self.table = table
        self.batch_size = batch_size
        self._protocol = protocol
        self._flush_fn = flush_fn
        self._buffer: list[_Row] = []
        self._total_inserted = 0
        self._total_batches = 0

    # ------------------------------------------------------------------
    # Core methods
    # ------------------------------------------------------------------

    def add(self, row: dict) -> "BulkInserter":
        """Add a row to the buffer. Flush if buffer reaches batch_size.

        Args:
            row: Dict of column-name → value mappings.

        Returns:
            Self for method chaining.
        """
        if not isinstance(row, dict):
            raise VedaDBValidationError("row must be a dict")
        self._buffer.append(row)
        if len(self._buffer) >= self.batch_size:
            self.flush()
        return self

    def add_many(self, rows: Iterator[dict]) -> "BulkInserter":
        """Add multiple rows from an iterable.

        Returns:
            Self for method chaining.
        """
        for row in rows:
            self.add(row)
        return self

    def flush(self) -> int:
        """Manually flush the current buffer to the server.

        Returns:
            Number of rows inserted in this flush.
        """
        if not self._buffer:
            return 0

        row_count = len(self._buffer)
        sql = self._build_insert_sql(self._buffer)
        self._execute(sql)

        self._total_inserted += row_count
        self._total_batches += 1
        self._buffer.clear()

        logger.debug(
            "BulkInserter flushed %d rows to %r (total=%d batches=%d)",
            row_count,
            self.table,
            self._total_inserted,
            self._total_batches,
        )
        return row_count

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def buffered(self) -> int:
        """Number of rows currently in the buffer (not yet flushed)."""
        return len(self._buffer)

    @property
    def total_inserted(self) -> int:
        """Total number of rows inserted across all flushes."""
        return self._total_inserted

    @property
    def total_batches(self) -> int:
        """Total number of flush operations performed."""
        return self._total_batches

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_insert_sql(self, rows: list[_Row]) -> str:
        """Build a multi-row INSERT statement."""
        if not rows:
            return ""
        columns = list(rows[0].keys())
        col_str = ", ".join(columns)
        value_rows: list[str] = []
        for row in rows:
            values = [sql_literal(row.get(c)) for c in columns]
            value_rows.append(f"({', '.join(values)})")
        values_str = ", ".join(value_rows)
        return f"INSERT INTO {self.table} ({col_str}) VALUES {values_str};"

    def _execute(self, sql: str) -> Result:
        if self._protocol:
            return self._protocol.query(sql)
        if self._flush_fn:
            return self._flush_fn(sql)
        raise VedaDBValidationError(
            "BulkInserter has no protocol or flush_fn — cannot flush"
        )

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def __enter__(self) -> "BulkInserter":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.flush()
        if exc is not None:
            logger.warning("BulkInserter exiting with exception: %s", exc)

    def __repr__(self) -> str:
        return (
            f"<BulkInserter table={self.table!r} "
            f"buffered={len(self._buffer)}/{self.batch_size} "
            f"inserted={self._total_inserted}>"
        )


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


@dataclass
class _PipelineOp:
    """Internal: a single pipelined operation."""

    sql: str
    params: list | None = None


class Pipeline:
    """Redis-style pipeline for chaining queries into a single batch.

    Collects multiple queries and sends them all in one network call
    via the batch REST endpoint.  This dramatically reduces latency
    when executing many independent queries.

    Args:
        client: A :class:`VedaDB` or compatible client with a
            :meth:`batch` method.

    Example::

        pipe = db.pipeline()
        for i in range(100):
            pipe.query("SELECT * FROM users WHERE id = ?", [i])
        results = pipe.run()  # 1 network call
    """

    def __init__(self, client: Any):
        self._client = client
        self._operations: list[_PipelineOp] = []

    # ------------------------------------------------------------------
    # Building
    # ------------------------------------------------------------------

    def query(self, sql: str, params: list | None = None) -> "Pipeline":
        """Add a query to the pipeline.

        Returns:
            Self for method chaining.
        """
        self._operations.append(_PipelineOp(sql, params))
        return self

    def execute(self, sql: str, params: list | None = None) -> "Pipeline":
        """Alias for :meth:`query`."""
        return self.query(sql, params)

    def insert_into(self, table: str, row: dict) -> "Pipeline":
        """Add an INSERT operation to the pipeline.

        The row dict is converted to an ``INSERT INTO ... VALUES ...``
        statement.
        """
        columns = list(row.keys())
        values = [sql_literal(row[c]) for c in columns]
        sql = (
            f"INSERT INTO {table} "
            f"({', '.join(columns)}) "
            f"VALUES ({', '.join(values)});"
        )
        self._operations.append(_PipelineOp(sql))
        return self

    def update(self, table: str, row: dict, where: str) -> "Pipeline":
        """Add an UPDATE operation to the pipeline."""
        sets = ", ".join(f"{k} = {sql_literal(v)}" for k, v in row.items())
        sql = f"UPDATE {table} SET {sets} WHERE {where};"
        self._operations.append(_PipelineOp(sql))
        return self

    def delete_from(self, table: str, where: str) -> "Pipeline":
        """Add a DELETE operation to the pipeline."""
        sql = f"DELETE FROM {table} WHERE {where};"
        self._operations.append(_PipelineOp(sql))
        return self

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def run(self) -> list[Result]:
        """Execute all pipelined queries.

        Returns:
            List of :class:`Result` objects, one per pipelined query.

        Raises:
            VedaDBValidationError: If the pipeline is empty or exceeds
                the server's batch limit.
        """
        if not self._operations:
            return []

        # Build batch operations
        operations: list[dict] = []
        for op in self._operations:
            body: dict[str, Any] = {"query": op.sql}
            if op.params:
                body["params"] = [json.dumps(p, default=str) for p in op.params]
            operations.append({"method": "POST", "path": "/v1/query", "body": body})

        logger.debug(
            "Pipeline executing %d operations in 1 batch call", len(operations)
        )

        raw_results = self._client.batch(operations)

        # Parse results
        results: list[Result] = []
        for raw in raw_results:
            if isinstance(raw, dict):
                if "error" in raw:
                    from .exceptions import VedaDBQueryError
                    raise VedaDBQueryError(raw["error"])
                results.append(
                    Result(
                        columns=raw.get("columns"),
                        rows=raw.get("rows"),
                        row_count=raw.get("row_count", 0),
                        message=raw.get("message", ""),
                    )
                )
            else:
                results.append(
                    Result(columns=None, rows=None, row_count=0, message=str(raw))
                )

        # Clear after successful execution
        op_count = len(self._operations)
        self._operations.clear()

        logger.debug("Pipeline completed: %d results returned", len(results))
        return results

    def run_one(self) -> Result:
        """Run the pipeline and return exactly one result.

        Raises:
            ValueError: If the pipeline does not contain exactly one operation.
        """
        if len(self._operations) != 1:
            raise ValueError(f"expected 1 operation, got {len(self._operations)}")
        results = self.run()
        return results[0]

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    @property
    def size(self) -> int:
        """Number of operations currently in the pipeline."""
        return len(self._operations)

    def clear(self) -> "Pipeline":
        """Clear all pending operations without executing them."""
        self._operations.clear()
        return self

    def __len__(self) -> int:
        return len(self._operations)

    def __repr__(self) -> str:
        return f"<Pipeline size={len(self._operations)}>"


# ---------------------------------------------------------------------------
# Convenience factory functions (attach to VedaDB)
# ---------------------------------------------------------------------------


def bulk_insert(
    table: str,
    batch_size: int = 1000,
    *,
    protocol: Protocol | None = None,
    flush_fn: Callable[[str], Result] | None = None,
) -> BulkInserter:
    """Create a :class:`BulkInserter` for the given table.

    Example::

        with bulk_insert("users", batch_size=500, flush_fn=db.query) as bi:
            for row in rows:
                bi.add(row)
    """
    return BulkInserter(table=table, batch_size=batch_size, protocol=protocol, flush_fn=flush_fn)


def pipeline(client: Any) -> Pipeline:
    """Create a :class:`Pipeline` bound to *client*.

    Example::

        p = pipeline(db)
        for i in range(100):
            p.query("SELECT * FROM users WHERE id = ?", [i])
        results = p.run()
    """
    return Pipeline(client)
