use std::collections::HashMap;
use std::fmt;
use std::slice::Iter;

use serde::{Deserialize, Serialize};
use serde_json::Number;

/// A VedaDB value type that can represent any data returned by the server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Value {
    Null,
    Bool(bool),
    Integer(i64),
    Float(f64),
    String(String),
    Array(Vec<Value>),
    Object(HashMap<String, Value>),
    Bytes(Vec<u8>),
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Null => write!(f, "NULL"),
            Value::Bool(b) => write!(f, "{}", b),
            Value::Integer(i) => write!(f, "{}", i),
            Value::Float(fl) => write!(f, "{}", fl),
            Value::String(s) => write!(f, "'{}'", s.replace('\'', "''")),
            Value::Array(arr) => {
                let items: Vec<String> = arr.iter().map(|v| v.to_string()).collect();
                write!(f, "[{}]", items.join(", "))
            }
            Value::Object(obj) => {
                let items: Vec<String> = obj
                    .iter()
                    .map(|(k, v)| format!("{}: {}", k, v))
                    .collect();
                write!(f, "{{{}}}", items.join(", "))
            }
            Value::Bytes(b) => write!(f, "<{} bytes>", b.len()),
        }
    }
}

impl From<i64> for Value {
    fn from(v: i64) -> Self { Value::Integer(v) }
}

impl From<i32> for Value {
    fn from(v: i32) -> Self { Value::Integer(v as i64) }
}

impl From<f64> for Value {
    fn from(v: f64) -> Self { Value::Float(v) }
}

impl From<String> for Value {
    fn from(v: String) -> Self { Value::String(v) }
}

impl From<&str> for Value {
    fn from(v: &str) -> Self { Value::String(v.to_string()) }
}

impl From<bool> for Value {
    fn from(v: bool) -> Self { Value::Bool(v) }
}

impl From<Vec<u8>> for Value {
    fn from(v: Vec<u8>) -> Self { Value::Bytes(v) }
}

impl From<HashMap<String, Value>> for Value {
    fn from(v: HashMap<String, Value>) -> Self { Value::Object(v) }
}

impl From<Vec<Value>> for Value {
    fn from(v: Vec<Value>) -> Self { Value::Array(v) }
}

impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(v: Option<T>) -> Self {
        match v {
            Some(inner) => inner.into(),
            None => Value::Null,
        }
    }
}

/// Represents the result of a VedaDB query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VedaResult {
    #[serde(default)]
    pub columns: Option<Vec<String>>,
    #[serde(default)]
    pub rows: Option<Vec<Vec<Value>>>,
    #[serde(default)]
    pub row_count: i64,
    pub message: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<f64>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

impl VedaResult {
    /// Create an empty result.
    pub fn empty() -> Self {
        VedaResult {
            columns: None,
            rows: None,
            row_count: 0,
            message: None,
            error: None,
            duration_ms: None,
            warnings: Vec::new(),
        }
    }

    /// Returns true if the query returned an error.
    pub fn is_error(&self) -> bool {
        self.error.is_some()
    }

    /// Returns true if the result has rows.
    pub fn has_rows(&self) -> bool {
        self.rows.as_ref().map(|r| !r.is_empty()).unwrap_or(false)
    }

    /// Returns the number of rows returned.
    pub fn len(&self) -> usize {
        self.rows.as_ref().map(|r| r.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Convert rows to a vector of HashMaps keyed by column name.
    pub fn to_maps(&self) -> Vec<HashMap<String, Value>> {
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
                        let val = row.get(i).cloned().unwrap_or(Value::Null);
                        (col.clone(), val)
                    })
                    .collect()
            })
            .collect()
    }

    /// Get the first row as a HashMap, or None if empty.
    pub fn first(&self) -> Option<HashMap<String, Value>> {
        let maps = self.to_maps();
        maps.into_iter().next()
    }

    /// Get a single value from the first row by column name.
    pub fn first_value(&self, column: &str) -> Option<Value> {
        self.first().and_then(|map| map.get(column).cloned())
    }

    /// Extract values from a single column.
    pub fn pluck(&self, column: &str) -> Vec<Value> {
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
            .map(|row| row.get(idx).cloned().unwrap_or(Value::Null))
            .collect()
    }

    /// Get the message or a default row count string.
    pub fn get_message(&self) -> String {
        self.message
            .clone()
            .unwrap_or_else(|| format!("{} rows", self.row_count))
    }

    /// Iterate over rows as HashMaps.
    pub fn iter_maps(&self) -> Vec<HashMap<String, Value>> {
        self.to_maps()
    }

    /// Iterate over rows as slices of Values.
    pub fn iter_rows(&self) -> Option<Iter<'_, Vec<Value>>> {
        self.rows.as_ref().map(|r| r.iter())
    }

    /// Get a row by index.
    pub fn get_row(&self, index: usize) -> Option<&Vec<Value>> {
        self.rows.as_ref().and_then(|r| r.get(index))
    }

    /// Get a column value by (row, column_name).
    pub fn get(&self, row: usize, column: &str) -> Option<Value> {
        let columns = self.columns.as_ref()?;
        let rows = self.rows.as_ref()?;
        let col_idx = columns.iter().position(|c| c == column)?;
        rows.get(row).and_then(|r| r.get(col_idx).cloned())
    }
}

/// Row represents a single row from a query result, providing convenient access.
#[derive(Debug, Clone)]
pub struct Row {
    columns: Vec<String>,
    values: Vec<Value>,
}

impl Row {
    pub fn new(columns: Vec<String>, values: Vec<Value>) -> Self {
        Row { columns, values }
    }

    pub fn get(&self, column: &str) -> Option<&Value> {
        self.columns
            .iter()
            .position(|c| c == column)
            .and_then(|idx| self.values.get(idx))
    }

    pub fn get_string(&self, column: &str) -> Option<String> {
        self.get(column).and_then(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Integer(i) => Some(i.to_string()),
            Value::Float(f) => Some(f.to_string()),
            Value::Bool(b) => Some(b.to_string()),
            _ => None,
        })
    }

    pub fn get_i64(&self, column: &str) -> Option<i64> {
        self.get(column).and_then(|v| match v {
            Value::Integer(i) => Some(*i),
            Value::Float(f) => Some(*f as i64),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
    }

    pub fn get_f64(&self, column: &str) -> Option<f64> {
        self.get(column).and_then(|v| match v {
            Value::Float(f) => Some(*f),
            Value::Integer(i) => Some(*i as f64),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
    }

    pub fn get_bool(&self, column: &str) -> Option<bool> {
        self.get(column).and_then(|v| match v {
            Value::Bool(b) => Some(*b),
            Value::Integer(1) => Some(true),
            Value::Integer(0) => Some(false),
            Value::String(s) if s.eq_ignore_ascii_case("true") => Some(true),
            Value::String(s) if s.eq_ignore_ascii_case("false") => Some(false),
            _ => None,
        })
    }

    pub fn columns(&self) -> &[String] {
        &self.columns
    }

    pub fn values(&self) -> &[Value] {
        &self.values
    }

    pub fn to_map(&self) -> HashMap<String, Value> {
        self.columns
            .iter()
            .cloned()
            .zip(self.values.iter().cloned())
            .collect()
    }
}
