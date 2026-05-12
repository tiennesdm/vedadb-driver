"""
Retry logic with exponential backoff and jitter for VedaDB operations.

Provides configurable retry policies with support for:
- Exponential backoff with configurable base / max delay
- Full jitter to prevent thundering herd
- Exception-based retry classification (retryable vs non-retryable)
- Decorator and imperative APIs

Example::

    from vedadb.retry import RetryPolicy, retry

    # Imperative API
    policy = RetryPolicy(max_retries=5, base_delay=0.5)
    result = policy.execute(db.query, "SELECT * FROM users")

    # Decorator API
    @retry(max_retries=3, base_delay=1.0)
    def fetch_users(db):
        return db.query("SELECT * FROM users")
"""

from __future__ import annotations

import functools
import logging
import random
import time
from typing import Any, Callable, Optional, Tuple, Type

logger = logging.getLogger("vedadb.retry")


class RetryableError(Exception):
    """Raised when an operation fails but is eligible for retry."""

    def __init__(self, message: str, original: Exception | None = None):
        super().__init__(message)
        self.original = original


class NonRetryableError(Exception):
    """Raised when an operation fails and should NOT be retried."""

    def __init__(self, message: str, original: Exception | None = None):
        super().__init__(message)
        self.original = original


class MaxRetriesExceeded(Exception):
    """Raised when all retry attempts have been exhausted."""

    def __init__(self, message: str, attempts: int, last_error: Exception | None = None):
        super().__init__(message)
        self.attempts = attempts
        self.last_error = last_error


class RetryPolicy:
    """Configurable retry policy with exponential backoff and jitter.

    The policy uses the "full jitter" strategy (random value between 0 and
    the computed delay) to spread out retries and avoid synchronized
    thundering-herd behaviour across clients.

    Args:
        max_retries: Maximum number of retry attempts (not including the
            initial attempt).  
        base_delay: Initial delay in seconds between retries.
        max_delay: Hard cap on delay between retries.
        jitter: If True (default), apply random jitter to each delay.
        retryable_exceptions: Tuple of exception types that trigger a retry.
        on_retry: Optional callback ``fn(attempt, delay, exception)`` called
            before each retry.

    Example::

        policy = RetryPolicy(max_retries=5, base_delay=0.5)
        result = policy.execute(db.query, "SELECT * FROM users")
    """

    def __init__(
        self,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 30.0,
        jitter: bool = True,
        retryable_exceptions: Tuple[Type[Exception], ...] = (
            ConnectionError,
            TimeoutError,
            OSError,
        ),
        on_retry: Callable[[int, float, Exception], None] | None = None,
    ):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.jitter = jitter
        self.retryable_exceptions = retryable_exceptions
        self.on_retry = on_retry

    # ------------------------------------------------------------------
    # Core execution
    # ------------------------------------------------------------------

    def execute(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        """Execute *fn* with the configured retry policy.

        Args:
            fn: Callable to execute.
            *args, **kwargs: Arguments passed to *fn*.

        Returns:
            The return value of *fn*.

        Raises:
            MaxRetriesExceeded: If all retries are exhausted.
            NonRetryableError: If a non-retryable exception is raised.
        """
        last_error: Exception | None = None

        for attempt in range(1 + self.max_retries):
            try:
                return fn(*args, **kwargs)
            except self.retryable_exceptions as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                delay = self._compute_delay(attempt)
                logger.warning(
                    "Retryable error on attempt %d/%d: %s — "
                    "retrying in %.3fs",
                    attempt + 1,
                    1 + self.max_retries,
                    exc,
                    delay,
                )
                if self.on_retry:
                    self.on_retry(attempt, delay, exc)
                time.sleep(delay)
            except NonRetryableError:
                raise
            except Exception as exc:
                # Non-retryable — fail fast
                raise NonRetryableError(f"Non-retryable error: {exc}", original=exc) from exc

        raise MaxRetriesExceeded(
            f"Failed after {1 + self.max_retries} attempts: {last_error}",
            attempts=1 + self.max_retries,
            last_error=last_error,
        )

    async def execute_async(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        """Async variant of :meth:`execute`.

        Works with coroutine functions — ``await`` is applied automatically.
        """
        import asyncio

        last_error: Exception | None = None

        for attempt in range(1 + self.max_retries):
            try:
                result = fn(*args, **kwargs)
                if asyncio.iscoroutine(result):
                    return await result
                return result
            except self.retryable_exceptions as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                delay = self._compute_delay(attempt)
                logger.warning(
                    "Retryable error on attempt %d/%d: %s — "
                    "retrying in %.3fs",
                    attempt + 1,
                    1 + self.max_retries,
                    exc,
                    delay,
                )
                if self.on_retry:
                    cb_result = self.on_retry(attempt, delay, exc)
                    if asyncio.iscoroutine(cb_result):
                        await cb_result
                await asyncio.sleep(delay)
            except NonRetryableError:
                raise
            except Exception as exc:
                raise NonRetryableError(f"Non-retryable error: {exc}", original=exc) from exc

        raise MaxRetriesExceeded(
            f"Failed after {1 + self.max_retries} attempts: {last_error}",
            attempts=1 + self.max_retries,
            last_error=last_error,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _compute_delay(self, attempt: int) -> float:
        """Compute the delay for a given attempt using exponential backoff.

        Delay = min(base_delay * 2^attempt, max_delay)
        With jitter: random uniform [0, delay]
        """
        delay = self.base_delay * (2 ** attempt)
        delay = min(delay, self.max_delay)
        if self.jitter:
            delay = random.uniform(0, delay)
        return delay

    def is_retryable(self, exc: Exception) -> bool:
        """Return True if *exc* is classified as retryable."""
        return isinstance(exc, self.retryable_exceptions)

    def __repr__(self) -> str:
        return (
            f"<RetryPolicy retries={self.max_retries} "
            f"delay={self.base_delay}s..{self.max_delay}s jitter={self.jitter}>"
        )


# ---------------------------------------------------------------------------
# Decorator factory
# ---------------------------------------------------------------------------


def retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    jitter: bool = True,
    retryable_exceptions: Tuple[Type[Exception], ...] = (ConnectionError, TimeoutError, OSError),
):
    """Decorator that retries a function with exponential backoff.

    Args:
        max_retries: Maximum retry attempts.
        base_delay: Initial delay between retries (seconds).
        max_delay: Maximum delay cap (seconds).
        jitter: Apply random jitter to delays.
        retryable_exceptions: Exception types that trigger retry.

    Example::

        @retry(max_retries=3, base_delay=0.5)
        def query(db, sql):
            return db.query(sql)
    """
    policy = RetryPolicy(
        max_retries=max_retries,
        base_delay=base_delay,
        max_delay=max_delay,
        jitter=jitter,
        retryable_exceptions=retryable_exceptions,
    )

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            return policy.execute(fn, *args, **kwargs)

        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            return await policy.execute_async(fn, *args, **kwargs)

        # Return async wrapper if the wrapped function is a coroutine
        if hasattr(fn, "__code__") and fn.__code__.co_flags & 0x80:
            return async_wrapper
        wrapper._async_wrapper = async_wrapper  # type: ignore[attr-defined]
        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# Global default policy (used by driver when no explicit policy is given)
# ---------------------------------------------------------------------------

DEFAULT_RETRY_POLICY = RetryPolicy()
