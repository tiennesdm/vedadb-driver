"""Tests for the vbp.wire.multiplexer module — sequence-id routing & pipelining."""
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

from vedadb.wire.vbp.frame import (  # noqa: E402
    MAGIC,
    read_frame,
    write_frame,
)
from vedadb.wire.vbp.multiplexer import Multiplexer, VBPError  # noqa: E402


# ---------------------------------------------------------------------------
# Test helpers: a small in-process VBP echo server
# ---------------------------------------------------------------------------


class _FakeVBPServer:
    """A trivial VBP server that responds to QUERY with a 1-row DATA_CHUNK.

    Binds to 127.0.0.1:0 (OS picks the port) and serves connections in
    background threads until ``stop()`` is called.
    """

    def __init__(self):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(64)
        self.port: int = self._sock.getsockname()[1]
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self.requests: list[Tuple[int, int, int, bytes]] = []
        self._lock = threading.Lock()
        # Spawn the accept loop.
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
            # Handshake: reply to CLIENT_HELLO with SERVER_READY + AUTH_OK.
            f = read_frame(rf); seq, op, _, body = f.seq, f.op, f.flags, f.body
            with self._lock:
                self.requests.append((seq, op, 0, body))
            # SERVER_READY body
            sr = struct.pack("<I", 0x000A0000) + struct.pack("<I", 0x0000001F) + bytes([0]) + struct.pack("<I", 16) + b"\x00" * 16
            write_frame(wf, 0, 0x02, 0, sr)
            # AUTH_OK
            write_frame(wf, 0, 0x05, 0, struct.pack("<QQI", 0xC0FFEE, 0xFFFFFFFFFFFFFFFF, 0))
            wf.flush()
            # Now echo QUERY frames with a 1-row DATA_CHUNK + ROWS_FINISHED.
            # (Post-v2 fix: ROWS_FINISHED is terminal, so the multiplexer
            # returns on it; we no longer emit COMMAND_COMPLETE because
            # the slot is removed when ROWS_FINISHED fires the event.)
            while True:
                try:
                    f = read_frame(rf); seq, op, _, body = f.seq, f.op, f.flags, f.body
                except Exception:
                    break
                with self._lock:
                    self.requests.append((seq, op, 0, body))
                if op == 0x06:  # QUERY
                    # DATA_CHUNK: 1 row, 1 col, T_INT4 = 1
                    # Include a column name so the decoder can pick it up.
                    name = b"x"
                    dc = struct.pack("<I", 1) + struct.pack("<I", 1) + struct.pack("<H", 1) + struct.pack("<I", len(name)) + name + struct.pack("<H", 23) + bytes([0]) + struct.pack("<i", 1)
                    write_frame(wf, seq, 0x0A, 0, dc)
                    # ROWS_FINISHED — terminal; mux.call() returns here.
                    tag = b"SELECT 1"
                    rf2 = struct.pack("<Q", 1) + struct.pack("<I", len(tag)) + tag + struct.pack("<I", 0)
                    write_frame(wf, seq, 0x0B, 0, rf2)
                    wf.flush()
                elif op == 0x18:  # CLOSE
                    break
                else:
                    # Generic ERROR for anything else.
                    err = b"0A000" + struct.pack("<I", 8) + b"not impl" + struct.pack("<I", 0) + struct.pack("<I", 0) + struct.pack("<I", 0) + struct.pack("<I", 0)
                    write_frame(wf, seq, 0x0D, 0, err)
                    wf.flush()
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
        if self._acceptor.is_alive():
            self._acceptor.join(timeout=2.0)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMultiplexerBasic(unittest.TestCase):
    """A multiplexer can do a request/response round-trip."""

    def setUp(self):
        self.srv = _FakeVBPServer()
        self.sock = socket.create_connection(self.srv.addr, timeout=5.0)
        self.mux = Multiplexer(self.sock)
        self.mux.start()

    def tearDown(self):
        self.mux.close()
        self.srv.stop()

    def test_query_round_trip(self):
        # Send a CLIENT_HELLO and consume SERVER_READY + AUTH_OK.
        hello = struct.pack("<H", 1) + struct.pack("<H", 0) + struct.pack("<I", 4) + b"user" + struct.pack("<I", 0) + bytes([0]) + struct.pack("<I", 0)
        replies = self.mux.call(0x01, hello, timeout=5.0)
        self.assertEqual(len(replies), 2)
        self.assertEqual(replies[0].op, 0x02)  # SERVER_READY
        self.assertEqual(replies[1].op, 0x05)  # AUTH_OK

        # Send a QUERY.
        sql = b"SELECT 1"
        body = struct.pack("<I", 0) + struct.pack("<I", len(sql)) + sql + struct.pack("<H", 0)
        replies = self.mux.call(0x06, body, timeout=5.0)
        # Expect DATA_CHUNK + ROWS_FINISHED.  (Post-v2 fix: ROWS_FINISHED
        # is terminal — the multiplexer returns on it.  The fake server
        # no longer emits COMMAND_COMPLETE because the slot would be
        # removed before it arrived.)
        ops = [r.op for r in replies]
        self.assertIn(0x0A, ops)
        self.assertIn(0x0B, ops)


