"""Tests for the vbp.wire.vbp.conformance_runner — JUnit XML output and basic flow."""
from __future__ import annotations

import os
import socket
import struct
import sys
import tempfile
import threading
import unittest
from typing import Tuple

# Make sure we can import the vedadb package from the repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from vedadb.wire.vbp.conformance_runner import (  # noqa: E402
    ConformanceRunner,
    TestOutcome,
    escape_xml,
    write_junit,
)
from vedadb.wire.vbp.frame import read_frame, write_frame  # noqa: E402


# ---------------------------------------------------------------------------
# In-process VBP server for the conformance runner
# ---------------------------------------------------------------------------


class _ConfVBPServer:
    """Same as the connection test's local server, kept separate to
    keep tests decoupled.
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
                if op == 0x01:
                    sr = struct.pack("<I", 0x000A0000) + struct.pack("<I", 0x0000001F) + bytes([0]) + struct.pack("<I", 16) + b"\x00" * 16
                    write_frame(wf, 0, 0x02, 0, sr)
                    write_frame(wf, 0, 0x05, 0, struct.pack("<QQI", 0xC0FFEE, 0xFFFFFFFFFFFFFFFF, 0))
                    wf.flush()
                elif op == 0x06:
                    text_len = struct.unpack("<I", body[4:8])[0]
                    text = body[8:8 + text_len].decode("utf-8").strip().upper().rstrip(";")
                    if text == "SELECT 1":
                        name = b"x"
                        dc = struct.pack("<I", 1) + struct.pack("<I", 1) + struct.pack("<H", 1) + struct.pack("<I", len(name)) + name + struct.pack("<H", 23) + bytes([0]) + struct.pack("<i", 1)
                        write_frame(wf, seq, 0x0A, 0, dc)
                        tag = b"SELECT 1"
                        rf2 = struct.pack("<Q", 1) + struct.pack("<I", len(tag)) + tag + struct.pack("<I", 0)
                        write_frame(wf, seq, 0x0B, 0, rf2)
                        write_frame(wf, seq, 0x0C, 0, b"\x00")
                    else:
                        err = b"0A000" + struct.pack("<I", 11) + b"unsupported" + struct.pack("<I", 0) + struct.pack("<I", 0) + struct.pack("<I", 0)
                        write_frame(wf, seq, 0x0D, 0, err)
                    wf.flush()
                elif op == 0x18:
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


class TestJUnitXML(unittest.TestCase):
    def test_escape_xml(self):
        self.assertEqual(escape_xml("a&b<c>"), "a&amp;b&lt;c&gt;")
        self.assertEqual(escape_xml('"x"'), "&quot;x&quot;")

    def test_write_junit_empty(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "out.xml")
            write_junit([], path)
            with open(path) as f:
                content = f.read()
            self.assertIn("testsuite", content)
            self.assertIn('tests="0"', content)

    def test_write_junit_with_outcomes(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "out.xml")
            outcomes = [
                TestOutcome(test_id=1001, name="connect", category="connect", status="PASS", message="ok", duration_ms=12.3),
                TestOutcome(test_id=1002, name="bad_magic", category="connect", status="FAIL", message="expected &", duration_ms=5.0),
                TestOutcome(test_id=1003, name="skipped", category="kv", status="SKIP", message="v2", duration_ms=0.0),
                TestOutcome(test_id=1004, name="oops", category="connect", status="ERROR", message="boom", duration_ms=1.0),
            ]
            write_junit(outcomes, path)
            with open(path) as f:
                content = f.read()
            self.assertIn('tests="4"', content)
            self.assertIn('failures="1"', content)
            self.assertIn('errors="1"', content)
            self.assertIn('skipped="1"', content)
            self.assertIn('expected &amp;', content)
            self.assertIn('<failure', content)
            self.assertIn('<error', content)
            self.assertIn('<skipped', content)


class TestConformanceRunner(unittest.TestCase):
    """The conformance runner produces outcomes for each test in the YAML suite.

    Note: we don't ship the YAML in this test (it's in the conformance/
    sibling dir at runtime).  Instead, we verify the runner structure:
    loading the suite, iterating tests, recording outcomes, writing
    JUnit XML.
    """

    def setUp(self):
        # Write a minimal vbp_suite.yaml in a temp dir.
        self.tmpdir = tempfile.mkdtemp()
        self.suite_path = os.path.join(self.tmpdir, "vbp_suite.yaml")
        with open(self.suite_path, "w") as f:
            f.write(
                "version: 2\n"
                "suite: test\n"
                "tests:\n"
                "  - id: 1001\n"
                "    name: connect_plain_tcp\n"
                "    category: connect\n"
                "    description: 'plain TCP connect'\n"
                "    operation:\n"
                "      kind: connect\n"
                "      params: {tls: false, address: '127.0.0.1'}\n"
                "    expect: {ok: true, server_banner_magic: 'VDB'}\n"
                "  - id: 1010\n"
                "    name: hello_basic\n"
                "    category: hello\n"
                "    description: 'basic hello'\n"
                "    operation:\n"
                "      kind: send_frame\n"
                "      opcode: 0x01\n"
                "      body: {}\n"
                "    expect: {ok: true}\n"
                "  - id: 1020\n"
                "    name: auth_no_auth_dev_mode\n"
                "    category: auth\n"
                "    description: 'dev mode auth'\n"
                "    operation:\n"
                "      kind: handshake\n"
                "      params: {mechanism: 'none'}\n"
                "    expect: {ok: true}\n"
                "  - id: 1030\n"
                "    name: query_select_1\n"
                "    category: query\n"
                "    description: 'select 1'\n"
                "    operation:\n"
                "      kind: query\n"
                "      sql: 'SELECT 1'\n"
                "      params: []\n"
                "    expect: {ok: true, rows: [['1']]}\n"
                "  - id: 1100\n"
                "    name: vector\n"
                "    category: vector\n"
                "    description: 'vector type'\n"
                "    operation:\n"
                "      kind: query\n"
                "      sql: 'SELECT [1,2,3]'\n"
                "    expect: {ok: true}\n"
                "  - id: 1190\n"
                "    name: type_registry\n"
                "    category: type_registry\n"
                "    description: 'all 27 v1 type IDs registered'\n"
                "    operation:\n"
                "      kind: query\n"
                "    expect: {ok: true, total_count: 27}\n"
            )
        self.srv = _ConfVBPServer()
        self.runner = ConformanceRunner(
            host="127.0.0.1",
            port=self.srv.port,
            user="admin",
            password="benchpw-cw-2026",
            suite_path=self.suite_path,
        )

    def tearDown(self):
        self.srv.stop()
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_run_filtered(self):
        outcomes = self.runner.run_all(categories=["connect", "hello", "auth", "query", "type_registry"])
        cats = {o.category for o in outcomes}
        # vector should be filtered out.
        self.assertNotIn("vector", cats)
        self.assertIn("connect", cats)
        # All 5 selected tests run.
        self.assertEqual(len(outcomes), 5)
        # They should all PASS against the dev server.
        statuses = [o.status for o in outcomes]
        # The dev server replies with AUTH_OK on HELLO; auth ok=true is
        # implicit.  query=SELECT 1 is handled.  type_registry asserts
        # 27 type IDs and we have 27.
        for o in outcomes:
            if o.status != "PASS":
                self.fail(f"test {o.test_id} ({o.name}) did not pass: {o.status} {o.message}")

    def test_at_least_3_categories_pass(self):
        outcomes = self.runner.run_all(categories=["connect", "hello", "auth", "query_params"])
        pass_cats = {o.category for o in outcomes if o.status == "PASS"}
        # The task spec said "at least 3 categories PASS"; connect, hello,
        # auth, query are all supported in the v1 POC.
        self.assertGreaterEqual(
            len(pass_cats), 3,
            f"expected at least 3 passing categories, got {len(pass_cats)}: {pass_cats}",
        )


if __name__ == "__main__":
    unittest.main()
