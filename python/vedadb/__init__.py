"""
VedaDB Python Driver -- Production-Grade Client Library

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

    # Retry with exponential backoff
    from vedadb.retry import retry
    @retry(max_retries=3, base_delay=0.5)
    def resilient_query(db, sql):
        return db.query(sql)

    # Circuit breaker
    from vedadb.circuit import CircuitBreaker
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    result = cb.call(db.query, "SELECT * FROM users")

    # Bulk insert
    from vedadb.bulk import BulkInserter, Pipeline
    with BulkInserter("users", batch_size=1000, protocol=db.protocol) as bulk:
        for user in users:
            bulk.add(user)

    # Query pipeline
    pipe = Pipeline(db)
    for i in range(100):
        pipe.query("SELECT * FROM users WHERE id = ?", [i])
    results = pipe.run()  # 1 network call

    # Fluent query builder
    from vedadb.query_builder import QueryBuilder
    result = QueryBuilder(db).table("users").where("age", ">", 18).limit(10).get()

    # Change streams
    from vedadb.streams import ChangeStream
    async for event in ChangeStream(db).watch("users"):
        print(f"Change: {event.operation_type} on {event.table}")

    # Pub/Sub
    from vedadb.pubsub import PubSub
    pubsub = PubSub(db)
    await pubsub.publish("events", "Hello!")

    # Streaming cursor
    from vedadb.cursor import Cursor
    for row in Cursor(db, "SELECT * FROM huge_table"):
        process(row)

    # Connection URI
    from vedadb.uri import parse_uri
    config = parse_uri("vedadb://admin:pass@localhost:7480/mydb?pool_size=20")
    db = connect(**config.to_kwargs())

    # TLS
    from vedadb.tls import TLSConfig
    tls = TLSConfig(enabled=True, ca_file="/path/to/ca.crt")

    # Query cache
    from vedadb.cache import QueryCache
    cache = QueryCache(max_size=100, ttl=60)

    # Read/write splitting
    from vedadb.rw_split import RWSplitClient
    rw = RWSplitClient(primary=primary_db, replicas=[replica1, replica2])

    # Load balancing
    from vedadb.load_balance import LoadBalancer
    lb = LoadBalancer(nodes=["db1:7480", "db2:7480", "db3:7480"], strategy="least_connections")

    # Metrics
    from vedadb.observability import MetricsCollector
    metrics = MetricsCollector()
    print(metrics.prometheus_metrics)

    # ORM
    from vedadb.orm_advanced import Model, Field
    class User(Model):
        table = "users"
        id = Field(int, primary_key=True)
        name = Field(str)

    # Migrations
    from vedadb.migrations import MigrationRunner
    runner = MigrationRunner(db, migrations=[AddUsersTable, AddPostsTable])
    runner.migrate()

    # Interceptors
    from vedadb.interceptors import InterceptorChain, LoggingInterceptor
    db = InterceptorChain([LoggingInterceptor()]).wrap(db)

    # Failover
    from vedadb.failover import FailoverClient
    client = FailoverClient(nodes=[primary_db, secondary_db, tertiary_db])

    # Framework integration
    from vedadb.framework import FastAPIVedaDB, FlaskVedaDB, VedaDBMiddleware
"""

from .exceptions import (
    VedaDBError,
    VedaDBConnectionError,
    VedaDBQueryError,
    VedaDBPoolError,
    VedaDBPoolExhausted,
    VedaDBAuthError,
    VedaDBRateLimitError,
    VedaDBTimeoutError,
    VedaDBValidationError,
)
from .protocol import Result
from .driver import VedaDB, connect, PreparedStatement
from .pool import ConnectionPool, PooledConnection, PoolStats
from .async_client import AsyncVedaDB, AsyncConnectionPool

# P0 -- Critical
from .retry import RetryPolicy, retry, RetryableError, NonRetryableError, MaxRetriesExceeded
from .circuit import CircuitBreaker, CircuitOpenError, circuit_breaker
from .health import HealthChecker, HealthSnapshot
from .bulk import BulkInserter, Pipeline, bulk_insert, pipeline

# P1 -- High
from .streams import ChangeStream, ChangeEvent, make_change_event
from .pubsub import PubSub, Message
from .cursor import Cursor, Row
from .uri import parse_uri, build_uri, Config
from .tls import TLSConfig, create_ssl_context, apply_tls_to_pool_kwargs

# P2 -- Medium
from .query_builder import QueryBuilder
from .cache import QueryCache
from .rw_split import RWSplitClient
from .load_balance import LoadBalancer, Node
from .observability import MetricsCollector

# P3 -- Low
from .orm_advanced import Model, Field, Relationship, QuerySet, SchemaInspector
from .migrations import Migration, MigrationRunner, MigrationRecord, migration
from .interceptors import (
    Interceptor,
    QueryInterceptor,
    ConnectionInterceptor,
    LoggingInterceptor,
    MetricsInterceptor,
    RetryInterceptor,
    QueryValidationInterceptor,
    CachingInterceptor,
    InterceptorChain,
    InterceptedClient,
)
from .failover import FailoverClient, FailoverNode, NodeState
from .framework import FastAPIVedaDB, FlaskVedaDB, DjangoVedaDBBackend, VedaDBMiddleware

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
    "VedaDBPoolExhausted",
    "VedaDBAuthError",
    "VedaDBRateLimitError",
    "VedaDBTimeoutError",
    "VedaDBValidationError",
    # P0 -- Retry
    "RetryPolicy",
    "retry",
    "RetryableError",
    "NonRetryableError",
    "MaxRetriesExceeded",
    # P0 -- Circuit breaker
    "CircuitBreaker",
    "CircuitOpenError",
    "circuit_breaker",
    # P0 -- Health
    "HealthChecker",
    "HealthSnapshot",
    # P0 -- Bulk
    "BulkInserter",
    "Pipeline",
    "bulk_insert",
    "pipeline",
    # P1 -- Streams
    "ChangeStream",
    "ChangeEvent",
    "make_change_event",
    # P1 -- Pub/Sub
    "PubSub",
    "Message",
    # P1 -- Cursor
    "Cursor",
    "Row",
    # P1 -- URI
    "parse_uri",
    "build_uri",
    "Config",
    # P1 -- TLS
    "TLSConfig",
    "create_ssl_context",
    "apply_tls_to_pool_kwargs",
    # P2 -- Query builder
    "QueryBuilder",
    # P2 -- Cache
    "QueryCache",
    # P2 -- RW Split
    "RWSplitClient",
    # P2 -- Load balance
    "LoadBalancer",
    "Node",
    # P2 -- Observability
    "MetricsCollector",
    # P3 -- ORM
    "Model",
    "Field",
    "Relationship",
    "QuerySet",
    "SchemaInspector",
    # P3 -- Migrations
    "Migration",
    "MigrationRunner",
    "MigrationRecord",
    "migration",
    # P3 -- Interceptors
    "Interceptor",
    "QueryInterceptor",
    "ConnectionInterceptor",
    "LoggingInterceptor",
    "MetricsInterceptor",
    "RetryInterceptor",
    "QueryValidationInterceptor",
    "CachingInterceptor",
    "InterceptorChain",
    "InterceptedClient",
    # P3 -- Failover
    "FailoverClient",
    "FailoverNode",
    "NodeState",
    # P3 -- Framework
    "FastAPIVedaDB",
    "FlaskVedaDB",
    "DjangoVedaDBBackend",
    "VedaDBMiddleware",
]
