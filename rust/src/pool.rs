use std::sync::Mutex;
use std::time::Duration;

use crate::client::Client;
use crate::error::{Result, VedaError};

/// Thread-safe connection pool for VedaDB.
///
/// # Example
///
/// ```no_run
/// use vedadb::Pool;
///
/// let pool = Pool::new("localhost", 6380, 10);
/// let mut client = pool.acquire()?;
/// let result = client.query("SELECT * FROM users;")?;
/// pool.release(client);
/// pool.close();
/// # Ok::<(), vedadb::VedaError>(())
/// ```
pub struct Pool {
    host: String,
    port: u16,
    max_size: usize,
    timeout: Duration,
    idle: Mutex<Vec<Client>>,
    closed: Mutex<bool>,
}

impl Pool {
    /// Create a new connection pool.
    pub fn new(host: &str, port: u16, max_size: usize) -> Self {
        Pool {
            host: host.to_string(),
            port,
            max_size,
            timeout: Duration::from_secs(30),
            idle: Mutex::new(Vec::new()),
            closed: Mutex::new(false),
        }
    }

    /// Create a pool with a custom timeout.
    pub fn with_timeout(host: &str, port: u16, max_size: usize, timeout: Duration) -> Self {
        Pool {
            host: host.to_string(),
            port,
            max_size,
            timeout,
            idle: Mutex::new(Vec::new()),
            closed: Mutex::new(false),
        }
    }

    /// Acquire a client from the pool.
    pub fn acquire(&self) -> Result<Client> {
        if *self.closed.lock().unwrap() {
            return Err(VedaError::Connection("pool is closed".into()));
        }

        if let Some(client) = self.idle.lock().unwrap().pop() {
            return Ok(client);
        }

        Client::connect_with_timeout(&self.host, self.port, self.timeout)
    }

    /// Release a client back to the pool.
    pub fn release(&self, client: Client) {
        let mut idle = self.idle.lock().unwrap();
        if *self.closed.lock().unwrap() || idle.len() >= self.max_size {
            drop(client); // Drop triggers close via Drop trait
        } else {
            idle.push(client);
        }
    }

    /// Number of idle connections in the pool.
    pub fn idle_count(&self) -> usize {
        self.idle.lock().unwrap().len()
    }

    /// Close all idle connections in the pool.
    pub fn close(&self) {
        *self.closed.lock().unwrap() = true;
        let mut idle = self.idle.lock().unwrap();
        idle.clear(); // Drop trait handles closing each connection
    }
}
