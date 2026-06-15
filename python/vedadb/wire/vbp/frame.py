"""
VedaDB Binary Protocol (VBP) — frame I/O.

Wire format (see ``VBP_SPEC.md`` §2)::

    +--------+---------+-----+-----+-----+----------+...+
    | 'VDB'  | len_le4 | seq | op  | flg |  body    |
    +--------+---------+-----+-----+-----+----------+...+
    | 3 B    | 4 B     | 1 B | 1 B | 1 B | (len-2)B |
    +--------+---------+-----+-----+-----+----------+...+

* Magic is the literal ASCII bytes ``V``, ``D``, ``B`` (0x56 0x44 0x42).
* ``len_le4`` is the **payload length** (op + flags + body), encoded
  little-endian as an unsigned 32-bit integer. It must be >= 2.
* ``seq`` is an unsigned byte used for request/response multiplexing.
  Wraps at 256.
* ``op`` is the opcode (one byte, see ``opcodes.py``).
* ``flags`` is reserved for connection-level flags; zero in v1.
* ``body`` length is ``len_le4 - 2``.

This module is **pure stdlib** (no third-party deps) and the only
network I/O helpers in the VBP package.
"""
from __future__ import annotations

import io
import struct
from typing import BinaryIO, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAGIC: bytes = b"VDB"
MAGIC_LEN: int = 3
LEN_LEN: int = 4
SEQ_LEN: int = 1
HDR_LEN: int = MAGIC_LEN + LEN_LEN + SEQ_LEN  # 8 bytes
OP_LEN: int = 1
FLAGS_LEN: int = 1
OPFLAGS_LEN: int = OP_LEN + FLAGS_LEN  # 2 bytes

# Default v1 port (matches the engine's vbp package).
DEFAULT_VBP_PORT: int = 6380

# Maximum single-frame body — matches the Go reference implementation
# (64 MiB).  Frames larger than this are rejected by the wire layer.
MAX_FRAME_LEN: int = 64 * 1024 * 1024


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class VBPProtocolError(Exception):
    """Base class for VBP wire-layer errors."""


class VBPBadMagic(VBPProtocolError):
    """Frame magic bytes are not 'VDB'."""


class VBPFrameTooShort(VBPProtocolError):
    """Frame payload_length is less than 2 (no room for op+flags)."""


class VBPFrameTooLarge(VBPProtocolError):
    """Frame payload_length exceeds MAX_FRAME_LEN."""


class VBPConnectionClosed(VBPProtocolError):
    """The peer closed the connection mid-frame."""


# ---------------------------------------------------------------------------
# Frame struct
# ---------------------------------------------------------------------------


class Frame:
    """A decoded VBP frame.

    Attributes:
        seq: 1-byte sequence id (0-255).
        op:  1-byte opcode.
        flags: 1-byte flags (zero in v1).
        body: variable-length body, possibly empty.
    """

    __slots__ = ("seq", "op", "flags", "body")

    def __init__(self, seq: int, op: int, flags: int, body: bytes):
        if not 0 <= seq <= 0xFF:
            raise ValueError(f"seq out of range: {seq}")
        if not 0 <= op <= 0xFF:
            raise ValueError(f"op out of range: {op}")
        if not 0 <= flags <= 0xFF:
            raise ValueError(f"flags out of range: {flags}")
        self.seq = seq
        self.op = op
        self.flags = flags
        self.body = bytes(body)

    def __repr__(self) -> str:
        return (
            f"Frame(seq={self.seq}, op=0x{self.op:02x}, "
            f"flags=0x{self.flags:02x}, body_len={len(self.body)})"
        )

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Frame):
            return NotImplemented
        return (
            self.seq == other.seq
            and self.op == other.op
            and self.flags == other.flags
            and self.body == other.body
        )


# ---------------------------------------------------------------------------
# Read / write
# ---------------------------------------------------------------------------


def write_frame(stream: BinaryIO, seq: int, op: int, flags: int, body: bytes) -> None:
    """Encode a single frame and write it to ``stream``.

    Args:
        stream: any binary file-like object supporting ``write()``.
        seq: 1-byte sequence id.
        op: 1-byte opcode.
        flags: 1-byte flags.
        body: payload body (may be empty).

    Raises:
        ValueError: if seq/op/flags out of range or body too large.
    """
    if not 0 <= seq <= 0xFF:
        raise ValueError(f"seq out of range: {seq}")
    if not 0 <= op <= 0xFF:
        raise ValueError(f"op out of range: {op}")
    if not 0 <= flags <= 0xFF:
        raise ValueError(f"flags out of range: {flags}")
    payload_len = OPFLAGS_LEN + len(body)
    if payload_len > MAX_FRAME_LEN:
        raise VBPFrameTooLarge(
            f"payload length {payload_len} exceeds MAX_FRAME_LEN {MAX_FRAME_LEN}"
        )
    # 3-byte magic + 4-byte LE length + 1-byte seq + op + flags + body
    stream.write(MAGIC)
    stream.write(struct.pack("<I", payload_len))
    stream.write(bytes([seq & 0xFF]))
    stream.write(bytes([op & 0xFF]))
    stream.write(bytes([flags & 0xFF]))
    if body:
        stream.write(body)


