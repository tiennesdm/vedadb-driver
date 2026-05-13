use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crossbeam::channel::{bounded, Sender, Receiver};

use crate::bulk::{BulkInserter, Pipeline};
use crate::cursor::Cursor;
use crate::error::VedaError;
use crate::pool::VedaPool;
use crate::protocol::{Command, Protocol, ResponsePayload};
use crate::pubsub::PubSub;
use crate::result::{Value, VedaResult};
use crate::uri::VedaUri;

/// Configuration for connecting to a VedaDB server.
#[derive(Debug, Clone)]
pub struct VedaConfig {
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub timeout: Duration,
    pub connect_timeout: Duration,
    pub tls: bool,
    pub tls_verify: bool,
    pub tls_ca_file: Option<String>,
    pub tls_cert_file: Option<String>,
    pub tls_key_file: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub pool_max_size: usize,
    pub retry_max_attempts: usize,
    pub retry_base_delay: Duration,
    pub retry_max_delay: Duration,
    pub app_name: Option<String>,
}

impl VedaConfig {
    /// Create a new config builder.
    pub fn builder() -> VedaConfigBuilder {
        VedaConfigBuilder::default()
    }

    /// Parse a VedaDB URI into configuration.
    pub fn from_uri(uri: &str) -> Result<Self, VedaError> {
        let parsed = VedaUri::parse(uri)?;
        Ok(parsed.into_config())
    }
}

impl Default for VedaConfig {
    fn default() -> Self {
        VedaConfig {
            host: "localhost".to_string(),
            port: 6380,
            database: None,
            timeout: Duration::from_secs(30),
            connect_timeout: Duration::from_secs(10),
            tls: false,
            tls_verify: true,
            tls_ca_file: None,
            tls_cert_file: None,
            tls_key_file: None,
            username: None,
            password: None,
            pool_max_size: 10,
            retry_max_attempts: 3,
            retry_base_delay: Duration::from_millis(100),
            retry_max_delay: Duration::from_secs(5),
            app_name: Some("vedadb-rust".to_string()),
        }
    }
}

/// Builder pattern for VedaConfig.
#[derive(Debug, Clone)]
pub struct VedaConfigBuilder {
    config: VedaConfig,
}

impl Default for VedaConfigBuilder {
    fn default() -> Self {
        VedaConfigBuilder {
            config: VedaConfig::default(),
        }
    }
}

impl VedaConfigBuilder {
    pub fn host(mut self, host: &str) -> Self {
        self.config.host = host.to_string();
        self
    }

    pub fn port(mut self, port: u16) -> Self {
        self.config.port = port;
        self
    }

    pub fn database(mut self, db: &str) -> Self {
        self.config.database = Some(db.to_string());
        self
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.config.timeout = timeout;
        self
    }

    pub fn connect_timeout(mut self, timeout: Duration) -> Self {
        self.config.connect_timeout = timeout;
        self
    }

    pub fn tls(mut self, enabled: bool) -> Self {
        self.config.tls = enabled;
        self
    }

    pub fn tls_verify(mut self, verify: bool) -> Self {
        self.config.tls_verify = verify;
        self
    }

    pub fn username(mut self, username: &str) -> Self {
        self.config.username = Some(username.to_string());
        self
    }

    pub fn password(mut self, password: &str) -> Self {
        self.config.password = Some(password.to_string());
        self
    }

    pub fn pool_max_size(mut self, size: usize) -> Self {
        self.config.pool_max_size = size;
        self
    }

    pub fn retry_max_attempts(mut self, attempts: usize) -> Self {
        self.config.retry_max_attempts = attempts;
        self
    }

    pub fn app_name(mut self, name: &str) -> Self {
        self.config.app_name = Some(name.to_string());
        self
    }

    pub fn build(self) -> Result<VedaConfig, VedaError> {
        if self.config.host.is_empty() {
            return Err(VedaError::Connection {
                message: "host cannot be empty".to_string(),
                host: None,
                port: None,
            });
        }
        Ok(self.config)
    }
}

/// Thread-safe handle for sending async operations to a background worker thread.
pub struct VedaClientHandle {
    cmd_tx: Sender<ClientCommand>,
    connected: Arc<AtomicBool>,
}

/// Commands sent to the background worker thread.
enum ClientCommand {
    Query {
        sql: String,
        params: Option<Vec<Value>>,
        resp: Sender<Result<VedaResult, VedaError>>,
    },
    Execute {
        sql: String,
        params: Option<Vec<Value>>,
        resp: Sender<Result<u64, VedaError>>,
    },
    Ping {
        resp: Sender<Result<Duration, VedaError>>,
    },
    Close,
}

