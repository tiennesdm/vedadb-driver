use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crate::client::VedaClient;
use crate::error::VedaError;
use crate::protocol::Command;
use crate::result::{Value, VedaResult};

/// A pipeline of commands that can be sent in a single batch.
pub struct Pipeline {
    commands: Vec<PipelineCommand>,
}

#[derive(Debug, Clone)]
struct PipelineCommand {
    sql: String,
    params: Option<Vec<Value>>,
}

impl Pipeline {
    /// Create a new empty pipeline.
    pub fn new() -> Self {
        Pipeline {
            commands: Vec::new(),
        }
    }

    /// Add a query to the pipeline.
    pub fn query(mut self, sql: &str, params: Option<&[Value]>) -> Self {
        self.commands.push(PipelineCommand {
            sql: sql.to_string(),
            params: params.map(|p| p.to_vec()),
        });
        self
    }

    /// Add an execute to the pipeline.
    pub fn execute(mut self, sql: &str, params: Option<&[Value]>) -> Self {
        self.commands.push(PipelineCommand {
            sql: sql.to_string(),
            params: params.map(|p| p.to_vec()),
        });
        self
    }

    /// Add an insert statement.
    pub fn insert(mut self, table: &str, columns: &[&str], values: &[Value]) -> Self {
        let cols = columns.join(", ");
        let vals: Vec<String> = values.iter().map(|v| v.to_string()).collect();
        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({});",
            table,
            cols,
            vals.join(", ")
        );
        self.commands.push(PipelineCommand { sql, params: None });
        self
    }

    /// Add an update statement.
    pub fn update(mut self, table: &str, set: &[(&str, Value)], where_clause: Option<&str>) -> Self {
        let set_clause: Vec<String> = set
            .iter()
            .map(|(col, val)| format!("{} = {}", col, val))
            .collect();
        let mut sql = format!("UPDATE {} SET {}", table, set_clause.join(", "));
        if let Some(w) = where_clause {
            sql.push_str(&format!(" WHERE {}", w));
        }
        sql.push(';');
        self.commands.push(PipelineCommand { sql, params: None });
        self
    }

    /// Add a delete statement.
    pub fn delete(mut self, table: &str, where_clause: Option<&str>) -> Self {
        let mut sql = format!("DELETE FROM {}", table);
        if let Some(w) = where_clause {
            sql.push_str(&format!(" WHERE {}", w));
        }
        sql.push(';');
        self.commands.push(PipelineCommand { sql, params: None });
        self
    }

    /// Number of commands in the pipeline.
    pub fn len(&self) -> usize {
        self.commands.len()
    }

    pub fn is_empty(&self) -> bool {
        self.commands.is_empty()
    }

    /// Execute all commands in the pipeline sequentially.
    pub fn execute_all(&self, client: &mut VedaClient) -> Result<Vec<VedaResult>, VedaError> {
        let mut results = Vec::with_capacity(self.commands.len());
        for cmd in &self.commands {
            let result = client.query(&cmd.sql, cmd.params.as_deref())?;
            results.push(result);
        }
        Ok(results)
    }

    /// Execute with a transaction wrapper.
    pub fn execute_transactional(
        &self,
        client: &mut VedaClient,
    ) -> Result<Vec<VedaResult>, VedaError> {
        client.transaction(|client| {
            let mut results = Vec::with_capacity(self.commands.len());
            for cmd in &self.commands {
                let result = client.query(&cmd.sql, cmd.params.as_deref())?;
                results.push(result);
            }
            Ok(results)
        })
    }

    /// Clear all commands.
    pub fn clear(&mut self) {
        self.commands.clear();
    }
}

impl Default for Pipeline {
    fn default() -> Self {
        Self::new()
    }
}

/// Bulk inserter that batches rows for efficient insertion.
pub struct BulkInserter {
    table: String,
    columns: Vec<String>,
    buffer: VecDeque<Vec<Value>>,
    batch_size: usize,
    total_inserted: u64,
    total_buffered: u64,
    last_flush: Instant,
    auto_flush_interval: Option<Duration>,
}

impl BulkInserter {
    /// Create a new bulk inserter.
    pub fn new(table: String, batch_size: usize) -> Self {
        BulkInserter {
            table,
            columns: Vec::new(),
            buffer: VecDeque::with_capacity(batch_size * 2),
            batch_size: batch_size.max(1),
            total_inserted: 0,
            total_buffered: 0,
            last_flush: Instant::now(),
            auto_flush_interval: None,
        }
    }

    /// Set column names for inserts.
    pub fn columns(mut self, columns: &[&str]) -> Self {
        self.columns = columns.iter().map(|s| s.to_string()).collect();
        self
    }

