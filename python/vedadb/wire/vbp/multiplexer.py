"""
VBP multiplexed connection — a single TCP connection carrying many
concurrent in-flight requests keyed by 1-byte sequence id.

Wire constraints (VBP_SPEC.md §2):
  * Sequence id is 1 byte, wraps at 256.
  * Responses arrive in the same connection, addressed by their seq.
  * The driver MUST NOT issue a new request with a given seq while a
    previous request with that seq is still in flight.

The Multiplexer exposes a synchronous request/response API:
  * ``call(op, body)`` — send a request, wait for the matching reply.
  * ``call_many(items)`` — fire all, gather all.

And a streaming async API:
  * ``stream(op, body)`` — iterate over DATA_CHUNK / STREAM_CHUNK /
    ROWS_FINISHED messages until the stream is closed.

Internally, a single background thread reads frames from the socket
and dispatches them to per-seq ``Future``-like waiters. A ``condition``
variable wakes waiters when their reply arrives.

The class is **thread-safe** for concurrent ``call()`` from many
threads.
"""
from __future__ import annotations

import io
import logging
import queue
import socket
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator, Optional

from .frame import (
    Frame,
    MAGIC,
    MAX_FRAME_LEN,
    VBPConnectionClosed,
    VBPProtocolError,
    read_frame,
    write_frame,
)

logger = logging.getLogger("vedadb.wire.vbp.multiplexer")


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class VBPError(Exception):
    """High-level VBP error (decoded from the ERROR frame body)."""

    def __init__(self, sqlstate: str, message: str, detail: str = "", hint: str = ""):
        self.sqlstate = sqlstate
        self.message = message
        self.detail = detail
        self.hint = hint
        super().__init__(f"[{sqlstate}] {message}")


# ---------------------------------------------------------------------------
# Multiplexer
# ---------------------------------------------------------------------------