class TestMultiplexerPipelining(unittest.TestCase):
    """Concurrent requests use different sequence ids and don't leak data."""

    def setUp(self):
        self.srv = _FakeVBPServer()
        self.results: list = [None] * 16
        self.errors: list = [None] * 16

    def tearDown(self):
        self.srv.stop()

    def _send_one(self, idx: int, n_queries: int):
        sock = socket.create_connection(self.srv.addr, timeout=10.0)
        try:
            mux = Multiplexer(sock)
            mux.start()
            # Handshake.
            hello = struct.pack("<H", 1) + struct.pack("<H", 0) + struct.pack("<I", 0) + struct.pack("<I", 0) + bytes([0]) + struct.pack("<I", 0)
            mux.call(0x01, hello, timeout=5.0)
            # Fire n_queries queries serially through this mux (not concurrent
            # within one mux — but each thread has its own mux, so the
            # multiplexer on the server side sees concurrent requests from
            # different conns).  This is "pipelining" in the wire sense.
            sql = b"SELECT 1"
            body = struct.pack("<I", 0) + struct.pack("<I", len(sql)) + sql + struct.pack("<H", 0)
            for i in range(n_queries):
                replies = mux.call(0x06, body, timeout=5.0)
                self.results[idx] = len(replies)
        except Exception as e:
            self.errors[idx] = e
        finally:
            mux.close()
            sock.close()

    def test_16_concurrent_clients(self):
        threads = []
        for i in range(16):
            t = threading.Thread(target=self._send_one, args=(i, 3), daemon=True)
            threads.append(t)
            t.start()
        for t in threads:
            t.join(timeout=15.0)
            self.assertFalse(t.is_alive(), "client thread hung")
        for i, r in enumerate(self.results):
            self.assertIsNone(self.errors[i], f"client {i} errored: {self.errors[i]}")
            # Post-v2 fix: query response is DATA_CHUNK + ROWS_FINISHED (2 frames).
            self.assertEqual(r, 2, f"client {i} expected 2 replies, got {r}")


class TestMultiplexerErrorFrame(unittest.TestCase):
    """An ERROR frame from the server surfaces as VBPError."""

    def setUp(self):
        self.srv = _FakeVBPServer()
        self.sock = socket.create_connection(self.srv.addr, timeout=5.0)
        self.mux = Multiplexer(self.sock)
        self.mux.start()

    def tearDown(self):
        self.mux.close()
        self.srv.stop()

    def test_error_frame(self):
        # Send HELLO first to put the server in the QUERY/CLOSE state.
        body = b"\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        replies = self.mux.call(0x01, body, timeout=5.0)
        self.assertEqual(len(replies), 2)  # SERVER_READY + AUTH_OK
        # Now send a non-QUERY frame (OP_COPY_IN = 0x11); the server replies with ERROR.
        body = b""
        with self.assertRaises(VBPError) as cm:
            self.mux.call(0x11, body, timeout=5.0)
        self.assertEqual(cm.exception.sqlstate, "0A000")
        self.assertIn("not impl", cm.exception.message)


# ---------------------------------------------------------------------------
# Streaming fix tests (v2)
# ---------------------------------------------------------------------------


def _data_chunk_body(value: int) -> bytes:
    """Build a 1-row 1-col T_INT4 DATA_CHUNK body carrying ``value``."""
    name = b"x"
    return (
        struct.pack("<I", 1)         # chunk_id
        + struct.pack("<I", 1)       # row_count
        + struct.pack("<H", 1)       # col_count
        + struct.pack("<I", len(name)) + name
        + struct.pack("<H", 23)      # T_INT4
        + bytes([0])                  # null_bitmap_byte_count
        + struct.pack("<i", value)
    )


def _rows_finished_body(rows: int, tag: bytes = b"SELECT") -> bytes:
    return (
        struct.pack("<Q", rows)
        + struct.pack("<I", len(tag))
        + tag
        + struct.pack("<I", 0)
    )


