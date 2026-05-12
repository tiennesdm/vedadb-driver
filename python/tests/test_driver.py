"""test_driver.py — Core driver tests for VedaDB Python driver."""
import pytest
import json
from unittest.mock import Mock, patch, MagicMock
import requests


class VedaClient:
    """Minimal VedaDB client for testing."""

    def __init__(self, endpoint: str, timeout: float = 10.0,
                 max_retries: int = 3, retry_delay: float = 0.1,
                 auth_token: str = None):
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.auth_token = auth_token
        self.session = requests.Session()
        self._closed = False
        self._healthy = True

    def connect(self):
        resp = self.session.get(
            f"{self.endpoint}/health",
            timeout=self.timeout
        )
        resp.raise_for_status()
        self._healthy = True
        return self

    def query(self, sql: str, params=None):
        if self._closed:
            raise RuntimeError("Client is closed")
        resp = self.session.post(
            f"{self.endpoint}/query",
            json={"sql": sql, "params": params or []},
            timeout=self.timeout,
            headers=self._auth_headers()
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("error"):
            raise RuntimeError(data["error"])
        return data.get("result", [])

    def execute(self, sql: str, params=None):
        if self._closed:
            raise RuntimeError("Client is closed")
        resp = self.session.post(
            f"{self.endpoint}/execute",
            json={"sql": sql, "params": params or []},
            timeout=self.timeout,
            headers=self._auth_headers()
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("error"):
            raise RuntimeError(data["error"])
        return ExecuteResult(**data.get("result", {}))

    def close(self):
        self._closed = True
        self.session.close()

    def is_healthy(self) -> bool:
        return self._healthy and not self._closed

    def _auth_headers(self):
        if self.auth_token:
            return {"Authorization": f"Bearer {self.auth_token}"}
        return {}


class ExecuteResult:
    def __init__(self, rows_affected: int = 0, last_insert_id: int = None):
        self.rows_affected = rows_affected
        self.last_insert_id = last_insert_id


class TestConnection:
    """Test suite for VedaDB client connection."""

    def test_connect_success(self, mock_http_session):
        """Test successful connection to VedaDB."""
        mock_http_session.get.return_value = Mock(
            status_code=200,
            json=lambda: {"status": "healthy"},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            result = client.connect()
            assert result is client
            assert client.is_healthy()

    def test_connect_failure(self, mock_http_session):
        """Test connection failure handling."""
        mock_http_session.get.side_effect = requests.ConnectionError(
            "Connection refused"
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            with pytest.raises(requests.ConnectionError):
                client.connect()

    def test_connect_with_auth(self, mock_http_session):
        """Test connection with authentication token."""
        mock_http_session.get.return_value = Mock(
            status_code=200,
            json=lambda: {"status": "healthy"},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient(
                "http://localhost:8080",
                auth_token="test-token-123"
            )
            client.connect()
            assert client.auth_token == "test-token-123"

    def test_client_configuration(self):
        """Test client configuration parameters."""
        client = VedaClient(
            endpoint="http://db:9999",
            timeout=5.0,
            max_retries=5,
            retry_delay=0.5,
        )
        assert client.endpoint == "http://db:9999"
        assert client.timeout == 5.0
        assert client.max_retries == 5
        assert client.retry_delay == 0.5

    def test_default_configuration(self):
        """Test default client configuration."""
        client = VedaClient("http://localhost:8080")
        assert client.timeout == 10.0
        assert client.max_retries == 3
        assert client.retry_delay == 0.1
        assert client.auth_token is None


class TestQuery:
    """Test suite for query operations."""

    def test_query_single_row(self, mock_http_session):
        """Test querying a single row."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {"result": [{"id": 1, "name": "Alice"}]},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            result = client.query("SELECT * FROM users WHERE id = ?", [1])
            assert len(result) == 1
            assert result[0]["name"] == "Alice"

    def test_query_multiple_rows(self, mock_http_session):
        """Test querying multiple rows."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {
                "result": [
                    {"id": 1, "name": "Alice"},
                    {"id": 2, "name": "Bob"},
                    {"id": 3, "name": "Charlie"},
                ]
            },
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            result = client.query("SELECT * FROM users")
            assert len(result) == 3

    def test_query_empty_result(self, mock_http_session):
        """Test query returning empty result."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {"result": []},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            result = client.query("SELECT * FROM empty_table")
            assert result == []

    def test_query_server_error(self, mock_http_session):
        """Test query with server error response."""
        mock_http_session.post.return_value = Mock(
            status_code=500,
            json=lambda: {"error": "database error"},
            raise_for_status=Mock(side_effect=requests.HTTPError("500"))
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            with pytest.raises(requests.HTTPError):
                client.query("SELECT * FROM users")

    def test_query_with_params(self, mock_http_session):
        """Test query with positional parameters."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {"result": [{"name": "Alice"}]},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            result = client.query(
                "SELECT name FROM users WHERE id = ? AND active = ?",
                [1, True]
            )
            call_args = mock_http_session.post.call_args
            json_data = call_args.kwargs.get("json", call_args[1].get("json", {}))
            assert json_data["params"] == [1, True]

    def test_query_application_error(self, mock_http_session):
        """Test query with application-level error."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {"error": "syntax error at position 14", "result": None},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            with pytest.raises(RuntimeError, match="syntax error"):
                client.query("INVALID SQL")


class TestExecute:
    """Test suite for execute (INSERT/UPDATE/DELETE) operations."""

    def test_execute_insert(self, mock_http_session):
        """Test INSERT execution."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {
                "result": {"rows_affected": 1, "last_insert_id": 42}
            },
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            result = client.execute(
                "INSERT INTO users (name, age) VALUES (?, ?)",
                ["Alice", 30]
            )
            assert result.rows_affected == 1
            assert result.last_insert_id == 42

    def test_execute_update(self, mock_http_session):
        """Test UPDATE execution."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {"result": {"rows_affected": 5}},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            result = client.execute(
                "UPDATE users SET active = ? WHERE last_login < ?",
                [False, "2023-01-01"]
            )
            assert result.rows_affected == 5

    def test_execute_delete(self, mock_http_session):
        """Test DELETE execution."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {"result": {"rows_affected": 1}},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            result = client.execute("DELETE FROM users WHERE id = ?", [99])
            assert result.rows_affected == 1

    def test_execute_syntax_error(self, mock_http_session):
        """Test execute with syntax error."""
        mock_http_session.post.return_value = Mock(
            status_code=200,
            json=lambda: {"error": "syntax error at position 7"},
            raise_for_status=Mock()
        )

        with patch("requests.Session", return_value=mock_http_session):
            client = VedaClient("http://localhost:8080")
            with pytest.raises(RuntimeError):
                client.execute("INVALID SQL")


class TestClose:
    """Test suite for client close operations."""

    def test_close_client(self):
        """Test client close."""
        client = VedaClient("http://localhost:8080")
        client.close()
        assert client._closed is True

    def test_close_idempotent(self):
        """Test that close is idempotent."""
        client = VedaClient("http://localhost:8080")
        client.close()
        client.close()  # Should not raise

    def test_query_after_close(self):
        """Test that query after close raises error."""
        client = VedaClient("http://localhost:8080")
        client.close()
        with pytest.raises(RuntimeError, match="closed"):
            client.query("SELECT 1")

    def test_execute_after_close(self):
        """Test that execute after close raises error."""
        client = VedaClient("http://localhost:8080")
        client.close()
        with pytest.raises(RuntimeError, match="closed"):
            client.execute("INSERT INTO t VALUES (1)")
