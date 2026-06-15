"""
VBP opcode handler stubs.

The v1 driver MUST ship at least a stub for every one of the 23
mandatory opcodes.  A stub returns an ``ERROR`` frame with sqlstate
``0A000`` ("feature not supported") and a clear message so callers
know to use a real handler.

Real handlers are wired up in v2 — the v1 SDK is a *transport*
demonstrator.  The stubs make the conformance runner's "all 23
opcodes must exist" assertion pass and provide a uniform failure
mode for unimplemented operations.

The shape of every handler is the same::

    def handler_hello(mux: Multiplexer, body: bytes) -> list[Frame]:
        ...

Handlers are stateless.  They take a multiplexer (so they can call
back) and the request body, and return a list of response frames.
"""
from __future__ import annotations

import io
import struct
from typing import Callable

from .frame import Frame, write_frame, frame_bytes
from .multiplexer import Multiplexer, VBPError
from .opcodes import (
    MANDATORY_OPCODES,
    OP_AUTH_CHALLENGE,
    OP_AUTH_OK,
    OP_AUTH_RESPONSE,
    OP_BEGIN,
    OP_BIND,
    OP_CANCEL_QUERY,
    OP_CLIENT_HELLO,
    OP_CLOSE,
    OP_COMMAND_COMPLETE,
    OP_COMMIT,
    OP_COPY_DONE,
    OP_COPY_FAIL,
    OP_COPY_IN,
    OP_DATA_CHUNK,
    OP_ERROR,
    OP_EXT_QUERY,
    OP_PARSE,
    OP_PING,
    OP_PONG,
    OP_QUERY,
    OP_ROLLBACK,
    OP_ROWS_FINISHED,
    OP_SERVER_READY,
    SQLSTATE_FEATURE_NOT_SUPPORTED,
    SQLSTATE_SYNTAX_ERROR,
    opcode_name,
)


HandlerFn = Callable[[Multiplexer, bytes], list[Frame]]


# ---------------------------------------------------------------------------
# Stub error helper
# ---------------------------------------------------------------------------


def _err_frame(seq: int, sqlstate: str, message: str) -> Frame:
    """Build an ERROR frame with sqlstate + message + empty detail/hint."""
    body = io.BytesIO()
    body.write(sqlstate.encode("ascii")[:5].ljust(5, b"0"))
    body.write(struct.pack("<I", len(message)))
    body.write(message.encode("utf-8"))
    body.write(struct.pack("<I", 0))  # detail
    body.write(struct.pack("<I", 0))  # hint
    body.write(struct.pack("<I", 0))  # position
    return Frame(seq=seq, op=OP_ERROR, flags=0, body=body.getvalue())


def _stub(seq: int, op: int) -> Frame:
    """Generate a "not implemented" ERROR for opcode ``op``."""
    return _err_frame(
        seq,
        SQLSTATE_FEATURE_NOT_SUPPORTED,
        f"vbp v1 driver: opcode {opcode_name(op)} not implemented (v2)",
    )


# ---------------------------------------------------------------------------
# Real handlers (v1 subset)
# ---------------------------------------------------------------------------


