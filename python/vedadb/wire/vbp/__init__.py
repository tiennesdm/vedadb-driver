"""
VedaDB Binary Protocol (VBP) — public API.

This package is the v1 transport option for the VedaDB Python driver.
It is **opt-in**: the high-level ``VedaDB`` / ``connect()`` API still
uses HTTP by default.  To use VBP, instantiate ``VBPConnection``
directly or pass ``transport="vbp"`` to ``connect()``.

The public surface is intentionally small::

    from vedadb.wire.vbp import VBPConnection, VBPError, Multiplexer, Frame
    conn = VBPConnection(host="127.0.0.1", port=6380, user="admin", password="benchpw-cw-2026")
    conn.connect()
    rows = conn.execute("SELECT 1")
    conn.close()

The package is pure stdlib (no third-party deps at runtime; the test
suite and conformance runner use ``pyyaml`` and ``cryptography`` as
optional dev-deps only).
"""
from __future__ import annotations

import logging
import socket
import ssl
import struct
from typing import Any, Optional, Sequence

from .auth import (
    AUTH_MECH_NONE,
    AUTH_MECH_PLAIN,
    AUTH_MECH_SCRAM_SHA_256,
    HandshakeResult,
    perform_handshake,
)
from .frame import (
    DEFAULT_VBP_PORT,
    Frame,
    MAX_FRAME_LEN,
    VBPBadMagic,
    VBPConnectionClosed,
    VBPFrameTooLarge,
    VBPFrameTooShort,
    VBPProtocolError,
    frame_bytes,
    read_frame,
    write_frame,
)
from .handlers import (
    HANDLERS,
    assert_all_mandatory_handlers_registered,
)
from .multiplexer import Multiplexer, VBPError
from .opcodes import (
    AUTH_MECH_NONE as _AUTH_MECH_NONE,
    AUTH_MECH_PLAIN as _AUTH_MECH_PLAIN,
    AUTH_MECH_SCRAM_SHA_256 as _AUTH_MECH_SCRAM_SHA_256,
    MANDATORY_OPCODES,
    OP_AUTH_OK,
    OP_CLIENT_HELLO,
    OP_COMMAND_COMPLETE,
    OP_DATA_CHUNK,
    OP_PING,
    OP_ROWS_FINISHED,
    OPCODE_NAMES,
    TYPE_IDS,
    opcode_name,
    type_id_name,
)
from .types import (
    T_BOOL,
    T_BYTEA,
    T_FLOAT8,
    T_INT4,
    T_TEXT,
    decode_value,
    encode_value,
    is_known_type,
)

logger = logging.getLogger("vedadb.wire.vbp")

__version__ = "1.0.0"


# ---------------------------------------------------------------------------
# Default auth mechanism (PLAIN in dev mode; SCRAM for production)
# ---------------------------------------------------------------------------


def _default_mechanism() -> str:
    """Pick an auth mechanism based on environment."""
    import os
    return os.environ.get("VEDADB_VBP_MECH", AUTH_MECH_PLAIN).upper()


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


class VBPResult:
    """A VBP result set — decoded from DATA_CHUNK / ROWS_FINISHED.

    Attributes:
        columns: list of column names (from DATA_CHUNK).
        column_types: list of VBP type IDs.
        rows: list of decoded rows (each row is a list of values).
        command_tag: server-provided command tag (e.g. ``"SELECT 1"``).
        rows_affected: row count from ROWS_FINISHED.
    """

    __slots__ = ("columns", "column_types", "rows", "command_tag", "rows_affected")

    def __init__(self):
        self.columns: list[str] = []
        self.column_types: list[int] = []
        self.rows: list[list[Any]] = []
        self.command_tag: str = ""
        self.rows_affected: int = 0

    def to_dicts(self) -> list[dict[str, Any]]:
        if not self.columns:
            return []
        return [dict(zip(self.columns, row)) for row in self.rows]

    def __repr__(self) -> str:
        return (
            f"VBPResult(columns={self.columns!r}, "
            f"column_types={self.column_types!r}, "
            f"row_count={len(self.rows)}, command_tag={self.command_tag!r})"
        )


