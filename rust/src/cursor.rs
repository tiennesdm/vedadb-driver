use crate::error::VedaError;
use crate::protocol::async_protocol::AsyncProtocol;
use crate::protocol::{Command, Protocol, ResponsePayload};
use crate::result::{Value, VedaResult};

/// Streaming cursor for large result sets.
pub struct Cursor {
    cursor_id: Option<String>,
    buffer: Vec<Vec<Value>>,
    position: usize,
    columns: Vec<String>,
    has_more: bool,
    fetched_count: u64,
    fetch_size: usize,
}

impl Cursor {
    /// Open a new cursor by executing a query.
    pub fn open(protocol: &mut Protocol, sql: &str) -> Result<Self, VedaError> {
        let resp = protocol.send_command(&Command::CursorOpen {
            sql: sql.to_string(),
        })?;

        match resp.payload {
            ResponsePayload::CursorChunk {
                cursor_id,
                rows,
                has_more,
            } => {
                let columns = Vec::new(); // Will be populated on first fetch if needed
                Ok(Cursor {
                    cursor_id: Some(cursor_id),
                    buffer: rows,
                    position: 0,
                    columns,
                    has_more,
                    fetched_count: 0,
                    fetch_size: 100,
                })
            }
            _ => {
                // Fallback: treat as a normal query result
                Err(VedaError::Protocol(
                    "server does not support cursors, use query() instead".to_string(),
                ))
            }
        }
    }

    /// Set the number of rows to fetch per batch.
    pub fn fetch_size(mut self, size: usize) -> Self {
        self.fetch_size = size.max(1);
        self
    }

    /// Fetch the next row.
    pub fn next(&mut self, protocol: &mut Protocol) -> Result<Option<&Vec<Value>>, VedaError> {
        if self.position < self.buffer.len() {
            let row = &self.buffer[self.position];
            self.position += 1;
            return Ok(Some(row));
        }

        if !self.has_more {
            return Ok(None);
        }

        // Fetch next batch
        self.fetch_next(protocol)?;

        if self.position < self.buffer.len() {
            let row = &self.buffer[self.position];
            self.position += 1;
            Ok(Some(row))
        } else {
            Ok(None)
        }
    }

    /// Fetch the next batch of rows.
    fn fetch_next(&mut self, protocol: &mut Protocol) -> Result<(), VedaError> {
        let cursor_id = match &self.cursor_id {
            Some(id) => id.clone(),
            None => return Ok(()),
        };

        let resp = protocol.send_command(&Command::CursorFetch {
            cursor_id,
            count: self.fetch_size,
        })?;

        match resp.payload {
            ResponsePayload::CursorChunk {
                rows,
                has_more,
                ..
            } => {
                self.fetched_count += rows.len() as u64;
                self.buffer = rows;
                self.position = 0;
                self.has_more = has_more;
                Ok(())
            }
            _ => Err(VedaError::Protocol(
                "unexpected cursor response".to_string(),
            )),
        }
    }

    /// Iterate over all remaining rows.
    pub fn iter<'a>(
        &'a mut self,
        protocol: &'a mut Protocol,
    ) -> CursorIter<'a> {
        CursorIter { cursor: self, protocol }
    }

    /// Close the cursor.
    pub fn close(&mut self, protocol: &mut Protocol) -> Result<(), VedaError> {
        if let Some(cursor_id) = self.cursor_id.take() {
            let _ = protocol.send_command(&Command::CursorClose { cursor_id });
        }
        self.buffer.clear();
        self.has_more = false;
        Ok(())
    }

    /// Get column names (if available from metadata).
    pub fn columns(&self) -> &[String] {
        &self.columns
    }

    /// Set column names from result metadata.
    pub fn set_columns(&mut self, columns: Vec<String>) {
        self.columns = columns;
    }

    /// Get total rows fetched so far.
    pub fn fetched_count(&self) -> u64 {
        self.fetched_count
    }

    /// Check if there are more rows.
    pub fn has_more(&self) -> bool {
        self.has_more
    }

    /// Convert all remaining rows to a VedaResult.
    pub fn to_result(mut self, protocol: &mut Protocol) -> Result<VedaResult, VedaError> {
        let mut all_rows = Vec::new();
        while let Some(row) = self.next(protocol)? {
            all_rows.push(row.clone());
        }

        let _ = self.close(protocol);

        Ok(VedaResult {
            columns: if self.columns.is_empty() {
                None
            } else {
                Some(self.columns.clone())
            },
            rows: Some(
                all_rows.into_iter().map(|r| {
                    r.into_iter().map(|v| v).collect()
                }).collect()
            ),
            row_count: self.fetched_count as i64,
            message: Some(format!("{} rows fetched", self.fetched_count)),
            error: None,
            duration_ms: None,
            warnings: Vec::new(),
        })
    }
}

