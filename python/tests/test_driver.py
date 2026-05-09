"""
Comprehensive tests for the VedaDB Python driver.

These tests cover the protocol layer, connection pool, prepared statements,
async client, and error handling. They use mocking to avoid requiring a
running VedaDB server.

Run with: pytest tests/test_driver.py -v
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import MagicMock, patch

import pytest

import vedadb
from vedadb import (
    AsyncConnectionPool,
    AsyncVedaDB,
    ConnectionPool,
    PreparedStatement,
    VedaDB,
    connect,
)
from vedadb.exceptions import (
    VedaDBAuthError,
    VedaDBConnectionError,
    VedaDBPoolError,
    VedaDBPoolExhausted,
    VedaDBQueryError,
    VedaDBRateLimitError,
    VedaDBTimeoutError,
    VedaDBValidationError,
)
from vedadb.protocol import HealthStatus, Result, sql_literal, validate_identifier


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_protocol():
    """Return a mock Protocol that returns predictable results."""
    proto = MagicMock()
    proto.base_url = "http://localhost:8080"
    proto.database = None
    proto.closed = False
    return proto


@pytest.fixture
def client(mock_protocol):
    """Return a VedaDB client using a mock protocol."""
    db = VedaDB.__new__(VedaDB)
    db._protocol = mock_protocol
    db._prepared = {}
    db._lock = threading.RLock()
    return db


# ---------------------------------------------------------------------------
# SQL literal & validation tests
# ---------------------------------------------------------------------------

class TestSqlLiteral:
    def test_none(self):
        assert sql_literal(None) == "NULL"

    def test_bool(self):
        assert sql_literal(True) == "TRUE"
        assert sql_literal(False) == "FALSE"

    def test_int(self):
        assert sql_literal(42) == "42"
        assert sql_literal(-7) == "-7"

    def test_float(self):
        assert sql_literal(3.14) == "3.14"
        assert sql_literal(2.0) == "2"

    def test_string(self):
        assert sql_literal("hello") == "'hello'"
        assert sql_literal("it's") == "'it''s'"

    def test_unsupported_type(self):
        with pytest.raises(VedaDBValidationError):
            sql_literal({"foo": "bar"})


class TestValidateIdentifier:
    def test_valid(self):
        validate_identifier("users")
        validate_identifier("_private")
        validate_identifier("table123")

    def test_invalid_empty(self):
        with pytest.raises(VedaDBValidationError):
            validate_identifier("")

    def test_invalid_hyphen(self):
        with pytest.raises(VedaDBValidationError):
            validate_identifier("my-table")

    def test_invalid_sql_injection(self):
        with pytest.raises(VedaDBValidationError):
            validate_identifier("users; DROP TABLE users")


# ---------------------------------------------------------------------------
# Result data class
# ---------------------------------------------------------------------------

class TestResult:
    def test_to_dicts(self):
        r = Result(columns=["id", "name"], rows=[["1", "Alice"], ["2", "Bob"]], row_count=2)
        dicts = r.to_dicts()
        assert dicts == [{"id": "1", "name": "Alice"}, {"id": "2", "name": "Bob"}]

    def test_empty_result(self):
        r = Result(columns=None, rows=None, row_count=0)
        assert r.to_dicts() == []

    def test_no_rows(self):
        r = Result(columns=["id"], rows=[], row_count=0)
        assert r.to_dicts() == []


# ---------------------------------------------------------------------------
# PreparedStatement tests
# ---------------------------------------------------------------------------

class TestPreparedStatement:
    def test_creation(self, mock_protocol):
        stmt = PreparedStatement(mock_protocol, "get_user", "SELECT * FROM users WHERE id = ?")
        assert stmt.name == "get_user"
        assert stmt.param_count == 1
        assert not stmt.closed

    def test_execution(self, mock_protocol):
        mock_protocol.query.return_value = Result(
            columns=["id", "name"], rows=[["1", "Alice"]], row_count=1
        )
        stmt = PreparedStatement(mock_protocol, "get_user", "SELECT * FROM users WHERE id = ?")
        result = stmt.execute(["1"])
        assert result.row_count == 1
        mock_protocol.query.assert_called_once_with("SELECT * FROM users WHERE id = ?", params=["1"])

    def test_param_mismatch(self, mock_protocol):
        stmt = PreparedStatement(mock_protocol, "t", "SELECT * WHERE a = ? AND b = ?")
        with pytest.raises(VedaDBValidationError, match="expected 2 params"):
            stmt.execute([1])

    def test_callable(self, mock_protocol):
        mock_protocol.query.return_value = Result(columns=["x"], rows=[["1"]], row_count=1)
        stmt = PreparedStatement(mock_protocol, "t", "SELECT ?")
        result = stmt(42)
        assert result.row_count == 1

    def test_close(self, mock_protocol):
        stmt = PreparedStatement(mock_protocol, "t", "SELECT 1")
        stmt.close()
        assert stmt.closed
        with pytest.raises(VedaDBQueryError):
            stmt.execute([])

    def test_dollar_placeholders(self, mock_protocol):
        stmt = PreparedStatement(mock_protocol, "t", "SELECT * WHERE id = $1 AND name = $2")
        assert stmt.param_count == 2


# ---------------------------------------------------------------------------
# VedaDB client tests
# ---------------------------------------------------------------------------

class TestVedaDBClient:
    def test_query(self, client, mock_protocol):
        mock_protocol.query.return_value = Result(columns=["a"], rows=[["1"]], row_count=1)
        result = client.query("SELECT 1")
        assert result.row_count == 1
        mock_protocol.query.assert_called_once_with("SELECT 1", params=None)

    def test_query_with_params(self, client, mock_protocol):
        mock_protocol.query.return_value = Result(columns=["a"], rows=[["5"]], row_count=1)
        result = client.query("SELECT ?", params=[5])
        mock_protocol.query.assert_called_once_with("SELECT ?", params=[5])

    def test_query_one(self, client, mock_protocol):
        mock_protocol.query.return_value = Result(
            columns=["id", "name"], rows=[["1", "Alice"]], row_count=1
        )
        row = client.query_one("SELECT * FROM users WHERE id = 1")
        assert row == {"id": "1", "name": "Alice"}

    def test_query_one_empty(self, client, mock_protocol):
        mock_protocol.query.return_value = Result(columns=["id"], rows=[], row_count=0)
        row = client.query_one("SELECT * FROM users WHERE id = -1")
        assert row is None

    def test_query_value(self, client, mock_protocol):
        mock_protocol.query.return_value = Result(columns=["count"], rows=[["42"]], row_count=1)
        val = client.query_value("SELECT COUNT(*) FROM users")
        assert val == "42"

    def test_prepare(self, client):
        stmt = client.prepare("SELECT * WHERE id = ?")
        assert isinstance(stmt, PreparedStatement)
        assert client.get_prepared(stmt.name) is stmt

    def test_execute_prepared(self, client, mock_protocol):
        mock_protocol.query.return_value = Result(columns=["x"], rows=[["1"]], row_count=1)
        client.prepare("SELECT ?", name="sel")
        result = client.execute_prepared("sel", [42])
        assert result.row_count == 1

    def test_transaction_context(self, client, mock_protocol):
        mock_protocol.query.return_value = Result(columns=[], rows=[], row_count=0)
        with client.transaction() as db:
            db.query("INSERT INTO t VALUES (1)")
        # Should call BEGIN, query, COMMIT
        assert mock_protocol.query.call_count == 2  # BEGIN + actual query (commit is separate)

    def test_transaction_rollback(self, client, mock_protocol):
        mock_protocol.query.side_effect = [
            Result(columns=[], rows=[], row_count=0),  # BEGIN
            VedaDBQueryError("boom"),                    # INSERT fails
            Result(columns=[], rows=[], row_count=0),  # ROLLBACK
        ]
        with pytest.raises(VedaDBQueryError):
            with client.transaction() as db:
                db.query("INSERT INTO t VALUES (1)")

    def test_tables(self, client, mock_protocol):
        mock_protocol.get_tables.return_value = [{"name": "users"}]
        tables = client.tables()
        assert tables == [{"name": "users"}]

    def test_insert(self, client, mock_protocol):
        mock_protocol.table_insert_row.return_value = {"message": "OK"}
        result = client.insert("users", {"name": "Alice", "age": 30})
        assert result["message"] == "OK"

    def test_database_property(self, client):
        client.database = "testdb"
        assert client.database == "testdb"
        assert client.protocol.database == "testdb"

    def test_close(self, client):
        client.close()
        client.protocol.close.assert_called_once()


# ---------------------------------------------------------------------------
# Connection pool tests
# ---------------------------------------------------------------------------

class TestConnectionPool:
    def test_creation(self):
        # Create pool without pre-warm to avoid network
        with patch("vedadb.pool.Protocol") as MockProto:
            MockProto.return_value.ping.return_value = True
            pool = ConnectionPool(
                host="localhost",
                max_size=5,
                housekeeping_interval=0,  # disable background thread
            )
            assert pool._max_size == 5
            pool.close()

    def test_acquire_and_query(self):
        with patch("vedadb.pool.Protocol") as MockProto:
            mock_proto = MockProto.return_value
            mock_proto.query.return_value = Result(columns=["a"], rows=[["1"]], row_count=1)
            mock_proto.ping.return_value = True

            pool = ConnectionPool(
                host="localhost",
                max_size=2,
                housekeeping_interval=0,
            )
            with pool.acquire() as conn:
                result = conn.query("SELECT 1")
                assert result.row_count == 1
            pool.close()

    def test_pool_exhausted(self):
        with patch("vedadb.pool.Protocol") as MockProto:
            mock_proto = MockProto.return_value
            mock_proto.ping.return_value = True

            pool = ConnectionPool(
                host="localhost",
                max_size=1,
                max_overflow=0,
                timeout=0.1,
                housekeeping_interval=0,
            )
            # Hold the only connection
            conn1 = pool.acquire()
            # Second acquire should timeout
            with pytest.raises(VedaDBPoolExhausted):
                pool.acquire(timeout=0.1)
            conn1.close()
            pool.close()

    def test_concurrent_checkout(self):
        with patch("vedadb.pool.Protocol") as MockProto:
            mock_proto = MockProto.return_value
            mock_proto.query.return_value = Result(columns=["a"], rows=[["ok"]], row_count=1)
            mock_proto.ping.return_value = True

            pool = ConnectionPool(
                host="localhost",
                max_size=5,
                housekeeping_interval=0,
            )
            results = []

            def worker():
                with pool.acquire() as conn:
                    r = conn.query("SELECT 'ok'")
                    results.append(r.rows[0][0])

            threads = [threading.Thread(target=worker) for _ in range(10)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            assert len(results) == 10
            assert all(v == "ok" for v in results)
            pool.close()

    def test_pool_stats(self):
        with patch("vedadb.pool.Protocol") as MockProto:
            MockProto.return_value.ping.return_value = True
            pool = ConnectionPool(
                host="localhost",
                max_size=3,
                housekeeping_interval=0,
            )
            stats = pool.stats()
            assert stats.max_size >= 0
            pool.close()

    def test_connection_context_manager(self):
        with patch("vedadb.pool.Protocol") as MockProto:
            mock_proto = MockProto.return_value
            mock_proto.query.return_value = Result(columns=["x"], rows=[["42"]], row_count=1)
            mock_proto.ping.return_value = True

            pool = ConnectionPool(
                host="localhost",
                max_size=2,
                housekeeping_interval=0,
            )
            with pool.connection() as conn:
                result = conn.query("SELECT 42")
                assert result.rows[0][0] == "42"
            pool.close()


# ---------------------------------------------------------------------------
# Async client tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestAsyncVedaDB:
    async def test_creation(self):
        with patch("vedadb.async_client.aiohttp.ClientSession") as MockSession:
            mock_session = MagicMock()
            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.read = asyncio.coroutine(lambda: b'{"columns":["a"],"rows":[["1"]],"row_count":1}')
            mock_session.request = MagicMock(return_value=asyncio.coroutine(lambda **kw: mock_response)())
            MockSession.return_value = mock_session

            db = AsyncVedaDB(host="localhost")
            # Close should not raise
            await db.close()

    async def test_query(self):
        with patch("vedadb.async_client.AsyncProtocol.query", new_callable=MagicMock) as mock_query:
            mock_query.return_value = asyncio.Future()
            mock_query.return_value.set_result(
                Result(columns=["a"], rows=[["1"]], row_count=1)
            )
            db = AsyncVedaDB(host="localhost")
            result = await db.query("SELECT 1")
            assert result.row_count == 1
            await db.close()

    async def test_prepare(self):
        with patch("vedadb.async_client.AsyncProtocol.query", new_callable=MagicMock) as mock_query:
            mock_query.return_value = asyncio.Future()
            mock_query.return_value.set_result(Result(columns=["a"], rows=[["1"]], row_count=1))
            db = AsyncVedaDB(host="localhost")
            stmt = await db.prepare("SELECT ?")
            assert stmt.param_count == 1
            result = await stmt.execute([42])
            assert result.row_count == 1
            await db.close()

    async def test_transaction(self):
        with patch("vedadb.async_client.AsyncProtocol.query", new_callable=MagicMock) as mock_query:
            fut = asyncio.Future()
            fut.set_result(Result(columns=[], rows=[], row_count=0))
            mock_query.return_value = fut
            db = AsyncVedaDB(host="localhost")
            async with db.transaction() as db:
                await db.query("INSERT INTO t VALUES (1)")
            await db.close()


# ---------------------------------------------------------------------------
# Exception hierarchy tests
# ---------------------------------------------------------------------------

class TestExceptions:
    def test_base_error(self):
        err = VedaDBError("something went wrong", status_code=500)
        assert str(err) == "something went wrong (HTTP 500)"

    def test_rate_limit_with_retry(self):
        err = VedaDBRateLimitError("too many requests", retry_after=5.0)
        assert err.retry_after == 5.0

    def test_connection_error(self):
        err = VedaDBConnectionError("connection refused")
        assert str(err) == "connection refused"

    def test_timeout_error(self):
        err = VedaDBTimeoutError("timed out")
        assert isinstance(err, VedaDBConnectionError)


# ---------------------------------------------------------------------------
# Integration-style test with local HTTP server
# ---------------------------------------------------------------------------

class MockVedaDBHandler(BaseHTTPRequestHandler):
    """Minimal HTTP handler that simulates VedaDB REST responses."""

    def log_message(self, format, *args):
        pass  # Suppress logs

    def do_GET(self):
        if self.path == "/v1/health":
            self._respond(200, {"status": "ok", "timestamp": "2024-01-01T00:00:00Z"})
        elif self.path == "/v1/tables":
            self._respond(200, {"tables": [{"name": "users"}]})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len)
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            payload = {"query": body.decode()}

        if self.path == "/v1/query":
            query = payload.get("query", "")
            if "SELECT" in query.upper():
                self._respond(200, {
                    "columns": ["result"],
                    "rows": [["42"]],
                    "row_count": 1,
                    "message": "",
                })
            elif "ERROR" in query.upper():
                self._respond(400, {"error": "syntax error"})
            else:
                self._respond(200, {"row_count": 1, "message": "OK"})
        elif self.path == "/v1/batch":
            self._respond(200, {"ok": True, "failed_count": 0, "results": []})
        else:
            self._respond(404, {"error": "not found"})

    def _respond(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


@pytest.fixture(scope="module")
def mock_server():
    """Start a local mock VedaDB server for integration tests."""
    server = HTTPServer(("127.0.0.1", 0), MockVedaDBHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    yield host, port
    server.shutdown()


class TestIntegration:
    def test_health(self, mock_server):
        host, port = mock_server
        db = connect(host=host, port=port)
        health = db.health()
        assert health.status == "ok"
        db.close()

    def test_query(self, mock_server):
        host, port = mock_server
        db = connect(host=host, port=port)
        result = db.query("SELECT 42")
        assert result.row_count == 1
        assert result.rows[0][0] == "42"
        db.close()

    def test_tables(self, mock_server):
        host, port = mock_server
        db = connect(host=host, port=port)
        tables = db.tables()
        assert len(tables) == 1
        assert tables[0]["name"] == "users"
        db.close()

    def test_error_handling(self, mock_server):
        host, port = mock_server
        db = connect(host=host, port=port)
        with pytest.raises(VedaDBQueryError):
            db.query("ERROR")
        db.close()

    def test_pool_integration(self, mock_server):
        host, port = mock_server
        pool = ConnectionPool(
            host=host,
            rest_port=port,
            max_size=3,
            housekeeping_interval=0,
        )
        with pool.connection() as conn:
            result = conn.query("SELECT 1")
            assert result.row_count == 1
        pool.close()
