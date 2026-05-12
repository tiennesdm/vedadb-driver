"""test_pool.py — Connection pool tests for VedaDB Python driver."""
import pytest
import time
import threading
from queue import Queue, Empty
from typing import Optional, List, Callable
from unittest.mock import Mock


class PooledConnection:
    """A connection managed by the pool."""

    def __init__(self, connection_id: int, pool: 'ConnectionPool'):
        self.connection_id = connection_id
        self._pool = pool
        self.in_use = False
        self.created_at = time.time()
        self._closed = False

    def release(self):
        self._pool.release(self)

    @property
    def is_valid(self) -> bool:
        return not self._closed

    def close(self):
        self._closed = True


class ConnectionPool:
    """Connection pool for VedaDB."""

    def __init__(self, factory: Callable, max_size: int = 10,
                 max_idle: int = 5, wait_timeout: float = 5.0):
        self._factory = factory
        self._max_size = max_size
        self._max_idle = max_idle
        self._wait_timeout = wait_timeout
        self._pool: Queue = Queue(maxsize=max_size)
        self._active_count = 0
        self._total_created = 0
        self._closed = False
        self._lock = threading.Lock()

    def acquire(self) -> PooledConnection:
        if self._closed:
            raise RuntimeError("Pool is closed")

        # Try to get from pool
        try:
            conn = self._pool.get(block=False)
            conn.in_use = True
            return conn
        except Empty:
            pass

        # Create new if under max
        with self._lock:
            if self._total_created < self._max_size:
                self._total_created += 1
                raw_conn = self._factory()
                conn = PooledConnection(self._total_created, self)
                conn.in_use = True
                return conn

        # Wait for a connection
        try:
            conn = self._pool.get(timeout=self._wait_timeout)
            conn.in_use = True
            return conn
        except Empty:
            raise TimeoutError("Pool exhausted: wait timeout")

    def release(self, conn: PooledConnection):
        conn.in_use = False
        try:
            self._pool.put(conn, block=False)
        except:
            conn.close()

    @property
    def active_count(self) -> int:
        return self._total_created - self._pool.qsize()

    @property
    def total_created(self) -> int:
        return self._total_created

    @property
    def available_count(self) -> int:
        return self._pool.qsize()

    def close(self):
        self._closed = True
        while not self._pool.empty():
            try:
                conn = self._pool.get_nowait()
                conn.close()
            except Empty:
                break


class TestConnectionPool:
    """Test suite for connection pool."""

    def _factory(self):
        return Mock()

    def test_acquire_new_connection(self):
        """Test acquiring a new connection."""
        pool = ConnectionPool(self._factory, max_size=5)
        conn = pool.acquire()
        assert conn is not None
        assert conn.in_use is True
        conn.release()

    def test_acquire_reuses_connection(self):
        """Test that released connections are reused."""
        pool = ConnectionPool(self._factory, max_size=5)
        conn1 = pool.acquire()
        conn1.release()
        conn2 = pool.acquire()
        assert conn1 is conn2
        conn2.release()

    def test_pool_exhaustion_timeout(self):
        """Test timeout when pool is exhausted."""
        pool = ConnectionPool(self._factory, max_size=1, wait_timeout=0.1)
        conn = pool.acquire()
        with pytest.raises(TimeoutError):
            pool.acquire()
        conn.release()

    def test_pool_limits_creation(self):
        """Test that pool respects max_size."""
        pool = ConnectionPool(self._factory, max_size=3)
        conns = [pool.acquire() for _ in range(3)]
        assert pool.total_created == 3
        for c in conns:
            c.release()

    def test_concurrent_acquire_release(self):
        """Test concurrent acquire and release."""
        pool = ConnectionPool(self._factory, max_size=5, wait_timeout=1.0)
        errors = []
        conns_acquired = []
        lock = threading.Lock()

        def worker():
            try:
                conn = pool.acquire()
                time.sleep(0.01)
                conns_acquired.append(conn.connection_id)
                conn.release()
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        assert len(conns_acquired) == 20

    def test_close_pool(self):
        """Test closing the pool."""
        pool = ConnectionPool(self._factory, max_size=5)
        conn = pool.acquire()
        conn.release()
        pool.close()
        assert pool._closed is True

    def test_acquire_after_close(self):
        """Test acquiring after pool is closed."""
        pool = ConnectionPool(self._factory, max_size=5)
        pool.close()
        with pytest.raises(RuntimeError):
            pool.acquire()

    def test_release_to_full_pool(self):
        """Test releasing when pool is at capacity."""
        pool = ConnectionPool(self._factory, max_size=2, max_idle=1)
        # Fill the pool
        conns = [pool.acquire() for _ in range(2)]
        # Release one (should be kept)
        conns[0].release()
        # Release another (pool might discard)
        conns[1].release()

    def test_total_created_tracking(self):
        """Test that total_created is tracked."""
        pool = ConnectionPool(self._factory, max_size=10)
        assert pool.total_created == 0
        conn = pool.acquire()
        assert pool.total_created == 1
        conn.release()

    def test_connection_validity(self):
        """Test connection validity check."""
        pool = ConnectionPool(self._factory, max_size=5)
        conn = pool.acquire()
        assert conn.is_valid is True
        conn.close()
        assert conn.is_valid is False
        conn.release()

    def test_available_count(self):
        """Test available connection count."""
        pool = ConnectionPool(self._factory, max_size=5)
        assert pool.available_count == 0
        conn = pool.acquire()
        assert pool.available_count == 0
        conn.release()
        time.sleep(0.01)
        assert pool.available_count == 1
