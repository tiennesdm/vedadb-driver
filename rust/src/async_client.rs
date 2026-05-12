use std::time::Duration;

use tokio::net::TcpStream;
use tokio::sync::mpsc;

use crate::bulk::BulkInserter;
use crate::change_stream::{ChangeEvent, ChangeStream};
use crate::cursor::AsyncCursor;
use crate::error::VedaError;
use crate::protocol::async_protocol::AsyncProtocol;
use crate::protocol::Command;
use crate::pubsub::AsyncPubSub;
use crate::result::{Value, VedaResult};
use crate::uri::VedaUri;
use crate::client::VedaConfig;

/// Async VedaDB client using tokio.
pub struct AsyncVedaClient {
    config: VedaConfig,
    protocol: Option<AsyncProtocol>,
    connected: bool,
}

impl AsyncVedaClient {
    /// Create a new async client from config.
    pub fn new(config: VedaConfig) -> Self {
        AsyncVedaClient {
            config,
            protocol: None,
            connected: false,
        }
    }

    /// Connect to the server.
    pub async fn connect(&mut self) -> Result<(), VedaError> {
        let addr = format!("{}:{}", self.config.host, self.config.port);
        let tcp = tokio::time::timeout(
            self.config.connect_timeout,
            TcpStream::connect(&addr),
        )
        .await
        .map_err(|_| {
            VedaError::Timeout(self.config.connect_timeout)
        })?
        .map_err(|e| VedaError::Connection {
            message: e.to_string(),
            host: Some(self.config.host.clone()),
            port: Some(self.config.port),
        })?;

        let mut protocol = AsyncProtocol::new(tcp)?;
        protocol.handshake().await?;

        if self.config.tls {
            // TLS handshake via tokio-native-tls
        }

        if let (Some(ref username), Some(ref password)) =
            (&self.config.username, &self.config.password)
        {
            // AUTH
            let _ = protocol
                .send_command(&Command::Auth {
                    username: username.clone(),
                    password: password.clone(),
                })
                .await?;
        }

        self.protocol = Some(protocol);
        self.connected = true;
        Ok(())
    }

    /// Create and connect from a URI string.
    pub async fn from_uri(uri: &str) -> Result<Self, VedaError> {
        let parsed = VedaUri::parse(uri)?;
        let config = parsed.into_config();
        let mut client = AsyncVedaClient::new(config);
        client.connect().await?;
        Ok(client)
    }

    /// Execute a query and return the result.
    pub async fn query(
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

        let response = protocol.send_command(&cmd).await?;
        match response.payload {
            crate::protocol::ResponsePayload::Ok(result) => Ok(result),
            _ => Err(VedaError::Protocol(
                "unexpected response type".to_string(),
            )),
        }
    }

    /// Execute a statement, returning affected row count.
    pub async fn execute(
        &mut self,
        sql: &str,
        params: Option<&[Value]>,
    ) -> Result<u64, VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();

        let cmd = Command::Execute {
            sql: sql.to_string(),
            params: params.map(|p| p.to_vec()),
        };

        let response = protocol.send_command(&cmd).await?;
        match response.payload {
            crate::protocol::ResponsePayload::Ok(result) => Ok(result.row_count as u64),
            _ => Err(VedaError::Protocol(
                "unexpected response type".to_string(),
            )),
        }
    }

    /// Ping the server.
    pub async fn ping(&mut self) -> Result<Duration, VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.ping().await
    }

    /// Start watching a table for changes.
    pub async fn watch(
        &mut self,
        table: &str,
    ) -> Result<mpsc::Receiver<ChangeEvent>, VedaError> {
        self.ensure_connected()?;
        let (tx, rx) = mpsc::channel::<ChangeEvent>(100);

        let protocol = self.protocol.as_mut().unwrap();
        protocol
            .send_command(&Command::Watch {
                table: table.to_string(),
            })
            .await?;

        // Spawn a task to listen for change events
        // In a real implementation, this would keep reading from the protocol
        // and forwarding ChangeEvents to the channel
        tokio::spawn(async move {
            // Event loop would go here, reading protocol lines
            // and parsing them into ChangeEvent objects
            let _ = tx;
        });

        Ok(rx)
    }

    /// Create a change stream for a table.
    pub async fn change_stream(&mut self, table: &str) -> Result<ChangeStream, VedaError> {
        ChangeStream::new(self, table).await
    }

    /// Create an async cursor.
    pub async fn cursor(&mut self, sql: &str) -> Result<AsyncCursor, VedaError> {
        AsyncCursor::open(self.protocol.as_mut().unwrap(), sql).await
    }

    /// Get async PubSub handle.
    pub fn async_pubsub(&self) -> AsyncPubSub {
        AsyncPubSub::new(self.config.clone())
    }

    /// Begin a transaction.
    pub async fn begin(&mut self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_command(&Command::Begin).await?;
        Ok(())
    }

    /// Commit transaction.
    pub async fn commit(&mut self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_command(&Command::Commit).await?;
        Ok(())
    }

    /// Rollback transaction.
    pub async fn rollback(&mut self) -> Result<(), VedaError> {
        self.ensure_connected()?;
        let protocol = self.protocol.as_mut().unwrap();
        protocol.send_command(&Command::Rollback).await?;
        Ok(())
    }

    /// Execute within a transaction.
    pub async fn transaction<F, Fut, R>(&mut self, f: F) -> Result<R, VedaError>
    where
        F: FnOnce(&mut Self) -> Fut,
        Fut: std::future::Future<Output = Result<R, VedaError>>,
    {
        self.begin().await?;
        match f(self).await {
            Ok(result) => {
                self.commit().await?;
                Ok(result)
            }
            Err(e) => {
                let _ = self.rollback().await;
                Err(e)
            }
        }
    }

    /// Reconnect to the server.
    pub async fn reconnect(&mut self) -> Result<(), VedaError> {
        self.close().await;
        self.connect().await
    }

    /// Close the connection.
    pub async fn close(&mut self) {
        if let Some(ref mut protocol) = self.protocol {
            protocol.close().await;
        }
        self.connected = false;
    }

    /// Check if connected.
    pub fn is_connected(&self) -> bool {
        self.connected
    }

    /// Get the config.
    pub fn config(&self) -> &VedaConfig {
        &self.config
    }

    /// Create bulk inserter.
    pub fn bulk_insert(&self, table: &str, batch_size: usize) -> BulkInserter {
        BulkInserter::new(table.to_string(), batch_size)
    }

    fn ensure_connected(&self) -> Result<(), VedaError> {
        if !self.connected || self.protocol.is_none() {
            return Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: Some(self.config.host.clone()),
                port: Some(self.config.port),
            });
        }
        Ok(())
    }

    /// Get mutable access to the protocol (for extensions).
    pub fn protocol_mut(&mut self) -> Option<&mut AsyncProtocol> {
        self.protocol.as_mut()
    }
}