class _MultichunkFakeServer:
    """A fake VBP server that emits N DATA_CHUNKs + 1 ROWS_FINISHED per QUERY.

    The multiplexer must accumulate all N chunks before the terminal
    ROWS_FINISHED delivers them as one response list.
    """

    def __init__(self, n_chunks: int):
        self._n_chunks = n_chunks
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
            # Handshake.
            read_frame(rf)
            sr = (
                struct.pack("<I", 0x000A0000)
                + struct.pack("<I", 0x0000001F)
                + bytes([0])
                + struct.pack("<I", 16)
                + b"\x00" * 16
            )
            write_frame(wf, 0, 0x02, 0, sr)
            write_frame(wf, 0, 0x05, 0, struct.pack("<QQI", 0xC0FFEE, 0xFFFFFFFFFFFFFFFF, 0))
            wf.flush()
            while True:
                try:
                    f = read_frame(rf)
                except Exception:
                    break
                if f.op == 0x06:  # QUERY
                    for i in range(self._n_chunks):
                        write_frame(wf, f.seq, 0x0A, 0, _data_chunk_body(i))
                    write_frame(wf, f.seq, 0x0B, 0, _rows_finished_body(self._n_chunks))
                    wf.flush()
                elif f.op == 0x18:  # CLOSE
                    break
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
        if self._acceptor.is_alive():
            self._acceptor.join(timeout=2.0)


class TestMultiplexerStreamingFix(unittest.TestCase):
    """The v2 streaming fix: DATA_CHUNK is non-terminal.

    A query response shape is typically
        [DATA_CHUNK, DATA_CHUNK, ..., ROWS_FINISHED]
    (and optionally COMMAND_COMPLETE).  The multiplexer must NOT
    treat DATA_CHUNK as terminal — that would drop every chunk
    after the first.  Instead it ACCUMULATES chunks and delivers
    them all on the first ROWS_FINISHED / COMMAND_COMPLETE / ERROR.
    """

    def setUp(self):
        self.srv = _MultichunkFakeServer(n_chunks=5)
        self.sock = socket.create_connection(self.srv.addr, timeout=5.0)
        self.mux = Multiplexer(self.sock)
        self.mux.start()

    def tearDown(self):
        self.mux.close()
        self.srv.stop()

    def test_five_data_chunks_plus_rows_finished(self):
        # Handshake.
        hello = (
            struct.pack("<H", 1)
            + struct.pack("<H", 0)
            + struct.pack("<I", 0)
            + struct.pack("<I", 0)
            + bytes([0])
            + struct.pack("<I", 0)
        )
        replies = self.mux.call(0x01, hello, timeout=5.0)
        self.assertEqual(len(replies), 2)
        self.assertEqual(replies[0].op, 0x02)  # SERVER_READY
        self.assertEqual(replies[1].op, 0x05)  # AUTH_OK

        # Send a QUERY; expect 5 DATA_CHUNKs + 1 ROWS_FINISHED = 6 frames.
        sql = b"SELECT * FROM generate_series(1, 5)"
        body = (
            struct.pack("<I", 0)
            + struct.pack("<I", len(sql))
            + sql
            + struct.pack("<H", 0)
        )
        replies = self.mux.call(0x06, body, timeout=5.0)
        ops = [r.op for r in replies]
        # 5 chunks + 1 finished = 6 frames
        self.assertEqual(len(replies), 6, f"expected 6 frames, got {len(replies)} ({ops})")
        # First 5 must be DATA_CHUNK, last must be ROWS_FINISHED.
        self.assertEqual(ops[:5], [0x0A] * 5)
        self.assertEqual(ops[5], 0x0B)
        # And the values are in order 0, 1, 2, 3, 4.
        for i, f in enumerate(replies[:5]):
            # DATA_CHUNK body layout: u32 chunk_id + u32 row_count + u16
            # col_count + per-col (u32 name_len + name + u16 type) +
            # u8 null_bitmap_byte_count + value.  For 1 col of T_INT4
            # named "x", the value is at offset 18.
            value = struct.unpack("<i", f.body[18:22])[0]
            self.assertEqual(value, i, f"chunk {i} should carry value {i}, got {value}")


