use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dashmap::DashMap;

use crate::client::VedaClient;
use crate::error::VedaError;
use crate::protocol::Command;
use crate::result::VedaResult;

/// A cached query entry.
#[derive(Debug, Clone)]
struct CacheEntry {
    result: VedaResult,
    inserted_at: Instant,
    ttl: Duration,
    hit_count: u64,
}

impl CacheEntry {
    fn is_expired(&self) -> bool {
        self.inserted_at.elapsed() > self.ttl
    }
}

/// Thread-safe query cache backed by DashMap.
pub struct QueryCache {
    cache: Arc<DashMap<String, CacheEntry>>,
    default_ttl: Duration,
    max_size: usize,
    hits: AtomicU64,
    misses: AtomicU64,
    evictions: AtomicU64,
}

impl QueryCache {
    /// Create a new query cache.
    pub fn new(default_ttl: Duration, max_size: usize) -> Arc<Self> {
        Arc::new(QueryCache {
            cache: Arc::new(DashMap::with_capacity(max_size)),
            default_ttl,
            max_size,
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            evictions: AtomicU64::new(0),
        })
    }

    /// Create a cache with a default 5-minute TTL and 1000 entries.
    pub fn default_cache() -> Arc<Self> {
        Self::new(Duration::from_secs(300), 1000)
    }

    /// Get a cached result by key.
    pub fn get(&self, key: &str) -> Option<VedaResult> {
        if let Some(entry) = self.cache.get(key) {
            if !entry.is_expired() {
                self.hits.fetch_add(1, Ordering::SeqCst);
                return Some(entry.result.clone());
            }
            // Expired, remove it
            drop(entry);
            self.cache.remove(key);
            self.evictions.fetch_add(1, Ordering::SeqCst);
        }
        self.misses.fetch_add(1, Ordering::SeqCst);
        None
    }

    /// Insert a result into the cache.
    pub fn put(&self, key: &str, result: VedaResult) {
        self.put_with_ttl(key, result, self.default_ttl);
    }

    /// Insert with a custom TTL.
    pub fn put_with_ttl(&self, key: &str, result: VedaResult, ttl: Duration) {
        // Evict oldest if at capacity
        if self.cache.len() >= self.max_size {
            // Simple eviction: remove an arbitrary entry
            if let Some(k) = self.cache.iter().next().map(|e| e.key().clone()) {
                self.cache.remove(&k);
                self.evictions.fetch_add(1, Ordering::SeqCst);
            }
        }

        self.cache.insert(
            key.to_string(),
            CacheEntry {
                result,
                inserted_at: Instant::now(),
                ttl,
                hit_count: 0,
            },
        );
    }

    /// Remove an entry from the cache.
    pub fn invalidate(&self, key: &str) -> bool {
        self.cache.remove(key).is_some()
    }

    /// Invalidate all entries matching a pattern (simple contains check).
    pub fn invalidate_pattern(&self, pattern: &str) -> usize {
        let keys_to_remove: Vec<String> = self
            .cache
            .iter()
            .filter(|e| e.key().contains(pattern))
            .map(|e| e.key().clone())
            .collect();

        let count = keys_to_remove.len();
        for key in keys_to_remove {
            self.cache.remove(&key);
        }
        count
    }

    /// Clear all entries.
    pub fn clear(&self) {
        self.cache.clear();
    }

    /// Get cache statistics.
    pub fn stats(&self) -> CacheStats {
        let hits = self.hits.load(Ordering::SeqCst);
        let misses = self.misses.load(Ordering::SeqCst);
        let total = hits + misses;
        CacheStats {
            size: self.cache.len(),
            max_size: self.max_size,
            hits,
            misses,
            hit_rate: if total > 0 {
                hits as f64 / total as f64
            } else {
                0.0
            },
            evictions: self.evictions.load(Ordering::SeqCst),
            default_ttl_secs: self.default_ttl.as_secs(),
        }
    }

    /// Execute a query with cache lookup.
    pub fn query_with_cache<F>(
        &self,
        key: &str,
        query_fn: F,
    ) -> Result<VedaResult, VedaError>
    where
        F: FnOnce() -> Result<VedaResult, VedaError>,
    {
        if let Some(result) = self.get(key) {
            return Ok(result);
        }

        let result = query_fn()?;
        self.put(key, result.clone());
        Ok(result)
    }

    /// Check if a key is cached and not expired.
    pub fn contains(&self, key: &str) -> bool {
        self.cache
            .get(key)
            .map(|e| !e.is_expired())
            .unwrap_or(false)
    }

    /// Get the number of entries.
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }
}

/// Cache statistics for monitoring.
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub size: usize,
    pub max_size: usize,
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
    pub evictions: u64,
    pub default_ttl_secs: u64,
}

impl std::fmt::Display for CacheStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Cache {{ size={}/{}, hits={}, misses={:.2}%, evictions={}, ttl={}s }}",
            self.size, self.max_size, self.hits, self.hit_rate * 100.0, self.evictions,
            self.default_ttl_secs
        )
    }
}

/// Server-side cache integration.
pub struct ServerCache {
    // This would integrate with the server's native cache commands
}

impl ServerCache {
    /// Set a cache key on the server.
    pub fn cache_set(
        client: &mut VedaClient,
        key: &str,
        value: &str,
        ttl: Option<u64>,
    ) -> Result<(), VedaError> {
        if let Some(protocol) = client.protocol() {
            let cmd = Command::CacheSet {
                key: key.to_string(),
                value: value.to_string(),
                ttl,
            };
            protocol.send_command(&cmd)?;
            Ok(())
        } else {
            Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: None,
                port: None,
            })
        }
    }

    /// Get a cached value from the server.
    pub fn cache_get(client: &mut VedaClient, key: &str) -> Result<Option<String>, VedaError> {
        if let Some(protocol) = client.protocol() {
            let resp = protocol.send_command(&Command::CacheGet {
                key: key.to_string(),
            })?;
            match resp.payload {
                crate::protocol::ResponsePayload::CacheHit { value, .. } => Ok(Some(value)),
                crate::protocol::ResponsePayload::CacheMiss { .. } => Ok(None),
                _ => Ok(None),
            }
        } else {
            Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: None,
                port: None,
            })
        }
    }

    /// Delete a cached key.
    pub fn cache_del(client: &mut VedaClient, key: &str) -> Result<(), VedaError> {
        if let Some(protocol) = client.protocol() {
            protocol.send_command(&Command::CacheDel {
                key: key.to_string(),
            })?;
            Ok(())
        } else {
            Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: None,
                port: None,
            })
        }
    }

    /// Get keys matching a pattern.
    pub fn cache_keys(client: &mut VedaClient, pattern: &str) -> Result<VedaResult, VedaError> {
        if let Some(protocol) = client.protocol() {
            let resp = protocol.send_command(&Command::CacheKeys {
                pattern: pattern.to_string(),
            })?;
            match resp.payload {
                crate::protocol::ResponsePayload::Ok(result) => Ok(result),
                _ => Ok(VedaResult::empty()),
            }
        } else {
            Err(VedaError::Connection {
                message: "not connected".to_string(),
                host: None,
                port: None,
            })
        }
    }
}
