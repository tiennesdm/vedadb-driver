"""Unit tests for the VedaDB Python driver (mock socket, no server needed)."""

import json
import socket
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch, PropertyMock

from vedadb.client import VedaDB, Result, VedaDBError, ConnectionError, QueryError, AuthError, _format_value
from vedadb.pool import ConnectionPool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_response(data: dict) -> str:
    """Return a newline-terminated JSON string."""
    return json.dumps(data) + "\n"


def _mock_client(response_data: dict) -> VedaDB:
    """Create a VedaDB instance with a mocked socket that returns *response_data*."""
    client = VedaDB.__new__(VedaDB)
    client.host = "localhost"
    client.port = 6380
    client.timeout = 30.0
    client.auto_reconnect = False
    client._lock = __import__("threading").Lock()
    client._connected = True

    # Mock socket
    client._sock = MagicMock()

    # Mock file-like readline
    response_line = _make_response(response_data)
    mock_file = MagicMock()
    mock_file.readline.return_value = response_line
    client._file = mock_file

    return client


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

class TestResult(unittest.TestCase):

    def test_basic_fields(self):
        r = Result({"columns": ["id", "name"], "rows": [[1, "Alice"]], "row_count": 1})
        self.assertEqual(r.columns, ["id", "name"])
        self.assertEqual(r.rows, [[1, "Alice"]])
        self.assertEqual(r.row_count, 1)

    def test_to_dicts(self):
        r = Result({"columns": ["a", "b"], "rows": [[1, 2], [3, 4]], "row_count": 2})
        self.assertEqual(r.to_dicts(), [{"a": 1, "b": 2}, {"a": 3, "b": 4}])

    def test_first(self):
        r = Result({"columns": ["x"], "rows": [[42]], "row_count": 1})
        self.assertEqual(r.first(), {"x": 42})

    def test_first_empty(self):
        r = Result({"columns": ["x"], "rows": [], "row_count": 0})
        self.assertIsNone(r.first())

    def test_scalar(self):
        r = Result({"columns": ["count"], "rows": [[5]], "row_count": 1})
        self.assertEqual(r.scalar(), 5)

    def test_scalar_empty(self):
        r = Result({"columns": [], "rows": [], "row_count": 0})
        self.assertIsNone(r.scalar())

    def test_len(self):
        r = Result({"columns": ["a"], "rows": [[1], [2], [3]], "row_count": 3})
        self.assertEqual(len(r), 3)

    def test_iter(self):
        r = Result({"columns": ["a"], "rows": [[1], [2]], "row_count": 2})
        self.assertEqual(list(r), [[1], [2]])

    def test_bool_with_rows(self):
        r = Result({"columns": ["a"], "rows": [[1]], "row_count": 1})
        self.assertTrue(r)

    def test_bool_with_message(self):
        r = Result({"message": "Table created"})
        self.assertTrue(r)

    def test_bool_empty(self):
        r = Result({})
        self.assertFalse(r)

    def test_repr_message(self):
        r = Result({"message": "OK"})
        self.assertIn("OK", repr(r))

    def test_repr_rows(self):
        r = Result({"columns": ["id"], "rows": [[1]], "row_count": 1})
        self.assertIn("rows=1", repr(r))


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class TestExceptions(unittest.TestCase):

    def test_hierarchy(self):
        self.assertTrue(issubclass(ConnectionError, VedaDBError))
        self.assertTrue(issubclass(QueryError, VedaDBError))
        self.assertTrue(issubclass(AuthError, VedaDBError))

    def test_query_error_raised(self):
        client = _mock_client({"error": "table not found"})
        with self.assertRaises(QueryError):
            client.query("SELECT * FROM nope;")

    def test_auth_error_raised(self):
        client = _mock_client({"error": "authentication failed"})
        with self.assertRaises(AuthError):
            client.query("SELECT 1;")


# ---------------------------------------------------------------------------
# VedaDB client
# ---------------------------------------------------------------------------

