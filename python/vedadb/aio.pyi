"""Type stubs for vedadb.aio — asyncio VedaDB driver."""

from contextlib import AbstractAsyncContextManager
from types import TracebackType
from typing import Any, AsyncIterator, Optional, Type

from .client import Result


__all__ = [
    "AsyncVedaDB",
    "AsyncConnectionPool",
]


class AsyncVedaDB:
    """Asynchronous TCP client for VedaDB."""

    host: str
    port: int
    tls: bool
    tls_verify: bool
    timeout: float

    def __init__(
        self,
        host: str = ...,
        port: int = ...,
        *,
        tls: bool = ...,
        tls_verify: bool = ...,
        timeout: float = ...,
        user: Optional[str] = ...,
        password: Optional[str] = ...,
    ) -> None: ...

    # -- lifecycle ------------------------------------------------------------

    async def connect(self) -> None: ...
    async def close(self) -> None: ...

    async def __aenter__(self) -> "AsyncVedaDB": ...
    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[TracebackType],
    ) -> None: ...

    # -- query / execute ------------------------------------------------------

    async def query(self, sql: str) -> Result: ...
    async def execute(self, sql: str) -> Result: ...
    async def ping(self) -> bool: ...


class AsyncConnectionPool:
    """Fixed-bound asyncio connection pool."""

    def __init__(
        self,
        *,
        host: str = ...,
        port: int = ...,
        min_size: int = ...,
        max_size: int = ...,
        tls: bool = ...,
        tls_verify: bool = ...,
        user: Optional[str] = ...,
        password: Optional[str] = ...,
        timeout: float = ...,
    ) -> None: ...

    def acquire(self) -> AbstractAsyncContextManager[AsyncVedaDB]: ...
    async def close(self) -> None: ...

    async def __aenter__(self) -> "AsyncConnectionPool": ...
    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[TracebackType],
    ) -> None: ...
