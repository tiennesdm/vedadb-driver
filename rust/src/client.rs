use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

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

/// Core synchronous VedaDB client.
pub struct VedaClient {
    config: VedaConfig,
    protocol: Option<Protocol>,
    connected: AtomicBool,
    transaction_active: AtomicBool,
}

impl VedaClient {
    /// Create a new VedaClient from a config (without connecting).
    pub fn new(config: VedaConfig) -> Result<Self, VedaError> {
        Ok(VedaClient {
            config,
            protocol: None,
            connected: AtomicBool::new(false),
            transaction_active: AtomicBool::new(false),
        })
    }

    /// Connect to the VedaDB server.
    pub fn connect(&mut self) -> Result<(), VedaError> {
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

        self.protocol = Some(protocol);
        self.connected.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Create and connect from a URI string.
    pub fn from_uri(uri: &str) -> Result<Self, VedaError> {
        let config = VedaConfig::from_uri(uri)?;
        let mut client = VedaClient::new(config)?;
        client.connect()?;
        Ok(client)
    }

    /// Execute a query with optional parameters, returning a full result.
    pub fn query(
        &mut self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<VedaResult, VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();

        let cmd = Command::Query {
            sql: sql.to_string(),
            params: params.map(|p| p.to_vec()),
        };

        let response = protocol.send_command(&cmd)?;
        match response.payload {
            ResponsePayload::Ok(result) => Ok(result),
            _ => Err(VedaError::Protocol(
                "unexpected response type for query".to_string(),
            )),
        }
    }

    /// Execute a statement, returning affected row count.
    pub fn execute(&mut self, sql: &str, params: Option<&[Value]>) -> Result<u64, VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();

        let cmd = Command::Execute {
            sql: sql.to_string(),
            params: params.map(|p| p.to_vec()),
        };

        let response = protocol.send_command(&cmd)?;
        match response.payload {
            ResponsePayload::Ok(result) => Ok(result.row_count as u64),
            _ => Err(VedaError::Protocol(
                "unexpected response type for execute".to_string(),
            )),
        }
    }

    /// Send a raw SQL string (legacy protocol mode).
    pub fn query_raw(&mut self, sql: &str) -> Result<VedaResult, VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_raw(sql)
    }

    /// Ping the server and return round-trip duration.
    pub fn ping(&mut self) -> Result<Duration, VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.ping()
    }

    /// Check if the client is connected.
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    /// Close the connection gracefully.
    pub fn close(&mut self) {
        if let Some(ref mut protocol) = self.protocol {
            protocol.close();
        }
        self.connected.store(false, Ordering::SeqCst);
    }

    /// Reconnect to the server.
    pub fn reconnect(&mut self) -> Result<(), VedaError> {
        self.close();
        self.connect()
    }

    // --- Transaction Management ---

    /// Begin a transaction.
    pub fn begin(&mut self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_command(&Command::Begin)?;
        self.transaction_active.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Commit the current transaction.
    pub fn commit(&mut self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_command(&Command::Commit)?;
        self.transaction_active.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Rollback the current transaction.
    pub fn rollback(&mut self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_command(&Command::Rollback)?;
        self.transaction_active.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Execute a closure within a transaction.
    pub fn transaction<F, R>(&mut self, f: F) -> Result<R, VedaError>
    where
        F: FnOnce(&mut Self) -> Result<R, VedaError>,
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
    pub fn prepare(&mut self, name: &str, sql: &str) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_command(&Command::Prepare {
            name: name.to_string(),
            sql: sql.to_string(),
        })?;
        Ok(())
    }

    /// Execute a prepared statement with parameters.
    pub fn execute_prepared(
        &mut self,
        name: &str,
        params: &[Value],
    ) -> Result<VedaResult, VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        let resp = protocol.send_command(&Command::ExecutePrepared {
            name: name.to_string(),
            params: params.to_vec(),
        })?;
        match resp.payload {
            ResponsePayload::Ok(result) => Ok(result),
            _ => Err(VedaError::Protocol(
                "unexpected response for execute_prepared".to_string(),
            )),
        }
    }

    /// Deallocate a prepared statement.
    pub fn deallocate(&mut self, name: &str) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_command(&Command::Deallocate {
            name: name.to_string(),
        })?;
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
    pub fn cursor(&mut self, sql: &str) -> Result<Cursor, VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        Cursor::open(protocol, sql)
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
        if !self.connected.load(Ordering::SeqCst) || self.protocol.is_none() {
            return Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: Some(self.config.host.clone()),
                port: Some(self.config.port),
            });
        }
        Ok(())
    }

    /// Get a reference to the underlying protocol (for advanced use).
    pub fn protocol(&mut self) -> Option<&mut Protocol> {
        self.protocol.as_mut()
    }

    /// Get the client configuration.
    pub fn config(&self) -> &VedaConfig {
        &self.config
    }

    /// Insert a single row into a table.
    pub fn insert(
        &mut self,
        table: &str,
        data: &[(&str, &dyn std::fmt::Display)],
    ) -> Result<u64, VedaError> {
        if data.is_empty() {
            return Ok(0);
        }
        let cols: Vec<&str> = data.iter().map(|(k, _)| *k).collect();
        let vals: Vec<String> = data.iter().map(|(_, v)| format!("'{}'", v)).collect();

        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({});",
            table,
            cols.join(", "),
            vals.join(", ")
        );
        self.execute(&sql, None)
    }

    /// Select rows with optional clauses.
    pub fn select(
        &mut self,
        table: &str,
        columns: Option<&str>,
        where_clause: Option<&str>,
        order_by: Option<&str>,
        limit: Option<u32>,
    ) -> Result<VedaResult, VedaError> {
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
    pub fn exec(&mut self, sql: &str) -> Result<String, VedaError> {
        let result = self.query(sql, None)?;
        Ok(result.get_message())
    }
}

impl Drop for VedaClient {
    fn drop(&mut self) {
        self.close();
    }
}

// Send + Sync: VedaClient uses Mutex internally where needed
unsafe impl Send for VedaClient {}
unsafe impl Sync for VedaClient {}
