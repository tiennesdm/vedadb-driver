use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::VedaError;
use crate::result::{Value, VedaResult};

/// Wire protocol version.
pub const PROTOCOL_VERSION: u16 = 1;

/// Magic bytes sent at the start of every connection.
pub const MAGIC_BYTES: &[u8] = b"VEDA\x01";

/// Command types on the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Command {
    Query { sql: String, params: Option<Vec<Value>> },
    Execute { sql: String, params: Option<Vec<Value>> },
    Prepare { name: String, sql: String },
    ExecutePrepared { name: String, params: Vec<Value> },
    Deallocate { name: String },
    Begin,
    Commit,
    Rollback,
    Ping,
    StartTls,
    Auth { username: String, password: String },
    Subscribe { channel: String },
    Unsubscribe { channel: String },
    Publish { channel: String, message: String },
    Watch { table: String },
    Unwatch { table: String },
    CacheSet { key: String, value: String, ttl: Option<u64> },
    CacheGet { key: String },
    CacheDel { key: String },
    CacheKeys { pattern: String },
    BulkInsert { table: String, columns: Vec<String>, rows: Vec<Vec<Value>> },
    CursorOpen { sql: String },
    CursorFetch { cursor_id: String, count: usize },
    CursorClose { cursor_id: String },
    Quit,
}

/// Frame represents a single protocol frame on the wire.
#[derive(Debug)]
pub struct Frame {
    pub cmd: Command,
    pub request_id: u64,
}

