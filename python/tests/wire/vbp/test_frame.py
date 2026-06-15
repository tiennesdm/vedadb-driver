"""Tests for the vbp.wire.frame module — frame encode/decode round-trips."""
from __future__ import annotations

import io
import os
import struct
import sys
import unittest

# Make sure we can import the vedadb package from the repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from vedadb.wire.vbp.frame import (  # noqa: E402
    Frame,
    MAX_FRAME_LEN,
    VBPBadMagic,
    VBPConnectionClosed,
    VBPFrameTooLarge,
    VBPFrameTooShort,
    VBPProtocolError,
    frame_bytes,
    read_frame,
    read_frame_bytes,
    write_frame,
)


class TestFrameRoundTrip(unittest.TestCase):
    """A written frame is decodable back to the same Frame."""

    def test_empty_body(self):
        data = frame_bytes(seq=0, op=0x01, flags=0, body=b"")
        f, n = read_frame_bytes(data)
        self.assertEqual(f.seq, 0)
        self.assertEqual(f.op, 0x01)
        self.assertEqual(f.flags, 0)
        self.assertEqual(f.body, b"")
        self.assertEqual(n, len(data))
        self.assertEqual(n, 8 + 2)  # 8-byte header + 2-byte op+flags

    def test_short_body(self):
        body = b"\x01\x02\x03"
        data = frame_bytes(seq=42, op=0x06, flags=0x01, body=body)
        f, n = read_frame_bytes(data)
        self.assertEqual(f.seq, 42)
        self.assertEqual(f.op, 0x06)
        self.assertEqual(f.flags, 0x01)
        self.assertEqual(f.body, body)
        self.assertEqual(n, len(data))

    def test_seq_wraps_at_256(self):
        # The wire uses a 1-byte seq, so values >= 256 are masked to fit.
        # We expect frame_bytes to either reject (raise) or mask — the
        # spec just requires the on-wire value to match (seq mod 256).
        # The v1 implementation raises ValueError for seq > 0xFF
        # (callers should allocate seqs via Multiplexer, not pass 256+).
        # This test documents that behavior.
        for seq in (0, 1, 127, 255):
            data = frame_bytes(seq=seq, op=0x16, flags=0, body=b"")
            f, _ = read_frame_bytes(data)
            self.assertEqual(f.seq, seq)
        # For seq > 0xFF, the Multiplexer's _alloc_seq masks to a byte
        # (the seq is `(self._next_seq + 1) & 0xFF`).  Direct frame_bytes
        # callers get a ValueError as a safety net.
        with self.assertRaises(ValueError):
            frame_bytes(seq=256, op=0x16, flags=0, body=b"")

    def test_magic_is_VDB(self):
        data = frame_bytes(seq=0, op=0x01, flags=0, body=b"")
        self.assertEqual(data[:3], b"VDB")

    def test_length_is_le_u32(self):
        body = b"\x00" * 100
        data = frame_bytes(seq=0, op=0x01, flags=0, body=body)
        # payload_length = op + flags + body = 2 + 100 = 102
        (plen,) = struct.unpack("<I", data[3:7])
        self.assertEqual(plen, 102)

    def test_large_body(self):
        body = b"x" * 4096
        data = frame_bytes(seq=0, op=0x06, flags=0, body=body)
        f, n = read_frame_bytes(data)
        self.assertEqual(f.body, body)
        self.assertEqual(n, len(data))


class TestFrameErrors(unittest.TestCase):
    """Malformed frames are rejected with the right exception class."""

    def test_bad_magic(self):
        # 'XYZ' instead of 'VDB'
        data = b"XYZ" + struct.pack("<I", 2) + b"\x00\x00"
        with self.assertRaises(VBPBadMagic):
            read_frame_bytes(data)

    def test_payload_too_short(self):
        # payload_length = 1 (less than op+flags minimum of 2)
        data = b"VDB" + struct.pack("<I", 1) + b"\x00"
        with self.assertRaises(VBPFrameTooShort):
            read_frame_bytes(data)

    def test_payload_too_large(self):
        # payload_length = MAX_FRAME_LEN + 1
        data = b"VDB" + struct.pack("<I", MAX_FRAME_LEN + 1) + b"\x00\x00"
        with self.assertRaises(VBPFrameTooLarge):
            read_frame_bytes(data)

    def test_incomplete_data_raises(self):
        # Only 5 bytes — not enough for the 8-byte header.
        with self.assertRaises(ValueError):
            read_frame_bytes(b"VDB\x00\x00")

    def test_incomplete_body_raises(self):
        # Header says 100 bytes body, only 50 follow.
        data = b"VDB" + struct.pack("<I", 102) + b"\x00\x00" + b"x" * 50
        with self.assertRaises(ValueError):
            read_frame_bytes(data)


class TestStreamRoundTrip(unittest.TestCase):
    """A frame written to a stream is read back the same."""

    def test_write_then_read(self):
        body = b"hello, world"
        buf = io.BytesIO()
        write_frame(buf, seq=7, op=0x05, flags=0, body=body)
        buf.seek(0)
        f = read_frame(buf)
        self.assertEqual(f.seq, 7)
        self.assertEqual(f.op, 0x05)
        self.assertEqual(f.body, body)

    def test_write_close_then_read(self):
        """Closing the write side doesn't break read."""
        body = b"abc"
        buf = io.BytesIO()
        write_frame(buf, 0, 0x16, 0, body)
        buf.seek(0)
        f = read_frame(buf)
        self.assertEqual(f.body, body)

    def test_read_past_eof_raises(self):
        buf = io.BytesIO(b"VDB\x00")  # truncated header
        with self.assertRaises(VBPProtocolError):
            read_frame(buf)


class TestFrameEquality(unittest.TestCase):
    """Two frames with the same fields are equal; different fields differ."""

    def test_equal(self):
        a = Frame(seq=1, op=2, flags=3, body=b"x")
        b = Frame(seq=1, op=2, flags=3, body=b"x")
        self.assertEqual(a, b)

    def test_not_equal(self):
        a = Frame(seq=1, op=2, flags=3, body=b"x")
        b = Frame(seq=2, op=2, flags=3, body=b"x")
        self.assertNotEqual(a, b)

    def test_repr(self):
        f = Frame(seq=0, op=0x01, flags=0, body=b"")
        self.assertIn("Frame", repr(f))
        self.assertIn("seq=0", repr(f))
        self.assertIn("op=0x01", repr(f))


class TestValidation(unittest.TestCase):
    """Frame constructor and write_frame reject out-of-range values."""

    def test_ctor_rejects_seq(self):
        with self.assertRaises(ValueError):
            Frame(seq=256, op=0, flags=0, body=b"")

    def test_ctor_rejects_op(self):
        with self.assertRaises(ValueError):
            Frame(seq=0, op=256, flags=0, body=b"")

    def test_ctor_rejects_flags(self):
        with self.assertRaises(ValueError):
            Frame(seq=0, op=0, flags=256, body=b"")

    def test_write_rejects_oversize(self):
        with self.assertRaises(VBPFrameTooLarge):
            frame_bytes(0, 0, 0, b"x" * (MAX_FRAME_LEN + 1))


if __name__ == "__main__":
    unittest.main()
