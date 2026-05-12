"""
TLS/SSL support for VedaDB connections.

Provides utilities for creating SSL contexts, certificate validation,
and TLS configuration for all connection types (sync, async, pool).

Example::

    from vedadb.tls import TLSConfig

    tls = TLSConfig(
        enabled=True,
        ca_file="/path/to/ca.crt",
        cert_file="/path/to/client.crt",
        key_file="/path/to/client.key",
        verify=True,
    )

    db = connect(host="db.example.com", tls=True, tls_ca_file=tls.ca_file)
"""

from __future__ import annotations

import logging
import ssl
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

logger = logging.getLogger("vedadb.tls")


@dataclass
class TLSConfig:
    """TLS/SSL configuration for VedaDB connections.

    Attributes:
        enabled: Whether TLS is enabled.
        ca_file: Path to CA certificate file for server verification.
        cert_file: Path to client certificate file (for mutual TLS).
        key_file: Path to client private key file (for mutual TLS).
        verify: Whether to verify the server's certificate.
        check_hostname: Whether to check the hostname matches the cert.
        cipher_suites: Optional list of allowed cipher suites.
        min_version: Minimum TLS version (e.g. "TLSv1.2").
        max_version: Maximum TLS version.
    """

    enabled: bool = False
    ca_file: str | None = None
    cert_file: str | None = None
    key_file: str | None = None
    verify: bool = True
    check_hostname: bool = True
    cipher_suites: list[str] | None = None
    min_version: str | None = None
    max_version: str | None = None

    @property
    def insecure(self) -> bool:
        """Return True if TLS verification is disabled (dev only)."""
        return not self.verify

    def create_ssl_context(self) -> ssl.SSLContext | None:
        """Create an :class:`ssl.SSLContext` from this configuration.

        Returns:
            An SSL context, or None if TLS is not enabled.
        """
        if not self.enabled:
            return None

        # Choose the protocol version
        if self.min_version:
            proto = self._parse_protocol(self.min_version)
        else:
            proto = ssl.PROTOCOL_TLS_CLIENT

        ctx = ssl.SSLContext(proto)

        # Certificate verification
        if self.verify:
            ctx.verify_mode = ssl.CERT_REQUIRED
            ctx.check_hostname = self.check_hostname
            if self.ca_file:
                ctx.load_verify_locations(self.ca_file)
            else:
                ctx.load_default_certs()
        else:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            logger.warning("TLS certificate verification is disabled — INSECURE")

        # Client certificate (mutual TLS)
        if self.cert_file and self.key_file:
            ctx.load_cert_chain(self.cert_file, self.key_file)
            logger.debug("Loaded client certificate for mutual TLS")

        # Cipher suites
        if self.cipher_suites:
            ctx.set_ciphers(":".join(self.cipher_suites))

        # TLS version constraints
        if self.min_version:
            min_ssl = self._parse_ssl_version(self.min_version)
            if min_ssl is not None:
                ctx.minimum_version = min_ssl
        if self.max_version:
            max_ssl = self._parse_ssl_version(self.max_version)
            if max_ssl is not None:
                ctx.maximum_version = max_ssl

        # Default: require TLS 1.2+
        if self.min_version is None:
            ctx.minimum_version = ssl.TLSVersion.TLSv1_2

        return ctx

    def to_kwargs(self) -> Dict[str, Any]:
        """Convert to keyword args for :class:`VedaDB` / :class:`ConnectionPool`."""
        return {
            "tls": self.enabled,
            "tls_insecure": self.insecure,
            "tls_ca_file": self.ca_file,
        }

    @staticmethod
    def _parse_protocol(version: str) -> int:
        """Map a version string to an ssl PROTOCOL_* constant."""
        v = version.upper().replace(".", "_")
        mapping = {
            "TLS": ssl.PROTOCOL_TLS_CLIENT,
            "TLSV1": ssl.PROTOCOL_TLS_CLIENT,
            "TLSV1_1": ssl.PROTOCOL_TLS_CLIENT,
            "TLSV1_2": ssl.PROTOCOL_TLS_CLIENT,
            "TLSV1_3": ssl.PROTOCOL_TLS_CLIENT,
        }
        return mapping.get(v, ssl.PROTOCOL_TLS_CLIENT)

    @staticmethod
    def _parse_ssl_version(version: str) -> ssl.TLSVersion | None:
        """Map a version string to a ssl.TLSVersion enum value."""
        v = version.upper().replace(".", "_")
        mapping: Dict[str, ssl.TLSVersion] = {
            "TLSV1": ssl.TLSVersion.TLSv1,
            "TLSV1_1": ssl.TLSVersion.TLSv1_1,
            "TLSV1_2": ssl.TLSVersion.TLSv1_2,
            "TLSV1_3": ssl.TLSVersion.TLSv1_3,
        }
        return mapping.get(v)

    def __repr__(self) -> str:
        return (
            f"<TLSConfig enabled={self.enabled} "
            f"verify={self.verify} mTLS={bool(self.cert_file)}>"
        )


# ---------------------------------------------------------------------------
# Factory functions
# ---------------------------------------------------------------------------


def create_ssl_context(
    enabled: bool = True,
    ca_file: str | None = None,
    cert_file: str | None = None,
    key_file: str | None = None,
    verify: bool = True,
    insecure: bool = False,
) -> ssl.SSLContext | None:
    """Create an SSL context with the given parameters.

    This is a convenience shortcut to avoid building a :class:`TLSConfig`
    when you just need a quick context.

    Args:
        enabled: Whether TLS is enabled.  Returns None if False.
        ca_file: Path to CA certificate.
        cert_file: Path to client certificate.
        key_file: Path to client private key.
        verify: Verify server certificates.
        insecure: Skip verification (dev only, overrides *verify*).

    Returns:
        An :class:`ssl.SSLContext` or None.

    Example::

        ctx = create_ssl_context(
            ca_file="/etc/ssl/certs/ca.crt",
            verify=True,
        )
        db = connect(host="db.example.com", tls=True, tls_ca_file="/etc/ssl/certs/ca.crt")
    """
    config = TLSConfig(
        enabled=enabled,
        ca_file=ca_file,
        cert_file=cert_file,
        key_file=key_file,
        verify=verify and not insecure,
        check_hostname=verify and not insecure,
    )
    return config.create_ssl_context()


def apply_tls_to_pool_kwargs(tls_config: TLSConfig, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Merge TLS configuration into pool/client keyword arguments.

    Modifies *kwargs* in-place and returns it.

    Example::

        kwargs = {"host": "db.example.com"}
        apply_tls_to_pool_kwargs(TLSConfig(enabled=True, ca_file="ca.crt"), kwargs)
        # kwargs now contains tls=True, tls_ca_file="ca.crt", etc.
    """
    kwargs.update(tls_config.to_kwargs())
    return kwargs