/// Core synchronous VedaDB client with interior mutability for thread safety.
/// All state is protected by Mutex, making the client both Send and Sync
/// without any unsafe code.
pub struct VedaClient {
    config: VedaConfig,
    protocol: Mutex<Option<Protocol>>,
    connected: AtomicBool,
    transaction_active: AtomicBool,
}

impl VedaClient {
    /// Create a new VedaClient from a config (without connecting).
    pub fn new(config: VedaConfig) -> Result<Self, VedaError> {
        Ok(VedaClient {
            config,
            protocol: Mutex::new(None),
            connected: AtomicBool::new(false),
            transaction_active: AtomicBool::new(false),
        })
    }

    /// Connect to the VedaDB server.
    pub fn connect(&self) -> Result<(), VedaError> {
        let addr = format!("{}:{}", self.config.host, self.config.port);
        let tcp = TcpStream::connect_timeout(
            &addr.parse().map_err(|e: std::net::AddrParseError| {
                VedaError::Connection {
                    message: e.to_string(),
                    host: Some(self.config.host.clone()),
                    port: Some(self.config.port),
                }
            })?,
            self.config.connect_timeout,
        )
        .map_err(|e| VedaError::Connection {
            message: e.to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;

        tcp.set_read_timeout(Some(self.config.timeout))?;
        tcp.set_write_timeout(Some(self.config.timeout))?;

        let mut protocol = Protocol::new(tcp)?;
        protocol.handshake()?;

        // TLS upgrade
        if self.config.tls {
            #[cfg(feature = "tokio")]
            {
                protocol.start_tls()?;
            }
            #[cfg(not(feature = "tokio"))]
            {
                return Err(VedaError::Tls(
                    "TLS requires tokio feature".to_string(),
                ));
            }
        }

        // AUTH
        if let (Some(ref username), Some(ref password)) =
            (&self.config.username, &self.config.password)
        {
            protocol.authenticate(username, password)?;
        }

        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        *guard = Some(protocol);
        drop(guard);
        self.connected.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Create and connect from a URI string.
    pub fn from_uri(uri: &str) -> Result<Arc<Self>, VedaError> {
        let config = VedaConfig::from_uri(uri)?;
        let client = VedaClient::new(config)?;
        client.connect()?;
        Ok(Arc::new(client))
    }

    /// Execute a query with optional parameters, returning a full result.
    pub fn query(
        &self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<VedaResult, VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;

        let cmd = Command::Query {
            sql: sql.to_string(),
            params: params.map(|p| p.to_vec()),
        };

        let response = protocol.send_command(&cmd)?;
        drop(guard);
        match response.payload {
            ResponsePayload::Ok(result) => Ok(result),
            _ => Err(VedaError::Protocol(
                "unexpected response type for query".to_string(),
            )),
        }
    }

    /// Execute a statement, returning affected row count.
    pub fn execute(&self, sql: &str, params: Option<&[Value]>) -> Result<u64, VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;

        let cmd = Command::Execute {
            sql: sql.to_string(),
            params: params.map(|p| p.to_vec()),
        };

        let response = protocol.send_command(&cmd)?;
        drop(guard);
        match response.payload {
            ResponsePayload::Ok(result) => Ok(result.row_count as u64),
            _ => Err(VedaError::Protocol(
                "unexpected response type for execute".to_string(),
            )),
        }
    }

    /// Send a raw SQL string (legacy protocol mode).
    pub fn query_raw(&self, sql: &str) -> Result<VedaResult, VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        let result = protocol.send_raw(sql)?;
        drop(guard);
        Ok(result)
    }

    /// Ping the server and return round-trip duration.
    pub fn ping(&self) -> Result<Duration, VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        let result = protocol.ping()?;
        drop(guard);
        Ok(result)
    }

    /// Check if the client is connected.
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    /// Close the connection gracefully.
    pub fn close(&self) {
        let mut guard = self.protocol.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(ref mut protocol) = guard.as_mut() {
            protocol.close();
        }
        drop(guard);
        self.connected.store(false, Ordering::SeqCst);
    }

    /// Reconnect to the server.
    pub fn reconnect(&self) -> Result<(), VedaError> {
        self.close();
        self.connect()
    }

    // --- Transaction Management ---