class Multiplexer:
    """Thread-safe VBP request multiplexer over a single TCP connection.

    Args:
        sock: connected TCP socket.
        on_close: optional callback invoked when the connection is
            closed (read loop exits).
    """

    # Time to wait between seq-id allocation retries when seqs are
    # exhausted (all 256 in flight). v1 clients should normally never
    # hit this; if they do, we sleep briefly and retry.
    _SEQ_ALLOC_POLL = 0.001

    def __init__(self, sock: socket.socket, on_close: Optional[Callable[[], None]] = None):
        self._sock = sock
        # Make the socket non-blocking on read so the background reader
        # can be cleanly interrupted via self._closing.
        self._closing = threading.Event()
        self._reader_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()  # protects _inflight and _next_seq
        # Per-seq reply queue.  Each entry is a list of Frames (most ops
        # have a single response, but DATA_CHUNK streams have many).
        self._inflight: dict[int, list[Frame]] = {}
        # Per-seq completion event (set when the response stream is done).
        self._events: dict[int, threading.Event] = {}
        # Per-seq error (if the response stream ends in an ERROR frame).
        self._errors: dict[int, Optional[Frame]] = {}
        self._next_seq = 0
        self._on_close = on_close
        # Optional stream-callback registry: seq -> callable(Frame).
        # If set, the reader invokes the callback instead of queueing
        # the frame. Used by stream() for low-latency chunk delivery.
        self._stream_cb: dict[int, Callable[[Frame], None]] = {}
        # Track read-loop liveness for tests/diagnostics.
        self._reader_alive = threading.Event()
        self._reader_alive.set()
        # Persistent writer — a buffered file opened on the socket.
        # Shared by all senders; the writer lock is the same as
        # self._lock so the framing of concurrent sends is atomic.
        self._writer = self._sock.makefile("wb")
        self._writer_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Start the background reader thread."""
        if self._reader_thread is not None:
            return
        self._reader_thread = threading.Thread(
            target=self._read_loop,
            name=f"vbp-reader-{id(self):x}",
            daemon=True,
        )
        self._reader_thread.start()

    def close(self) -> None:
        """Shut down the multiplexer. Idempotent."""
        if self._closing.is_set():
            return
        self._closing.set()
        # Closing the socket unblocks the read.
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self._sock.close()
        except OSError:
            pass
        # Wake any waiters with an EOF error.
        with self._lock:
            for ev in self._events.values():
                ev.set()
        if self._reader_thread is not None:
            self._reader_thread.join(timeout=2.0)
        self._reader_alive.clear()

    # ------------------------------------------------------------------
    # Sequence-id allocation
    # ------------------------------------------------------------------

    def _alloc_seq(self) -> int:
        """Allocate a new seq id not currently in flight.

        If all 256 seqs are in flight, busy-wait (with a tiny sleep) for
        one to free up. Caller must hold self._lock.
        """
        # Scan forward from self._next_seq. Bounded to 256 iterations
        # because if we go a full loop without finding a free slot, the
        # caller is mis-using the API and we'll raise.
        start = self._next_seq
        for _ in range(256):
            seq = self._next_seq
            self._next_seq = (self._next_seq + 1) & 0xFF
            if seq not in self._inflight:
                return seq
            if self._next_seq == start:
                # Full loop — drop the lock and wait briefly.
                self._lock.release()
                try:
                    time.sleep(self._SEQ_ALLOC_POLL)
                finally:
                    self._lock.acquire()
        raise VBPProtocolError("all 256 sequence ids are in flight")

    # ------------------------------------------------------------------
    # Send
    # ------------------------------------------------------------------

    def send(self, op: int, body: bytes, *, flags: int = 0) -> int:
        """Send a request and return its seq id (for stream/manual use).

        Does not register a waiter.  Use ``call()`` for request/response.
        """
        with self._lock:
            seq = self._alloc_seq()
            self._inflight[seq] = []
            self._events[seq] = threading.Event()
            self._errors[seq] = None
        self._send_frame(seq, op, flags, body)
        return seq

    def _send_frame(self, seq: int, op: int, flags: int, body: bytes) -> None:
        try:
            with self._writer_lock:
                write_frame(self._writer, seq, op, flags, body)
                self._writer.flush()
        except (OSError, VBPProtocolError) as e:
            with self._lock:
                ev = self._events.pop(seq, None)
                if ev is not None:
                    ev.set()
            self.close()
            raise VBPProtocolError(f"send failed: {e}") from e

    def call(self, op: int, body: bytes, *, timeout: Optional[float] = None, flags: int = 0) -> list[Frame]:
        """Send a request and wait for the complete response stream.

        Returns a list of frames (typically 1-3: e.g. [DATA_CHUNK,
        ROWS_FINISHED, COMMAND_COMPLETE] for a successful query).
        """
        with self._lock:
            seq = self._alloc_seq()
            self._inflight[seq] = []
            self._events[seq] = threading.Event()
            self._errors[seq] = None
        try:
            self._send_frame(seq, op, flags, body)
        except Exception:
            with self._lock:
                self._inflight.pop(seq, None)
                self._events.pop(seq, None)
                self._errors.pop(seq, None)
            raise
        ev = self._events[seq]
        if not ev.wait(timeout=timeout):
            raise TimeoutError(f"vbp call op=0x{op:02x} seq={seq} timed out")
        with self._lock:
            frames = self._inflight.pop(seq, [])
            err = self._errors.pop(seq, None)
            del self._events[seq]
        if err is not None:
            sqlstate, msg, detail, hint = self._parse_error_frame(err)
            raise VBPError(sqlstate, msg, detail, hint)
        return frames

    def call_many(self, items: list[tuple[int, bytes]], *, timeout: Optional[float] = None) -> list[list[Frame]]:
        """Send many requests concurrently, wait for all replies.

        ``items`` is a list of ``(op, body)`` tuples.  Returns a list of
        reply-frame lists, one per input, in the same order.
        """
        seqs: list[int] = []
        try:
            for op, body in items:
                seqs.append(self._send_with_alloc(op, body))
            # Wait for all events
            for s in seqs:
                ev = self._events[s]
                if not ev.wait(timeout=timeout):
                    raise TimeoutError(f"vbp seq={s} timed out")
            # Gather results in order
            out = []
            with self._lock:
                for s in seqs:
                    out.append(self._inflight.pop(s, []))
                    err = self._errors.pop(s, None)
                    self._events.pop(s, None)
                    if err is not None:
                        sqlstate, msg, detail, hint = self._parse_error_frame(err)
                        raise VBPError(sqlstate, msg, detail, hint)
            return out
        finally:
            for s in seqs:
                with self._lock:
                    if s in self._inflight:
                        self._inflight.pop(s, None)
                    self._events.pop(s, None)
                    self._errors.pop(s, None)

    def _send_with_alloc(self, op: int, body: bytes) -> int:
        with self._lock:
            seq = self._alloc_seq()
            self._inflight[seq] = []
            self._events[seq] = threading.Event()
            self._errors[seq] = None
        try:
            self._send_frame(seq, op, 0, body)
        except Exception:
            with self._lock:
                self._inflight.pop(seq, None)
                self._events.pop(seq, None)
                self._errors.pop(seq, None)
            raise
        return seq

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    def stream(
        self,
        op: int,
        body: bytes,
        *,
        timeout: Optional[float] = None,
    ) -> Iterator[Frame]:
        """Send a request and yield each reply frame until stream end.

        Yields DATA_CHUNK / STREAM_CHUNK frames; raises VBPError if
        an ERROR frame is received; raises StopIteration on ROWS_FINISHED
        or COMMAND_COMPLETE.
        """
        # We use a queue to deliver frames from the reader thread to
        # the consumer thread (which is also the calling thread).
        q: "queue.Queue[Frame | Exception | None]" = queue.Queue()

        def cb(frame: Frame) -> None:
            if frame.op == 0x0D:  # ERROR
                sqlstate, msg, detail, hint = self._parse_error_frame(frame)
                q.put(VBPError(sqlstate, msg, detail, hint))
            else:
                q.put(frame)

        with self._lock:
            seq = self._alloc_seq()
            self._inflight[seq] = []
            self._events[seq] = threading.Event()
            self._errors[seq] = None
            self._stream_cb[seq] = cb
        try:
            self._send_frame(seq, op, body=body)
            done = False
            while not done:
                try:
                    item = q.get(timeout=timeout)
                except queue.Empty:
                    raise TimeoutError("vbp stream timed out")
                if isinstance(item, BaseException):
                    raise item
                if item is None:
                    return
                if item.op in (0x0C,):  # COMMAND_COMPLETE — terminal
                    return
                if item.op in (0x0B,):  # ROWS_FINISHED — last data frame
                    yield item
                    return
                if item.op in (0x1A,):  # STREAM_END
                    return
                yield item
        finally:
            with self._lock:
                self._stream_cb.pop(seq, None)
                self._inflight.pop(seq, None)
                self._events.pop(seq, None)
                self._errors.pop(seq, None)

    # ------------------------------------------------------------------
    # Reader
    # ------------------------------------------------------------------

    def _read_loop(self) -> None:
        """Background thread: read frames and dispatch to waiters.

        We block on the socket directly (no makefile / buffered reader)
        so that ``self._sock.settimeout`` does what we expect.  A
        socket-level timeout is treated as a transient idle (the
        connection may simply be quiet), not a fatal error.
        """
        # Set a short socket timeout so the reader can check the
        # closing flag periodically.
        try:
            self._sock.settimeout(0.5)
        except OSError:
            pass
        try:
            while not self._closing.is_set():
                try:
                    # Read the 8-byte header.
                    hdr = self._read_exact(8)
                except (socket.timeout, TimeoutError):
                    continue  # idle, loop again
                if hdr is None:
                    break
                if hdr[:3] != MAGIC:
                    logger.debug("vbp read: bad magic %r", hdr[:3])
                    break
                import struct as _struct
                (payload_len,) = _struct.unpack("<I", hdr[3:7])
                seq = hdr[7]
                if payload_len < 2:
                    logger.debug("vbp read: payload too short %d", payload_len)
                    break
                if payload_len > MAX_FRAME_LEN:
                    logger.debug("vbp read: payload too large %d", payload_len)
                    break
                try:
                    opflags = self._read_exact(2)
                except (socket.timeout, TimeoutError):
                    continue
                if opflags is None:
                    break
                op = opflags[0]
                flags = opflags[1]
                body_len = payload_len - 2
                body = b""
                if body_len > 0:
                    try:
                        body = self._read_exact(body_len)
                    except (socket.timeout, TimeoutError):
                        continue
                if body is None:
                    break
                frame = Frame(seq=seq, op=op, flags=flags, body=body)
                self._dispatch_frame(frame)
        except OSError as e:
            if not self._closing.is_set():
                logger.debug("vbp socket error: %s", e)
        finally:
            self._reader_alive.clear()
            # Wake every waiter with an EOF.
            with self._lock:
                for ev in self._events.values():
                    ev.set()
            if self._on_close is not None:
                try:
                    self._on_close()
                except Exception:  # pragma: no cover
                    logger.exception("on_close callback raised")

    def _read_exact(self, n: int) -> bytes | None:
        """Read exactly n bytes from the socket, handling short reads.

        Returns None on EOF (peer closed).  Raises socket.timeout on
        timeout (the calling loop treats that as transient).
        """
        if n == 0:
            return b""
        chunks = []
        remaining = n
        while remaining > 0:
            chunk = self._sock.recv(remaining)
            if not chunk:
                return None
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _dispatch_frame(self, frame: Frame) -> None:
        """Route a frame to its waiter (or to the stream callback)."""
        seq = frame.seq
        with self._lock:
            # Streaming callback takes priority.
            cb = self._stream_cb.get(seq)
            if cb is not None:
                cb(frame)
                if frame.op in (0x0C, 0x0B, 0x1A, 0x0D):
                    # Terminal frame — release the seq.
                    ev = self._events.get(seq)
                    if ev is not None:
                        ev.set()
                return
            bucket = self._inflight.get(seq)
            if bucket is None:
                # Spurious frame for an unknown seq — drop it.
                return
            bucket.append(frame)
            # Set the waiter's event for any of the "response terminal"
            # opcodes.  SERVER_READY is NOT terminal because the handshake
            # typically continues with AUTH_OK (or AUTH_CHALLENGE for
            # SCRAM).  Callers that just want the SERVER_READY can use
            # the streaming API.  Note: ROWS_FINISHED is *not* terminal
            # for QUERY because the server always emits COMMAND_COMPLETE
            # after it; we wait for CC to know the response is complete.
            if frame.op in (
                0x0D,  # ERROR
                0x0C,  # COMMAND_COMPLETE
                0x1A,  # STREAM_END
                0x05,  # AUTH_OK (handshake terminal)
                0x03,  # AUTH_CHALLENGE (SCRAM server-first)
                0x17,  # PONG
            ):
                if frame.op == 0x0D:
                    # Remember the ERROR frame so call() can raise VBPError.
                    self._errors[seq] = frame
                ev = self._events.get(seq)
                if ev is not None:
                    ev.set()

    # ------------------------------------------------------------------
    # ERROR frame parsing (used by both call() and stream())
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_error_frame(frame: Frame) -> tuple[str, str, str, str]:
        """Parse an ERROR frame body into (sqlstate, message, detail, hint)."""
        buf = io.BytesIO(frame.body)
        try:
            # sqlstate: fixed 5 bytes (no length prefix)
            sqlstate = buf.read(5).decode("ascii")
            # u32 msg_len, msg, u32 detail_len, detail, u32 hint_len, hint
            (msg_len,) = struct.unpack("<I", buf.read(4))
            message = buf.read(msg_len).decode("utf-8")
            (det_len,) = struct.unpack("<I", buf.read(4))
            detail = buf.read(det_len).decode("utf-8")
            (hint_len,) = struct.unpack("<I", buf.read(4))
            hint = buf.read(hint_len).decode("utf-8")
        except Exception:
            sqlstate, message, detail, hint = "0A000", "malformed ERROR frame", "", ""
        return sqlstate, message, detail, hint


__all__ = [
    "Multiplexer",
    "VBPError",
]
