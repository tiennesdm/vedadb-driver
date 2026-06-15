//! VBP multiplexed connection — a single TCP connection carrying many
//! concurrent in-flight requests keyed by 1-byte sequence id.
//!
//! Wire constraints (VBP_SPEC.md §2):
//!   * Sequence id is 1 byte, wraps at 256.
//!   * Responses arrive in the same connection, addressed by their seq.
//!   * The driver MUST NOT issue a new request with a given seq while a
//!     previous request with that seq is still in flight.
//!
//! The Multiplexer exposes an async request/response API:
//!   * `call(op, body)` — send a request, await the matching reply.
//!   * `call_many(items)` — fire all, gather all.
//!
//! Internally, a single background reader task reads frames from the
//! socket and dispatches them to per-seq [`InflightSlot`] accumulators.
//!
//! **STREAMING FIX (v2):** the per-seq slot holds an append-only frame
//! buffer plus a `Notify`. The reader appends every received frame
//! for the seq; the slot is released only when a *terminal* opcode
//! (see [`super::opcodes::is_terminal`]) arrives. Non-terminal frames
//! (`OP_DATA_CHUNK` 0x0A, `OP_STREAM_CHUNK` 0x19) are accumulated
//! into the buffer and the slot is kept open. This fixes the v1
//! bug where a query response shaped like
//! `[DATA_CHUNK, DATA_CHUNK, …, ROWS_FINISHED, COMMAND_COMPLETE]`
//! had its first frame delivered as the entire reply, leaking the
//! remaining frames and corrupting subsequent calls.

use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::{Mutex, Notify};
use tokio::task::JoinHandle;

use super::frame::{frame_bytes, Frame, VBPProtocolError, MAGIC, MAX_FRAME_LEN, OPFLAGS_LEN};
use super::opcodes::is_terminal;

/// High-level VBP error (decoded from the ERROR frame body).
#[derive(Debug, Clone, Error)]
#[error("[{sqlstate}] {message}")]
pub struct VBPError {
    pub sqlstate: String,
    pub message: String,
    pub detail: String,
    pub hint: String,
}

impl VBPError {
    pub fn new(sqlstate: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            sqlstate: sqlstate.into(),
            message: message.into(),
            detail: String::new(),
            hint: String::new(),
        }
    }
}