class TestMultiplexerRowsFinishedAlone(unittest.TestCase):
    """ROWS_FINISHED with no preceding DATA_CHUNKs still terminates call().

    Edge case: an empty result set may emit DATA_CHUNK(row_count=0)
    or just ROWS_FINISHED directly.  Either way, the mux must
    deliver the terminal frame without hanging.
    """

    def setUp(self):
        # Reuse the multichunk fake server but with n_chunks=0 to send
        # a bare ROWS_FINISHED.  We use a small ad-hoc server here.
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(1)
        self.port: int = self._sock.getsockname()[1]
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._serve, daemon=True)
        self._t.start()
        time.sleep(0.05)
        self.sock = socket.create_connection(("127.0.0.1", self.port), timeout=5.0)
        self.mux = Multiplexer(self.sock)
        self.mux.start()

    def _serve(self):
        self._sock.settimeout(0.1)
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            t = threading.Thread(target=self._serve_conn, args=(conn,), daemon=True)
            t.start()
            break  # one connection only

    def _serve_conn(self, conn: socket.socket) -> None:
        try:
            conn.settimeout(5.0)
            rf = conn.makefile("rb")
            wf = conn.makefile("wb")
            read_frame(rf)  # HELLO
            sr = struct.pack("<I", 0x000A0000) + struct.pack("<I", 0x0000001F) + bytes([0]) + struct.pack("<I", 16) + b"\x00" * 16
            write_frame(wf, 0, 0x02, 0, sr)
            write_frame(wf, 0, 0x05, 0, struct.pack("<QQI", 0xC0FFEE, 0xFFFFFFFFFFFFFFFF, 0))
            wf.flush()
            while True:
                try:
                    f = read_frame(rf)
                except Exception:
                    break
                if f.op == 0x06:
                    # Send just ROWS_FINISHED — no DATA_CHUNK.
                    write_frame(wf, f.seq, 0x0B, 0, _rows_finished_body(0))
                    wf.flush()
                elif f.op == 0x18:
                    break
        finally:
            try:
                conn.close()
            except OSError:
                pass

    def tearDown(self):
        self.mux.close()
        self._stop.set()
        try:
            self._sock.close()
        except OSError:
            pass

    def test_rows_finished_alone_is_terminal(self):
        # Handshake.
        hello = (
            struct.pack("<H", 1)
            + struct.pack("<H", 0)
            + struct.pack("<I", 0)
            + struct.pack("<I", 0)
            + bytes([0])
            + struct.pack("<I", 0)
        )
        replies = self.mux.call(0x01, hello, timeout=5.0)
        self.assertEqual(len(replies), 2)

        # Query — server sends just ROWS_FINISHED.
        sql = b"SELECT 1 WHERE FALSE"
        body = (
            struct.pack("<I", 0)
            + struct.pack("<I", len(sql))
            + sql
            + struct.pack("<H", 0)
        )
        replies = self.mux.call(0x06, body, timeout=5.0)
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0].op, 0x0B)  # ROWS_FINISHED


class TestMultiplexerTerminalOpcodes(unittest.TestCase):
    """Sanity check the _TERMINAL_OPCODES class constant.

    DATA_CHUNK and STREAM_CHUNK are non-terminal — they accumulate.
    ROWS_FINISHED, COMMAND_COMPLETE, ERROR, AUTH_OK, AUTH_CHALLENGE,
    PONG, STREAM_END, CLOSE are terminal.
    SERVER_READY is NOT terminal here because the handshake continues.
    """

    def test_data_chunk_not_terminal(self):
        from vedadb.wire.vbp import opcodes as Ops
        self.assertNotIn(Ops.OP_DATA_CHUNK, Multiplexer._TERMINAL_OPCODES)

    def test_stream_chunk_not_terminal(self):
        from vedadb.wire.vbp import opcodes as Ops
        self.assertNotIn(Ops.OP_STREAM_CHUNK, Multiplexer._TERMINAL_OPCODES)

    def test_terminal_opcodes_are_terminal(self):
        from vedadb.wire.vbp import opcodes as Ops
        terminal = {
            Ops.OP_ROWS_FINISHED,
            Ops.OP_COMMAND_COMPLETE,
            Ops.OP_ERROR,
            Ops.OP_AUTH_OK,
            Ops.OP_AUTH_CHALLENGE,
            Ops.OP_PONG,
            Ops.OP_STREAM_END,
            Ops.OP_CLOSE,
        }
        self.assertTrue(terminal.issubset(Multiplexer._TERMINAL_OPCODES))

    def test_server_ready_not_terminal(self):
        from vedadb.wire.vbp import opcodes as Ops
        # SERVER_READY is followed by AUTH_OK / AUTH_CHALLENGE.
        self.assertNotIn(Ops.OP_SERVER_READY, Multiplexer._TERMINAL_OPCODES)


if __name__ == "__main__":
    unittest.main()
