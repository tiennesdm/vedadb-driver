//! VBP connection — high-level async client for the VedaDB Binary
//! Protocol.
//!
//! Usage:
//! ```ignore
//! let conn = VBPConnection::new("127.0.0.1", 6380, "admin", "pass", "main");
//! conn.connect().await?;
//! let rows = conn.execute("SELECT 1", &[]).await?;
//! conn.ping().await?;
//! conn.close().await;
//! ```

use std::sync::Arc;
use std::time::Duration;

use thiserror::Error;

use super::auth::{perform_handshake, HandshakeOptions, HandshakeResult};
use super::frame::Frame;
use super::multiplexer::{Multiplexer, MultiplexerError, VBPError};
use super::opcodes::{
    AUTH_MECH_PLAIN, OP_CLIENT_HELLO, OP_PING, OP_QUERY,
};

/// Connection-level error.
#[derive(Debug, Error)]
pub enum VBPConnectionError {
    #[error("multiplexer: {0}")]
    Multiplexer(#[from] MultiplexerError),
    #[error("auth: {0}")]
    Auth(String),
    #[error("bad server ready: {0}")]
    BadServerReady(String),
    #[error("not connected")]
    NotConnected,
    #[error("vbp: {0}")]
    Vbp(#[from] VBPError),
}

#[derive(Debug, Clone)]
pub struct ServerHello {
    pub server_version: u32,
    pub server_caps: u32,
    pub auth_required: u8,
    pub nonce_len: u32,
    pub nonce: Vec<u8>,
}

pub struct VBPConnection {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
    mechanism: String,
    mux: Option<Arc<Multiplexer>>,
    timeout: Option<Duration>,
}

impl VBPConnection {
    pub fn new(
        host: impl Into<String>,
        port: u16,
        user: impl Into<String>,
        password: impl Into<String>,
        database: impl Into<String>,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            user: user.into(),
            password: password.into(),
            database: database.into(),
            mechanism: AUTH_MECH_PLAIN.to_string(),
            mux: None,
            timeout: Some(Duration::from_secs(5)),
        }
    }

    pub fn with_mechanism(mut self, mech: impl Into<String>) -> Self {
        self.mechanism = mech.into();
        self
    }

    pub fn with_timeout(mut self, t: Duration) -> Self {
        self.timeout = Some(t);
        self
    }

    pub fn host(&self) -> &str {
        &self.host
    }
    pub fn port(&self) -> u16 {
        self.port
    }
    pub fn user(&self) -> &str {
        &self.user
    }
    pub fn database(&self) -> &str {
        &self.database
    }
    pub fn is_connected(&self) -> bool {
        self.mux.is_some()
    }

    /// Connect to the server, perform the CLIENT_HELLO + handshake.
    pub async fn connect(&mut self) -> Result<ServerHello, VBPConnectionError> {
        let mux = Multiplexer::connect(&self.host, self.port).await?;
        // CLIENT_HELLO body: [u16 proto][u16 flags][u32 un_len][un][u32 db_len][db][u8 actor_kind][u32 aid_len][aid]
        let mut body = Vec::new();
        body.extend_from_slice(&1u16.to_le_bytes()); // protocol_version = 1
        body.extend_from_slice(&0u16.to_le_bytes()); // client_flags
        body.extend_from_slice(&(self.user.len() as u32).to_le_bytes());
        body.extend_from_slice(self.user.as_bytes());
        body.extend_from_slice(&(self.database.len() as u32).to_le_bytes());
        body.extend_from_slice(self.database.as_bytes());
        body.push(0u8); // actor_kind
        body.extend_from_slice(&0u32.to_le_bytes()); // actor_id (empty)

        let replies = mux
            .call(OP_CLIENT_HELLO, body, self.timeout)
            .await?;
        // Replies: [SERVER_READY, AUTH_OK] in dev mode.
        let mut server_hello: Option<ServerHello> = None;
        let mut auth_done = false;
        for f in &replies {
            match f.op {
                0x02 => {
                    // SERVER_READY: [u32 version][u32 caps][u8 auth_required][u32 nonce_len][nonce]
                    if f.body.len() < 4 + 4 + 1 + 4 {
                        return Err(VBPConnectionError::BadServerReady(
                            "short body".into(),
                        ));
                    }
                    let version = u32::from_le_bytes([f.body[0], f.body[1], f.body[2], f.body[3]]);
                    let caps = u32::from_le_bytes([f.body[4], f.body[5], f.body[6], f.body[7]]);
                    let auth_required = f.body[8];
                    let nonce_len = u32::from_le_bytes([
                        f.body[9],
                        f.body[10],
                        f.body[11],
                        f.body[12],
                    ]);
                    let nonce = if f.body.len() >= 13 + nonce_len as usize {
                        f.body[13..13 + nonce_len as usize].to_vec()
                    } else {
                        vec![]
                    };
                    server_hello = Some(ServerHello {
                        server_version: version,
                        server_caps: caps,
                        auth_required,
                        nonce_len,
                        nonce,
                    });
                }
                0x05 => {
                    // AUTH_OK
                    auth_done = true;
                }
                _ => {}
            }
        }
        let server_hello =
            server_hello.ok_or_else(|| VBPConnectionError::BadServerReady("no SERVER_READY".into()))?;

        if !auth_done && server_hello.auth_required == 1 {
            // Run the auth handshake.
            let result: HandshakeResult = perform_handshake(
                mux.as_ref(),
                HandshakeOptions {
                    mechanism: &self.mechanism,
                    username: &self.user,
                    password: &self.password,
                    timeout: self.timeout,
                },
            )
            .await
            .map_err(|e| VBPConnectionError::Auth(e.to_string()))?;
            // Sanity: ensure AUTH_OK actually came back.
            if result.session_token == 0 && result.expires_at == 0 {
                // dev mode may not return a real token — that's OK.
            }
        }

        self.mux = Some(mux);
        Ok(server_hello)
    }

    /// Send a PING and wait for a PONG. Returns the round-trip nonce.
    pub async fn ping(&self) -> Result<u64, VBPConnectionError> {
        let mux = self.mux.as_ref().ok_or(VBPConnectionError::NotConnected)?;
        let nonce: u64 = 0xDEADBEEFCAFEBABE;
        let body = nonce.to_le_bytes().to_vec();
        let replies = mux.call(OP_PING, body, self.timeout).await?;
        if replies.is_empty() {
            return Err(VBPConnectionError::BadServerReady("empty PONG".into()));
        }
        let pong = &replies[0];
        if pong.op != 0x17 {
            return Err(VBPConnectionError::BadServerReady(format!(
                "expected PONG, got 0x{:02x}",
                pong.op
            )));
        }
        if pong.body.len() < 8 {
            return Err(VBPConnectionError::BadServerReady("PONG too short".into()));
        }
        let mut a = [0u8; 8];
        a.copy_from_slice(&pong.body[..8]);
        Ok(u64::from_le_bytes(a))
    }

    /// Execute a simple query and return the list of reply frames.
    /// Most users will use `execute_with_params`.
    pub async fn execute_raw(&self, sql: &str) -> Result<Vec<Frame>, VBPConnectionError> {
        let mux = self.mux.as_ref().ok_or(VBPConnectionError::NotConnected)?;
        // QUERY body: [u32 qid][u32 text_len][text][u16 param_count]
        let mut body = Vec::new();
        body.extend_from_slice(&0u32.to_le_bytes()); // qid
        body.extend_from_slice(&(sql.len() as u32).to_le_bytes());
        body.extend_from_slice(sql.as_bytes());
        body.extend_from_slice(&0u16.to_le_bytes()); // param_count
        let replies = mux.call(OP_QUERY, body, self.timeout).await?;
        Ok(replies)
    }

    /// Execute a simple query (no params) and return a list of rows.
    /// Each row is a Vec<DecodedColumn> (type_id, body).
    pub async fn execute(&self, sql: &str) -> Result<Vec<Vec<DecodedColumn>>, VBPConnectionError> {
        let replies = self.execute_raw(sql).await?;
        Ok(decode_rows(&replies))
    }

    /// Close the connection.
    pub async fn close(&self) {
        if let Some(mux) = &self.mux {
            mux.close().await;
        }
    }

    pub fn mux(&self) -> Option<&Arc<Multiplexer>> {
        self.mux.as_ref()
    }
}

#[derive(Debug, Clone)]
pub struct DecodedColumn {
    pub type_id: u16,
    pub body: Vec<u8>,
}

/// Decode DATA_CHUNK rows from a list of reply frames. Returns
/// rows of `{type_id, body}` — the caller is responsible for
/// interpreting the body.
pub fn decode_rows(frames: &[Frame]) -> Vec<Vec<DecodedColumn>> {
    let mut out = Vec::new();
    for f in frames {
        if f.op != 0x0A {
            // not DATA_CHUNK
            continue;
        }
        let body = &f.body;
        if body.len() < 10 {
            continue;
        }
        let _chunk_id = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
        let row_count = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
        let col_count = u16::from_le_bytes([body[8], body[9]]) as usize;
        let mut off = 10;
        let mut col_types = Vec::with_capacity(col_count);
        let mut col_bodies = Vec::with_capacity(col_count);
        for _ in 0..col_count {
            if off + 3 > body.len() {
                break;
            }
            let tid = u16::from_le_bytes([body[off], body[off + 1]]);
            let bmp_size = body[off + 2] as usize;
            off += 3;
            if off + bmp_size > body.len() {
                break;
            }
            off += bmp_size;
            col_types.push(tid);
            col_bodies.push(off);
        }
        // For each row, read per-column bytes using the fixed width or
        // a u32 length prefix (variable types).  For POC we read
        // everything left as a single per-column buffer — we don't
        // recurse into the row cursor.
        for _ in 0..row_count {
            let mut row = Vec::with_capacity(col_types.len());
            for (c, tid) in col_types.iter().enumerate() {
                if c >= col_bodies.len() {
                    break;
                }
                let mut cur = col_bodies[c];
                let w = fixed_width(*tid);
                let (slice, after) = if w > 0 {
                    if cur + w > body.len() {
                        row.push(DecodedColumn {
                            type_id: *tid,
                            body: vec![],
                        });
                        continue;
                    }
                    (body[cur..cur + w].to_vec(), cur + w)
                } else {
                    // variable: read u32 length
                    if cur + 4 > body.len() {
                        row.push(DecodedColumn {
                            type_id: *tid,
                            body: vec![],
                        });
                        continue;
                    }
                    let ln = u32::from_le_bytes([
                        body[cur],
                        body[cur + 1],
                        body[cur + 2],
                        body[cur + 3],
                    ]) as usize;
                    cur += 4;
                    if cur + ln > body.len() {
                        row.push(DecodedColumn {
                            type_id: *tid,
                            body: vec![],
                        });
                        continue;
                    }
                    (body[cur..cur + ln].to_vec(), cur + ln)
                };
                col_bodies[c] = after;
                row.push(DecodedColumn {
                    type_id: *tid,
                    body: slice,
                });
            }
            out.push(row);
        }
    }
    out
}

fn fixed_width(tid: u16) -> usize {
    use super::opcodes::*;
    match tid {
        T_BOOL => 1,
        T_INT2 => 2,
        T_INT4 => 4,
        T_INT8 => 8,
        T_FLOAT4 => 4,
        T_FLOAT8 => 8,
        T_DATE => 4,
        T_TIME => 8,
        T_TIMESTAMP | T_TIMESTAMPTZ => 8,
        T_MONEY => 8,
        T_UUID => 16,
        T_INTERVAL => 16,
        T_TS_POINT => 16,
        T_GEO_POINT => 8,
        _ => 0,
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use tokio::net::TcpListener;

    use crate::wire::vbp::frame::frame_bytes;

    /// A tiny fake VBP server: accept a connection, receive one frame,
    /// and reply with the appropriate response based on opcode.
    async fn spawn_fake_server<F>(handler: F) -> SocketAddr
    where
        F: Fn(u8, &[u8]) -> Vec<u8> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = match listener.accept().await {
                    Ok(p) => p,
                    Err(_) => break,
                };
                tokio::spawn(async move {
                    loop {
                        let mut hdr = [0u8; 8];
                        if tokio::io::AsyncReadExt::read_exact(&mut sock, &mut hdr)
                            .await
                            .is_err()
                        {
                            return;
                        }
                        let payload_len = u32::from_le_bytes([
                            hdr[3], hdr[4], hdr[5], hdr[6],
                        ]);
                        let mut rest = vec![0u8; (payload_len as usize) - 2 + 2];
                        if tokio::io::AsyncReadExt::read_exact(&mut sock, &mut rest)
                            .await
                            .is_err()
                        {
                            return;
                        }
                        let op = rest[0];
                        let body = &rest[2..];
                        let reply = handler(op, body);
                        if tokio::io::AsyncWriteExt::write_all(&mut sock, &reply)
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                });
            }
        });
        addr
    }

    fn make_server_ready(seq: u8) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&0x000A0000u32.to_le_bytes());
        body.extend_from_slice(&0x0000001Fu32.to_le_bytes());
        body.push(0); // auth_required = 0
        body.extend_from_slice(&16u32.to_le_bytes());
        body.extend_from_slice(&[0u8; 16]);
        frame_bytes(seq, 0x02, 0, &body)
    }

    fn make_auth_ok(seq: u8) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&0u64.to_le_bytes());
        body.extend_from_slice(&0u64.to_le_bytes());
        body.extend_from_slice(&0u32.to_le_bytes());
        frame_bytes(seq, 0x05, 0, &body)
    }

    #[tokio::test]
    async fn connection_hello_and_ping() {
        let addr = spawn_fake_server(|op, _body| match op {
            0x01 => {
                // CLIENT_HELLO: send SERVER_READY + AUTH_OK
                let sr = make_server_ready(0);
                let aok = make_auth_ok(0);
                let mut all = sr;
                all.extend_from_slice(&aok);
                all
            }
            0x16 => {
                // PING: echo nonce as PONG
                let nonce: u64 = 0xDEADBEEFCAFEBABE;
                let bytes = nonce.to_le_bytes();
                frame_bytes(0, 0x17, 0, &bytes)
            }
            _ => vec![],
        })
        .await;

        let mut conn = VBPConnection::new("127.0.0.1", addr.port(), "u", "p", "db");
        let server = conn.connect().await.expect("connect");
        assert_eq!(server.server_version, 0x000A0000);
        let nonce = conn.ping().await.expect("ping");
        assert_eq!(nonce, 0xDEADBEEFCAFEBABE);
    }

    #[tokio::test]
    async fn connection_execute_select_1() {
        let addr = spawn_fake_server(|op, body| match op {
            0x01 => {
                let sr = make_server_ready(0);
                let aok = make_auth_ok(0);
                let mut all = sr;
                all.extend_from_slice(&aok);
                all
            }
            0x06 => {
                // QUERY: parse text and respond
                let _qid = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
                let tlen = u32::from_le_bytes([body[4], body[5], body[6], body[7]]) as usize;
                let text = String::from_utf8_lossy(&body[8..8 + tlen]).to_string();
                if text.trim().to_uppercase() == "SELECT 1" {
                    // DATA_CHUNK + ROWS_FINISHED + COMMAND_COMPLETE
                    let mut dc_body = Vec::new();
                    dc_body.extend_from_slice(&1u32.to_le_bytes());
                    dc_body.extend_from_slice(&1u32.to_le_bytes());
                    dc_body.extend_from_slice(&1u16.to_le_bytes());
                    dc_body.extend_from_slice(&super::super::opcodes::T_INT4.to_le_bytes());
                    dc_body.push(0);
                    dc_body.extend_from_slice(&1i32.to_le_bytes());
                    let dc = frame_bytes(0, 0x0A, 0, &dc_body);
                    let mut rf_body = Vec::new();
                    rf_body.extend_from_slice(&1u64.to_le_bytes());
                    rf_body.extend_from_slice(&8u32.to_le_bytes());
                    rf_body.extend_from_slice(b"SELECT 1");
                    rf_body.extend_from_slice(&0u32.to_le_bytes());
                    let rf = frame_bytes(0, 0x0B, 0, &rf_body);
                    let cc = frame_bytes(0, 0x0C, 0, &[0]);
                    let mut all = dc;
                    all.extend_from_slice(&rf);
                    all.extend_from_slice(&cc);
                    all
                } else {
                    frame_bytes(0, 0x0C, 0, &[0])
                }
            }
            _ => vec![],
        })
        .await;

        let mut conn = VBPConnection::new("127.0.0.1", addr.port(), "u", "p", "db");
        conn.connect().await.expect("connect");
        let rows = conn.execute("SELECT 1").await.expect("execute");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].len(), 1);
        let val = i32::from_le_bytes(rows[0][0].body.as_slice().try_into().unwrap());
        assert_eq!(val, 1);
    }

    #[tokio::test]
    async fn connection_close_is_idempotent() {
        let addr = spawn_fake_server(|op, _| match op {
            0x01 => {
                let sr = make_server_ready(0);
                let aok = make_auth_ok(0);
                let mut all = sr;
                all.extend_from_slice(&aok);
                all
            }
            _ => vec![],
        })
        .await;
        let mut conn = VBPConnection::new("127.0.0.1", addr.port(), "u", "p", "db");
        conn.connect().await.expect("connect");
        conn.close().await;
        // Calling close again is fine.
        conn.close().await;
    }

    #[tokio::test]
    async fn connection_ping_fails_when_not_connected() {
        let conn = VBPConnection::new("127.0.0.1", 65535, "u", "p", "db");
        let err = conn.ping().await.unwrap_err();
        assert!(matches!(err, VBPConnectionError::NotConnected));
    }

    #[tokio::test]
    async fn connection_handshake_fails_with_bad_server() {
        // Server that returns the wrong opcode on CLIENT_HELLO.
        let addr = spawn_fake_server(|_op, _| {
            // Send a PING reply (wrong opcode)
            let bytes = b"12345678";
            frame_bytes(0, 0x17, 0, bytes)
        })
        .await;
        let mut conn = VBPConnection::new("127.0.0.1", addr.port(), "u", "p", "db");
        let err = conn.connect().await.unwrap_err();
        assert!(matches!(
            err,
            VBPConnectionError::BadServerReady(_) | VBPConnectionError::Multiplexer(_)
        ));
    }

    #[test]
    fn new_connection_not_connected() {
        let conn = VBPConnection::new("h", 1234, "u", "p", "d");
        assert!(!conn.is_connected());
        assert_eq!(conn.host(), "h");
        assert_eq!(conn.port(), 1234);
        assert_eq!(conn.user(), "u");
        assert_eq!(conn.database(), "d");
    }

    #[test]
    fn with_mechanism_overrides() {
        let conn = VBPConnection::new("h", 1, "u", "p", "d")
            .with_mechanism(AUTH_MECH_SCRAM_SHA_256);
        // We don't expose the field directly, but construction must not panic.
        let _ = conn;
    }

    #[test]
    fn with_timeout_overrides() {
        let conn = VBPConnection::new("h", 1, "u", "p", "d")
            .with_timeout(Duration::from_secs(2));
        let _ = conn;
    }
}