# ---------------------------------------------------------------------------
# Result decoder
# ---------------------------------------------------------------------------


def _decode_data_chunk(body: bytes) -> tuple[list[str], list[int], list[list[Any]]]:
    """Decode a DATA_CHUNK body into (col_names, col_types, rows)."""
    import io
    buf = io.BytesIO(body)
    (chunk_id,) = struct.unpack("<I", buf.read(4))
    (row_count,) = struct.unpack("<I", buf.read(4))
    (col_count,) = struct.unpack("<H", buf.read(2))
    col_names: list[str] = []
    col_types: list[int] = []
    for _ in range(col_count):
        (nlen,) = struct.unpack("<I", buf.read(4))
        col_names.append(buf.read(nlen).decode("utf-8"))
        (tid,) = struct.unpack("<H", buf.read(2))
        col_types.append(tid)
    # null_bitmap_byte_count (u8) — v1 doesn't use bitmaps, so this is
    # always 0 in the v1 reference server, but we read+skip it for
    # forward-compat.
    null_bitmap_byte_count = buf.read(1)[0]
    if null_bitmap_byte_count > 0:
        buf.read(null_bitmap_byte_count)
    rows: list[list[Any]] = []
    for _r in range(row_count):
        row: list[Any] = []
        for ci, tid in enumerate(col_types):
            # Fixed-width encoders (no null bitmap) for v1 simplicity.
            if tid == T_BOOL:
                row.append(buf.read(1)[0] != 0)
            elif tid == T_INT4:
                row.append(struct.unpack("<i", buf.read(4))[0])
            elif tid == T_TEXT:
                (n,) = struct.unpack("<I", buf.read(4))
                row.append(buf.read(n).decode("utf-8"))
            else:
                # Fallback: try to decode via type codec.
                try:
                    row.append(decode_value(tid, buf.read(_type_fixed_size(tid))))
                except Exception:
                    row.append(None)
        rows.append(row)
    return col_names, col_types, rows


def _type_fixed_size(tid: int) -> int:
    """Return a best-guess fixed size for ``tid`` (used by the decoder fallback)."""
    if tid in (T_BOOL,):
        return 1
    if tid == T_INT4:
        return 4
    return 4


def _decode_rows_finished(body: bytes) -> tuple[int, str]:
    """Return (rows_affected, command_tag)."""
    import io
    buf = io.BytesIO(body)
    (rows_affected,) = struct.unpack("<Q", buf.read(8))
    (tlen,) = struct.unpack("<I", buf.read(4))
    tag = buf.read(tlen).decode("utf-8")
    return rows_affected, tag


# ---------------------------------------------------------------------------
# The public connection
# ---------------------------------------------------------------------------


