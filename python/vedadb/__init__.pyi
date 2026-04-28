"""Type stubs for the VedaDB Python driver public API."""

from .client import (
    AuthError as AuthError,
    ConnectionError as ConnectionError,
    QueryError as QueryError,
    Result as Result,
    VedaDB as VedaDB,
    VedaDBError as VedaDBError,
)
from .pool import ConnectionPool as ConnectionPool
from .aio import (
    AsyncConnectionPool as AsyncConnectionPool,
    AsyncVedaDB as AsyncVedaDB,
)

__version__: str
__all__: list[str]