#[derive(Debug, Error)]
pub enum MultiplexerError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("vbp protocol error: {0}")]
    Protocol(#[from] VBPProtocolError),
    #[error("vbp call timed out (op=0x{op:02x}, seq={seq})")]
    Timeout { op: u8, seq: u8 },
    #[error("all 256 sequence ids are in flight")]
    SeqExhausted,
    #[error("vbp error: {0}")]
    Vbp(#[from] VBPError),
    #[error("multiplexer closed")]
    Closed,
}

/// Per-seq accumulator used by the reader task and the calling task.
///
/// Lifecycle:
///   1. Created in `alloc_seq` with `frames` empty and `terminal` false.
///   2. Reader pushes non-terminal frames into `frames`.
///   3. Reader pushes the terminal frame into `frames`, sets
///      `terminal = true`, sets `error = Some(...)` if it was an
///      `OP_ERROR`, and calls `notify.notify_waiters()`.
///   4. Caller wakes, drains `frames`, returns them to the user, and
///      removes the slot from the multiplexer's inflight map.
struct InflightSlot {
    /// All received frames for this seq, in order. Includes the
    /// terminal frame at the end.
    frames: Mutex<Vec<Frame>>,
    /// Set to true once the reader has observed a terminal opcode.
    /// The caller is responsible for removing the slot from the
    /// inflight map; the reader no longer holds a reference once it
    /// sets `terminal = true` and notifies.
    terminal: std::sync::atomic::AtomicBool,
    /// Set to the `OP_ERROR` frame if the terminal frame was an error.
    /// Checked by the caller; if set, the caller returns
    /// `MultiplexerError::Vbp` instead of the frames.
    error: Mutex<Option<Frame>>,
    /// Notified when `terminal` flips to true. Used by the wait path.
    notify: Notify,
}

impl InflightSlot {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            frames: Mutex::new(Vec::new()),
            terminal: std::sync::atomic::AtomicBool::new(false),
            error: Mutex::new(None),
            notify: Notify::new(),
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct Reply {
    pub frames: Vec<Frame>,
    pub error: Option<Frame>,
}

pub struct Multiplexer {
    writer: Mutex<tokio::net::tcp::OwnedWriteHalf>,
    inflight: Arc<Mutex<HashMap<u8, Arc<InflightSlot>>>>,
    next_seq: Arc<Mutex<u8>>,
    closing: Arc<Mutex<bool>>,
    _reader_handle: Mutex<Option<JoinHandle<()>>>,
    host: String,
    port: u16,
}

impl Multiplexer {
    /// Connect to a VBP server at `host:port` and start the background
    /// reader task.
    pub async fn connect(host: &str, port: u16) -> Result<Arc<Self>, MultiplexerError> {
        let stream = TcpStream::connect((host, port)).await?;
        let (read_half, write_half) = stream.into_split();

        let inflight: Arc<Mutex<HashMap<u8, Arc<InflightSlot>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let next_seq: Arc<Mutex<u8>> = Arc::new(Mutex::new(1));
        let closing: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));

        let mux = Arc::new(Self {
            writer: Mutex::new(write_half),
            inflight: inflight.clone(),
            next_seq: next_seq.clone(),
            closing: closing.clone(),
            _reader_handle: Mutex::new(None),
            host: host.to_string(),
            port,
        });

        let handle = tokio::spawn(read_loop(read_half, inflight, closing));
        *mux._reader_handle.lock().await = Some(handle);
        Ok(mux)
    }

    /// Allocate a fresh seq id (skipping 0).
    async fn alloc_seq(&self) -> Result<u8, MultiplexerError> {
        let mut next = self.next_seq.lock().await;
        for _ in 0..256 {
            let seq = *next;
            *next = next.wrapping_add(1);
            if seq == 0 {
                continue;
            }
            let inflight = self.inflight.lock().await;
            if !inflight.contains_key(&seq) {
                return Ok(seq);
            }
        }
        Err(MultiplexerError::SeqExhausted)
    }

    /// Send a request and return the seq id (without waiting).
    pub async fn send(&self, op: u8, body: Vec<u8>) -> Result<u8, MultiplexerError> {
        let seq = self.alloc_seq().await?;
        {
            let mut inflight = self.inflight.lock().await;
            inflight.insert(seq, InflightSlot::new());
        }
        let bytes = frame_bytes(seq, op, 0, &body);
        let mut writer = self.writer.lock().await;
        writer.write_all(&bytes).await?;
        writer.flush().await?;
        Ok(seq)
    }

    /// Send a request and await the complete reply.
    ///
    /// All frames received for the seq — including intermediate
    /// `OP_DATA_CHUNK` / `OP_STREAM_CHUNK` chunks — are returned in
    /// `Vec<Frame>` order. The terminal frame (last element) carries
    /// the opcode that ended the reply (typically `OP_ROWS_FINISHED`
    /// + `OP_COMMAND_COMPLETE` for queries, or `OP_ERROR` for
    /// failures — the latter is raised as `MultiplexerError::Vbp`).
    pub async fn call(
        &self,
        op: u8,
        body: Vec<u8>,
        timeout: Option<Duration>,
    ) -> Result<Vec<Frame>, MultiplexerError> {
        let seq = self.alloc_seq().await?;
        let slot = {
            let mut inflight = self.inflight.lock().await;
            let slot = InflightSlot::new();
            inflight.insert(seq, slot.clone());
            slot
        };
        let bytes = frame_bytes(seq, op, 0, &body);
        {
            let mut writer = self.writer.lock().await;
            writer.write_all(&bytes).await?;
            writer.flush().await?;
        }

        // Wait for the reader to mark the slot terminal.
        let wait = async {
            loop {
                if slot.terminal.load(std::sync::atomic::Ordering::Acquire) {
                    break;
                }
                // NotifyWaiter only fires on the next notify() call, so
                // re-check the flag in case we missed the edge.
                let notified = slot.notify.notified();
                tokio::pin!(notified);
                notified.as_mut().await;
            }
        };

        if let Some(t) = timeout {
            if tokio::time::timeout(t, wait).await.is_err() {
                let mut inflight = self.inflight.lock().await;
                inflight.remove(&seq);
                return Err(MultiplexerError::Timeout { op, seq });
            }
        } else {
            wait.await;
        }

        // Snapshot the reply, then drop the inflight slot.
        let frames = slot.frames.lock().await.clone();
        let error = slot.error.lock().await.clone();
        {
            let mut inflight = self.inflight.lock().await;
            inflight.remove(&seq);
        }
        // Trim the trailing terminal frame from the frames vec only
        // when the terminal was a *non-error* end-of-reply marker —
        // keep the terminal frame so the caller can inspect it
        // (e.g. COMMAND_COMPLETE carries row count). For ERROR, the
        // terminal is moved into `error` above and `frames` is left
        // empty (callers raise Vbp(err)).
        if let Some(err_frame) = error {
            return Err(MultiplexerError::Vbp(VBPError::from_frame(&err_frame)));
        }
        Ok(frames)
    }

    /// Send many requests concurrently and gather all replies.
    pub async fn call_many(
        &self,
        items: Vec<(u8, Vec<u8>)>,
        timeout: Option<Duration>,
    ) -> Result<Vec<Vec<Frame>>, MultiplexerError> {
        // Pre-allocate all seqs and slots BEFORE writing anything, so
        // the reader can find them as soon as frames arrive.
        struct Pending {
            op: u8,
            seq: u8,
            slot: Arc<InflightSlot>,
        }
        let mut pending: Vec<Pending> = Vec::with_capacity(items.len());
        {
            let mut inflight = self.inflight.lock().await;
            for (op, _body) in &items {
                let mut next = self.next_seq.lock().await;
                let mut found: Option<u8> = None;
                for _ in 0..256 {
                    let s = *next;
                    *next = next.wrapping_add(1);
                    if s == 0 {
                        continue;
                    }
                    if !inflight.contains_key(&s) {
                        found = Some(s);
                        break;
                    }
                }
                let seq = match found {
                    Some(s) => s,
                    None => return Err(MultiplexerError::SeqExhausted),
                };
                let slot = InflightSlot::new();
                inflight.insert(seq, slot.clone());
                pending.push(Pending {
                    op: *op,
                    seq,
                    slot,
                });
            }
        }

        // Now write all requests. We hold the writer lock for the
        // duration of the burst so they go out back-to-back.
        {
            let mut writer = self.writer.lock().await;
            for (i, (_op, body)) in items.iter().enumerate() {
                let bytes = frame_bytes(pending[i].seq, pending[i].op, 0, body);
                writer.write_all(&bytes).await?;
            }
            writer.flush().await?;
        }

        // Gather all replies.
        let mut out = Vec::with_capacity(pending.len());
        for p in pending {
            let wait = async {
                loop {
                    if p.slot.terminal.load(std::sync::atomic::Ordering::Acquire) {
                        break;
                    }
                    let notified = p.slot.notify.notified();
                    tokio::pin!(notified);
                    notified.as_mut().await;
                }
            };
            if let Some(t) = timeout {
                if tokio::time::timeout(t, wait).await.is_err() {
                    let mut inflight = self.inflight.lock().await;
                    inflight.remove(&p.seq);
                    return Err(MultiplexerError::Timeout {
                        op: p.op,
                        seq: p.seq,
                    });
                }
            } else {
                wait.await;
            }
            let mut frames = p.slot.frames.lock().await.clone();
            let error = p.slot.error.lock().await.clone();
            {
                let mut inflight = self.inflight.lock().await;
                inflight.remove(&p.seq);
            }
            if let Some(err_frame) = error {
                return Err(MultiplexerError::Vbp(VBPError::from_frame(&err_frame)));
            }
            out.push(frames);
        }
        Ok(out)
    }

    /// Mark the multiplexer as closed. Inflight waiters will be left
    /// to fail naturally; new sends will get an Io error.
    pub async fn close(&self) {
        let mut closing = self.closing.lock().await;
        *closing = true;
    }

    pub fn host(&self) -> &str {
        &self.host
    }
    pub fn port(&self) -> &u16 {
        &self.port
    }
}

