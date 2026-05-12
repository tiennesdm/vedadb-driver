"""
Client-side query cache for VedaDB — LRU cache with TTL support.

Caches query results to reduce redundant database round-trips.
Provides table-based invalidation for cache coherency.

Example::

    from vedadb.cache import QueryCache

    cache = QueryCache(max_size=100, ttl=60)

    # First call hits the database
    result = cache.get("SELECT * FROM users WHERE id = 1", params=[1], fetch_fn=db.query)

    # Second call (within TTL) returns from cache
    result = cache.get("SELECT * FROM users WHERE id = 1", params=[1], fetch_fn=db.query)

    # Invalidate all entries for a table
    cache.invalidate("users")
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set

from .protocol import Result

logger = logging.getLogger("vedadb.cache")


@dataclass
class _CacheEntry:
    """Internal cache entry."""

    key: str
    result: Result
    created_at: float = field(default_factory=time.monotonic)
    tables: set[str] = field(default_factory=set)

    @property
    def age(self) -> float:
        return time.monotonic() - self.created_at


class QueryCache:
    """LRU query result cache with TTL support.

    Caches query results keyed by the SQL string and parameters.
    Entries automatically expire after *ttl* seconds.  The cache is
    thread-safe and supports table-based invalidation.

    Args:
        max_size: Maximum number of entries to retain.
        ttl: Time-to-live in seconds (0 = no expiry).

    Example::

        cache = QueryCache(max_size=100, ttl=60)

        # Fetch with caching
        result = cache.get(
            "SELECT * FROM users WHERE id = ?",
            params=[1],
            fetch_fn=lambda sql: db.query(sql, params=[1]),
        )

        # Invalidate table
        cache.invalidate("users")
    """

    def __init__(self, max_size: int = 100, ttl: float = 60.0):
        if max_size < 1:
            raise ValueError("max_size must be >= 1")
        self.max_size = max_size
        self.ttl = ttl
        self._cache: OrderedDict[str, _CacheEntry] = OrderedDict()
        self._table_index: Dict[str, Set[str]] = {}
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0
        self._evictions = 0
        self._invalidations = 0

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def get(
        self,
        sql: str,
        params: list | None = None,
        *,
        fetch_fn: Callable[[], Result] | None = None,
        tables: list[str] | None = None,
    ) -> Result:
        """Get a cached result, or execute and cache if not found.

        Args:
            sql: SQL query string (used as part of the cache key).
            params: Query parameters (used as part of the cache key).
            fetch_fn: Callable that executes the query and returns a
                :class:`Result`.  Required if the entry is not cached.
            tables: List of table names this query depends on.  Used for
                cache invalidation.

        Returns:
            The (possibly cached) :class:`Result`.
        """
        key = self._make_key(sql, params)

        with self._lock:
            entry = self._cache.get(key)
            if entry is not None:
                if self.ttl <= 0 or entry.age < self.ttl:
                    # Move to end (most recently used)
                    self._cache.move_to_end(key)
                    self._hits += 1
                    logger.debug("Cache HIT for key %s", key[:16])
                    return entry.result
                else:
                    # Expired — remove
                    self._remove_entry(key)

            self._misses += 1
            logger.debug("Cache MISS for key %s", key[:16])

        # Not in cache — fetch
        if fetch_fn is None:
            raise KeyError(f"Cache miss for {key[:32]}... and no fetch_fn provided")

        result = fetch_fn()

        # Store in cache
        self.set(sql, params, result, tables=tables)
        return result

    def set(
        self,
        sql: str,
        params: list | None,
        result: Result,
        *,
        tables: list[str] | None = None,
    ) -> None:
        """Manually store a result in the cache.

        Args:
            sql: SQL query string.
            params: Query parameters.
            result: :class:`Result` to cache.
            tables: Table names this result depends on.
        """
        key = self._make_key(sql, params)
        table_set = set(tables) if tables else set()

        with self._lock:
            # Evict oldest if at capacity
            while len(self._cache) >= self.max_size:
                oldest_key, oldest = self._cache.popitem(last=False)
                self._unindex_entry(oldest_key, oldest.tables)
                self._evictions += 1

            entry = _CacheEntry(key=key, result=result, tables=table_set)
            self._cache[key] = entry
            self._index_entry(key, table_set)

    def invalidate(self, table: str | None = None) -> int:
        """Invalidate cache entries.

        Args:
            table: If provided, invalidate only entries that depend on
                this table.  If None, clear the entire cache.

        Returns:
            Number of entries invalidated.
        """
        with self._lock:
            if table is None:
                count = len(self._cache)
                self._cache.clear()
                self._table_index.clear()
                self._invalidations += count
                logger.info("Cache fully invalidated (%d entries)", count)
                return count

            keys_to_remove = self._table_index.get(table, set()).copy()
            for key in keys_to_remove:
                self._remove_entry(key)
            self._invalidations += len(keys_to_remove)
            logger.info("Cache invalidated for table %r (%d entries)", table, len(keys_to_remove))
            return len(keys_to_remove)

    def clear(self) -> None:
        """Clear all cached entries."""
        self.invalidate(None)

    # ------------------------------------------------------------------
    # Properties / stats
    # ------------------------------------------------------------------

    @property
    def size(self) -> int:
        """Current number of cached entries."""
        with self._lock:
            return len(self._cache)

    @property
    def hit_rate(self) -> float:
        """Cache hit rate as a percentage (0.0–100.0)."""
        total = self._hits + self._misses
        if total == 0:
            return 0.0
        return (self._hits / total) * 100.0

    @property
    def stats(self) -> dict:
        """Cache statistics."""
        with self._lock:
            return {
                "size": len(self._cache),
                "max_size": self.max_size,
                "ttl": self.ttl,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": self.hit_rate,
                "evictions": self._evictions,
                "invalidations": self._invalidations,
            }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _make_key(sql: str, params: list | None) -> str:
        """Create a cache key from SQL and parameters."""
        hasher = hashlib.sha256()
        hasher.update(sql.encode("utf-8"))
        if params:
            hasher.update(json.dumps(params, default=str).encode("utf-8"))
        return hasher.hexdigest()

    def _index_entry(self, key: str, tables: set[str]) -> None:
        """Add entry key to the table index."""
        for table in tables:
            self._table_index.setdefault(table, set()).add(key)

    def _unindex_entry(self, key: str, tables: set[str]) -> None:
        """Remove entry key from the table index."""
        for table in tables:
            if table in self._table_index:
                self._table_index[table].discard(key)
                if not self._table_index[table]:
                    del self._table_index[table]

    def _remove_entry(self, key: str) -> None:
        """Remove a single entry from cache and indexes."""
        entry = self._cache.pop(key, None)
        if entry:
            self._unindex_entry(key, entry.tables)

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def __enter__(self) -> "QueryCache":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.clear()

    def __repr__(self) -> str:
        return (
            f"<QueryCache size={self.size}/{self.max_size} "
            f"hit_rate={self.hit_rate:.1f}% ttl={self.ttl}s>"
        )
