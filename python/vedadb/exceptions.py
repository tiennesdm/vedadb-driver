"""VedaDB exception hierarchy."""


class VedaDBError(RuntimeError):
    """Base error raised by the VedaDB Python client."""

    def __init__(self, message: str, *, status_code: int | None = None, response_body: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.response_body = response_body

    def __str__(self) -> str:
        parts = [self.message]
        if self.status_code is not None:
            parts.append(f"(HTTP {self.status_code})")
        return " ".join(parts)


class VedaDBConnectionError(VedaDBError):
    """Raised when the client cannot reach the VedaDB server."""


class VedaDBTimeoutError(VedaDBConnectionError):
    """Raised when a request exceeds the configured timeout."""


class VedaDBQueryError(VedaDBError):
    """Raised when VedaDB rejects a query (HTTP 400)."""


class VedaDBAuthError(VedaDBError):
    """Raised on authentication/authorization failure (HTTP 401/403)."""


class VedaDBRateLimitError(VedaDBError):
    """Raised when the rate limit is exceeded (HTTP 429).

    Attributes:
        retry_after: Seconds to wait before retrying, if provided by server.
    """

    def __init__(self, message: str, *, retry_after: float | None = None, **kwargs):
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class VedaDBPoolError(VedaDBError):
    """Raised for connection pool-related errors."""


class VedaDBPoolExhausted(VedaDBPoolError):
    """Raised when the connection pool is exhausted and no connection is available."""


class VedaDBValidationError(VedaDBError):
    """Raised for client-side validation failures (bad identifiers, injection attempts, etc.)."""