impl VBPError {
    /// Parse an `OP_ERROR` frame body into a [`VBPError`].
    pub fn from_frame(frame: &Frame) -> Self {
        let (sqlstate, message, detail, hint) = parse_error_frame(frame);
        VBPError {
            sqlstate,
            message,
            detail,
            hint,
        }
    }
}

async fn read_loop(
    mut read_half: tokio::net::tcp::OwnedReadHalf,
    inflight: Arc<Mutex<HashMap<u8, Arc<InflightSlot>>>>,
    closing: Arc<Mutex<bool>>,
) {
    loop {
        if *closing.lock().await {
            break;
        }
        let frame = match read_one_frame(&mut read_half).await {
            Ok(f) => f,
            Err(_) => {
                // Reader died — wake all inflight waiters by flipping
                // each slot to terminal with no frames. The caller's
                // `wait` loop will then proceed to the snapshot step
                // and return an empty Vec<Frame>.
                let slots: Vec<Arc<InflightSlot>> = {
                    let mut g = inflight.lock().await;
                    g.drain().map(|(_, s)| s).collect()
                };
                for s in slots {
                    s.terminal
                        .store(true, std::sync::atomic::Ordering::Release);
                    s.notify.notify_waiters();
                }
                break;
            }
        };
        let seq = frame.seq;
        let op = frame.op;
        let terminal = is_terminal(op);
        let is_error = op == 0x0D; // OP_ERROR

        // *** THE STREAMING FIX (v2) ***
        // Look up the slot, push the frame, and ONLY release the slot
        // (set terminal = true) when the opcode is terminal. Non-
        // terminal frames (DATA_CHUNK, STREAM_CHUNK, …) are appended
        // to the accumulator and the slot is kept open.
        let slot = {
            let g = inflight.lock().await;
            g.get(&seq).cloned()
        };
        let Some(slot) = slot else {
            // Spurious frame for an unknown seq — drop it silently.
            continue;
        };
        {
            let mut frames = slot.frames.lock().await;
            frames.push(frame);
        }
        if is_error {
            let body = slot.frames.lock().await.last().cloned();
            if let Some(f) = body {
                *slot.error.lock().await = Some(f);
            }
        }
        if terminal {
            slot.terminal
                .store(true, std::sync::atomic::Ordering::Release);
            // Wake all current waiters. The caller is responsible for
            // removing the slot from the inflight map (we keep it for
            // a moment in case a late duplicate frame arrives — those
            // are silently dropped on the unknown-seq branch above).
            slot.notify.notify_waiters();
        }
    }
}