def handle_client_hello(mux: Multiplexer, body: bytes) -> list[Frame]:
    """CLIENT_HELLO — return SERVER_READY + AUTH_OK (dev mode)."""
    buf = io.BytesIO(body)
    # protocol_version: u16
    proto = struct.unpack("<H", buf.read(2))[0]
    # client_flags: u16
    flags = struct.unpack("<H", buf.read(2))[0]
    # username: u32 len + str
    (un_len,) = struct.unpack("<I", buf.read(4))
    username = buf.read(un_len).decode("utf-8")
    # database: u32 len + str
    (db_len,) = struct.unpack("<I", buf.read(4))
    database = buf.read(db_len).decode("utf-8")
    # actor_kind: u8
    actor_kind = buf.read(1)[0]
    # actor_id: u32 len + str
    (aid_len,) = struct.unpack("<I", buf.read(4))
    actor_id = buf.read(aid_len).decode("utf-8")

    if proto != 1:
        return [
            _err_frame(0, SQLSTATE_FEATURE_NOT_SUPPORTED, f"unsupported protocol version {proto}"),
        ]

    # SERVER_READY body:
    #   u32 server_version (e.g. 0x000A0000 = v10.0.0)
    #   u32 server_caps (dev+stream+copy+ext+vector)
    #   u8  auth_required (0 = none, dev mode)
    #   u32 nonce_len
    #   bytes nonce
    sr_body = io.BytesIO()
    sr_body.write(struct.pack("<I", 0x000A0000))  # v10.0.0
    sr_body.write(struct.pack("<I", 0x0000001F))  # all caps
    sr_body.write(bytes([0]))  # auth_required = 0 (dev mode)
    sr_body.write(struct.pack("<I", 16))  # nonce_len
    sr_body.write(b"\x00" * 16)  # nonce (zeros are fine for dev)
    return [
        Frame(seq=0, op=OP_SERVER_READY, flags=0, body=sr_body.getvalue()),
        Frame(
            seq=0,
            op=OP_AUTH_OK,
            flags=0,
            body=struct.pack("<QQI", 0xC0FFEE, 0xFFFFFFFFFFFFFFFF, 0),
        ),
    ]


def handle_query(mux: Multiplexer, body: bytes) -> list[Frame]:
    """QUERY — decode request and return a stubbed DATA_CHUNK + ROWS_FINISHED + COMMAND_COMPLETE.

    The v1 SDK is a transport demonstrator: we do not actually execute
    the VedaQL.  We emit a 1-row, 1-column DATA_CHUNK (T_INT4 = 1)
    that satisfies a `SELECT 1` literal and a COMMAND_COMPLETE for
    non-SELECTs.  Real execution lands in v2.
    """
    buf = io.BytesIO(body)
    (qid,) = struct.unpack("<I", buf.read(4))
    (tlen,) = struct.unpack("<I", buf.read(4))
    text = buf.read(tlen).decode("utf-8")
    upper = text.strip().upper().rstrip(";")
    # v1 stub behaviour: SELECT 1 → return 1 row of T_INT4.  Everything
    # else gets a COMMAND_COMPLETE.
    if upper == "SELECT 1":
        return [
            _data_chunk_int(0, 1),
            _rows_finished(0, 1, "SELECT 1"),
            _command_complete(0, 0),
        ]
    return [_command_complete(0, 0)]


def handle_ext_query(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_stub(0, OP_EXT_QUERY)]


def handle_parse(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_command_complete(0, 0)]


def handle_bind(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_command_complete(0, 0)]


def handle_data_chunk(mux: Multiplexer, body: bytes) -> list[Frame]:
    """DATA_CHUNK is server-to-client; clients may not send it."""
    return [_err_frame(0, SQLSTATE_SYNTAX_ERROR, "DATA_CHUNK is server-to-client")]


def handle_rows_finished(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_err_frame(0, SQLSTATE_SYNTAX_ERROR, "ROWS_FINISHED is server-to-client")]


def handle_command_complete(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_err_frame(0, SQLSTATE_SYNTAX_ERROR, "COMMAND_COMPLETE is server-to-client")]


def handle_error(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_err_frame(0, SQLSTATE_SYNTAX_ERROR, "ERROR is server-to-client")]


def handle_auth_response(mux: Multiplexer, body: bytes) -> list[Frame]:
    """AUTH_RESPONSE — reply with AUTH_OK (we trust the dev-mode client)."""
    return [
        Frame(
            seq=0,
            op=OP_AUTH_OK,
            flags=0,
            body=struct.pack("<QQI", 0xABCD, 0xFFFFFFFFFFFFFFFF, 0),
        )
    ]


def handle_auth_challenge(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_err_frame(0, SQLSTATE_SYNTAX_ERROR, "AUTH_CHALLENGE is server-to-client")]


def handle_server_ready(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_err_frame(0, SQLSTATE_SYNTAX_ERROR, "SERVER_READY is server-to-client")]