    /// Begin a transaction.
    pub fn begin(&self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        protocol.send_command(&Command::Begin)?;
        drop(guard);
        self.transaction_active.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Commit the current transaction.
    pub fn commit(&self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        protocol.send_command(&Command::Commit)?;
        drop(guard);
        self.transaction_active.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Rollback the current transaction.
    pub fn rollback(&self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        protocol.send_command(&Command::Rollback)?;
        drop(guard);
        self.transaction_active.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Execute a closure within a transaction.
    pub fn transaction<F, R>(&self, f: F) -> Result<R, VedaError>
    where
        F: FnOnce(&Self) -> Result<R, VedaError>,
    {
        self.begin()?;
        match f(self) {
            Ok(result) => {
                self.commit()?;
                Ok(result)
            }
            Err(e) => {
                let _ = self.rollback();
                Err(e)
            }
        }
    }

    // --- Prepared Statements ---

    /// Prepare a named statement.
    pub fn prepare(&self, name: &str, sql: &str) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        protocol.send_command(&Command::Prepare {
            name: name.to_string(),
            sql: sql.to_string(),
        })?;
        drop(guard);
        Ok(())
    }

    /// Execute a prepared statement with parameters.
    pub fn execute_prepared(
        &self,
        name: &str,
        params: &[Value],
    ) -> Result<VedaResult, VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        let resp = protocol.send_command(&Command::ExecutePrepared {
            name: name.to_string(),
            params: params.to_vec(),
        })?;
        drop(guard);
        match resp.payload {
            ResponsePayload::Ok(result) => Ok(result),
            _ => Err(VedaError::Protocol(
                "unexpected response for execute_prepared".to_string(),
            )),
        }
    }

    /// Deallocate a prepared statement.
    pub fn deallocate(&self, name: &str) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        protocol.send_command(&Command::Deallocate {
            name: name.to_string(),
        })?;
        drop(guard);
        Ok(())
    }

    // --- Feature Factories ---

    /// Create a pipeline for batching commands.
    pub fn pipeline(&self) -> Pipeline {
        Pipeline::new()
    }

    /// Create a bulk inserter for the given table.
    pub fn bulk_insert(&self, table: &str, batch_size: usize) -> BulkInserter {
        BulkInserter::new(table.to_string(), batch_size)
    }

    /// Create a cursor for streaming results.
    pub fn cursor(&self, sql: &str) -> Result<Cursor, VedaError> {
        self.ensure_connected()?;
        let mut guard = self.protocol.lock().map_err(|_| VedaError::Protocol(
            "mutex poisoned".to_string(),
        ))?;
        let protocol = guard.as_mut().ok_or_else(|| VedaError::Connection {
            message: "protocol not initialized".to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;
        let result = Cursor::open(protocol, sql);
        drop(guard);
        result
    }

    /// Create a PubSub handle.
    pub fn pubsub(&self) -> PubSub {
        PubSub::new(self.config.clone())
    }

    /// Create a connection pool from this client's config.
    pub fn create_pool(&self) -> Result<VedaPool, VedaError> {
        VedaPool::new(self.config.clone())
    }

    // --- Private Helpers ---

    fn ensure_connected(&self) -> Result<(), VedaError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: Some(self.config.host.clone()),
                port: Some(self.config.port),
            });
        }
        Ok(())
    }

    /// Get the client configuration.
    pub fn config(&self) -> &VedaConfig {
        &self.config
    }

    /// Insert a single row into a table using parameterized queries.
    /// SECURE: Uses server-side parameter binding to prevent SQL injection.
    pub fn insert(
        &self,
        table: &str,
        data: &[(&str, &dyn std::fmt::Display)],
    ) -> Result<u64, VedaError> {
        if data.is_empty() {
            return Ok(0);
        }
        // Validate table name to prevent injection
        if !is_valid_identifier(table) {
            return Err(VedaError::Query(format!(
                "invalid table name: {}", table
            )));
        }
        let cols: Vec<&str> = data.iter().map(|(k, _)| *k).collect();
        // Validate column names
        for col in &cols {
            if !is_valid_identifier(col) {
                return Err(VedaError::Query(format!(
                    "invalid column name: {}", col
                )));
            }
        }
        // Build parameterized query using ? placeholders
        let placeholders: Vec<String> = (1..=data.len())
            .map(|i| format!("${}", i))
            .collect();

        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({});",
            table,
            cols.join(", "),
            placeholders.join(", ")
        );

        let values: Vec<Value> = data
            .iter()
            .map(|(_, v)| Value::String(v.to_string()))
            .collect();

        self.execute(&sql, Some(&values))
    }

    /// Select rows with optional clauses.
    pub fn select(
        &self,
        table: &str,
        columns: Option<&str>,
        where_clause: Option<&str>,
        order_by: Option<&str>,
        limit: Option<u32>,
    ) -> Result<VedaResult, VedaError> {
        if !is_valid_identifier(table) {
            return Err(VedaError::Query(format!(
                "invalid table name: {}", table
            )));
        }
        let mut sql = format!("SELECT {} FROM {}", columns.unwrap_or("*"), table);
        if let Some(w) = where_clause {
            sql.push_str(&format!(" WHERE {}", w));
        }
        if let Some(o) = order_by {
            sql.push_str(&format!(" ORDER BY {}", o));
        }
        if let Some(l) = limit {
            sql.push_str(&format!(" LIMIT {}", l));
        }
        sql.push(';');
        self.query(&sql, None)
    }

    /// Execute DDL/DML and return the status message.
    pub fn exec(&self, sql: &str) -> Result<String, VedaError> {
        let result = self.query(sql, None)?;
        Ok(result.get_message())
    }

    /// Spawn a background worker thread for async-style communication
    /// using crossbeam channels. Returns a handle for sending commands.
    pub fn spawn_async_worker(self: Arc<Self>) -> VedaClientHandle {
        let (cmd_tx, cmd_rx): (Sender<ClientCommand>, Receiver<ClientCommand>) = bounded(1000);
        let connected = Arc::new(AtomicBool::new(self.connected.load(Ordering::SeqCst)));
        let connected_worker = Arc::clone(&connected);

        thread::spawn(move || {
            while let Ok(cmd) = cmd_rx.recv() {
                match cmd {
                    ClientCommand::Query { sql, params, resp } => {
                        let p: Option<&[Value]> = params.as_deref();
                        let result = self.query(&sql, p);
                        let _ = resp.send(result);
                    }
                    ClientCommand::Execute { sql, params, resp } => {
                        let p: Option<&[Value]> = params.as_deref();
                        let result = self.execute(&sql, p);
                        let _ = resp.send(result);
                    }
                    ClientCommand::Ping { resp } => {
                        let result = self.ping();
                        let _ = resp.send(result);
                    }
                    ClientCommand::Close => {
                        self.close();
                        connected_worker.store(false, Ordering::SeqCst);
                        break;
                    }
                }
            }
        });

        VedaClientHandle { cmd_tx, connected }
    }
}