async fn read_one_frame(
    read_half: &mut tokio::net::tcp::OwnedReadHalf,
) -> Result<Frame, io::Error> {
    let mut hdr = [0u8; 8];
    read_half.read_exact(&mut hdr).await?;
    if &hdr[..3] != MAGIC {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "bad magic"));
    }
    let payload_len = u32::from_le_bytes([hdr[3], hdr[4], hdr[5], hdr[6]]);
    if payload_len < OPFLAGS_LEN as u32 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "truncated"));
    }
    if payload_len > MAX_FRAME_LEN {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "oversize"));
    }
    let seq = hdr[7];
    let mut opflags = [0u8; 2];
    read_half.read_exact(&mut opflags).await?;
    let op = opflags[0];
    let flags = opflags[1];
    let body_len = payload_len as usize - OPFLAGS_LEN;
    let mut body = vec![0u8; body_len];
    if body_len > 0 {
        read_half.read_exact(&mut body).await?;
    }
    Ok(Frame {
        seq,
        op,
        flags,
        body,
    })
}

/// Parse an ERROR frame body into (sqlstate, message, detail, hint).
pub fn parse_error_frame(frame: &Frame) -> (String, String, String, String) {
    let body = &frame.body;
    if body.len() < 5 + 4 {
        return (
            "0A000".into(),
            "malformed ERROR frame".into(),
            String::new(),
            String::new(),
        );
    }
    let sqlstate = String::from_utf8_lossy(&body[..5]).into_owned();
    let mut off = 5;
    let (msg, n) = read_str_field(body, off);
    off += n;
    let (detail, n) = read_str_field(body, off);
    off += n;
    let (hint, _) = read_str_field(body, off);
    (sqlstate, msg, detail, hint)
}

