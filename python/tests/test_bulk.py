"""test_bulk.py — Bulk operations tests for VedaDB Python driver."""
import pytest
import time
import threading
from typing import List, Dict, Any, Optional
from queue import Queue
from unittest.mock import Mock


class BulkInserter:
    """Handles batch insert operations."""

    def __init__(self, client, table: str, columns: List[str],
                 batch_size: int = 100):
        self._client = client
        self._table = table
        self._columns = columns
        self._batch_size = batch_size
        self._buffer: List[Dict[str, Any]] = []
        self._total_sent = 0
        self._total_errors = 0
        self._lock = threading.Lock()

    def insert(self, row: Dict[str, Any]) -> None:
        with self._lock:
            self._buffer.append(row)
            if len(self._buffer) >= self._batch_size:
                self._flush()

    def insert_many(self, rows: List[Dict[str, Any]]) -> None:
        for row in rows:
            self.insert(row)

    def flush(self) -> int:
        with self._lock:
            return self._flush()

    def _flush(self) -> int:
        if not self._buffer:
            return 0
        count = len(self._buffer)
        # Mock: send to client
        self._total_sent += count
        self._buffer.clear()
        return count

    def close(self) -> int:
        return self.flush()

    @property
    def total_sent(self) -> int:
        return self._total_sent

    @property
    def pending(self) -> int:
        return len(self._buffer)

    @property
    def buffer_size(self) -> int:
        return self._batch_size


class Pipeline:
    """Pipeline for batching multiple operations."""

    def __init__(self, client):
        self._client = client
        self._commands: List[Dict[str, Any]] = []
        self._lock = threading.Lock()

    def add(self, sql: str, params=None):
        with self._lock:
            self._commands.append({"sql": sql, "params": params or []})

    def execute(self) -> List[Dict[str, Any]]:
        with self._lock:
            commands = self._commands[:]
            self._commands.clear()
        # Mock execution
        return [{"rows_affected": 1} for _ in commands]

    def __len__(self) -> int:
        return len(self._commands)

    def clear(self):
        with self._lock:
            self._commands.clear()


class TestBulkInserter:
    """Test suite for bulk inserter."""

    def test_insert_single_row(self):
        """Test inserting a single row."""
        client = Mock()
        inserter = BulkInserter(client, "users", ["name", "age"], batch_size=10)
        inserter.insert({"name": "Alice", "age": 30})
        assert inserter.pending == 1
        assert inserter.total_sent == 0  # Not flushed yet

    def test_auto_flush(self):
        """Test automatic flush when batch is full."""
        client = Mock()
        inserter = BulkInserter(client, "users", ["name"], batch_size=3)
        inserter.insert({"name": "Alice"})
        inserter.insert({"name": "Bob"})
        inserter.insert({"name": "Charlie"})  # Should trigger flush
        assert inserter.total_sent == 3
        assert inserter.pending == 0

    def test_explicit_flush(self):
        """Test explicit flush call."""
        client = Mock()
        inserter = BulkInserter(client, "users", ["name"], batch_size=100)
        for i in range(5):
            inserter.insert({"name": f"User{i}"})
        assert inserter.pending == 5
        inserter.flush()
        assert inserter.total_sent == 5
        assert inserter.pending == 0

    def test_close_flushes(self):
        """Test that close flushes remaining rows."""
        client = Mock()
        inserter = BulkInserter(client, "users", ["name"], batch_size=100)
        for i in range(7):
            inserter.insert({"name": f"User{i}"})
        inserter.close()
        assert inserter.total_sent == 7
        assert inserter.pending == 0

    def test_insert_many(self):
        """Test insert_many with list."""
        client = Mock()
        inserter = BulkInserter(client, "users", ["name"], batch_size=50)
        rows = [{"name": f"User{i}"} for i in range(25)]
        inserter.insert_many(rows)
        inserter.close()
        assert inserter.total_sent == 25

    def test_empty_flush(self):
        """Test flushing empty buffer."""
        client = Mock()
        inserter = BulkInserter(client, "users", ["name"], batch_size=10)
        result = inserter.flush()
        assert result == 0

    def test_batch_size_1(self):
        """Test with batch_size of 1."""
        client = Mock()
        inserter = BulkInserter(client, "users", ["name"], batch_size=1)
        inserter.insert({"name": "Alice"})
        assert inserter.total_sent == 1  # Flushed immediately

    def test_concurrent_inserts(self):
        """Test thread-safe concurrent inserts."""
        client = Mock()
        inserter = BulkInserter(client, "users", ["id"], batch_size=50)
        threads = []

        for i in range(100):
            t = threading.Thread(target=lambda n=i: inserter.insert({"id": n}))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        inserter.close()
        assert inserter.total_sent == 100

    def test_buffer_size_property(self):
        """Test buffer_size property."""
        inserter = BulkInserter(Mock(), "t", ["c"], batch_size=42)
        assert inserter.buffer_size == 42


class TestPipeline:
    """Test suite for pipeline operations."""

    def test_add_command(self):
        """Test adding commands to pipeline."""
        pipeline = Pipeline(Mock())
        pipeline.add("INSERT INTO users VALUES (?)", [1])
        assert len(pipeline) == 1

    def test_add_multiple(self):
        """Test adding multiple commands."""
        pipeline = Pipeline(Mock())
        pipeline.add("INSERT INTO a VALUES (1)")
        pipeline.add("INSERT INTO b VALUES (2)")
        pipeline.add("UPDATE c SET x = 3")
        assert len(pipeline) == 3

    def test_execute_returns_results(self):
        """Test pipeline execution."""
        pipeline = Pipeline(Mock())
        pipeline.add("INSERT INTO t VALUES (1)")
        pipeline.add("INSERT INTO t VALUES (2)")
        results = pipeline.execute()
        assert len(results) == 2
        assert all(r["rows_affected"] == 1 for r in results)

    def test_execute_clears_pipeline(self):
        """Test that execute clears the pipeline."""
        pipeline = Pipeline(Mock())
        pipeline.add("INSERT INTO t VALUES (1)")
        pipeline.execute()
        assert len(pipeline) == 0

    def test_execute_empty(self):
        """Test executing empty pipeline."""
        pipeline = Pipeline(Mock())
        results = pipeline.execute()
        assert results == []

    def test_clear(self):
        """Test clearing the pipeline."""
        pipeline = Pipeline(Mock())
        pipeline.add("INSERT INTO t VALUES (1)")
        pipeline.add("INSERT INTO t VALUES (2)")
        pipeline.clear()
        assert len(pipeline) == 0
