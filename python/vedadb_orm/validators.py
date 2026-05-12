"""
VedaDB ORM — Field validators.

Each public function returns a *callable* that accepts a single value and
raises ``ValidationError`` when the constraint is violated.  Validators are
attached to ``Field`` definitions and executed by the validation hook before
CREATE / UPDATE.
"""

import re
from typing import Any, Callable, Optional, Sequence

from .exceptions import ValidationError


# ---------------------------------------------------------------------------
# Validator factories
# ---------------------------------------------------------------------------

def required(value: Any) -> None:
    """Raise ``ValidationError`` if *value* is ``None`` or empty string."""
    if value is None or (isinstance(value, str) and value.strip() == ""):
        raise ValidationError("This field is required")


def min_length(n: int) -> Callable[[Any], None]:
    """Return a validator that enforces ``len(value) >= n``."""

    def _check(value: Any) -> None:
        if value is not None and len(str(value)) < n:
            raise ValidationError(f"Minimum length is {n}")

    return _check


def max_length(n: int) -> Callable[[Any], None]:
    """Return a validator that enforces ``len(value) <= n``."""

    def _check(value: Any) -> None:
        if value is not None and len(str(value)) > n:
            raise ValidationError(f"Maximum length is {n}")

    return _check


def min_value(n: float) -> Callable[[Any], None]:
    """Return a validator that enforces ``value >= n``."""

    def _check(value: Any) -> None:
        if value is not None and float(value) < n:
            raise ValidationError(f"Minimum value is {n}")

    return _check


def max_value(n: float) -> Callable[[Any], None]:
    """Return a validator that enforces ``value <= n``."""

    def _check(value: Any) -> None:
        if value is not None and float(value) > n:
            raise ValidationError(f"Maximum value is {n}")

    return _check


def regex(pattern: str) -> Callable[[Any], None]:
    """Return a validator that checks *value* against a regex *pattern*."""
    compiled = re.compile(pattern)

    def _check(value: Any) -> None:
        if value is not None and not compiled.match(str(value)):
            raise ValidationError(f"Value does not match pattern {pattern!r}")

    return _check


def email() -> Callable[[Any], None]:
    """Return a validator that checks for a plausible email address."""
    _EMAIL_RE = re.compile(
        r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
    )

    def _check(value: Any) -> None:
        if value is not None and not _EMAIL_RE.match(str(value)):
            raise ValidationError("Invalid email address")

    return _check


def one_of(*choices: Any) -> Callable[[Any], None]:
    """Return a validator that ensures *value* is among *choices*."""

    def _check(value: Any) -> None:
        if value is not None and value not in choices:
            raise ValidationError(
                f"Value must be one of {choices!r}, got {value!r}"
            )

    return _check


def custom(fn: Callable[[Any], Optional[str]]) -> Callable[[Any], None]:
    """Return a validator backed by an arbitrary function *fn*.

    *fn* should return ``None`` on success or an error-message string on
    failure.  If it raises ``ValidationError`` directly, it is re-raised
    as-is.
    """

    def _check(value: Any) -> None:
        try:
            result = fn(value)
        except ValidationError:
            raise
        except Exception as exc:
            raise ValidationError(f"Custom validation failed: {exc}") from exc
        if result is not None:
            raise ValidationError(str(result))

    return _check
