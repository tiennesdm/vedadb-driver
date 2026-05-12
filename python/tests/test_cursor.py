"""test_cursor.py — Cursor tests for VedaDB Python driver."""
import pytest
from typing import List, Dict, Any, Optional


class Cursor:
    """Cursor for iterating over query results."""

    def __init__(self, rows: List[Dict[str, Any]]):
        self._rows = rows
        self._position = -1
        self._closed = False

    def next(self) -> bool:
        if self._closed:
            return False
        self._position += 1
        return 0 <= self._position < len(self._rows)

    def fetchone(self) -> Optional[Dict[str, Any]]:
        if self._closed or self._position < 0 or self._position >= len(self._rows):
            return None
        return dict(self._rows[self._position])

    def fetchmany(self, size: int = 1) -> List[Dict[str, Any]]:
        if self._closed:
            return []
        start = self._position if self._position >= 0 else 0
        end = min(start + size, len(self._rows))
        return [dict(r) for r in self._rows[start:end]]

    def fetchall(self) -> List[Dict[str, Any]]:
        if self._closed:
            return []
        start = self._position if self._position >= 0 else 0
        return [dict(r) for r in self._rows[start:]]

    def close(self):
        self._closed = True

    @property
    def rowcount(self) -> int:
        return len(self._rows)

    @property
    def position(self) -> int:
        return self._position

    @property
    def closed(self) -> bool:
        return self._closed

    def __iter__(self):
        return self

    def __next__(self):
        if not self.next():
            raise StopIteration
        return self.fetchone()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class TestCursor:
    """Test suite for cursor."""

    def test_iterate_all_rows(self):
        """Test iterating all rows."""
        rows = [
            {"id": 1, "name": "Alice"},
            {"id": 2, "name": "Bob"},
            {"id": 3, "name": "Charlie"},
        ]
        cursor = Cursor(rows)
        results = []
        while cursor.next():
            results.append(cursor.fetchone())
        assert len(results) == 3
        assert results[0]["name"] == "Alice"

    def test_empty_result(self):
        """Test cursor with no rows."""
        cursor = Cursor([])
        assert cursor.next() is False
        assert cursor.rowcount == 0

    def test_single_row(self):
        """Test cursor with single row."""
        cursor = Cursor([{"id": 1, "value": "only"}])
        assert cursor.next() is True
        row = cursor.fetchone()
        assert row["value"] == "only"
        assert cursor.next() is False

    def test_close_prevents_iteration(self):
        """Test that closed cursor prevents iteration."""
        cursor = Cursor([{"id": 1}])
        cursor.close()
        assert cursor.next() is False
        assert cursor.fetchone() is None

    def test_rowcount(self):
        """Test row count property."""
        rows = [{"id": i} for i in range(100)]
        cursor = Cursor(rows)
        assert cursor.rowcount == 100

    def test_fetchmany(self):
        """Test fetchmany."""
        rows = [{"id": i} for i in range(10)]
        cursor = Cursor(rows)
        cursor.next()  # Position at first
        batch = cursor.fetchmany(3)
        assert len(batch) == 3

    def test_fetchall(self):
        """Test fetchall."""
        rows = [{"id": i} for i in range(5)]
        cursor = Cursor(rows)
        cursor.next()
        all_rows = cursor.fetchall()
        assert len(all_rows) == 5

    def test_iterator_protocol(self):
        """Test iterator protocol."""
        rows = [{"id": 1}, {"id": 2}, {"id": 3}]
        cursor = Cursor(rows)
        results = list(cursor)
        assert len(results) == 3

    def test_context_manager(self):
        """Test context manager."""
        with Cursor([{"id": 1}]) as cursor:
            assert cursor.next() is True
        assert cursor.closed is True

    def test_fetchone_before_next(self):
        """Test fetchone before calling next."""
        cursor = Cursor([{"id": 1}])
        row = cursor.fetchone()
        assert row is None  # Position is -1

    def test_large_result(self):
        """Test cursor with large result set."""
        rows = [{"id": i, "data": f"row-{i}"} for i in range(10000)]
        cursor = Cursor(rows)
        count = 0
        while cursor.next():
            count += 1
        assert count == 10000

    def test_position_tracking(self):
        """Test position tracking."""
        rows = [{"id": i} for i in range(10)]
        cursor = Cursor(rows)
        assert cursor.position == -1
        cursor.next()
        assert cursor.position == 0
        for _ in range(5):
            cursor.next()
        assert cursor.position == 5

    def test_data_isolation(self):
        """Test that returned data is isolated from internal storage."""
        rows = [{"id": 1, "items": [1, 2, 3]}]
        cursor = Cursor(rows)
        cursor.next()
        row = cursor.fetchone()
        row["id"] = 999  # Modify returned row
        cursor.next()
        cursor2 = Cursor(rows)
        cursor2.next()
        original = cursor2.fetchone()
        assert original["id"] == 1  # Original unchanged
