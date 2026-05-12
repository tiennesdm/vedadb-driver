"""test_retry.py — Retry logic tests for VedaDB Python driver."""
import pytest
import time
from unittest.mock import Mock, call
from functools import wraps


class RetryPolicy:
    """Retry policy for VedaDB operations."""

    def __init__(self, max_retries: int = 3, base_delay: float = 0.1,
                 max_delay: float = 5.0, multiplier: float = 2.0):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.multiplier = multiplier
        self.retryable_exceptions = (ConnectionError, TimeoutError)

    def execute(self, fn, *args, **kwargs):
        """Execute a function with retry logic."""
        delay = self.base_delay
        last_error = None

        for attempt in range(self.max_retries + 1):
            if attempt > 0:
                time.sleep(delay)
                delay = min(delay * self.multiplier, self.max_delay)

            try:
                return fn(*args, **kwargs)
            except Exception as e:
                last_error = e
                if not self.is_retryable(e):
                    raise

        raise RetryExhaustedError(
            f"Failed after {self.max_retries + 1} attempts"
        ) from last_error

    def is_retryable(self, error: Exception) -> bool:
        """Check if an error is retryable."""
        return isinstance(error, self.retryable_exceptions)


class RetryExhaustedError(Exception):
    """Raised when all retry attempts are exhausted."""
    pass


class TestRetryPolicy:
    """Test suite for retry policy."""

    def test_immediate_success(self):
        """Test that a successful call is not retried."""
        policy = RetryPolicy(max_retries=3, base_delay=0.01)
        mock_fn = Mock(return_value="success")

        result = policy.execute(mock_fn, "arg1")

        assert result == "success"
        assert mock_fn.call_count == 1

    def test_success_after_retries(self):
        """Test success after a few failures."""
        policy = RetryPolicy(max_retries=5, base_delay=0.001)
        mock_fn = Mock(side_effect=[
            ConnectionError("fail 1"),
            ConnectionError("fail 2"),
            "success"
        ])

        result = policy.execute(mock_fn)

        assert result == "success"
        assert mock_fn.call_count == 3

    def test_all_attempts_fail(self):
        """Test that all retries being exhausted raises error."""
        policy = RetryPolicy(max_retries=2, base_delay=0.001)
        mock_fn = Mock(side_effect=ConnectionError("persistent failure"))

        with pytest.raises(RetryExhaustedError):
            policy.execute(mock_fn)

        assert mock_fn.call_count == 3  # initial + 2 retries

    def test_zero_retries(self):
        """Test with zero retries configured."""
        policy = RetryPolicy(max_retries=0, base_delay=0.001)
        mock_fn = Mock(side_effect=ConnectionError("fail"))

        with pytest.raises(RetryExhaustedError):
            policy.execute(mock_fn)

        assert mock_fn.call_count == 1

    def test_non_retryable_error(self):
        """Test that non-retryable errors are not retried."""
        policy = RetryPolicy(max_retries=5, base_delay=0.001)
        mock_fn = Mock(side_effect=ValueError("invalid"))

        with pytest.raises(ValueError):
            policy.execute(mock_fn)

        assert mock_fn.call_count == 1

    def test_retry_on_timeout(self):
        """Test that timeout errors are retried."""
        policy = RetryPolicy(max_retries=3, base_delay=0.001)
        mock_fn = Mock(side_effect=[
            TimeoutError("timeout"),
            TimeoutError("timeout"),
            "success"
        ])

        result = policy.execute(mock_fn)
        assert result == "success"
        assert mock_fn.call_count == 3

    def test_exponential_backoff(self):
        """Test that delays increase exponentially."""
        policy = RetryPolicy(max_retries=3, base_delay=0.01, multiplier=2.0)
        mock_fn = Mock(side_effect=ConnectionError("fail"))

        start = time.time()
        with pytest.raises(RetryExhaustedError):
            policy.execute(mock_fn)
        elapsed = time.time() - start

        # Minimum expected: 0.01 + 0.02 + 0.04 = 0.07
        assert elapsed >= 0.06

    def test_max_delay_cap(self):
        """Test that delay is capped at max_delay."""
        policy = RetryPolicy(
            max_retries=5,
            base_delay=0.1,
            max_delay=0.15,
            multiplier=10.0
        )
        mock_fn = Mock(side_effect=ConnectionError("fail"))

        start = time.time()
        with pytest.raises(RetryExhaustedError):
            policy.execute(mock_fn)
        elapsed = time.time() - start

        # Should not exceed ~0.8s even with 5 retries due to cap
        assert elapsed < 1.0

    def test_custom_retryable_exceptions(self):
        """Test custom retryable exception types."""
        policy = RetryPolicy(max_retries=2, base_delay=0.001)
        policy.retryable_exceptions = (ValueError,)

        mock_fn = Mock(side_effect=[ValueError("bad"), "success"])

        result = policy.execute(mock_fn)
        assert result == "success"


class RetryDecorator:
    """Decorator for adding retry behavior to functions."""

    def __init__(self, policy: RetryPolicy):
        self.policy = policy

    def __call__(self, fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            return self.policy.execute(fn, *args, **kwargs)
        return wrapper


class TestRetryDecorator:
    """Test suite for retry decorator."""

    def test_decorator_success(self):
        """Test decorated function succeeds."""
        policy = RetryPolicy(max_retries=3, base_delay=0.001)
        decorator = RetryDecorator(policy)

        @decorator
        def my_function():
            return "done"

        assert my_function() == "done"

    def test_decorator_retries(self):
        """Test decorated function retries on failure."""
        policy = RetryPolicy(max_retries=3, base_delay=0.001)
        decorator = RetryDecorator(policy)
        call_count = 0

        @decorator
        def flaky_function():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ConnectionError("fail")
            return "done"

        assert flaky_function() == "done"
        assert call_count == 3

    def test_decorator_preserves_metadata(self):
        """Test that decorator preserves function metadata."""
        policy = RetryPolicy(max_retries=1, base_delay=0.001)
        decorator = RetryDecorator(policy)

        @decorator
        def my_func():
            """My docstring."""
            return 42

        assert my_func.__name__ == "my_func"
        assert my_func.__doc__ == "My docstring."
