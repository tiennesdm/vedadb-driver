"""Type stubs for vedadb.client — synchronous VedaDB driver."""

from types import TracebackType
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple, Type, TypeVar

_T = TypeVar("_T")


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class VedaDBError(Exception):
    """Base exception for all VedaDB driver errors."""
    ...


class ConnectionError(VedaDBError):
    """Raised when a TCP connection cannot be established or is lost."""
    ...


class QueryError(VedaDBError):
    """Raised when the server returns an error for a query."""
    ...


class AuthError(VedaDBError):
    """Raised when authentication fails."""
    ...


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

class Result:
    """Structured result returned by VedaDB queries."""

    columns: List[str]
    rows: List[List[Any]]
    row_count: int
    message: str
    error: str

    def __init__(self, data: Dict[str, Any]) -> None: ...
    def to_dicts(self) -> List[Dict[str, Any]]: ...
    def first(self) -> Optional[Dict[str, Any]]: ...
    def scalar(self) -> Any: ...
    def __len__(self) -> int: ...
    def __iter__(self) -> Iterator[List[Any]]: ...
    def __bool__(self) -> bool: ...
    def __repr__(self) -> str: ...


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class VedaDB:
    """Synchronous VedaDB TCP client."""

    host: str
    port: int
    timeout: float
    auto_reconnect: bool
    tls: bool
    tls_verify: bool
    username: Optional[str]
    password: Optional[str]

    def __init__(
        self,
        host: str = ...,
        port: int = ...,
        timeout: float = ...,
        auto_reconnect: bool = ...,
        tls: bool = ...,
        tls_verify: bool = ...,
        username: Optional[str] = ...,
        password: Optional[str] = ...,
    ) -> None: ...

    # -- connection lifecycle -------------------------------------------------

    def connect(self) -> "VedaDB": ...
    def close(self) -> None: ...

    # -- context manager ------------------------------------------------------

    def __enter__(self) -> "VedaDB": ...
    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[TracebackType],
    ) -> None: ...

    # -- core query -----------------------------------------------------------

    def query(self, sql: str) -> Result: ...

    # -- prepared statements --------------------------------------------------

    def prepare(self, name: str, query: str) -> Result: ...
    def execute_prepared(self, name: str, *args: str) -> Result: ...
    def deallocate(self, name: str) -> Result: ...

    # -- transactions ---------------------------------------------------------

    def begin(self) -> Result: ...
    def commit(self) -> Result: ...
    def rollback(self) -> Result: ...
    def transaction(self, fn: Callable[["VedaDB"], _T]) -> _T: ...

    # -- convenience helpers --------------------------------------------------

    def execute(self, sql: str) -> Result: ...
    def insert(self, table: str, data: Dict[str, Any]) -> Result: ...
    def select(
        self,
        table: str,
        columns: str = ...,
        where: Optional[Dict[str, Any]] = ...,
        order_by: Optional[str] = ...,
        desc: bool = ...,
        limit: Optional[int] = ...,
        offset: Optional[int] = ...,
    ) -> Result: ...
    def update(
        self,
        table: str,
        set_values: Dict[str, Any],
        where: Optional[Dict[str, Any]] = ...,
    ) -> Result: ...
    def delete(
        self,
        table: str,
        where: Optional[Dict[str, Any]] = ...,
    ) -> Result: ...
    def insert_many(
        self,
        table: str,
        columns: List[str],
        rows: List[List[Any]],
    ) -> Result: ...
    def show_tables(self) -> List[str]: ...
    def drop_table(self, table: str) -> Result: ...
    def count(
        self,
        table: str,
        where: Optional[Dict[str, Any]] = ...,
    ) -> int: ...

    # -- cache ----------------------------------------------------------------

    def cache_set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = ...,
    ) -> Result: ...
    def cache_get(self, key: str) -> Result: ...
    def cache_del(self, key: str) -> Result: ...
    def cache_keys(self, pattern: str = ...) -> Result: ...
    def cache_incr(self, key: str) -> Result: ...

    # -- search ---------------------------------------------------------------

    def search(
        self,
        table: str,
        column: str,
        query: str,
        fuzzy: int = ...,
    ) -> Result: ...

    # -- graph ----------------------------------------------------------------

    def graph_add_node(
        self,
        node_id: str,
        label: str,
        props: Optional[Dict[str, Any]] = ...,
    ) -> Result: ...
    def graph_add_edge(
        self,
        from_id: str,
        to_id: str,
        edge_type: str,
    ) -> Result: ...
    def graph_bfs(self, start: str, depth: int = ...) -> Result: ...

    # -- utilities ------------------------------------------------------------

    def ping(self) -> bool: ...
    def __del__(self) -> None: ...
