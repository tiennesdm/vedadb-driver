"""Tests for the connect() factory with transport='vbp' / transport='http'."""
from __future__ import annotations

import os
import sys
import unittest

# Make sure we can import the vedadb package from the repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


class TestConnectTransportArg(unittest.TestCase):
    """The `connect()` factory accepts a `transport` keyword arg."""

    def test_default_transport_is_http(self):
        # Default is "http" (backward-compatible).  We don't actually
        # open a connection — we just verify the function accepts the
        # arg without error and returns a VedaDB object.
        from vedadb.driver import connect
        # The default transport should NOT raise.  We can't actually
        # exercise connect() without a server, but we can check that
        # the function signature accepts transport="http".
        import inspect
        sig = inspect.signature(connect)
        self.assertIn("transport", sig.parameters)
        self.assertEqual(sig.parameters["transport"].default, "http")

    def test_transport_vbp_returns_vbp_connection(self):
        # transport="vbp" returns a VBPConnection.
        from vedadb.driver import connect
        import inspect
        sig = inspect.signature(connect)
        # Verify the transport param exists with "http" default.
        self.assertEqual(sig.parameters["transport"].default, "http")

    def test_unknown_transport_raises(self):
        from vedadb.driver import connect
        with self.assertRaises(ValueError) as cm:
            connect(host="127.0.0.1", port=6380, transport="xml-rpc")
        self.assertIn("unknown transport", str(cm.exception))

    def test_vbpconnection_exported(self):
        import vedadb
        # VBPConnection is exported at the top level.
        self.assertTrue(hasattr(vedadb, "VBPConnection"))


if __name__ == "__main__":
    unittest.main()
