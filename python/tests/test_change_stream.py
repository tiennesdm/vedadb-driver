"""test_change_stream.py — Change stream tests for VedaDB Python driver."""
import pytest
import time
import threading
from typing import Dict, Any, List, Optional, Callable
from queue import Queue, Empty
from enum import Enum, auto


class ChangeType(Enum):
    INSERT = auto()
    UPDATE = auto()
    DELETE = auto()


class ChangeEvent:
    """Represents a database change event."""

    def __init__(self, change_type: ChangeType, table: str,
                 data: Dict[str, Any], timestamp: float = None):
        self.type = change_type
        self.table = table
        self.data = data
        self.timestamp = timestamp or time.time()


class ChangeStream:
    """Stream of database change events."""

    def __init__(self, tables: List[str] = None):
        self._tables = tables or []
        self._queue: Queue = Queue(maxsize=1000)
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._listeners: List[Callable] = []
        self._lock = threading.Lock()

    def start(self):
        self._running = True

    def stop(self):
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    def add_listener(self, callback: Callable):
        with self._lock:
            self._listeners.append(callback)

    def remove_listener(self, callback: Callable):
        with self._lock:
            try:
                self._listeners.remove(callback)
            except ValueError:
                pass

    def emit(self, event: ChangeEvent):
        try:
            self._queue.put_nowait(event)
            with self._lock:
                for listener in self._listeners:
                    listener(event)
        except:
            pass

    def next_event(self, timeout: float = 1.0) -> Optional[ChangeEvent]:
        try:
            return self._queue.get(timeout=timeout)
        except Empty:
            return None

    def __iter__(self):
        return self

    def __next__(self):
        event = self.next_event(timeout=0.1)
        if event is None:
            raise StopIteration
        return event

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *args):
        self.stop()

    @property
    def event_count(self) -> int:
        return self._queue.qsize()

    @property
    def listener_count(self) -> int:
        with self._lock:
            return len(self._listeners)


class TestChangeStream:
    """Test suite for change streams."""

    def test_start_stop(self):
        """Test starting and stopping."""
        stream = ChangeStream()
        stream.start()
        assert stream.is_running is True
        stream.stop()
        assert stream.is_running is False

    def test_emit_and_receive(self):
        """Test emitting and receiving events."""
        stream = ChangeStream()
        event = ChangeEvent(ChangeType.INSERT, "users", {"id": 1, "name": "Alice"})
        stream.emit(event)
        received = stream.next_event(timeout=0.5)
        assert received is not None
        assert received.type == ChangeType.INSERT
        assert received.table == "users"
        assert received.data["name"] == "Alice"

    def test_multiple_events(self):
        """Test receiving multiple events."""
        stream = ChangeStream()
        for i in range(5):
            stream.emit(ChangeEvent(ChangeType.INSERT, "users", {"id": i}))
        events = []
        for _ in range(5):
            e = stream.next_event(timeout=0.5)
            if e:
                events.append(e)
        assert len(events) == 5

    def test_different_change_types(self):
        """Test different change event types."""
        stream = ChangeStream()
        stream.emit(ChangeEvent(ChangeType.INSERT, "t", {"id": 1}))
        stream.emit(ChangeEvent(ChangeType.UPDATE, "t", {"id": 1, "v": 2}))
        stream.emit(ChangeEvent(ChangeType.DELETE, "t", {"id": 1}))

        events = []
        for _ in range(3):
            e = stream.next_event(timeout=0.5)
            if e:
                events.append(e)

        assert events[0].type == ChangeType.INSERT
        assert events[1].type == ChangeType.UPDATE
        assert events[2].type == ChangeType.DELETE

    def test_add_listener(self):
        """Test adding event listeners."""
        stream = ChangeStream()
        received = []

        def listener(event):
            received.append(event)

        stream.add_listener(listener)
        stream.emit(ChangeEvent(ChangeType.INSERT, "t", {"id": 1}))
        time.sleep(0.01)
        assert len(received) == 1

    def test_remove_listener(self):
        """Test removing event listeners."""
        stream = ChangeStream()

        def listener(event):
            pass

        stream.add_listener(listener)
        assert stream.listener_count == 1
        stream.remove_listener(listener)
        assert stream.listener_count == 0

    def test_context_manager(self):
        """Test context manager."""
        with ChangeStream() as stream:
            assert stream.is_running is True
        assert stream.is_running is False

    def test_event_count(self):
        """Test event count."""
        stream = ChangeStream()
        assert stream.event_count == 0
        stream.emit(ChangeEvent(ChangeType.INSERT, "t", {"id": 1}))
        assert stream.event_count == 1

    def test_iterator(self):
        """Test iterator protocol."""
        stream = ChangeStream()
        stream.emit(ChangeEvent(ChangeType.INSERT, "t", {"id": 1}))
        stream.emit(ChangeEvent(ChangeType.INSERT, "t", {"id": 2}))

        events = []
        for e in stream:
            events.append(e)
            if len(events) >= 2:
                break

        assert len(events) == 2

    def test_timeout_no_event(self):
        """Test timeout when no event available."""
        stream = ChangeStream()
        result = stream.next_event(timeout=0.05)
        assert result is None

    def test_multiple_listeners(self):
        """Test multiple listeners receiving events."""
        stream = ChangeStream()
        received1 = []
        received2 = []

        stream.add_listener(lambda e: received1.append(e))
        stream.add_listener(lambda e: received2.append(e))

        stream.emit(ChangeEvent(ChangeType.INSERT, "t", {"id": 1}))
        time.sleep(0.01)

        assert len(received1) == 1
        assert len(received2) == 1
