"""Tests for the vbp.wire.handlers module — all 23 mandatory opcodes have stubs."""
from __future__ import annotations

import os
import sys
import unittest

# Make sure we can import the vedadb package from the repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from vedadb.wire.vbp.handlers import (  # noqa: E402
    HANDLERS,
    assert_all_mandatory_handlers_registered,
)
from vedadb.wire.vbp.opcodes import (  # noqa: E402
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
)


class TestAllMandatoryOpcodes(unittest.TestCase):
    def test_23_mandatory_opcodes(self):
        self.assertEqual(len(MANDATORY_OPCODES), 23)

    def test_assert_raises_nothing_when_complete(self):
        # Should not raise.
        assert_all_mandatory_handlers_registered()

    def test_handler_for_every_mandatory_opcode(self):
        for op in MANDATORY_OPCODES:
            self.assertIn(op, HANDLERS, f"opcode 0x{op:02x} has no handler")

    def test_handlers_are_callable(self):
        for op, fn in HANDLERS.items():
            self.assertTrue(callable(fn), f"opcode 0x{op:02x} handler is not callable")


class TestRealHandlers(unittest.TestCase):
    def test_ping_handler_echoes_nonce(self):
        from vedadb.wire.vbp.handlers import handle_ping
        nonce = b"\x01\x02\x03\x04\x05\x06\x07\x08"
        replies = handle_ping(None, nonce)
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0].op, OP_PONG)
        self.assertEqual(replies[0].body, nonce)

    def test_query_handler_select_1(self):
        from vedadb.wire.vbp.handlers import handle_query
        sql = b"SELECT 1"
        body = (
            # u32 query_id
            b"\x00\x00\x00\x00"
            # u32 text_len + text
            + (len(sql)).to_bytes(4, "little") + sql
            # u16 param_count
            + b"\x00\x00"
        )
        replies = handle_query(None, body)
        ops = [r.op for r in replies]
        self.assertIn(OP_DATA_CHUNK, ops)
        self.assertIn(OP_ROWS_FINISHED, ops)
        self.assertIn(OP_COMMAND_COMPLETE, ops)

    def test_client_hello_handler(self):
        from vedadb.wire.vbp.handlers import handle_client_hello
        import struct
        # u16 proto=1, u16 flags=0, u32 un_len=4, "user", u32 db_len=0, u8 ak=0, u32 aid_len=0
        body = struct.pack("<HHI4sI", 1, 0, 4, b"user", 0) + b"\x00" + struct.pack("<I", 0)
        replies = handle_client_hello(None, body)
        ops = [r.op for r in replies]
        self.assertIn(OP_SERVER_READY, ops)
        self.assertIn(OP_AUTH_OK, ops)

    def test_client_hello_wrong_proto_returns_error(self):
        from vedadb.wire.vbp.handlers import handle_client_hello
        import struct
        body = struct.pack("<HHI4sI", 99, 0, 4, b"user", 0) + b"\x00" + struct.pack("<I", 0)
        replies = handle_client_hello(None, body)
        self.assertEqual(replies[0].op, OP_ERROR)


if __name__ == "__main__":
    unittest.main()
