"""
VedaDB ORM — Exception hierarchy.

All ORM-specific exceptions inherit from VedaORMError so callers can
catch a single base class when they want to handle any ORM failure.
"""

from typing import Any, Optional


class VedaORMError(Exception):
    """Base exception for all VedaDB ORM errors."""


class ConnectionError(VedaORMError):
    """Raised when the ORM cannot reach VedaDB or loses its connection."""


class ValidationError(VedaORMError):
    """Raised when a field value fails validation.

    Attributes:
        field:   Name of the field that failed.
        message: Human-readable explanation.
        value:   The offending value.
    """

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        value: Any = None,
    ) -> None:
        self.field = field
        self.message = message
        self.value = value
        parts = [message]
        if field:
            parts.insert(0, f"[{field}]")
        super().__init__(" ".join(parts))


class SchemaError(VedaORMError):
    """Raised when a schema definition is invalid or conflicts with the DB."""


class QueryError(VedaORMError):
    """Raised when a query cannot be built or the server rejects it."""


class HookError(VedaORMError):
    """Raised when a lifecycle hook fails."""


class RelationshipError(VedaORMError):
    """Raised for invalid relationship definitions or circular references."""


class MigrationError(VedaORMError):
    """Raised when a migration cannot be applied or rolled back."""


class SessionError(VedaORMError):
    """Raised for transaction/session management failures."""