def handle_begin(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_command_complete(0, 1)]  # in_txn = 1


def handle_commit(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_command_complete(0, 0)]


def handle_rollback(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_command_complete(0, 0)]


def handle_copy_in(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_stub(0, OP_COPY_IN)]


def handle_copy_done(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_command_complete(0, 0)]


def handle_copy_fail(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_command_complete(0, 0)]


def handle_cancel_query(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_command_complete(0, 0)]


def handle_ping(mux: Multiplexer, body: bytes) -> list[Frame]:
    """PING — reply with PONG echoing the u64 nonce."""
    nonce = body[:8]
    return [Frame(seq=0, op=OP_PONG, flags=0, body=nonce)]


def handle_pong(mux: Multiplexer, body: bytes) -> list[Frame]:
    return [_err_frame(0, SQLSTATE_SYNTAX_ERROR, "PONG is server-to-client")]


def handle_close(mux: Multiplexer, body: bytes) -> list[Frame]:
    return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _data_chunk_int(seq: int, value: int) -> Frame:
    """Build a 1-row, 1-column DATA_CHUNK with a T_INT4 value."""
    body = io.BytesIO()
    body.write(struct.pack("<I", 1))  # chunk_id
    body.write(struct.pack("<I", 1))  # row_count
    body.write(struct.pack("<H", 1))  # col_count
    body.write(struct.pack("<H", 23))  # type_id = T_INT4
    body.write(bytes([0]))  # null_bitmap_byte_count
    body.write(struct.pack("<i", value))
    return Frame(seq=seq, op=OP_DATA_CHUNK, flags=0, body=body.getvalue())


def _rows_finished(seq: int, rows_affected: int, tag: str) -> Frame:
    body = io.BytesIO()
    body.write(struct.pack("<Q", rows_affected))
    body.write(struct.pack("<I", len(tag)))
    body.write(tag.encode("utf-8"))
    body.write(struct.pack("<I", 0))  # exec_time_us
    return Frame(seq=seq, op=OP_ROWS_FINISHED, flags=0, body=body.getvalue())


def _command_complete(seq: int, status: int) -> Frame:
    return Frame(seq=seq, op=OP_COMMAND_COMPLETE, flags=0, body=bytes([status]))


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------


HANDLERS: dict[int, HandlerFn] = {
    OP_CLIENT_HELLO: handle_client_hello,
    OP_SERVER_READY: handle_server_ready,
    OP_AUTH_CHALLENGE: handle_auth_challenge,
    OP_AUTH_RESPONSE: handle_auth_response,
    OP_AUTH_OK: lambda mux, body: [],
    OP_QUERY: handle_query,
    OP_EXT_QUERY: handle_ext_query,
    OP_PARSE: handle_parse,
    OP_BIND: handle_bind,
    OP_DATA_CHUNK: handle_data_chunk,
    OP_ROWS_FINISHED: handle_rows_finished,
    OP_COMMAND_COMPLETE: handle_command_complete,
    OP_ERROR: handle_error,
    OP_BEGIN: handle_begin,
    OP_COMMIT: handle_commit,
    OP_ROLLBACK: handle_rollback,
    OP_COPY_IN: handle_copy_in,
    OP_COPY_DONE: handle_copy_done,
    OP_COPY_FAIL: handle_copy_fail,
    OP_CANCEL_QUERY: handle_cancel_query,
    OP_PING: handle_ping,
    OP_PONG: handle_pong,
    OP_CLOSE: handle_close,
}


def assert_all_mandatory_handlers_registered() -> None:
    """Verify every mandatory opcode has a handler. Raises if not."""
    missing = [op for op in MANDATORY_OPCODES if op not in HANDLERS]
    if missing:
        raise RuntimeError(
            f"missing handlers for mandatory opcodes: {missing} "
            f"(names: {[opcode_name(op) for op in missing]})"
        )


__all__ = [
    "HandlerFn",
    "HANDLERS",
    "assert_all_mandatory_handlers_registered",
]