class VBPConnection:
    """A high-level synchronous VBP client connection.

    The connection is **not** thread-safe; use one per thread or wrap
    in a connection pool.  For concurrent pipelining, the underlying
    ``Multiplexer`` supports it but ``execute()`` blocks until the
    whole reply stream is received.

    Args:
        host: server hostname.
        port: VBP port (default ``6380``).
        user: username for PLAIN/SCRAM.
        password: password.
        database: default database (informational; sent in CLIENT_HELLO).
        timeout: socket timeout (seconds).
        tls: enable TLS (v1 has a TLS slot in SERVER_READY but we do
            not implement the upgrade yet — see ``v2: TLS upgrade``).
        mechanism: ``"PLAIN"`` / ``"SCRAM-SHA-256"`` / ``"NONE"``
            (dev mode).
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = DEFAULT_VBP_PORT,
        *,
        user: str = "",
        password: str = "",
        db: str = "",
        timeout: float = 30.0,
        tls: bool = False,
        mechanism: Optional[str] = None,
    ):
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.db = db
        self.timeout = timeout
        self.tls = tls
        self.mechanism = (mechanism or _default_mechanism()).upper()
        self._sock: Optional[socket.socket] = None
        self._mux: Optional[Multiplexer] = None
        self._connected = False
        self._session_token: int = 0
        self._closed = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def connect(self) -> "VBPConnection":
        """Open the TCP connection, run CLIENT_HELLO, run auth."""
        if self._connected:
            return self
        # 1. Open TCP.
        self._sock = socket.create_connection(
            (self.host, self.port), timeout=self.timeout
        )
        self._sock.settimeout(self.timeout)
        # 2. Build the multiplexer.
        self._mux = Multiplexer(self._sock)
        self._mux.start()
        # 3. Send CLIENT_HELLO.
        hello_body = self._build_hello()
        replies = self._mux.call(OP_CLIENT_HELLO, hello_body, timeout=self.timeout)
        if not replies:
            raise VBPConnectionError("no SERVER_READY received")
        # 4. Walk replies; expect SERVER_READY (and maybe AUTH_OK in dev mode).
        saw_auth_ok = False
        for f in replies:
            if f.op == OP_AUTH_OK:
                saw_auth_ok = True
            elif f.op == 0x0D:  # ERROR
                sqlstate, msg, detail, hint = Multiplexer._parse_error_frame(f)
                raise VBPError(sqlstate, msg, detail, hint)
        if not saw_auth_ok and self.mechanism != AUTH_MECH_NONE and self.user:
            # 5. Run auth.
            hr = perform_handshake(
                self._mux,
                mechanism=self.mechanism,
                username=self.user,
                password=self.password,
                timeout=self.timeout,
            )
            self._session_token = hr.session_token
        elif saw_auth_ok:
            self._session_token = 0
        self._connected = True
        return self

    def close(self) -> None:
        """Close the connection gracefully."""
        if self._closed:
            return
        self._closed = True
        if self._mux is not None:
            try:
                # Best-effort CLOSE.
                self._mux.send(0x18, b"")
            except Exception:
                pass
            self._mux.close()
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass

    def __enter__(self) -> "VBPConnection":
        return self.connect()

    def __exit__(self, *args) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Wire operations
    # ------------------------------------------------------------------

    def execute(self, sql: str, params: Optional[Sequence[Any]] = None) -> VBPResult:
        """Run a single VedaQL statement and return a ``VBPResult``.

        Args:
            sql: VedaQL text.
            params: optional positional parameter list (must be plain
                Python values; type inference picks T_INT4 / T_TEXT /
                T_BOOL based on the Python type).
        """
        if not self._connected or self._mux is None:
            raise VBPConnectionError("not connected; call connect() first")
        body = self._build_query(sql, params)
        replies = self._mux.call(0x06, body, timeout=self.timeout)  # OP_QUERY
        return self._parse_replies(replies)

    def ping(self) -> int:
        """Send a PING and return the round-trip nonce (u64)."""
        if not self._connected or self._mux is None:
            raise VBPConnectionError("not connected")
        import time
        nonce = struct.pack("<Q", int(time.time() * 1_000_000) & 0xFFFFFFFFFFFFFFFF)
        replies = self._mux.call(0x16, nonce, timeout=self.timeout)  # OP_PING
        if not replies or replies[0].op != 0x17:  # OP_PONG
            raise VBPError("08P01", "expected PONG")
        return struct.unpack("<Q", replies[0].body[:8])[0]

    # ------------------------------------------------------------------
    # Frame builders
    # ------------------------------------------------------------------

    def _build_hello(self) -> bytes:
        import io
        body = io.BytesIO()
        body.write(struct.pack("<H", 1))  # protocol_version
        body.write(struct.pack("<H", 0))  # client_flags
        body.write(struct.pack("<I", len(self.user)))
        body.write(self.user.encode("utf-8"))
        body.write(struct.pack("<I", len(self.db)))
        body.write(self.db.encode("utf-8"))
        body.write(bytes([0]))  # actor_kind = 0 (user)
        body.write(struct.pack("<I", len(self.user)))
        body.write(self.user.encode("utf-8"))
        return body.getvalue()

    def _build_query(self, sql: str, params: Optional[Sequence[Any]] = None) -> bytes:
        import io
        body = io.BytesIO()
        body.write(struct.pack("<I", 0))  # query_id (unused in v1 stub)
        sql_bytes = sql.encode("utf-8")
        body.write(struct.pack("<I", len(sql_bytes)))
        body.write(sql_bytes)
        if not params:
            body.write(struct.pack("<H", 0))  # param_count
            return body.getvalue()
        # Build a per-param block: u16 type_id + u32 value_len + value
        # wrapped by an outer length so the server can advance past.
        param_bytes = io.BytesIO()
        for p in params:
            if p is None:
                # NULL param — emit a u8 marker (1) so the server
                # knows to bind a NULL value of the indicated type.
                # We default to T_INT4 in v1.
                tid = T_INT4
                param_bytes.write(struct.pack("<HI", tid, 1))
                param_bytes.write(b"\x01")  # is_null flag
            elif isinstance(p, bool):
                tid = T_BOOL
                val = encode_value(tid, p)
                param_bytes.write(struct.pack("<HI", tid, len(val)))
                param_bytes.write(val)
            elif isinstance(p, int):
                tid = T_INT4
                val = encode_value(tid, p)
                param_bytes.write(struct.pack("<HI", tid, len(val)))
                param_bytes.write(val)
            elif isinstance(p, float):
                tid = T_FLOAT8
                val = encode_value(tid, p)
                param_bytes.write(struct.pack("<HI", tid, len(val)))
                param_bytes.write(val)
            elif isinstance(p, (bytes, bytearray)):
                tid = T_BYTEA
                val = encode_value(tid, bytes(p))
                param_bytes.write(struct.pack("<HI", tid, len(val)))
                param_bytes.write(val)
            elif isinstance(p, str):
                tid = T_TEXT
                val = encode_value(tid, p)
                param_bytes.write(struct.pack("<HI", tid, len(val)))
                param_bytes.write(val)
            else:
                # Fall back to JSON.
                tid = T_TEXT
                val = encode_value(tid, str(p))
                param_bytes.write(struct.pack("<HI", tid, len(val)))
                param_bytes.write(val)
        body.write(struct.pack("<H", len(params)))
        body.write(param_bytes.getvalue())
        return body.getvalue()

    def _parse_replies(self, replies: list[Frame]) -> VBPResult:
        result = VBPResult()
        for f in replies:
            if f.op == OP_DATA_CHUNK:
                cols, types, rows = _decode_data_chunk(f.body)
                result.columns = cols
                result.column_types = types
                result.rows = rows
            elif f.op == OP_ROWS_FINISHED:
                rows_affected, tag = _decode_rows_finished(f.body)
                result.rows_affected = rows_affected
                result.command_tag = tag
            elif f.op == OP_COMMAND_COMPLETE:
                pass
            elif f.op == 0x0D:
                sqlstate, msg, detail, hint = Multiplexer._parse_error_frame(f)
                raise VBPError(sqlstate, msg, detail, hint)
        return result


class VBPConnectionError(VBPError):
    """Connection lifecycle error (not connected, broken pipe, etc.)."""


# ---------------------------------------------------------------------------
# Public re-exports
# ---------------------------------------------------------------------------


__all__ = [
    # Connection
    "VBPConnection",
    "VBPConnectionError",
    "VBPError",
    "VBPResult",
    # Wire helpers
    "Frame",
    "Multiplexer",
    "HANDLERS",
    "assert_all_mandatory_handlers_registered",
    # Wire-level exceptions
    "VBPProtocolError",
    "VBPBadMagic",
    "VBPFrameTooShort",
    "VBPFrameTooLarge",
    "VBPConnectionClosed",
    # Constants
    "DEFAULT_VBP_PORT",
    "MAX_FRAME_LEN",
    "MANDATORY_OPCODES",
    "OPCODE_NAMES",
    "TYPE_IDS",
    "opcode_name",
    "type_id_name",
    "is_known_type",
    # Auth
    "AUTH_MECH_NONE",
    "AUTH_MECH_PLAIN",
    "AUTH_MECH_SCRAM_SHA_256",
    "HandshakeResult",
    "perform_handshake",
    # Encoders
    "encode_value",
    "decode_value",
    # Version
    "__version__",
]
