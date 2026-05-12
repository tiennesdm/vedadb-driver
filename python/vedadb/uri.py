"""
Connection URI parser for VedaDB.

Parses ``vedadb://`` URIs into configuration objects suitable for
passing to :class:`VedaDB`, :class:`ConnectionPool`, etc.

Supported URI format::

    vedadb://[username[:password]@]host[:port]/[database][?param1=value1&...]

Query parameters::

    pool_size         — Maximum pool size (default: 10)
    pool_min_size     — Minimum pool size (default: 1)
    pool_max_overflow — Max overflow connections (default: 5)
    timeout           — Connection timeout in seconds (default: 30)
    connect_timeout   — Alias for timeout
    retry             — Max retry attempts (default: 3)
    retry_delay       — Base retry delay in seconds (default: 1.0)
    tls               — Enable TLS: "true" or "false" (default: false)
    tls_insecure      — Skip TLS verification: "true" or "false"
    tls_ca_file       — Path to CA certificate file
    health_interval   — Health check interval in seconds

Example URIs::

    vedadb://admin:pass@localhost:7480/mydb
    vedadb://admin:pass@localhost:7480/mydb?pool_size=20&timeout=30s&retry=3
    vedadb://admin:pass@db.example.com:443/prod?tls=true&tls_insecure=false
    vedadb://localhost/mydb?pool_size=50&timeout=60

Example::

    from vedadb.uri import parse_uri, Config

    config = parse_uri("vedadb://admin:pass@localhost:7480/mydb?pool_size=20")
    db = connect(**config.to_kwargs())
"""

from __future__ import annotations

import logging
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from .exceptions import VedaDBValidationError

logger = logging.getLogger("vedadb.uri")


@dataclass
class Config:
    """Parsed VedaDB connection configuration.

    Attributes map directly to the parameters accepted by
    :class:`VedaDB`, :class:`ConnectionPool`, etc.
    """

    host: str = "localhost"
    port: int = 8080
    username: str | None = None
    password: str | None = None
    database: str | None = None
    timeout: float = 30.0
    tls: bool = False
    tls_insecure: bool = False
    tls_ca_file: str | None = None
    max_retries: int = 3
    retry_delay: float = 1.0
    pool_size: int = 10
    pool_min_size: int = 1
    pool_max_overflow: int = 5
    health_interval: float = 10.0
    # Extra parameters not captured above
    extra: Dict[str, str] = field(default_factory=dict)

    def to_kwargs(self) -> Dict[str, Any]:
        """Convert this Config to keyword arguments for :class:`VedaDB`."""
        return {
            "host": self.host,
            "rest_port": self.port,
            "username": self.username,
            "password": self.password,
            "database": self.database,
            "timeout": self.timeout,
            "tls": self.tls,
            "tls_insecure": self.tls_insecure,
            "tls_ca_file": self.tls_ca_file,
            "max_retries": self.max_retries,
        }

    def to_pool_kwargs(self) -> Dict[str, Any]:
        """Convert this Config to keyword arguments for :class:`ConnectionPool`."""
        return {
            "host": self.host,
            "rest_port": self.port,
            "username": self.username,
            "password": self.password,
            "database": self.database,
            "timeout": self.timeout,
            "tls": self.tls,
            "tls_insecure": self.tls_insecure,
            "tls_ca_file": self.tls_ca_file,
            "max_size": self.pool_size,
            "max_overflow": self.pool_max_overflow,
            "health_check_interval": self.health_interval,
        }

    def to_async_kwargs(self) -> Dict[str, Any]:
        """Convert this Config to keyword arguments for :class:`AsyncVedaDB`."""
        return {
            "host": self.host,
            "port": self.port,
            "user": self.username,
            "password": self.password,
            "timeout": self.timeout,
            "tls": self.tls,
        }

    def __repr__(self) -> str:
        masked = "***" if self.password else None
        return (
            f"<Config host={self.host!r} port={self.port} "
            f"user={self.username!r} db={self.database!r} "
            f"tls={self.tls}>"
        )


# ---------------------------------------------------------------------------
# URI parsing
# ---------------------------------------------------------------------------


