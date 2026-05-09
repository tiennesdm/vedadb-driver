"""
VedaDB Python Driver — Production-Grade Client Library

Provides synchronous and asynchronous clients, connection pooling,
server-side prepared statements, and robust error handling for
VedaDB's REST API.

Example::

    from vedadb import connect

    # Simple connection
    db = connect(host="localhost", rest_port=8080, username="admin", password="secret")
    result = db.query("SELECT * FROM users WHERE age > ?", params=[21])
    for row in result.to_dicts():
        print(row)

    # Connection pool (recommended for production)
    from vedadb import ConnectionPool
    pool = ConnectionPool(host="localhost", max_size=20)
    with pool.acquire() as conn:
        conn.query("SELECT * FROM products")

    # Async
    from vedadb import AsyncVedaDB
    async def fetch():
        async with AsyncVedaDB(host="localhost") as db:
            result = await db.query("SELECT * FROM users")
            return result.to_dicts()
"""

from .exceptions import (
    VedaDBError,
    VedaDBConnectionError,
    VedaDBQueryError,
    VedaDBPoolError,
    VedaDBAuthError,
    VedaDBRateLimitError,
    VedaDBTimeoutError,
    VedaDBValidationError,
)
from .protocol import Result
from .driver import VedaDB, connect, PreparedStatement
from .pool import ConnectionPool, PooledConnection
from .async_client import AsyncVedaDB, AsyncConnectionPool

__version__ = "1.0.0"

__all__ = [
    # Core classes
    "VedaDB",
    "AsyncVedaDB",
    "ConnectionPool",
    "AsyncConnectionPool",
    "PooledConnection",
    "PreparedStatement",
    "Result",
    # Factory function
    "connect",
    # Exception hierarchy
    "VedaDBError",
    "VedaDBConnectionError",
    "VedaDBQueryError",
    "VedaDBPoolError",
    "VedaDBAuthError",
    "VedaDBRateLimitError",
    "VedaDBTimeoutError",
    "VedaDBValidationError",
]
