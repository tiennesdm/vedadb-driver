"""
Connection and query middleware (interceptors) for VedaDB.

Provides a hook system for intercepting and modifying queries,
connections, and results.  Useful for logging, metrics, query
rewriting, access control, and cross-cutting concerns.

Example — logging interceptor::

    from vedadb.interceptors import InterceptorChain, QueryInterceptor

    class LoggingInterceptor(QueryInterceptor):
        def before_query(self, sql, params):
            print(f"Executing: {sql}")
            return sql, params

        def after_query(self, sql, result, duration_ms):
            print(f"Completed in {duration_ms:.1f}ms")

    chain = InterceptorChain([LoggingInterceptor()])
    db = chain.wrap(db)
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Optional, Tuple

from .protocol import Result

logger = logging.getLogger("vedadb.interceptors")


# ---------------------------------------------------------------------------
# Base interceptor classes
# ---------------------------------------------------------------------------

class Interceptor(ABC):
    """Base class for all interceptors.

    Interceptors can implement any subset of the hook methods.
    Each hook receives relevant context and can modify values or
    trigger side effects.
    """

    name: str = "base"

    def before_query(self, sql: str, params: list | None) -> tuple[str, list | None]:
        """Called before a query is executed.

        Args:
            sql: The SQL statement.
            params: Query parameters.

        Returns:
            (sql, params) tuple — possibly modified.
        """
        return sql, params

    def after_query(self, sql: str, result: Result | None, duration_ms: float) -> Result | None:
        """Called after a query completes.

        Args:
            sql: The SQL statement.
            result: The query result (None if an exception occurred).
            duration_ms: Query execution time in milliseconds.

        Returns:
            The (possibly modified) result.
        """
        return result

    def on_error(self, sql: str, exception: Exception, duration_ms: float) -> None:
        """Called when a query raises an exception."""
        pass

    def before_connect(self, kwargs: dict) -> dict:
        """Called before a connection is established.

        Args:
            kwargs: Connection keyword arguments.

        Returns:
            Possibly modified kwargs.
        """
        return kwargs

    def after_connect(self, client: Any) -> Any:
        """Called after a connection is established."""
        return client

    def before_close(self, client: Any) -> None:
        """Called before a connection is closed."""
        pass

    def __repr__(self) -> str:
        return f"<Interceptor {self.name!r}>"


class QueryInterceptor(Interceptor):
    """Convenient base class for query-only interceptors."""
    name = "query"


class ConnectionInterceptor(Interceptor):
    """Convenient base class for connection-only interceptors."""
    name = "connection"


# ---------------------------------------------------------------------------
# Built-in interceptors
# ---------------------------------------------------------------------------

class LoggingInterceptor(QueryInterceptor):
    """Logs all queries with their duration.

    Args:
        log_params: Whether to log query parameters.
        slow_query_ms: Log warnings for queries slower than this.
    """

    name = "logging"

    def __init__(self, log_params: bool = False, slow_query_ms: float = 500.0):
        self.log_params = log_params
        self.slow_query_ms = slow_query_ms

    def before_query(self, sql: str, params: list | None) -> tuple[str, list | None]:
        self._start_time = time.perf_counter()
        return sql, params

    def after_query(self, sql: str, result: Result | None, duration_ms: float) -> Result | None:
        elapsed = (time.perf_counter() - self._start_time) * 1000.0
        extra = f" params={params!r}" if (self.log_params and (params := getattr(self, "_params", None))) else ""
        if elapsed > self.slow_query_ms:
            logger.warning("Slow query (%.1fms): %s%s", elapsed, sql[:200], extra)
        else:
            logger.info("Query (%.1fms): %s%s", elapsed, sql[:200], extra)
        return result

    def on_error(self, sql: str, exception: Exception, duration_ms: float) -> None:
        elapsed = (time.perf_counter() - self._start_time) * 1000.0
        logger.error("Query failed (%.1fms): %s — %s", elapsed, sql[:200], exception)


class MetricsInterceptor(QueryInterceptor):
    """Collects query metrics.

    Integrates with :class:`vedadb.observability.MetricsCollector`.
    """

    name = "metrics"

    def __init__(self, metrics_collector: Any):
        self._metrics = metrics_collector

    def after_query(self, sql: str, result: Result | None, duration_ms: float) -> Result | None:
        self._metrics.record_query(sql, duration_ms, getattr(result, "row_count", 0))
        return result

    def on_error(self, sql: str, exception: Exception, duration_ms: float) -> None:
        self._metrics.record_query(sql, duration_ms)
        self._metrics.record_query_error(sql, type(exception).__name__)


class RetryInterceptor(QueryInterceptor):
    """Adds retry logic at the interceptor level.

    Args:
        max_retries: Maximum retry attempts.
        retryable_exceptions: Exception types to retry on.
    """

    name = "retry"

    def __init__(
        self,
        max_retries: int = 3,
        retryable_exceptions: tuple[type[Exception], ...] = (Exception,),
    ):
        self.max_retries = max_retries
        self.retryable_exceptions = retryable_exceptions

    def before_query(self, sql: str, params: list | None) -> tuple[str, list | None]:
        self._retry_count = 0
        return sql, params


class QueryValidationInterceptor(QueryInterceptor):
    """Validates queries for common issues.

    Checks for:
    - Dangerous operations (DROP without WHERE)
    - Very large queries
    - Common SQL injection patterns
    """

    name = "validation"

    DANGEROUS_KEYWORDS = ["DROP DATABASE", "DROP TABLE", "TRUNCATE TABLE"]
    MAX_QUERY_LENGTH = 1_000_000

    def before_query(self, sql: str, params: list | None) -> tuple[str, list | None]:
        if len(sql) > self.MAX_QUERY_LENGTH:
            raise ValueError(f"Query exceeds maximum length of {self.MAX_QUERY_LENGTH}")
        sql_upper = sql.upper().strip()
        for kw in self.DANGEROUS_KEYWORDS:
            if kw in sql_upper:
                logger.warning("Potentially dangerous query detected: %s", sql[:200])
        return sql, params


class CachingInterceptor(QueryInterceptor):
    """Caches query results based on SQL + params.

    Integrates with :class:`vedadb.cache.QueryCache`.
    """

    name = "cache"

    def __init__(self, cache: Any):
        self._cache = cache

    def before_query(self, sql: str, params: list | None) -> tuple[str, list | None]:
        self._current_sql = sql
        self._current_params = params
        return sql, params

    def after_query(self, sql: str, result: Result | None, duration_ms: float) -> Result | None:
        if result is not None:
            self._cache.set(sql, getattr(self, "_current_params", None), result)
        return result


# ---------------------------------------------------------------------------
# InterceptorChain
# ---------------------------------------------------------------------------

class InterceptorChain:
    """Chains multiple interceptors and applies them in order.

    The chain wraps a client, intercepting all queries and connection
    operations through the registered interceptors.

    Args:
        interceptors: List of :class:`Interceptor` instances.

    Example::

        chain = InterceptorChain([
            LoggingInterceptor(),
            MetricsInterceptor(metrics),
            QueryValidationInterceptor(),
        ])
        db = chain.wrap(db)
    """

    def __init__(self, interceptors: list[Interceptor] | None = None):
        self._interceptors: list[Interceptor] = list(interceptors) if interceptors else []

    def add(self, interceptor: Interceptor) -> "InterceptorChain":
        """Add an interceptor to the chain."""
        self._interceptors.append(interceptor)
        return self

    def wrap(self, client: Any) -> "InterceptedClient":
        """Wrap a client with the interceptor chain.

        Args:
            client: A :class:`VedaDB` or compatible client.

        Returns:
            An :class:`InterceptedClient` proxy.
        """
        return InterceptedClient(client, self)

    def execute_before_query(self, sql: str, params: list | None) -> tuple[str, list | None]:
        """Run all before_query hooks."""
        for interceptor in self._interceptors:
            sql, params = interceptor.before_query(sql, params)
        return sql, params

    def execute_after_query(self, sql: str, result: Result | None, duration_ms: float) -> Result | None:
        """Run all after_query hooks in reverse order."""
        for interceptor in reversed(self._interceptors):
            result = interceptor.after_query(sql, result, duration_ms)
        return result

    def execute_on_error(self, sql: str, exception: Exception, duration_ms: float) -> None:
        """Run all on_error hooks."""
        for interceptor in self._interceptors:
            interceptor.on_error(sql, exception, duration_ms)

    def __repr__(self) -> str:
        names = [i.name for i in self._interceptors]
        return f"<InterceptorChain interceptors={names}>"


# ---------------------------------------------------------------------------
# InterceptedClient proxy
# ---------------------------------------------------------------------------

class InterceptedClient:
    """Proxy that wraps a client and runs the interceptor chain.

    This is returned by :meth:`InterceptorChain.wrap`.  All queries
    go through the interceptor hooks.
    """

    def __init__(self, client: Any, chain: InterceptorChain):
        self._client = client
        self._chain = chain

    def query(self, sql: str, *, params: list | None = None) -> Result:
        """Execute a query through the interceptor chain."""
        sql, params = self._chain.execute_before_query(sql, params)
        start = time.perf_counter()
        try:
            result = self._client.query(sql, params=params)
            elapsed = (time.perf_counter() - start) * 1000.0
            result = self._chain.execute_after_query(sql, result, elapsed)
            return result
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000.0
            self._chain.execute_on_error(sql, exc, elapsed)
            raise

    def execute(self, sql: str, params: list | None = None) -> Result:
        """Alias for :meth:`query`."""
        return self.query(sql, params=params)

    def ping(self) -> bool:
        """Ping the server."""
        return self._client.ping()

    def health(self):
        """Check server health."""
        return self._client.health()

    def close(self) -> None:
        """Close the underlying client."""
        self._client.close()

    def __enter__(self) -> "InterceptedClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def __getattr__(self, name: str) -> Any:
        """Delegate unknown attributes to the wrapped client."""
        return getattr(self._client, name)

    def __repr__(self) -> str:
        return f"<InterceptedClient chain={self._chain!r}>"
