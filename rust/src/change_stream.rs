use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::async_client::AsyncVedaClient;
use crate::error::VedaError;
use crate::protocol::Command;
use crate::result::Value;

/// A change event from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeEvent {
    pub table: String,
    pub operation: ChangeOp,
    #[serde(flatten)]
    pub row: serde_json::Value,
    pub timestamp: u64,
    pub tx_id: Option<u64>,
    pub lsn: Option<u64>,
}

/// Type of change operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ChangeOp {
    Insert,
    Update,
    Delete,
    Truncate,
    #[serde(untagged)]
    Other(String),
}

impl ChangeEvent {
    /// Get the primary key value from the changed row.
    pub fn primary_key(&self) -> Option<&serde_json::Value> {
        self.row.get("id").or_else(|| self.row.get("_id"))
    }

    /// Get a field from the changed row.
    pub fn get(&self, field: &str) -> Option<&serde_json::Value> {
        self.row.get(field)
    }

    /// Check if this is an INSERT event.
    pub fn is_insert(&self) -> bool {
        matches!(self.operation, ChangeOp::Insert)
    }

    /// Check if this is an UPDATE event.
    pub fn is_update(&self) -> bool {
        matches!(self.operation, ChangeOp::Update)
    }

    /// Check if this is a DELETE event.
    pub fn is_delete(&self) -> bool {
        matches!(self.operation, ChangeOp::Delete)
    }

    /// Get human-readable timestamp.
    pub fn timestamp_utc(&self) -> Option<SystemTime> {
        Some(UNIX_EPOCH + Duration::from_millis(self.timestamp))
    }
}

/// Async change stream for watching table changes.
pub struct ChangeStream {
    table: String,
    rx: mpsc::Receiver<ChangeEvent>,
    started: bool,
    resume_lsn: Option<u64>,
    filter: Option<ChangeFilter>,
}

/// Filter for change stream events.
#[derive(Debug, Clone)]
pub struct ChangeFilter {
    pub operations: Vec<ChangeOp>,
    pub columns: Option<Vec<String>>,
}

impl ChangeStream {
    /// Create a new change stream for a table.
    pub async fn new(
        client: &mut AsyncVedaClient,
        table: &str,
    ) -> Result<Self, VedaError> {
        let (tx, rx) = mpsc::channel::<ChangeEvent>(1000);

        // Send WATCH command
        if let Some(protocol) = client.protocol_mut() {
            protocol
                .send_command(&Command::Watch {
                    table: table.to_string(),
                })
                .await?;
        }

        // In a real implementation, spawn a background task to read events
        // from the protocol and forward them to the channel

        Ok(ChangeStream {
            table: table.to_string(),
            rx,
            started: true,
            resume_lsn: None,
            filter: None,
        })
    }

    /// Set a filter for the change stream.
    pub fn with_filter(mut self, filter: ChangeFilter) -> Self {
        self.filter = Some(filter);
        self
    }

    /// Set a resume LSN for resuming from a specific point.
    pub fn resume_from(mut self, lsn: u64) -> Self {
        self.resume_lsn = Some(lsn);
        self
    }

    /// Get the next change event (async).
    pub async fn next(&mut self) -> Option<ChangeEvent> {
        loop {
            match self.rx.recv().await {
                Some(event) => {
                    if self.matches_filter(&event) {
                        if let Some(lsn) = event.lsn {
                            self.resume_lsn = Some(lsn);
                        }
                        return Some(event);
                    }
                }
                None => return None,
            }
        }
    }

    /// Get the next event with a timeout.
    pub async fn next_timeout(
        &mut self,
        timeout: Duration,
    ) -> Result<Option<ChangeEvent>, VedaError> {
        match tokio::time::timeout(timeout, self.rx.recv()).await {
            Ok(Some(event)) => {
                if self.matches_filter(&event) {
                    if let Some(lsn) = event.lsn {
                        self.resume_lsn = Some(lsn);
                    }
                    Ok(Some(event))
                } else {
                    Ok(None)
                }
            }
            Ok(None) => Ok(None),
            Err(_) => Err(VedaError::Timeout(timeout)),
        }
    }

    /// Check if an event matches the current filter.
    fn matches_filter(&self, event: &ChangeEvent) -> bool {
        if let Some(ref filter) = self.filter {
            if !filter.operations.is_empty() {
                let op_matches = filter.operations.iter().any(|op| {
                    std::mem::discriminant(op)
                        == std::mem::discriminant(&event.operation)
                });
                if !op_matches {
                    return false;
                }
            }
        }
        true
    }

    /// Get the current resume LSN.
    pub fn resume_lsn(&self) -> Option<u64> {
        self.resume_lsn
    }

    /// Check if the stream is still active.
    pub fn is_active(&self) -> bool {
        self.started && !self.rx.is_closed()
    }

    /// Close the stream.
    pub async fn close(&mut self) {
        self.started = false;
        self.rx.close();
    }

    /// Get the table name being watched.
    pub fn table(&self) -> &str {
        &self.table
    }
}