def parse_uri(uri: str) -> Config:
    """Parse a ``vedadb://`` URI to a :class:`Config`.

    Args:
        uri: The connection URI.

    Returns:
        A populated :class:`Config` instance.

    Raises:
        VedaDBValidationError: If the URI is malformed or has invalid values.

    Example::

        config = parse_uri("vedadb://admin:pass@localhost:7480/mydb?pool_size=20")
        print(config.host)       # "localhost"
        print(config.port)       # 7480
        print(config.database)   # "mydb"
        print(config.pool_size)  # 20
    """
    if not uri or not uri.strip():
        raise VedaDBValidationError("URI must not be empty")

    # Ensure the scheme is present
    if "://" not in uri:
        raise VedaDBValidationError(f"URI must have a scheme (e.g. vedadb://): {uri!r}")

    parsed = urllib.parse.urlparse(uri)

    if parsed.scheme != "vedadb":
        logger.warning(
            "Unexpected URI scheme %r (expected 'vedadb')", parsed.scheme
        )

    config = Config()

    # Host and port
    if parsed.hostname:
        config.host = parsed.hostname
    if parsed.port:
        config.port = parsed.port

    # Credentials
    if parsed.username:
        config.username = urllib.parse.unquote(parsed.username)
    if parsed.password:
        config.password = urllib.parse.unquote(parsed.password)

    # Database (path component, strip leading /)
    if parsed.path and parsed.path != "/":
        config.database = parsed.path.lstrip("/")

    # Query parameters
    params = urllib.parse.parse_qs(parsed.query)
    for key, values in params.items():
        value = values[-1]  # Take the last value for duplicate keys
        _apply_param(config, key, value)

    logger.debug("Parsed URI: %r → %s", _mask_uri(uri), config)
    return config


def _apply_param(config: Config, key: str, value: str) -> None:
    """Apply a single query parameter to a Config."""
    key = key.lower()

    if key in ("pool_size", "max_size"):
        config.pool_size = _parse_int(value, key)
    elif key == "pool_min_size":
        config.pool_min_size = _parse_int(value, key)
    elif key in ("pool_max_overflow", "max_overflow"):
        config.pool_max_overflow = _parse_int(value, key)
    elif key in ("timeout", "connect_timeout"):
        config.timeout = _parse_duration(value, key)
    elif key == "retry":
        config.max_retries = _parse_int(value, key)
    elif key == "retry_delay":
        config.retry_delay = _parse_float(value, key)
    elif key == "tls":
        config.tls = _parse_bool(value, key)
    elif key == "tls_insecure":
        config.tls_insecure = _parse_bool(value, key)
    elif key == "tls_ca_file":
        config.tls_ca_file = value
    elif key == "health_interval":
        config.health_interval = _parse_duration(value, key)
    else:
        config.extra[key] = value


def _parse_int(value: str, name: str) -> int:
    try:
        return int(value)
    except ValueError:
        raise VedaDBValidationError(f"{name} must be an integer, got {value!r}")


def _parse_float(value: str, name: str) -> float:
    try:
        return float(value)
    except ValueError:
        raise VedaDBValidationError(f"{name} must be a number, got {value!r}")


def _parse_bool(value: str, name: str) -> bool:
    v = value.lower().strip()
    if v in ("true", "1", "yes", "on"):
        return True
    if v in ("false", "0", "no", "off"):
        return False
    raise VedaDBValidationError(f"{name} must be a boolean, got {value!r}")


def _parse_duration(value: str, name: str) -> float:
    """Parse a duration string like '30s', '5m', '1h', or '30'."""
    value = value.strip()
    suffix = value[-1].lower()
    if suffix == "s":
        return _parse_float(value[:-1], name)
    if suffix == "m":
        return _parse_float(value[:-1], name) * 60
    if suffix == "h":
        return _parse_float(value[:-1], name) * 3600
    if suffix == "d":
        return _parse_float(value[:-1], name) * 86400
    # No suffix — assume seconds
    return _parse_float(value, name)


def _mask_uri(uri: str) -> str:
    """Return a URI with the password masked for safe logging."""
    try:
        parsed = urllib.parse.urlparse(uri)
        if parsed.password:
            masked_netloc = parsed.netloc.replace(parsed.password, "***")
            return urllib.parse.urlunparse(parsed._replace(netloc=masked_netloc))
    except Exception:
        pass
    return uri


# ---------------------------------------------------------------------------
# Convenience: build URI from Config
# ---------------------------------------------------------------------------


def build_uri(config: Config) -> str:
    """Build a ``vedadb://`` URI from a :class:`Config`.

    The password is included — use with caution in production.

    Example::

        uri = build_uri(Config(host="localhost", port=7480, database="mydb"))
        print(uri)  # "vedadb://localhost:7480/mydb"
    """
    netloc = config.host
    if config.port and config.port != 8080:
        netloc = f"{netloc}:{config.port}"
    if config.username:
        creds = urllib.parse.quote(config.username, safe="")
        if config.password:
            creds += f":{urllib.parse.quote(config.password, safe='')}"
        netloc = f"{creds}@{netloc}"

    path = f"/{config.database}" if config.database else ""

    query_parts: list[str] = []
    if config.pool_size != 10:
        query_parts.append(f"pool_size={config.pool_size}")
    if config.timeout != 30.0:
        query_parts.append(f"timeout={config.timeout}")
    if config.max_retries != 3:
        query_parts.append(f"retry={config.max_retries}")
    if config.tls:
        query_parts.append("tls=true")
    if config.tls_ca_file:
        query_parts.append(f"tls_ca_file={urllib.parse.quote(config.tls_ca_file)}")

    query = "&".join(query_parts)

    return urllib.parse.urlunparse(
        ("vedadb", netloc, path, "", query, "")
    )
