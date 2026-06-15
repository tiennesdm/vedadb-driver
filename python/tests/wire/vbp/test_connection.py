"""Tests for the vbp.wire.vbp module — VBPConnection end-to-end against an in-process server."""
from __future__ import annotations

import os
import socket
import struct
import sys
import threading
import time
import unittest
from typing import Tuple

# Make sure we can import the vedadb package from the repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from vedadb.wire.vbp import (  # noqa: E402
    VBPConnection,
    VBPError,
    VBPResult,
)
from vedadb.wire.vbp.frame import read_frame, write_frame  # noqa: E402


# ---------------------------------------------------------------------------
# Local in-process VBP server (smaller than the dev server, runs in-test)
# ---------------------------------------------------------------------------


class _LocalVBPServer:
    """A minimal VBP server that handles CLIENT_HELLO + AUTH_OK + QUERY(SELECT 1) only.

    Used by these tests so we don't depend on the Go dev server being
    available.
    """

    def __init__(self):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(64)
        self.port: int = self._sock.getsockname()[1]
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._acceptor = threading.Thread(target=self._accept, daemon=True)
        self._acceptor.start()

    @property
    def addr(self) -> Tuple[str, int]:
        return ("127.0.0.1", self.port)

    def _accept(self):
        self._sock.settimeout(0.1)
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            t = threading.Thread(target=self._serve, args=(conn,), daemon=True)
            t.start()
            self._threads.append(t)

    def _serve(self, conn: socket.socket) -> None:
        try:
            conn.settimeout(5.0)
            rf = conn.makefile("rb")
            wf = conn.makefile("wb")
            while True:
                try:
                    f = read_frame(rf); seq, op, _, body = f.seq, f.op, f.flags, f.body
                except Exception:
                    return
                if op == 0x01:  # CLIENT_HELLO
                    sr = struct.pack("<I", 0x000A0000) + struct.pack("<I", 0x0000001F) + bytes([0]) + struct.pack("<I", 16) + b"\x00" * 16
                    write_frame(wf, 0, 0x02, 0, sr)
                    write_frame(wf, 0, 0x05, 0, struct.pack("<QQI", 0xC0FFEE, 0xFFFFFFFFFFFFFFFF, 0))
                    wf.flush()
                elif op == 0x06:  # QUERY
                    # parse: u32 query_id, u32 text_len, str text, u16 param_count
                    text_len = struct.unpack("<I", body[4:8])[0]
                    text = body[8:8 + text_len].decode("utf-8").strip().upper().rstrip(";")
                    if text == "SELECT 1":
                        # 1 row, 1 col, T_INT4 = 1
                        # DATA_CHUNK body: u32 chunk_id, u32 row_count, u16 col_count,
                        #   for each col: u32 name_len + name + u16 type_id,
                        #   u8 null_bitmap_byte_count, [no bitmap],
                        #   1 row of T_INT4: 4 bytes LE
                        name = b"x"
                        dc = struct.pack("<I", 1) + struct.pack("<I", 1) + struct.pack("<H", 1) + struct.pack("<I", len(name)) + name + struct.pack("<H", 23) + bytes([0]) + struct.pack("<i", 1)
                        write_frame(wf, seq, 0x0A, 0, dc)
                        tag = b"SELECT 1"
                        rf2 = struct.pack("<Q", 1) + struct.pack("<I", len(tag)) + tag + struct.pack("<I", 0)
                        write_frame(wf, seq, 0x0B, 0, rf2)
                        write_frame(wf, seq, 0x0C, 0, b"\x00")
                        wf.flush()
                    else:
                        # Generic 0A000.  Body format: 5-byte sqlstate +
                        # u32 msg_len + msg + u32 detail_len + detail +
                        # u32 hint_len + hint + u32 position.
                        err = b"0A000" + struct.pack("<I", 11) + b"unsupported" + struct.pack("<I", 0) + struct.pack("<I", 0) + struct.pack("<I", 0) + struct.pack("<I", 0)
                        write_frame(wf, seq, 0x0D, 0, err)
                        wf.flush()
                elif op == 0x16:  # PING
                    write_frame(wf, seq, 0x17, 0, body[:8])
                    wf.flush()
                elif op == 0x18:  # CLOSE
                    return
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def stop(self) -> None:
        self._stop.set()
        try:
            self._sock.close()
        except OSError:
            pass
        for t in self._threads:
            t.join(timeout=2.0)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestVBPConnection(unittest.TestCase):
    def setUp(self):
        self.srv = _LocalVBPServer()
        self.conn = VBPConnection(
            host="127.0.0.1",
            port=self.srv.port,
            user="admin",
            password="benchpw-cw-2026",
        )
        self.conn.connect()

    def tearDown(self):
        self.conn.close()
        self.srv.stop()

    def test_select_1(self):
        result = self.conn.execute("SELECT 1")
        self.assertIsInstance(result, VBPResult)
        self.assertEqual(len(result.rows), 1)
        self.assertEqual(result.rows[0][0], 1)
        self.assertEqual(result.command_tag, "SELECT 1")

    def test_ping(self):
        nonce = self.conn.ping()
        self.assertIsInstance(nonce, int)

    def test_unsupported_query_raises(self):
        with self.assertRaises(VBPError) as cm:
            self.conn.execute("DROP TABLE foo")
        self.assertEqual(cm.exception.sqlstate, "0A000")

    def test_context_manager(self):
        with VBPConnection(
            host="127.0.0.1",
            port=self.srv.port,
            user="admin",
            password="x",
        ) as conn2:
            result = conn2.execute("SELECT 1")
            self.assertEqual(len(result.rows), 1)


class TestVBPConnectionParams(unittest.TestCase):
    def setUp(self):
        self.srv = _LocalVBPServer()

    def tearDown(self):
        self.srv.stop()

    def test_param_int(self):
        with VBPConnection(host="127.0.0.1", port=self.srv.port, user="u", password="p") as conn:
            result = conn.execute("SELECT 1", params=[1])
            self.assertEqual(len(result.rows), 1)

    def test_param_text(self):
        with VBPConnection(host="127.0.0.1", port=self.srv.port, user="u", password="p") as conn:
            # Use a query the dev server understands.
            result = conn.execute("SELECT 1", params=["hello"])
            self.assertEqual(len(result.rows), 1)


if __name__ == "__main__":
    unittest.main()
