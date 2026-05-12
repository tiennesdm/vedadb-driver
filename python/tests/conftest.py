# conftest.py — Shared pytest fixtures for VedaDB Python driver tests
import pytest
import json
from unittest.mock import Mock, MagicMock
from typing import Generator, Any, Dict, List
import threading
import time


class MockVedaServer:
    """Mock HTTP server for testing VedaDB driver without real server."""

    def __init__(self):
        self.responses: List[Dict[str, Any]] = []
        self.request_log: List[Dict[str, Any]] = []
        self.failure_count = 0
        self.failure_threshold = 0
        self.call_count = 0
        self.lock = threading.Lock()
        self.closed = False

    def add_response(self, result=None, error=None, status_code=200):
        """Queue a response to be returned."""
        self.responses.append({
            "result": result,
            "error": error,
            "status_code": status_code
        })

    def set_failure_sequence(self, count: int, status_code: int = 503):
        """Set the next N requests to fail."""
        self.failure_threshold = count
        self.failure_count = 0
        for _ in range(count):
            self.add_response(error="temporary error", status_code=status_code)

    def handle_request(self, method: str, url: str, **kwargs) -> Mock:
        """Handle an HTTP request and return a mock response."""
        with self.lock:
            self.call_count += 1
            self.request_log.append({"method": method, "url": url, "kwargs": kwargs})

            if self.closed:
                raise ConnectionError("Server is closed")

            if self.responses:
                resp_data = self.responses.pop(0)
            else:
                resp_data = {"result": None, "error": None, "status_code": 200}

            mock_response = Mock()
            mock_response.status_code = resp_data["status_code"]
            mock_response.json.return_value = {
                "result": resp_data.get("result"),
                "error": resp_data.get("error")
            }
            mock_response.text = json.dumps(mock_response.json.return_value)
            mock_response.raise_for_status = Mock()
            if resp_data["status_code"] >= 400:
                from requests import HTTPError
                mock_response.raise_for_status.side_effect = HTTPError(
                    f"HTTP {resp_data['status_code']}"
                )
            return mock_response

    def reset(self):
        """Reset the mock server state."""
        self.responses.clear()
        self.request_log.clear()
        self.failure_count = 0
        self.failure_threshold = 0
        self.call_count = 0


@pytest.fixture
def mock_server() -> MockVedaServer:
    """Provide a fresh mock server for each test."""
    return MockVedaServer()


@pytest.fixture
def vedadb_config() -> Dict[str, Any]:
    """Provide default VedaDB configuration for tests."""
    return {
        "endpoint": "http://localhost:8080",
        "timeout": 5.0,
        "max_retries": 3,
        "retry_delay": 0.1,
        "auth_token": None,
    }


@pytest.fixture
def sample_data() -> List[Dict[str, Any]]:
    """Provide sample query result data."""
    return [
        {"id": 1, "name": "Alice", "age": 30, "active": True},
        {"id": 2, "name": "Bob", "age": 25, "active": True},
        {"id": 3, "name": "Charlie", "age": 35, "active": False},
    ]


@pytest.fixture
def large_dataset() -> List[Dict[str, Any]]:
    """Provide a large dataset for performance tests."""
    return [
        {"id": i, "data": f"row-{i}", "category": i % 10}
        for i in range(10000)
    ]


@pytest.fixture
def mock_http_session(mock_server):
    """Provide a mock HTTP session that routes through mock_server."""
    session = Mock()

    def make_request(method: str, url: str, **kwargs):
        return mock_server.handle_request(method, url, **kwargs)

    session.get = lambda url, **kwargs: make_request("GET", url, **kwargs)
    session.post = lambda url, **kwargs: make_request("POST", url, **kwargs)
    session.put = lambda url, **kwargs: make_request("PUT", url, **kwargs)
    session.delete = lambda url, **kwargs: make_request("DELETE", url, **kwargs)
    session.close = Mock()

    return session