def frame_bytes(seq: int, op: int, flags: int, body: bytes) -> bytes:
    """Encode a single frame and return the bytes (no I/O)."""
    buf = io.BytesIO()
    write_frame(buf, seq, op, flags, body)
    return buf.getvalue()


def read_frame(stream: BinaryIO) -> Frame:
    """Read exactly one frame from ``stream``.

    Raises:
        VBPBadMagic: magic != 'VDB'.
        VBPFrameTooShort: payload_length < 2.
        VBPFrameTooLarge: payload_length > MAX_FRAME_LEN.
        VBPConnectionClosed: stream EOF in middle of a frame.
    """
    hdr = _read_exact(stream, HDR_LEN)
    if hdr is None:
        raise VBPConnectionClosed("peer closed before any frame bytes")
    if hdr[:MAGIC_LEN] != MAGIC:
        raise VBPBadMagic(
            f"bad magic: expected {MAGIC!r}, got {hdr[:MAGIC_LEN]!r}"
        )
    (payload_len,) = struct.unpack("<I", hdr[MAGIC_LEN : MAGIC_LEN + LEN_LEN])
    seq = hdr[MAGIC_LEN + LEN_LEN]
    if payload_len < OPFLAGS_LEN:
        raise VBPFrameTooShort(
            f"payload_length {payload_len} < {OPFLAGS_LEN} (no room for op+flags)"
        )
    if payload_len > MAX_FRAME_LEN:
        raise VBPFrameTooLarge(
            f"payload_length {payload_len} exceeds MAX_FRAME_LEN {MAX_FRAME_LEN}"
        )
    opflags = _read_exact(stream, OPFLAGS_LEN)
    if opflags is None:
        raise VBPConnectionClosed("peer closed mid-frame (after header)")
    op = opflags[0]
    flags = opflags[1]
    body_len = payload_len - OPFLAGS_LEN
    body = _read_exact(stream, body_len) if body_len > 0 else b""
    if body is None:
        raise VBPConnectionClosed("peer closed mid-frame (in body)")
    return Frame(seq=seq, op=op, flags=flags, body=body)


def read_frame_bytes(data: bytes) -> Tuple[Frame, int]:
    """Parse a single frame from a leading prefix of ``data``.

    Returns:
        (Frame, n_bytes_consumed).  n_bytes_consumed includes the entire
        frame (header + payload).

    Raises:
        VBPBadMagic / VBPFrameTooShort / VBPFrameTooLarge on malformed
        data.  ``ValueError("incomplete")`` is raised if ``data`` does
        not contain the entire frame — caller is expected to read more.
    """
    if len(data) < HDR_LEN:
        raise ValueError("incomplete: not enough bytes for header")
    if data[:MAGIC_LEN] != MAGIC:
        raise VBPBadMagic(f"bad magic: {data[:MAGIC_LEN]!r}")
    (payload_len,) = struct.unpack(
        "<I", data[MAGIC_LEN : MAGIC_LEN + LEN_LEN]
    )
    if payload_len < OPFLAGS_LEN:
        raise VBPFrameTooShort(
            f"payload_length {payload_len} < {OPFLAGS_LEN}"
        )
    if payload_len > MAX_FRAME_LEN:
        raise VBPFrameTooLarge(
            f"payload_length {payload_len} exceeds MAX_FRAME_LEN {MAX_FRAME_LEN}"
        )
    total = HDR_LEN + payload_len
    if len(data) < total:
        raise ValueError(
            f"incomplete: have {len(data)} bytes, need {total} for full frame"
        )
    seq = data[MAGIC_LEN + LEN_LEN]
    op = data[HDR_LEN]
    flags = data[HDR_LEN + 1]
    body = bytes(data[HDR_LEN + OPFLAGS_LEN : total])
    return Frame(seq=seq, op=op, flags=flags, body=body), total


def _read_exact(stream: BinaryIO, n: int) -> bytes | None:
    """Read exactly ``n`` bytes, or ``None`` on EOF."""
    if n == 0:
        return b""
    chunks = []
    remaining = n
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


__all__ = [
    "MAGIC",
    "MAGIC_LEN",
    "LEN_LEN",
    "SEQ_LEN",
    "HDR_LEN",
    "OP_LEN",
    "FLAGS_LEN",
    "OPFLAGS_LEN",
    "MAX_FRAME_LEN",
    "DEFAULT_VBP_PORT",
    "Frame",
    "VBPProtocolError",
    "VBPBadMagic",
    "VBPFrameTooShort",
    "VBPFrameTooLarge",
    "VBPConnectionClosed",
    "write_frame",
    "frame_bytes",
    "read_frame",
    "read_frame_bytes",
]