/// Wire-level response frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseFrame {
    pub request_id: u64,
    #[serde(flatten)]
    pub payload: ResponsePayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponsePayload {
    Ok(VedaResult),
    Error { code: String, message: String },
    Pong { latency_us: u64 },
    TlsReady,
    AuthOk,
    Event(ChangeEventPayload),
    CursorChunk { cursor_id: String, rows: Vec<Vec<Value>>, has_more: bool },
    Subscribed { channel: String },
    Published { channel: String, listeners: usize },
    Message { channel: String, payload: String },
    CacheHit { key: String, value: String },
    CacheMiss { key: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeEventPayload {
    pub table: String,
    pub op: String,
    pub row: serde_json::Value,
    pub timestamp: u64,
    pub tx_id: Option<u64>,
}

/// Core protocol handler for VedaDB wire format.
pub struct Protocol {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
    request_counter: u64,
    pub connected: bool,
}

impl Protocol {
    /// Create a new Protocol from an established TCP stream.
    pub fn new(stream: TcpStream) -> Result<Self, VedaError> {
        stream.set_read_timeout(Some(Duration::from_secs(30)))?;
        stream.set_write_timeout(Some(Duration::from_secs(30)))?;
        let writer = stream.try_clone().map_err(|e| VedaError::Io(e.to_string()))?;
        let reader = BufReader::new(stream);
        Ok(Protocol {
            reader,
            writer,
            request_counter: 0,
            connected: false,
        })
    }

    /// Send the protocol handshake.
    pub fn handshake(&mut self) -> Result<(), VedaError> {
        self.writer.write_all(MAGIC_BYTES)?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()?;

        let mut response = String::new();
        self.reader.read_line(&mut response).map_err(|e| {
            VedaError::Connection {
                message: format!("handshake failed: {}", e),
                host: None,
                port: None,
            }
        })?;

        if response.trim().is_empty() {
            return Err(VedaError::Protocol(
                "empty handshake response".to_string(),
            ));
        }

        let parsed: serde_json::Value = serde_json::from_str(response.trim())?;
        if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
            return Err(VedaError::Protocol(format!(
                "server rejected handshake: {}",
                err
            )));
        }

        self.connected = true;
        Ok(())
    }

    /// Send a command and await the response.
    pub fn send_command(&mut self, cmd: &Command) -> Result<ResponseFrame, VedaError> {
        self.request_counter += 1;
        let request_id = self.request_counter;

        let envelope = serde_json::json!({
            "version": PROTOCOL_VERSION,
            "request_id": request_id,
            "command": cmd,
        });

        let line = envelope.to_string();
        self.writer.write_all(line.as_bytes())?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()?;

        let mut response = String::new();
        self.reader.read_line(&mut response).map_err(|e| {
            VedaError::Io(format!("read response failed: {}", e))
        })?;

        if response.trim().is_empty() {
            return Err(VedaError::Protocol("empty response".to_string()));
        }

        let parsed: ResponseFrame = serde_json::from_str(response.trim())?;

        // Verify request_id matches
        if parsed.request_id != request_id {
            return Err(VedaError::Protocol(format!(
                "request_id mismatch: expected {}, got {}",
                request_id, parsed.request_id
            )));
        }

        match &parsed.payload {
            ResponsePayload::Error { code, message } => {
                Err(VedaError::Query(format!("[{}] {}", code, message)))
            }
            _ => Ok(parsed),
        }
    }

    /// Send a raw query string (legacy mode).
    pub fn send_raw(&mut self, sql: &str) -> Result<VedaResult, VedaError> {
        self.writer.write_all(sql.as_bytes())?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()?;

        let mut response = String::new();
        self.reader.read_line(&mut response).map_err(|e| {
            VedaError::Io(format!("read response failed: {}", e))
        })?;

        if response.trim().is_empty() {
            return Err(VedaError::Protocol("empty response".to_string()));
        }

        let result: VedaResult = serde_json::from_str(response.trim())?;
        if let Some(ref error) = result.error {
            return Err(VedaError::Query(error.clone()));
        }

        Ok(result)
    }

    /// Send a ping and measure round-trip time.
    pub fn ping(&mut self) -> Result<Duration, VedaError> {
        let start = std::time::Instant::now();
        let resp = self.send_command(&Command::Ping)?;
        let elapsed = start.elapsed();

        match resp.payload {
            ResponsePayload::Pong { latency_us } => {
                Ok(Duration::from_micros(latency_us))
            }
            _ => Ok(elapsed),
        }
    }

    /// Start TLS handshake.
    pub fn start_tls(&mut self) -> Result<(), VedaError> {
        let resp = self.send_command(&Command::StartTls)?;
        match resp.payload {
            ResponsePayload::TlsReady => Ok(()),
            _ => Err(VedaError::Tls("TLS handshake refused".to_string())),
        }
    }

    /// Authenticate with the server.
    pub fn authenticate(&mut self, username: &str, password: &str) -> Result<(), VedaError> {
        let resp = self.send_command(&Command::Auth {
            username: username.to_string(),
            password: password.to_string(),
        })?;
        match resp.payload {
            ResponsePayload::AuthOk => Ok(()),
            _ => Err(VedaError::Auth(
                "authentication rejected".to_string(),
            )),
        }
    }

    /// Read the next raw line from the server (used for pub/sub and change streams).
    pub fn read_line(&mut self) -> Result<String, VedaError> {
        let mut line = String::new();
        self.reader.read_line(&mut line)?;
        Ok(line)
    }

    /// Send a QUIT command and close the connection.
    pub fn close(&mut self) {
        let _ = self.send_command(&Command::Quit);
        self.connected = false;
    }

    /// Check if the underlying connection is alive.
    pub fn is_alive(&mut self) -> bool {
        match self.ping() {
            Ok(_) => true,
            Err(_) => {
                self.connected = false;
                false
            }
        }
    }
}

/// Async protocol wrapper for tokio-based connections.
#[cfg(feature = "tokio")]
pub mod async_protocol {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpStream;

    pub struct AsyncProtocol {
        reader: BufReader<tokio::net::tcp::OwnedReadHalf>,
        writer: tokio::net::tcp::OwnedWriteHalf,
        request_counter: u64,
        pub connected: bool,
    }

    impl AsyncProtocol {
        pub fn new(stream: TcpStream) -> Result<Self, VedaError> {
            let (read_half, write_half) = stream.into_split();
            Ok(AsyncProtocol {
                reader: BufReader::new(read_half),
                writer: write_half,
                request_counter: 0,
                connected: false,
            })
        }

        pub async fn handshake(&mut self) -> Result<(), VedaError> {
            self.writer.write_all(MAGIC_BYTES).await?;
            self.writer.write_all(b"\n").await?;
            self.writer.flush().await?;

            let mut response = String::new();
            self.reader.read_line(&mut response).await.map_err(|e| {
                VedaError::Connection {
                    message: format!("async handshake failed: {}", e),
                    host: None,
                    port: None,
                }
            })?;

            if response.trim().is_empty() {
                return Err(VedaError::Protocol(
                    "empty handshake response".to_string(),
                ));
            }

            let parsed: serde_json::Value = serde_json::from_str(response.trim())?;
            if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
                return Err(VedaError::Protocol(format!(
                    "server rejected handshake: {}",
                    err
                )));
            }

            self.connected = true;
            Ok(())
        }

        pub async fn send_command(
            &mut self,
            cmd: &Command,
        ) -> Result<ResponseFrame, VedaError> {
            self.request_counter += 1;
            let request_id = self.request_counter;

            let envelope = serde_json::json!({
                "version": PROTOCOL_VERSION,
                "request_id": request_id,
                "command": cmd,
            });

            let line = envelope.to_string();
            self.writer.write_all(line.as_bytes()).await?;
            self.writer.write_all(b"\n").await?;
            self.writer.flush().await?;

            let mut response = String::new();
            self.reader.read_line(&mut response).await.map_err(|e| {
                VedaError::Io(format!("async read response failed: {}", e))
            })?;

            if response.trim().is_empty() {
                return Err(VedaError::Protocol("empty response".to_string()));
            }

            let parsed: ResponseFrame = serde_json::from_str(response.trim())?;

            if parsed.request_id != request_id {
                return Err(VedaError::Protocol(format!(
                    "request_id mismatch: expected {}, got {}",
                    request_id, parsed.request_id
                )));
            }

            match &parsed.payload {
                ResponsePayload::Error { code, message } => {
                    Err(VedaError::Query(format!("[{}] {}", code, message)))
                }
                _ => Ok(parsed),
            }
        }

        pub async fn send_raw(&mut self, sql: &str) -> Result<VedaResult, VedaError> {
            self.writer.write_all(sql.as_bytes()).await?;
            self.writer.write_all(b"\n").await?;
            self.writer.flush().await?;

            let mut response = String::new();
            self.reader.read_line(&mut response).await.map_err(|e| {
                VedaError::Io(format!("async read response failed: {}", e))
            })?;

            if response.trim().is_empty() {
                return Err(VedaError::Protocol("empty response".to_string()));
            }

            let result: VedaResult = serde_json::from_str(response.trim())?;
            if let Some(ref error) = result.error {
                return Err(VedaError::Query(error.clone()));
            }

            Ok(result)
        }

        pub async fn ping(&mut self) -> Result<Duration, VedaError> {
            let start = std::time::Instant::now();
            let resp = self.send_command(&Command::Ping).await?;
            let elapsed = start.elapsed();

            match resp.payload {
                ResponsePayload::Pong { latency_us } => {
                    Ok(Duration::from_micros(latency_us))
                }
                _ => Ok(elapsed),
            }
        }

        pub async fn read_line(&mut self) -> Result<String, VedaError> {
            let mut line = String::new();
            self.reader.read_line(&mut line).await?;
            Ok(line)
        }

        pub async fn close(&mut self) {
            let _ = self.send_command(&Command::Quit).await;
            self.connected = false;
        }
    }
}
