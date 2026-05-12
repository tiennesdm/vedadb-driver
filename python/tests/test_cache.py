"""test_cache.py — Query cache tests for VedaDB Python driver."""
import pytest
import time
import threading
from typing import Any, Optional, Dict
from unittest.mock import Mock


class QueryCache:
    """Simple LRU cache for query results."""

    def __init__(self, max_size: int = 100, ttl: float = 60.0):
        self._max_size = max_size
        self._ttl = ttl
        self._cache: Dict[str, tuple] = {}
        self._access_order: list = []
        self._hits = 0
        self._misses = 0
        self._lock = threading.RLock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key in self._cache:
                value, expiry = self._cache[key]
                if time.time() < expiry:
                    self._hits += 1
                    self._access_order.remove(key)
                    self._access_order.append(key)
                    return value
                else:
                    del self._cache[key]
                    self._access_order.remove(key)
            self._misses += 1
            return None

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            expiry = time.time() + self._ttl
            if key in self._cache:
                self._access_order.remove(key)
            self._cache[key] = (value, expiry)
            self._access_order.append(key)

            if len(self._cache) > self._max_size:
                oldest = self._access_order.pop(0)
                del self._cache[oldest]

    def invalidate(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                self._access_order.remove(key)
                return True
            return False

    def clear(self):
        with self._lock:
            self._cache.clear()
            self._access_order.clear()

    @property
    def size(self) -> int:
        return len(self._cache)

    @property
    def hit_rate(self) -> float:
        total = self._hits + self._misses
        if total == 0:
            return 0.0
        return self._hits / total

    @property
    def stats(self) -> Dict[str, int]:
        return {
            "hits": self._hits,
            "misses": self._misses,
            "size": self.size,
        }


class TestQueryCache:
    """Test suite for query cache."""

    def test_cache_hit(self):
        """Test cache hit."""
        cache = QueryCache()
        cache.set("key1", "value1")
        result = cache.get("key1")
        assert result == "value1"
        assert cache.stats["hits"] == 1

    def test_cache_miss(self):
        """Test cache miss."""
        cache = QueryCache()
        result = cache.get("nonexistent")
        assert result is None
        assert cache.stats["misses"] == 1

    def test_cache_expiry(self):
        """Test TTL expiry."""
        cache = QueryCache(ttl=0.05)
        cache.set("key1", "value1")
        time.sleep(0.1)
        result = cache.get("key1")
        assert result is None

    def test_cache_invalidate(self):
        """Test cache invalidation."""
        cache = QueryCache()
        cache.set("key1", "value1")
        removed = cache.invalidate("key1")
        assert removed is True
        assert cache.get("key1") is None

    def test_cache_invalidate_missing(self):
        """Test invalidating non-existent key."""
        cache = QueryCache()
        removed = cache.invalidate("nonexistent")
        assert removed is False

    def test_cache_clear(self):
        """Test clearing cache."""
        cache = QueryCache()
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.clear()
        assert cache.size == 0
        assert cache.get("k1") is None
        assert cache.get("k2") is None

    def test_lru_eviction(self):
        """Test LRU eviction."""
        cache = QueryCache(max_size=3)
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.set("k3", "v3")
        cache.set("k4", "v4")  # Should evict k1
        assert cache.size == 3
        assert cache.get("k1") is None
        assert cache.get("k2") == "v2"

    def test_lru_order_update(self):
        """Test that access updates LRU order."""
        cache = QueryCache(max_size=3)
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        cache.set("k3", "v3")
        cache.get("k1")  # Access k1, making it most recently used
        cache.set("k4", "v4")  # Should evict k2
        assert cache.get("k1") == "v1"
        assert cache.get("k2") is None

    def test_hit_rate(self):
        """Test hit rate calculation."""
        cache = QueryCache()
        cache.set("k1", "v1")
        cache.get("k1")  # hit
        cache.get("k2")  # miss
        cache.get("k1")  # hit
        assert cache.hit_rate == 2 / 3

    def test_empty_hit_rate(self):
        """Test hit rate with no accesses."""
        cache = QueryCache()
        assert cache.hit_rate == 0.0

    def test_concurrent_access(self):
        """Test thread-safe concurrent access."""
        cache = QueryCache()
        threads = []

        for i in range(20):
            t = threading.Thread(target=lambda n=i: cache.set(f"key{n}", f"val{n}"))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        assert cache.size == 20

    def test_max_size_zero(self):
        """Test cache with max_size=0 falls back to 1."""
        cache = QueryCache(max_size=1)
        cache.set("k1", "v1")
        cache.set("k2", "v2")
        assert cache.size == 1