impl Drop for VedaClient {
    fn drop(&mut self) {
        self.close();
    }
}

// VedaClient is naturally Send + Sync because all fields are:
// - VedaConfig: Send + Sync (plain data)
// - Mutex<Option<Protocol>>: Send + Sync (Mutex provides both)
// - AtomicBool: Send + Sync
// No unsafe code required.

/// Validate a SQL identifier (table/column name) to prevent injection.
fn is_valid_identifier(ident: &str) -> bool {
    if ident.is_empty() {
        return false;
    }
    let mut chars = ident.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphabetic() && first != '_' {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Safe, asynchronous-style query via crossbeam channels.
impl VedaClientHandle {
    /// Execute a query asynchronously via the worker thread.
    pub fn query_async(
        &self,
        sql: String,
        params: Option<Vec<Value>>,
    ) -> Result<VedaResult, VedaError> {
        let (tx, rx) = bounded(1);
        self.cmd_tx
            .send(ClientCommand::Query { sql, params, resp: tx })
            .map_err(|_| VedaError::Connection {
                message: "async worker thread has shut down".to_string(),
                host: None,
                port: None,
            })?;
        rx.recv().map_err(|_| VedaError::Connection {
            message: "async worker did not respond".to_string(),
            host: None,
            port: None,
        })?
    }

    /// Execute a statement asynchronously.
    pub fn execute_async(
        &self,
        sql: String,
        params: Option<Vec<Value>>,
    ) -> Result<u64, VedaError> {
        let (tx, rx) = bounded(1);
        self.cmd_tx
            .send(ClientCommand::Execute { sql, params, resp: tx })
            .map_err(|_| VedaError::Connection {
                message: "async worker thread has shut down".to_string(),
                host: None,
                port: None,
            })?;
        rx.recv().map_err(|_| VedaError::Connection {
            message: "async worker did not respond".to_string(),
            host: None,
            port: None,
        })?
    }

    /// Ping asynchronously.
    pub fn ping_async(&self) -> Result<Duration, VedaError> {
        let (tx, rx) = bounded(1);
        self.cmd_tx
            .send(ClientCommand::Ping { resp: tx })
            .map_err(|_| VedaError::Connection {
                message: "async worker thread has shut down".to_string(),
                host: None,
                port: None,
            })?;
        rx.recv().map_err(|_| VedaError::Connection {
            message: "async worker did not respond".to_string(),
            host: None,
            port: None,
        })?
    }

    /// Close the async worker.
    pub fn close(&self) {
        let _ = self.cmd_tx.send(ClientCommand::Close);
    }

    /// Check if the worker is still connected.
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