    /// Set auto-flush interval.
    pub fn auto_flush_interval(mut self, interval: Duration) -> Self {
        self.auto_flush_interval = Some(interval);
        self
    }

    /// Queue a row for insertion.
    pub fn queue(&mut self, row: Vec<Value>) -> Result<(), VedaError> {
        if !self.columns.is_empty() && row.len() != self.columns.len() {
            return Err(VedaError::Query(format!(
                "row has {} columns, expected {}",
                row.len(),
                self.columns.len()
            )));
        }
        self.buffer.push_back(row);
        self.total_buffered += 1;

        if self.buffer.len() >= self.batch_size {
            return Ok(()); // Caller should check and flush
        }

        // Check auto-flush
        if let Some(interval) = self.auto_flush_interval {
            if self.last_flush.elapsed() >= interval && !self.buffer.is_empty() {
                return Ok(()); // Signal to flush
            }
        }

        Ok(())
    }

    /// Queue a row from a map of column values.
    pub fn queue_map(&mut self, row: std::collections::HashMap<String, Value>) -> Result<(), VedaError> {
        if self.columns.is_empty() {
            return Err(VedaError::Query(
                "columns must be set before queueing maps".to_string(),
            ));
        }
        let values: Vec<Value> = self
            .columns
            .iter()
            .map(|col| row.get(col).cloned().unwrap_or(Value::Null))
            .collect();
        self.queue(values)
    }

    /// Flush the current buffer to the database.
    pub fn flush(&mut self, client: &mut VedaClient) -> Result<u64, VedaError> {
        if self.buffer.is_empty() {
            return Ok(0);
        }

        if self.columns.is_empty() {
            return Err(VedaError::Query(
                "columns must be set before flushing".to_string(),
            ));
        }

        let batch: Vec<Vec<Value>> = self.buffer.drain(..).collect();
        let count = batch.len() as u64;

        let cmd = Command::BulkInsert {
            table: self.table.clone(),
            columns: self.columns.clone(),
            rows: batch,
        };

        if let Some(protocol) = client.protocol() {
            let response = protocol.send_command(&cmd)?;
            match response.payload {
                crate::protocol::ResponsePayload::Ok(result) => {
                    self.total_inserted += result.row_count as u64;
                    self.last_flush = Instant::now();
                    Ok(count)
                }
                _ => Err(VedaError::Protocol(
                    "unexpected response for bulk insert".to_string(),
                )),
            }
        } else {
            Err(VedaError::Connection {
                message: "no protocol available".to_string(),
                host: None,
                port: None,
            })
        }
    }

    /// Flush if buffer is at or exceeds batch_size.
    pub fn flush_if_needed(&mut self, client: &mut VedaClient) -> Result<u64, VedaError> {
        if self.buffer.len() >= self.batch_size {
            self.flush(client)
        } else {
            Ok(0)
        }
    }

    /// Should the caller flush?
    pub fn should_flush(&self) -> bool {
        if self.buffer.len() >= self.batch_size {
            return true;
        }
        if let Some(interval) = self.auto_flush_interval {
            if self.last_flush.elapsed() >= interval && !self.buffer.is_empty() {
                return true;
            }
        }
        false
    }

    /// Get the number of rows in the buffer.
    pub fn buffered(&self) -> usize {
        self.buffer.len()
    }

    /// Get total rows inserted so far.
    pub fn total_inserted(&self) -> u64 {
        self.total_inserted
    }

    /// Get total rows queued (including unflushed).
    pub fn total_buffered(&self) -> u64 {
        self.total_buffered
    }

    /// Clear the buffer without inserting.
    pub fn clear(&mut self) {
        self.buffer.clear();
    }
}

/// Streaming bulk loader that reads from a source and inserts in batches.
pub struct StreamingBulkLoader {
    inserter: BulkInserter,
}

impl StreamingBulkLoader {
    pub fn new(table: String, columns: Vec<String>, batch_size: usize) -> Self {
        StreamingBulkLoader {
            inserter: BulkInserter::new(table, batch_size).columns(
                &columns.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            ),
        }
    }

    /// Load rows from an iterator.
    pub fn load_from_iterator<I>(
        &mut self,
        client: &mut VedaClient,
        rows: I,
    ) -> Result<u64, VedaError>
    where
        I: Iterator<Item = Vec<Value>>,
    {
        let mut total = 0u64;
        for row in rows {
            self.inserter.queue(row)?;
            if self.inserter.should_flush() {
                total += self.inserter.flush(client)?;
            }
        }
        // Final flush
        if self.inserter.buffered() > 0 {
            total += self.inserter.flush(client)?;
        }
        Ok(total)
    }

    /// Get the underlying inserter stats.
    pub fn stats(&self) -> (u64, u64) {
        (self.inserter.total_inserted(), self.inserter.total_buffered())
    }
}
