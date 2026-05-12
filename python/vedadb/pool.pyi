"""Type stubs for vedadb.pool — synchronous connection pool."""

from .client import VedaDB


class ConnectionPool:
    """Thread-safe connection pool for VedaDB."""

    host: str
    port: int
    min_size: int
    max_size: int
    timeout: float

    def __init__(
        self,
        host: str = ...,
        port: int = ...,
        min_size: int = ...,
        max_size: int = ...,
        timeout: float = ...,
    ) -> None: ...

    def acquire(self) -> VedaDB: ...
    def release(self, conn: VedaDB) -> None: ...
    def close(self) -> None: ...

    @property
    def size(self) -> int: ...
    @property
    def available(self) -> int: ...