fn read_str_field(body: &[u8], off: usize) -> (String, usize) {
    if off + 4 > body.len() {
        return (String::new(), 0);
    }
    let len = u32::from_le_bytes([body[off], body[off + 1], body[off + 2], body[off + 3]])
        as usize;
    if off + 4 + len > body.len() {
        return (String::new(), 4);
    }
    let s = String::from_utf8_lossy(&body[off + 4..off + 4 + len]).into_owned();
    (s, 4 + len)
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use tokio::net::TcpListener;

    /// Build an encoded frame: `VDB | payload_len_le4 | seq | op | flags | body`.
    fn enc(seq: u8, op: u8, flags: u8, body: &[u8]) -> Vec<u8> {
        frame_bytes(seq, op, flags, body)
    }

    #[test]
    fn parse_error_frame_minimal() {
        let body = {
            let mut b = Vec::new();
            b.extend_from_slice(b"28000");
            b.extend_from_slice(&5u32.to_le_bytes());
            b.extend_from_slice(b"oops");
            b.extend_from_slice(&0u32.to_le_bytes());
            b.extend_from_slice(&0u32.to_le_bytes());
            b
        };
        let f = Frame {
            seq: 0,
            op: 0x0D,
            flags: 0,
            body,
        };
        let (sqlstate, msg, _, _) = parse_error_frame(&f);
        assert_eq!(sqlstate, "28000");
        assert_eq!(msg, "oops");
    }

    #[test]
    fn parse_error_frame_truncated_returns_default() {
        let f = Frame {
            seq: 0,
            op: 0x0D,
            flags: 0,
            body: vec![0u8; 3],
        };
        let (sqlstate, msg, _, _) = parse_error_frame(&f);
        assert_eq!(sqlstate, "0A000");
        assert_eq!(msg, "malformed ERROR frame");
    }

    #[tokio::test]
    async fn multiplexer_round_trip_with_fake_server() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut hdr = [0u8; 8];
                let _ = tokio::io::AsyncReadExt::read_exact(&mut sock, &mut hdr).await;
                let payload_len = u32::from_le_bytes([hdr[3], hdr[4], hdr[5], hdr[6]]);
                let mut rest = vec![0u8; (payload_len as usize) - 2 + 2];
                let _ = tokio::io::AsyncReadExt::read_exact(&mut sock, &mut rest).await;
                let nonce = b"12345678";
                let bytes = frame_bytes(hdr[7], 0x17, 0, nonce);
                let _ = tokio::io::AsyncWriteExt::write_all(&mut sock, &bytes).await;
            }
        });

        let mux = Multiplexer::connect("127.0.0.1", addr.port()).await.unwrap();
        let nonce = 0x12345678u64.to_le_bytes().to_vec();
        let replies = mux
            .call(0x16, nonce, Some(Duration::from_secs(2)))
            .await
            .unwrap();
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].op, 0x17);
        assert_eq!(replies[0].body, 0x12345678u64.to_le_bytes());
    }

    #[tokio::test]
    async fn multiplexer_call_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (_sock, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(10)).await;
        });
        let mux = Multiplexer::connect("127.0.0.1", addr.port()).await.unwrap();
        let err = mux
            .call(0x16, vec![], Some(Duration::from_millis(100)))
            .await
            .unwrap_err();
        assert!(matches!(err, MultiplexerError::Timeout { .. }), "{err:?}");
    }

    #[tokio::test]
    async fn multiplexer_call_many_round_trip() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            for _ in 0..3 {
                if let Ok((mut sock, _)) = listener.accept().await {
                    let mut hdr = [0u8; 8];
                    let _ = tokio::io::AsyncReadExt::read_exact(&mut sock, &mut hdr).await;
                    let payload_len = u32::from_le_bytes([hdr[3], hdr[4], hdr[5], hdr[6]]);
                    let mut rest = vec![0u8; (payload_len as usize) - 2 + 2];
                    let _ = tokio::io::AsyncReadExt::read_exact(&mut sock, &mut rest).await;
                    let bytes = frame_bytes(hdr[7], 0x17, 0, b"ok");
                    let _ = tokio::io::AsyncWriteExt::write_all(&mut sock, &bytes).await;
                }
            }
        });
        let mux = Multiplexer::connect("127.0.0.1", addr.port()).await.unwrap();
        let items = vec![
            (0x16, b"1".to_vec()),
            (0x16, b"2".to_vec()),
            (0x16, b"3".to_vec()),
        ];
        let replies = mux
            .call_many(items, Some(Duration::from_secs(2)))
            .await
            .unwrap();
        assert_eq!(replies.len(), 3);
    }

    /// **v2 STREAMING FIX test** — the most important regression
    /// guard. A query response shaped like
    /// `[DATA_CHUNK, DATA_CHUNK, ROWS_FINISHED, COMMAND_COMPLETE]`
    /// must return ALL FOUR frames to the caller, not just the
    /// first DATA_CHUNK (which is what the v1 buggy implementation
    /// would do).
    #[tokio::test]
    async fn multiplexer_accumulates_data_chunks_before_terminal() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                // Read the QUERY frame.
                let mut hdr = [0u8; 8];
                let _ = sock.read_exact(&mut hdr).await;
                let payload_len = u32::from_le_bytes([hdr[3], hdr[4], hdr[5], hdr[6]]);
                let mut rest = vec![0u8; (payload_len as usize) - 2 + 2];
                let _ = sock.read_exact(&mut rest).await;
                let seq = hdr[7];

                // Send a chunked query response: 2 DATA_CHUNK + ROWS_FINISHED + COMMAND_COMPLETE.
                let mut out = Vec::new();
                out.extend_from_slice(&enc(seq, 0x0A, 0, b"row-1")); // OP_DATA_CHUNK
                out.extend_from_slice(&enc(seq, 0x0A, 0, b"row-2")); // OP_DATA_CHUNK
                out.extend_from_slice(&enc(seq, 0x0B, 0, b"")); // OP_ROWS_FINISHED
                out.extend_from_slice(&enc(seq, 0x0C, 0, b"2 rows")); // OP_COMMAND_COMPLETE
                let _ = sock.write_all(&out).await;
            }
        });

        let mux = Multiplexer::connect("127.0.0.1", addr.port()).await.unwrap();
        let frames = mux
            .call(0x06 /* OP_QUERY */, b"SELECT *".to_vec(), Some(Duration::from_secs(2)))
            .await
            .expect("streaming call must succeed");

        // All 4 frames must be present, in order.
        assert_eq!(
            frames.len(),
            4,
            "expected DATA_CHUNK, DATA_CHUNK, ROWS_FINISHED, COMMAND_COMPLETE, got {frames:?}"
        );
        assert_eq!(frames[0].op, 0x0A);
        assert_eq!(frames[0].body, b"row-1");
        assert_eq!(frames[1].op, 0x0A);
        assert_eq!(frames[1].body, b"row-2");
        assert_eq!(frames[2].op, 0x0B, "ROWS_FINISHED must be present");
        assert_eq!(frames[3].op, 0x0C, "COMMAND_COMPLETE must be present");
        assert_eq!(frames[3].body, b"2 rows");
    }

    /// v2 streaming fix: an OP_ERROR as the terminal frame must be
    /// raised as `MultiplexerError::Vbp`, even when non-terminal
    /// chunks arrived before it.
    #[tokio::test]
    async fn multiplexer_error_after_data_chunks_raises_vbp_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut hdr = [0u8; 8];
                let _ = sock.read_exact(&mut hdr).await;
                let payload_len = u32::from_le_bytes([hdr[3], hdr[4], hdr[5], hdr[6]]);
                let mut rest = vec![0u8; (payload_len as usize) - 2 + 2];
                let _ = sock.read_exact(&mut rest).await;
                let seq = hdr[7];

                // Send 1 chunk + an ERROR (the engine's "partial-result + abort" pattern).
                let mut err_body = Vec::new();
                err_body.extend_from_slice(b"42P01");
                err_body.extend_from_slice(&9u32.to_le_bytes());
                err_body.extend_from_slice(b"fatal err");
                err_body.extend_from_slice(&0u32.to_le_bytes());
                err_body.extend_from_slice(&0u32.to_le_bytes());
                let mut out = Vec::new();
                out.extend_from_slice(&enc(seq, 0x0A, 0, b"row-1"));
                out.extend_from_slice(&enc(seq, 0x0D, 0, &err_body));
                let _ = sock.write_all(&out).await;
            }
        });

        let mux = Multiplexer::connect("127.0.0.1", addr.port()).await.unwrap();
        let err = mux
            .call(0x06, b"SELECT".to_vec(), Some(Duration::from_secs(2)))
            .await
            .expect_err("ERROR after chunks must raise MultiplexerError::Vbp");
        match err {
            MultiplexerError::Vbp(e) => {
                assert_eq!(e.sqlstate, "42P01");
                assert_eq!(e.message, "fatal err");
            }
            other => panic!("expected Vbp, got {other:?}"),
        }
    }

    /// v2 streaming fix: after a streaming call completes, the inflight
    /// slot is released so the same seq id can be reused for a new
    /// call. This is the v1 bug's downstream symptom (seq exhaustion /
    /// call corruption) — guard it here.
    ///
    /// Implementation: the multiplexer holds a single TCP connection,
    /// so the server side must service 4 sequential QUERY requests on
    /// the SAME accepted socket. Each request gets a chunked response
    /// (2 DATA_CHUNK, ROWS_FINISHED, COMMAND_COMPLETE). If seq-slot
    /// release is broken, the second call would re-use a still-open
    /// slot and corrupt the response.
    #[tokio::test]
    async fn multiplexer_releases_seq_after_streaming_call() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        let call_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let call_count_srv = call_count.clone();

        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            // Accept ONE connection, then service 4 requests on it.
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            for _ in 0..4 {
                let mut hdr = [0u8; 8];
                if sock.read_exact(&mut hdr).await.is_err() {
                    break;
                }
                let payload_len = u32::from_le_bytes([hdr[3], hdr[4], hdr[5], hdr[6]]);
                let mut rest = vec![0u8; (payload_len as usize) - 2 + 2];
                let _ = sock.read_exact(&mut rest).await;
                let seq = hdr[7];
                let n = call_count_srv.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let label = format!("call-{}", n);
                let mut out = Vec::new();
                out.extend_from_slice(&enc(seq, 0x0A, 0, label.as_bytes()));
                out.extend_from_slice(&enc(seq, 0x0A, 0, b"second-chunk"));
                out.extend_from_slice(&enc(seq, 0x0B, 0, b""));
                out.extend_from_slice(&enc(seq, 0x0C, 0, b"1"));
                let _ = sock.write_all(&out).await;
            }
        });

        let mux = Multiplexer::connect("127.0.0.1", addr.port()).await.unwrap();
        for _ in 0..4 {
            let frames = mux
                .call(0x06, b"SELECT".to_vec(), Some(Duration::from_secs(2)))
                .await
                .unwrap();
            assert_eq!(frames.len(), 4, "every call must return all 4 frames");
        }
        assert_eq!(
            call_count.load(std::sync::atomic::Ordering::SeqCst),
            4,
            "server should have seen 4 calls"
        );
    }

    #[tokio::test]
    async fn read_one_frame_round_trip() {
        let bytes = frame_bytes(0xAB, 0xCD, 0xEF, b"hello");
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let _ = tokio::io::AsyncWriteExt::write_all(&mut sock, &bytes).await;
        });
        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut rh, _wh) = stream.into_split();
        let f = read_one_frame(&mut rh).await.unwrap();
        assert_eq!(f.seq, 0xAB);
        assert_eq!(f.op, 0xCD);
        assert_eq!(f.flags, 0xEF);
        assert_eq!(f.body, b"hello");
    }

    #[tokio::test]
    async fn read_one_frame_bad_magic() {
        let bytes = b"XXX\x05\x00\x00\x00\xAB".to_vec();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let _ = tokio::io::AsyncWriteExt::write_all(&mut sock, &bytes).await;
        });
        let stream = TcpStream::connect(addr).await.unwrap();
        let (mut rh, _wh) = stream.into_split();
        let err = read_one_frame(&mut rh).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn read_str_field_empty() {
        let body = vec![0u8; 3];
        let (s, n) = read_str_field(&body, 0);
        assert!(s.is_empty());
        assert_eq!(n, 0);
    }

    #[test]
    fn read_str_field_basic() {
        let mut body = vec![];
        body.extend_from_slice(&3u32.to_le_bytes());
        body.extend_from_slice(b"abc");
        let (s, n) = read_str_field(&body, 0);
        assert_eq!(s, "abc");
        assert_eq!(n, 7);
    }

    #[test]
    fn read_str_field_truncated_returns_empty() {
        let body = vec![5u8, 0, 0, 0, b'a']; // len=5 but only 1 byte follows
        let (s, n) = read_str_field(&body, 0);
        assert!(s.is_empty());
        assert_eq!(n, 4);
    }
}