/// Iterator adapter for cursors.
pub struct CursorIter<'a> {
    cursor: &'a mut Cursor,
    protocol: &'a mut Protocol,
}

impl<'a> Iterator for CursorIter<'a> {
    type Item = Vec<Value>;

    fn next(&mut self) -> Option<Self::Item> {
        self.cursor.next(self.protocol)
            .ok()
            .flatten()
            .cloned()
    }
}

// ============== Async Cursor ==============

/// Async streaming cursor for large result sets.
#[cfg(feature = "tokio")]
pub struct AsyncCursor {
    cursor_id: Option<String>,
    buffer: Vec<Vec<Value>>,
    position: usize,
    columns: Vec<String>,
    has_more: bool,
    fetched_count: u64,
    fetch_size: usize,
}

#[cfg(feature = "tokio")]
impl AsyncCursor {
    /// Open a new async cursor.
    pub async fn open(protocol: &mut AsyncProtocol, sql: &str) -> Result<Self, VedaError> {
        let resp = protocol
            .send_command(&Command::CursorOpen {
                sql: sql.to_string(),
            })
            .await?;

        match resp.payload {
            ResponsePayload::CursorChunk {
                cursor_id,
                rows,
                has_more,
            } => Ok(AsyncCursor {
                cursor_id: Some(cursor_id),
                buffer: rows,
                position: 0,
                columns: Vec::new(),
                has_more,
                fetched_count: 0,
                fetch_size: 100,
            }),
            _ => Err(VedaError::Protocol(
                "server does not support async cursors".to_string(),
            )),
        }
    }

    /// Fetch the next row.
    pub async fn next(
        &mut self,
        protocol: &mut AsyncProtocol,
    ) -> Result<Option<&Vec<Value>>, VedaError> {
        if self.position < self.buffer.len() {
            let row = &self.buffer[self.position];
            self.position += 1;
            return Ok(Some(row));
        }

        if !self.has_more {
            return Ok(None);
        }

        self.fetch_next(protocol).await?;

        if self.position < self.buffer.len() {
            let row = &self.buffer[self.position];
            self.position += 1;
            Ok(Some(row))
        } else {
            Ok(None)
        }
    }

    async fn fetch_next(&mut self, protocol: &mut AsyncProtocol) -> Result<(), VedaError> {
        let cursor_id = match &self.cursor_id {
            Some(id) => id.clone(),
            None => return Ok(()),
        };

        let resp = protocol
            .send_command(&Command::CursorFetch {
                cursor_id,
                count: self.fetch_size,
            })
            .await?;

        match resp.payload {
            ResponsePayload::CursorChunk {
                rows,
                has_more,
                ..
            } => {
                self.fetched_count += rows.len() as u64;
                self.buffer = rows;
                self.position = 0;
                self.has_more = has_more;
                Ok(())
            }
            _ => Err(VedaError::Protocol(
                "unexpected async cursor response".to_string(),
            )),
        }
    }

    pub async fn close(&mut self, protocol: &mut AsyncProtocol) -> Result<(), VedaError> {
        if let Some(cursor_id) = self.cursor_id.take() {
            let _ = protocol
                .send_command(&Command::CursorClose { cursor_id })
                .await;
        }
        self.buffer.clear();
        self.has_more = false;
        Ok(())
    }

    pub fn has_more(&self) -> bool {
        self.has_more
    }

    pub fn fetched_count(&self) -> u64 {
        self.fetched_count
    }

    pub fn columns(&self) -> &[String] {
        &self.columns
    }
}
