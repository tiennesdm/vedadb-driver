use serde::Deserialize;
use std::collections::HashMap;

/// Represents the result of a VedaDB query.
#[derive(Debug, Deserialize)]
pub struct VedaResult {
    pub columns: Option<Vec<String>>,
    pub rows: Option<Vec<Vec<serde_json::Value>>>,
    #[serde(default)]
    pub row_count: i64,
    pub message: Option<String>,
    pub error: Option<String>,
}

impl VedaResult {
    /// Convert rows to a vector of HashMaps keyed by column name.
    pub fn to_maps(&self) -> Vec<HashMap<String, String>> {
        let columns = match &self.columns {
            Some(c) => c,
            None => return Vec::new(),
        };
        let rows = match &self.rows {
            Some(r) => r,
            None => return Vec::new(),
        };

        rows.iter()
            .map(|row| {
                columns
                    .iter()
                    .enumerate()
                    .map(|(i, col)| {
                        let val = row
                            .get(i)
                            .map(|v| match v {
                                serde_json::Value::String(s) => s.clone(),
                                serde_json::Value::Null => String::new(),
                                other => other.to_string(),
                            })
                            .unwrap_or_default();
                        (col.clone(), val)
                    })
                    .collect()
            })
            .collect()
    }

    /// Get the first row as a HashMap, or None if empty.
    pub fn first(&self) -> Option<HashMap<String, String>> {
        let maps = self.to_maps();
        maps.into_iter().next()
    }

    /// Extract values from a single column.
    pub fn pluck(&self, column: &str) -> Vec<String> {
        let columns = match &self.columns {
            Some(c) => c,
            None => return Vec::new(),
        };
        let rows = match &self.rows {
            Some(r) => r,
            None => return Vec::new(),
        };

        let idx = match columns.iter().position(|c| c == column) {
            Some(i) => i,
            None => return Vec::new(),
        };

        rows.iter()
            .map(|row| {
                row.get(idx)
                    .map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Null => String::new(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default()
            })
            .collect()
    }

    /// Get the message or a default row count string.
    pub fn get_message(&self) -> String {
        self.message
            .clone()
            .unwrap_or_else(|| format!("{} rows", self.row_count))
    }
}