class TestVedaDB(unittest.TestCase):

    def test_query_returns_result(self):
        client = _mock_client({
            "columns": ["id", "name"],
            "rows": [[1, "Alice"]],
            "row_count": 1,
        })
        result = client.query("SELECT * FROM users;")
        self.assertIsInstance(result, Result)
        self.assertEqual(result.row_count, 1)
        client._sock.sendall.assert_called_once()

    def test_execute_alias(self):
        client = _mock_client({"message": "Table created"})
        result = client.execute("CREATE TABLE t (id INT);")
        self.assertEqual(result.message, "Table created")

    def test_insert_builds_sql(self):
        client = _mock_client({"message": "1 row inserted"})
        client.insert("users", {"name": "Bob", "age": 25})
        sent = client._sock.sendall.call_args[0][0].decode()
        self.assertIn("INSERT INTO users", sent)
        self.assertIn("'Bob'", sent)
        self.assertIn("25", sent)

    def test_select_builds_sql(self):
        client = _mock_client({"columns": ["id"], "rows": [[1]], "row_count": 1})
        client.select("users", where={"active": True}, order_by="id", desc=True, limit=5, offset=10)
        sent = client._sock.sendall.call_args[0][0].decode()
        self.assertIn("SELECT * FROM users", sent)
        self.assertIn("WHERE active = TRUE", sent)
        self.assertIn("ORDER BY id DESC", sent)
        self.assertIn("LIMIT 5", sent)
        self.assertIn("OFFSET 10", sent)

    def test_update_builds_sql(self):
        client = _mock_client({"message": "1 row updated"})
        client.update("users", {"age": 31}, where={"name": "Alice"})
        sent = client._sock.sendall.call_args[0][0].decode()
        self.assertIn("UPDATE users SET age = 31", sent)
        self.assertIn("WHERE name = 'Alice'", sent)

    def test_delete_builds_sql(self):
        client = _mock_client({"message": "1 row deleted"})
        client.delete("users", where={"id": 5})
        sent = client._sock.sendall.call_args[0][0].decode()
        self.assertIn("DELETE FROM users", sent)
        self.assertIn("WHERE id = 5", sent)

    def test_count(self):
        client = _mock_client({"columns": ["count"], "rows": [[42]], "row_count": 1})
        self.assertEqual(client.count("users"), 42)

    def test_show_tables(self):
        client = _mock_client({"columns": ["table"], "rows": [["users"], ["orders"]], "row_count": 2})
        self.assertEqual(client.show_tables(), ["users", "orders"])

    def test_show_tables_empty(self):
        client = _mock_client({"columns": ["table"], "rows": [], "row_count": 0})
        self.assertEqual(client.show_tables(), [])

    def test_ping_success(self):
        client = _mock_client({"columns": ["table"], "rows": [], "row_count": 0})
        self.assertTrue(client.ping())

    def test_connection_error_when_not_connected(self):
        client = VedaDB.__new__(VedaDB)
        client.host = "localhost"
        client.port = 6380
        client.timeout = 30.0
        client.auto_reconnect = False
        client._connected = False
        client._sock = None
        client._file = None
        client._lock = __import__("threading").Lock()
        with self.assertRaises(ConnectionError):
            client.query("SELECT 1;")

    def test_context_manager(self):
        """Ensure __exit__ calls close."""
        client = _mock_client({"message": "ok"})
        client.close = MagicMock()
        client.__exit__(None, None, None)
        client.close.assert_called_once()


# ---------------------------------------------------------------------------
# _format_value
# ---------------------------------------------------------------------------

class TestFormatValue(unittest.TestCase):

    def test_none(self):
        self.assertEqual(_format_value(None), "NULL")

    def test_bool_true(self):
        self.assertEqual(_format_value(True), "TRUE")

    def test_bool_false(self):
        self.assertEqual(_format_value(False), "FALSE")

    def test_string(self):
        self.assertEqual(_format_value("hello"), "'hello'")

    def test_string_escape(self):
        # SQL-standard `''`-doubling, not backslash escaping.
        self.assertEqual(_format_value("it's"), "'it''s'")

    def test_int(self):
        self.assertEqual(_format_value(42), "42")

    def test_float(self):
        self.assertEqual(_format_value(3.14), "3.14")


# ---------------------------------------------------------------------------
# ConnectionPool
# ---------------------------------------------------------------------------

class TestConnectionPool(unittest.TestCase):

    @patch.object(VedaDB, "connect", return_value=None)
    def test_pool_creates_min_connections(self, mock_connect):
        pool = ConnectionPool.__new__(ConnectionPool)
        pool.host = "localhost"
        pool.port = 6380
        pool.min_size = 3
        pool.max_size = 5
        pool.timeout = 30.0
        pool._pool = []
        pool._lock = __import__("threading").Lock()
        pool._size = 0
        pool._closed = False
        for _ in range(3):
            pool._pool.append(pool._new_conn())
            pool._size += 1
        self.assertEqual(pool.size, 3)
        self.assertEqual(pool.available, 3)

    def test_pool_validation(self):
        with self.assertRaises(ValueError):
            ConnectionPool(min_size=-1)
        with self.assertRaises(ValueError):
            ConnectionPool(max_size=0)
        with self.assertRaises(ValueError):
            ConnectionPool(min_size=5, max_size=2)

    @patch.object(VedaDB, "connect", return_value=None)
    def test_acquire_and_release(self, mock_connect):
        pool = ConnectionPool.__new__(ConnectionPool)
        pool.host = "localhost"
        pool.port = 6380
        pool.min_size = 0
        pool.max_size = 2
        pool.timeout = 30.0
        pool._pool = []
        pool._lock = __import__("threading").Lock()
        pool._size = 0
        pool._closed = False

        conn = pool.acquire()
        self.assertEqual(pool.size, 1)
        self.assertEqual(pool.available, 0)

        pool.release(conn)
        self.assertEqual(pool.available, 1)

    def test_acquire_on_closed_pool(self):
        pool = ConnectionPool.__new__(ConnectionPool)
        pool._lock = __import__("threading").Lock()
        pool._pool = []
        pool._size = 0
        pool._closed = True
        pool.host = "localhost"
        pool.port = 6380
        pool.timeout = 30.0
        pool.max_size = 5
        with self.assertRaises(ConnectionError):
            pool.acquire()


if __name__ == "__main__":
    unittest.main()
