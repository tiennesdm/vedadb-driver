"""test_pubsub.py — Pub/Sub tests for VedaDB Python driver."""
import pytest
import time
import threading
from typing import Dict, List, Callable, Optional
from queue import Queue, Empty
from unittest.mock import Mock


class Message:
    """Pub/Sub message."""

    def __init__(self, channel: str, data: bytes, msg_id: str = None):
        self.channel = channel
        self.data = data
        self.id = msg_id or f"msg-{id(self)}"


class PubSub:
    """Pub/Sub implementation for VedaDB."""

    def __init__(self):
        self._subscribers: Dict[str, List[Queue]] = {}
        self._closed = False
        self._lock = threading.Lock()

    def subscribe(self, channel: str) -> Queue:
        with self._lock:
            if self._closed:
                raise RuntimeError("PubSub is closed")
            if channel not in self._subscribers:
                self._subscribers[channel] = []
            queue = Queue(maxsize=1000)
            self._subscribers[channel].append(queue)
            return queue

    def publish(self, channel: str, data: bytes) -> int:
        with self._lock:
            if self._closed:
                raise RuntimeError("PubSub is closed")
            msg = Message(channel, data)
            queues = self._subscribers.get(channel, [])
            for q in queues:
                try:
                    q.put_nowait(msg)
                except:
                    pass
            return len(queues)

    def unsubscribe(self, channel: str, queue: Queue):
        with self._lock:
            if channel in self._subscribers:
                try:
                    self._subscribers[channel].remove(queue)
                except ValueError:
                    pass

    def subscriber_count(self, channel: str) -> int:
        with self._lock:
            return len(self._subscribers.get(channel, []))

    def close(self):
        with self._lock:
            self._closed = True
            for queues in self._subscribers.values():
                for q in queues:
                    while not q.empty():
                        try:
                            q.get_nowait()
                        except Empty:
                            break

    @property
    def is_closed(self) -> bool:
        return self._closed


class TestPubSub:
    """Test suite for pub/sub."""

    def test_publish_subscribe(self):
        """Test basic publish and subscribe."""
        ps = PubSub()
        queue = ps.subscribe("test-channel")
        count = ps.publish("test-channel", b"hello")
        assert count == 1
        msg = queue.get(timeout=1.0)
        assert msg.data == b"hello"
        assert msg.channel == "test-channel"

    def test_multiple_subscribers(self):
        """Test multiple subscribers on same channel."""
        ps = PubSub()
        q1 = ps.subscribe("broadcast")
        q2 = ps.subscribe("broadcast")
        q3 = ps.subscribe("broadcast")
        count = ps.publish("broadcast", b"to-all")
        assert count == 3
        assert q1.get().data == b"to-all"
        assert q2.get().data == b"to-all"
        assert q3.get().data == b"to-all"

    def test_channel_isolation(self):
        """Test that channels are isolated."""
        ps = PubSub()
        ch_a = ps.subscribe("channel-a")
        ch_b = ps.subscribe("channel-b")
        ps.publish("channel-a", b"message-a")
        assert ch_a.get(timeout=0.5).data == b"message-a"
        with pytest.raises(Empty):
            ch_b.get(timeout=0.1)

    def test_unsubscribe(self):
        """Test unsubscribe."""
        ps = PubSub()
        q = ps.subscribe("temp")
        assert ps.subscriber_count("temp") == 1
        ps.unsubscribe("temp", q)
        assert ps.subscriber_count("temp") == 0

    def test_publish_no_subscribers(self):
        """Test publish with no subscribers."""
        ps = PubSub()
        count = ps.publish("empty", b"data")
        assert count == 0

    def test_close(self):
        """Test closing pub/sub."""
        ps = PubSub()
        ps.subscribe("test")
        ps.close()
        assert ps.is_closed is True

    def test_publish_after_close(self):
        """Test publish after close raises error."""
        ps = PubSub()
        ps.close()
        with pytest.raises(RuntimeError):
            ps.publish("test", b"data")

    def test_subscribe_after_close(self):
        """Test subscribe after close raises error."""
        ps = PubSub()
        ps.close()
        with pytest.raises(RuntimeError):
            ps.subscribe("test")

    def test_concurrent_publish(self):
        """Test concurrent publishing."""
        ps = PubSub()
        q = ps.subscribe("concurrent")
        threads = []

        for i in range(50):
            t = threading.Thread(target=lambda n=i: ps.publish("concurrent", f"msg-{n}".encode()))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        count = 0
        while True:
            try:
                q.get(timeout=0.5)
                count += 1
            except Empty:
                break
        assert count == 50

    def test_concurrent_subscribe(self):
        """Test concurrent subscribe."""
        ps = PubSub()
        queues = []
        lock = threading.Lock()

        def subscribe():
            q = ps.subscribe("multi")
            with lock:
                queues.append(q)

        threads = [threading.Thread(target=subscribe) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert ps.subscriber_count("multi") == 10

    def test_subscriber_count(self):
        """Test subscriber count."""
        ps = PubSub()
        assert ps.subscriber_count("nonexistent") == 0
        ps.subscribe("ch1")
        assert ps.subscriber_count("ch1") == 1
        ps.subscribe("ch1")
        assert ps.subscriber_count("ch1") == 2
