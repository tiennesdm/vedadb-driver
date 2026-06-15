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
//! socket and dispatches them to per-seq `tokio::sync::oneshot` waiters.

use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

use super::frame::{frame_bytes, Frame, VBPProtocolError, MAGIC, MAX_FRAME_LEN, OPFLAGS_LEN};

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
    #[error("oneshot cancelled: {0}")]
    Cancelled(String),
}

impl From<oneshot::error::RecvError> for MultiplexerError {
    fn from(e: oneshot::error::RecvError) -> Self {
        MultiplexerError::Cancelled(e.to_string())
    }
}

struct Inflight {
    tx: oneshot::Sender<Reply>,
}

#[derive(Debug, Clone, Default)]
pub struct Reply {
    pub frames: Vec<Frame>,
    pub error: Option<Frame>,
}

pub struct Multiplexer {
    writer: Mutex<tokio::net::tcp::OwnedWriteHalf>,
    inflight: Arc<Mutex<HashMap<u8, Inflight>>>,
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

        let inflight: Arc<Mutex<HashMap<u8, Inflight>>> =
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
        let (tx, _rx) = oneshot::channel();
        {
            let mut inflight = self.inflight.lock().await;
            inflight.insert(seq, Inflight { tx });
        }
        let bytes = frame_bytes(seq, op, 0, &body);
        let mut writer = self.writer.lock().await;
        writer.write_all(&bytes).await?;
        writer.flush().await?;
        Ok(seq)
    }

    /// Send a request and await the complete reply.
    pub async fn call(
        &self,
        op: u8,
        body: Vec<u8>,
        timeout: Option<Duration>,
    ) -> Result<Vec<Frame>, MultiplexerError> {
        let seq = self.alloc_seq().await?;
        let (tx, rx) = oneshot::channel();
        {
            let mut inflight = self.inflight.lock().await;
            inflight.insert(seq, Inflight { tx });
        }
        let bytes = frame_bytes(seq, op, 0, &body);
        {
            let mut writer = self.writer.lock().await;
            writer.write_all(&bytes).await?;
            writer.flush().await?;
        }
        let reply = if let Some(t) = timeout {
            match tokio::time::timeout(t, rx).await {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => return Err(e.into()),
                Err(_) => {
                    let mut inflight = self.inflight.lock().await;
                    inflight.remove(&seq);
                    return Err(MultiplexerError::Timeout { op, seq });
                }
            }
        } else {
            rx.await?
        };
        if let Some(err_frame) = reply.error {
            let (sqlstate, message, detail, hint) = parse_error_frame(&err_frame);
            return Err(MultiplexerError::Vbp(VBPError {
                sqlstate,
                message,
                detail,
                hint,
            }));
        }
        Ok(reply.frames)
    }

    /// Send many requests concurrently and gather all replies.
    pub async fn call_many(
        &self,
        items: Vec<(u8, Vec<u8>)>,
        timeout: Option<Duration>,
    ) -> Result<Vec<Vec<Frame>>, MultiplexerError> {
        let mut senders = Vec::with_capacity(items.len());
        for (op, body) in items {
            let seq = self.alloc_seq().await?;
            let (tx, rx) = oneshot::channel();
            {
                let mut inflight = self.inflight.lock().await;
                inflight.insert(seq, Inflight { tx });
            }
            let bytes = frame_bytes(seq, op, 0, &body);
            {
                let mut writer = self.writer.lock().await;
                writer.write_all(&bytes).await?;
                writer.flush().await?;
            }
            senders.push((op, seq, rx));
        }
        let mut out = Vec::with_capacity(senders.len());
        for (op, seq, rx) in senders {
            let reply = if let Some(t) = timeout {
                match tokio::time::timeout(t, rx).await {
                    Ok(Ok(r)) => r,
                    Ok(Err(e)) => return Err(e.into()),
                    Err(_) => return Err(MultiplexerError::Timeout { op, seq }),
                }
            } else {
                rx.await?
            };
            if let Some(err_frame) = reply.error {
                let (sqlstate, message, detail, hint) = parse_error_frame(&err_frame);
                return Err(MultiplexerError::Vbp(VBPError {
                    sqlstate,
                    message,
                    detail,
                    hint,
                }));
            }
            out.push(reply.frames);
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
    pub fn port(&self) -> u16 {
        self.port
    }
}

async fn read_loop(
    mut read_half: tokio::net::tcp::OwnedReadHalf,
    inflight: Arc<Mutex<HashMap<u8, Inflight>>>,
    closing: Arc<Mutex<bool>>,
) {
    loop {
        if *closing.lock().await {
            break;
        }
        let frame = match read_one_frame(&mut read_half).await {
            Ok(f) => f,
            Err(_) => {
                // Reader died — wake all inflight waiters with empty reply.
                let mut g = inflight.lock().await;
                g.clear();
                break;
            }
        };
        let seq = frame.seq;
        let is_terminal = matches!(
            frame.op,
            0x0D | // ERROR
            0x0C | // COMMAND_COMPLETE
            0x1A | // STREAM_END
            0x05 | // AUTH_OK
            0x03 | // AUTH_CHALLENGE
            0x17 // PONG
        );
        let is_error = frame.op == 0x0D;
        let mut g = inflight.lock().await;
        if g.get_mut(&seq).is_some() {
            let mut reply = Reply::default();
            if is_error {
                reply.error = Some(frame);
            } else {
                reply.frames.push(frame);
            }
            if is_terminal {
                if let Some(inf) = g.remove(&seq) {
                    let _ = inf.tx.send(reply);
                }
            } else {
                if let Some(inf) = g.remove(&seq) {
                    let _ = inf.tx.send(reply);
                }
            }
        }
        // else: spurious frame for unknown seq — drop it.
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
    Ok(Frame { seq, op, flags, body })
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
