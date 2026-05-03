use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[cfg(feature = "rustls")]
use std::sync::Arc;

use crate::error::{Result, VedaError};
use crate::result::VedaResult;

/// Connection stream — plain TCP or rustls-wrapped TLS.
///
/// After STARTTLS upgrade, a `Plain` variant is replaced in-place with a
/// `Tls` variant that owns the rustls `ClientConnection` and the underlying
/// `TcpStream`. All reads/writes go through `read_line`/`write_all`/`flush`
/// helpers which dispatch to the active variant.
enum Stream {
    Plain {
        reader: BufReader<TcpStream>,
        writer: TcpStream,
    },
    #[cfg(feature = "rustls")]
    Tls {
        // BufReader gives us read_line() over a rustls StreamOwned, which
        // implements std::io::Read+Write by driving the TLS state machine
        // against the underlying TcpStream.
        inner: BufReader<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>,
    },
}

impl Stream {
    fn read_line(&mut self, buf: &mut String) -> std::io::Result<usize> {
        match self {
            Stream::Plain { reader, .. } => reader.read_line(buf),
            #[cfg(feature = "rustls")]
            Stream::Tls { inner } => inner.read_line(buf),
        }
    }

    fn write_all(&mut self, data: &[u8]) -> std::io::Result<()> {
        match self {
            Stream::Plain { writer, .. } => writer.write_all(data),
            #[cfg(feature = "rustls")]
            Stream::Tls { inner } => inner.get_mut().write_all(data),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Stream::Plain { writer, .. } => writer.flush(),
            #[cfg(feature = "rustls")]
            Stream::Tls { inner } => inner.get_mut().flush(),
        }
    }
}

/// Configuration for connecting to a VedaDB server.
pub struct Config {
    pub host: String,
    pub port: u16,
    pub timeout: Duration,
    /// If true, send STARTTLS and perform the upgrade handshake.
    /// NOTE: Actual TLS wrapping requires a TLS library (e.g. native-tls or rustls).
    /// This flag enables the STARTTLS protocol exchange. For production TLS,
    /// use a TLS proxy (stunnel) or enable the `native-tls` feature.
    pub tls: bool,
    /// If false (and tls is true), skip certificate verification. Only for development.
    pub tls_verify: bool,
    /// Username for AUTH authentication.
    pub username: Option<String>,
    /// Password for AUTH authentication.
    pub password: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            host: "localhost".to_string(),
            port: 6380,
            timeout: Duration::from_secs(30),
            tls: false,
            tls_verify: true,
            username: None,
            password: None,
        }
    }
}

/// Escape a value for safe inclusion in a VedaQL string literal.
///
/// Uses SQL-standard `''` doubling — never `\'` backslash escaping.
/// Wraps the result in single quotes. Pass already-quoted SQL through
/// `query()` directly if you need a non-string literal.
pub(crate) fn escape_sql_value(v: &str) -> String {
    let mut out = String::with_capacity(v.len() + 2);
    out.push('\'');
    for c in v.chars() {
        if c == '\'' {
            out.push('\'');
            out.push('\'');
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

/// Audit #23 closure for the Rust driver: validates a prepared
/// statement arg before formatting. Currently rejects NUL bytes
/// (undefined behaviour in most SQL parsers) — anything else
/// passes through to escape_sql_value.
pub(crate) fn validate_prepared_arg(v: &str) -> Result<()> {
    if v.contains('\0') {
        return Err(VedaError::Query(
            "vedadb: prepared arg contains NUL byte".to_string(),
        ));
    }
    Ok(())
}

/// VedaDB Rust client driver.
///
/// # Security: TLS
///
/// `Config::tls = true` enables the **STARTTLS protocol exchange** but does
/// NOT by itself wrap the socket in an encrypted stream — actual TLS
/// requires a TLS library (native-tls / rustls) compiled in via a Cargo
/// feature. As a guard against silently sending plaintext after a STARTTLS
/// reply, `connect_with_config` will **fail loudly** when `tls = true` and
/// no TLS feature is enabled. Either:
///
/// 1. compile this driver with `--features native-tls` (or `rustls`), or
/// 2. set `tls = false` and front the server with stunnel / a TLS proxy.
///
/// # Example
///
/// ```no_run
/// use vedadb::Client;
///
/// let mut client = Client::connect("localhost", 6380)?;
/// let result = client.query("SELECT * FROM users;")?;
/// for row in result.to_maps() {
///     println!("{:?}", row);
/// }
/// client.close();
/// # Ok::<(), vedadb::VedaError>(())
/// ```
pub struct Client {
    stream: Stream,
    lock: Mutex<()>,
    /// Indicates whether the STARTTLS handshake was completed.
    is_tls: bool,
    /// Stored config for auto-reconnect.
    config_host: String,
    config_port: u16,
    config_timeout: Duration,
    config_username: Option<String>,
    config_password: Option<String>,
}

impl Client {
    /// Connect to a VedaDB server.
    pub fn connect(host: &str, port: u16) -> Result<Self> {
        Self::connect_with_timeout(host, port, Duration::from_secs(30))
    }

    /// Connect with a custom timeout.
    pub fn connect_with_timeout(host: &str, port: u16, timeout: Duration) -> Result<Self> {
        let config = Config {
            host: host.to_string(),
            port,
            timeout,
            ..Config::default()
        };
        Self::connect_with_config(config)
    }

    /// Connect using a full Config struct with TLS and auth options.
    ///
    /// # Example
    ///
    /// ```no_run
    /// use vedadb::{Client, Config};
    /// use std::time::Duration;
    ///
    /// let config = Config {
    ///     host: "db.example.com".to_string(),
    ///     port: 6380,
    ///     tls: true,
    ///     username: Some("admin".to_string()),
    ///     password: Some("secret".to_string()),
    ///     ..Config::default()
    /// };
    /// let mut client = Client::connect_with_config(config)?;
    /// # Ok::<(), vedadb::VedaError>(())
    /// ```
    pub fn connect_with_config(config: Config) -> Result<Self> {
        // Guard: refuse to "do TLS" when no TLS backend is compiled in.
        // Without this check the driver would send STARTTLS, the server
        // would switch to TLS, and we would keep speaking plaintext into
        // an encrypted socket — leaking credentials and queries.
        #[cfg(not(any(feature = "native-tls", feature = "rustls")))]
        {
            if config.tls {
                eprintln!(
                    "vedadb: WARN refusing to enable TLS: this build has \
                     no TLS feature compiled in (`native-tls` or `rustls`). \
                     Recompile with --features native-tls, or set Config.tls = false."
                );
                return Err(VedaError::Connection(
                    "TLS requested but no TLS feature is compiled in \
                     (build with --features native-tls or --features rustls)"
                        .into(),
                ));
            }
        }

        let addr = format!("{}:{}", config.host, config.port);
        let tcp = TcpStream::connect_timeout(
            &addr
                .parse()
                .map_err(|e| VedaError::Connection(format!("{}", e)))?,
            config.timeout,
        )?;
        tcp.set_read_timeout(Some(config.timeout))?;
        tcp.set_write_timeout(Some(config.timeout))?;

        let writer = tcp.try_clone()?;
        let mut reader = BufReader::new(tcp);

        // Read and discard welcome banner
        let mut banner = String::new();
        reader.read_line(&mut banner)?;

        let mut client = Client {
            stream: Stream::Plain { reader, writer },
            lock: Mutex::new(()),
            is_tls: false,
            config_host: config.host.clone(),
            config_port: config.port,
            config_timeout: config.timeout,
            config_username: config.username.clone(),
            config_password: config.password.clone(),
        };

        // STARTTLS upgrade
        if config.tls {
            client.starttls_handshake(&config.host)?;
        }

        // AUTH
        if let Some(ref username) = config.username {
            let password = config.password.as_deref().unwrap_or("");
            client.authenticate(username, password)?;
        }

        Ok(client)
    }

    /// Perform the STARTTLS protocol handshake and (when the `rustls`
    /// feature is enabled) wrap the underlying TcpStream in a real TLS
    /// session.
    ///
    /// Without a TLS feature, the safety check in `connect_with_config`
    /// already refused the request, so reaching this method with `tls=true`
    /// implies a TLS backend is compiled in.
    fn starttls_handshake(&mut self, hostname: &str) -> Result<()> {
        self.stream.write_all(b"STARTTLS\n")?;
        self.stream.flush()?;

        let mut response = String::new();
        self.stream.read_line(&mut response)?;

        if response.is_empty() {
            return Err(VedaError::Connection(
                "connection closed during STARTTLS".into(),
            ));
        }

        let trimmed = response.trim();

        // Parse response to check for errors
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
                return Err(VedaError::Connection(format!("STARTTLS failed: {}", err)));
            }
        }

        // Wrap the underlying TcpStream in a rustls session.
        #[cfg(feature = "rustls")]
        {
            self.upgrade_to_rustls(hostname)?;
            self.is_tls = true;
            return Ok(());
        }

        // native-tls feature satisfies the compile-time gate in
        // connect_with_config but is not yet wired to a real TLS impl.
        // Refuse to mark the connection TLS-ready so callers don't
        // believe they're encrypted. Recompile with --features rustls
        // for actual TLS, or front the server with a TLS proxy.
        #[cfg(all(feature = "native-tls", not(feature = "rustls")))]
        {
            let _ = hostname;
            return Err(VedaError::Connection(
                "native-tls feature is a placeholder; recompile with \
                 --features rustls for a wired TLS backend"
                    .into(),
            ));
        }

        // No TLS feature — unreachable because connect_with_config rejects
        // tls=true earlier, but keep the error path tight.
        #[cfg(not(any(feature = "rustls", feature = "native-tls")))]
        {
            let _ = hostname;
            Err(VedaError::Connection("no TLS backend compiled in".into()))
        }
    }

    /// Replace the plain TcpStream with a rustls-wrapped TLS session.
    ///
    /// Builds a `ClientConfig` with the Mozilla CA bundle from
    /// `webpki-roots` and no client auth, then drives the handshake by
    /// wrapping the stream in `rustls::StreamOwned`. Hostname verification
    /// is performed by rustls based on the `ServerName` we pass in.
    #[cfg(feature = "rustls")]
    fn upgrade_to_rustls(&mut self, hostname: &str) -> Result<()> {
        // Build the new TLS stream first so we never leave `self.stream`
        // in an invalid state. We use the host's own clone of the TcpStream
        // (the writer half) as the underlying transport for rustls, then
        // drop the BufReader and its TcpStream after we've validated the
        // STARTTLS response (which is already done before this is called).
        let tcp_for_tls = match &self.stream {
            Stream::Plain { writer, .. } => writer.try_clone().map_err(|e| {
                VedaError::Connection(format!("failed to clone TcpStream for TLS upgrade: {}", e))
            })?,
            Stream::Tls { .. } => {
                return Err(VedaError::Connection(
                    "STARTTLS attempted on already-TLS connection".into(),
                ));
            }
        };

        // Build root cert store from Mozilla bundle.
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        let config = rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        let server_name =
            rustls_pki_types::ServerName::try_from(hostname.to_string()).map_err(|e| {
                VedaError::Connection(format!("invalid TLS server name {:?}: {}", hostname, e))
            })?;

        let conn = rustls::ClientConnection::new(Arc::new(config), server_name)
            .map_err(|e| VedaError::Connection(format!("rustls client init failed: {}", e)))?;

        let tls_stream = rustls::StreamOwned::new(conn, tcp_for_tls);

        // Swap in the new TLS stream. The old Plain reader/writer (owning
        // the original TcpStream halves) is dropped here; rustls now owns
        // its own clone of the underlying socket fd.
        self.stream = Stream::Tls {
            inner: BufReader::new(tls_stream),
        };

        Ok(())
    }

    /// Authenticate with the server using AUTH command.
    fn authenticate(&mut self, username: &str, password: &str) -> Result<()> {
        self.stream
            .write_all(format!("AUTH {} {}\n", username, password).as_bytes())?;
        self.stream.flush()?;

        let mut response = String::new();
        self.stream.read_line(&mut response)?;

        if response.is_empty() {
            return Err(VedaError::Connection(
                "connection closed during AUTH".into(),
            ));
        }

        let trimmed = response.trim();

        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
                return Err(VedaError::Connection(format!(
                    "authentication failed: {}",
                    err
                )));
            }
        }

        Ok(())
    }

    /// Returns true if the STARTTLS handshake was completed.
    pub fn is_tls(&self) -> bool {
        self.is_tls
    }

    /// Execute a VedaQL query and return the result.
    pub fn query(&mut self, sql: &str) -> Result<VedaResult> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| VedaError::Connection("lock poisoned".into()))?;

        self.stream.write_all(sql.as_bytes())?;
        self.stream.write_all(b"\n")?;
        self.stream.flush()?;

        let mut response = String::new();
        self.stream.read_line(&mut response)?;

        if response.is_empty() {
            return Err(VedaError::Connection("connection closed".into()));
        }

        let result: VedaResult = serde_json::from_str(response.trim())?;

        if let Some(ref error) = result.error {
            return Err(VedaError::Query(error.clone()));
        }

        Ok(result)
    }

    /// Execute a DDL/DML statement, returns the status message.
    pub fn exec(&mut self, sql: &str) -> Result<String> {
        let result = self.query(sql)?;
        Ok(result.get_message())
    }

    /// Insert a row into a table.
    pub fn insert(
        &mut self,
        table: &str,
        data: &[(&str, &dyn std::fmt::Display)],
    ) -> Result<String> {
        let cols: Vec<&str> = data.iter().map(|(k, _)| *k).collect();
        let vals: Vec<String> = data.iter().map(|(_, v)| format!("'{}'", v)).collect();

        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({});",
            table,
            cols.join(", "),
            vals.join(", ")
        );
        self.exec(&sql)
    }

    /// Select rows from a table.
    pub fn select(
        &mut self,
        table: &str,
        columns: Option<&str>,
        where_clause: Option<&str>,
        order_by: Option<&str>,
        limit: Option<u32>,
    ) -> Result<VedaResult> {
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
        self.query(&sql)
    }

    /// Update rows in a table.
    pub fn update(
        &mut self,
        table: &str,
        set: &[(&str, &dyn std::fmt::Display)],
        where_clause: Option<&str>,
    ) -> Result<String> {
        let set_clause: Vec<String> = set
            .iter()
            .map(|(k, v)| format!("{} = '{}'", k, v))
            .collect();
        let mut sql = format!("UPDATE {} SET {}", table, set_clause.join(", "));
        if let Some(w) = where_clause {
            sql.push_str(&format!(" WHERE {}", w));
        }
        sql.push(';');
        self.exec(&sql)
    }

    /// Delete rows from a table.
    pub fn delete(&mut self, table: &str, where_clause: Option<&str>) -> Result<String> {
        let mut sql = format!("DELETE FROM {}", table);
        if let Some(w) = where_clause {
            sql.push_str(&format!(" WHERE {}", w));
        }
        sql.push(';');
        self.exec(&sql)
    }

    /// Prepare a named statement on the server.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # let mut client = vedadb::Client::connect("localhost", 6380)?;
    /// client.prepare("get_user", "SELECT * FROM users WHERE id = $1")?;
    /// # Ok::<(), vedadb::VedaError>(())
    /// ```
    pub fn prepare(&mut self, name: &str, query: &str) -> Result<VedaResult> {
        self.query(&format!("PREPARE {} AS {}", name, query))
    }

    /// Execute a previously prepared statement with parameter values.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # let mut client = vedadb::Client::connect("localhost", 6380)?;
    /// # client.prepare("get_user", "SELECT * FROM users WHERE id = $1")?;
    /// let result = client.execute_prepared("get_user", &["42"])?;
    /// # Ok::<(), vedadb::VedaError>(())
    /// ```
    pub fn execute_prepared(&mut self, name: &str, params: &[&str]) -> Result<VedaResult> {
        // SQL-standard `''`-doubling escape, never `\'`. Audit #23
        // closure: validate each param for NUL bytes before formatting.
        for p in params {
            validate_prepared_arg(p)?;
        }
        let param_list: Vec<String> = params.iter().map(|p| escape_sql_value(p)).collect();
        self.query(&format!("EXECUTE {} ({})", name, param_list.join(", ")))
    }

    /// Deallocate (remove) a previously prepared statement from the server.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # let mut client = vedadb::Client::connect("localhost", 6380)?;
    /// client.deallocate("get_user")?;
    /// # Ok::<(), vedadb::VedaError>(())
    /// ```
    pub fn deallocate(&mut self, name: &str) -> Result<VedaResult> {
        self.query(&format!("DEALLOCATE {}", name))
    }

    /// List all tables.
    pub fn show_tables(&mut self) -> Result<Vec<String>> {
        let result = self.query("SHOW TABLES;")?;
        Ok(result.pluck("table_name"))
    }

    /// Health check.
    pub fn ping(&mut self) -> bool {
        self.query("SHOW TABLES;").is_ok()
    }

    /// Close the connection.
    pub fn close(&mut self) {
        let _ = self.stream.write_all(b"QUIT\n");
        let _ = self.stream.flush();
    }

    // --- Transactions ---

    /// Begin a transaction.
    pub fn begin(&mut self) -> Result<()> {
        self.exec("BEGIN")?;
        Ok(())
    }

    /// Commit the current transaction.
    pub fn commit(&mut self) -> Result<()> {
        self.exec("COMMIT")?;
        Ok(())
    }

    /// Rollback the current transaction.
    pub fn rollback(&mut self) -> Result<()> {
        self.exec("ROLLBACK")?;
        Ok(())
    }

    /// Run a closure inside a transaction. Commits on success, rolls back on error.
    pub fn transaction<F>(&mut self, f: F) -> Result<()>
    where
        F: FnOnce(&mut Self) -> Result<()>,
    {
        self.begin()?;
        match f(self) {
            Ok(()) => self.commit(),
            Err(e) => {
                let _ = self.rollback();
                Err(e)
            }
        }
    }

    // --- Auto-Reconnect ---

    /// Attempt to reconnect up to 3 times with 1s backoff. Re-authenticates if configured.
    pub fn reconnect(&mut self) -> Result<()> {
        for i in 0..3 {
            thread::sleep(Duration::from_secs((i + 1) as u64));

            let addr = format!("{}:{}", self.config_host, self.config_port);
            let stream = match TcpStream::connect_timeout(
                &addr
                    .parse()
                    .map_err(|e| VedaError::Connection(format!("{}", e)))?,
                self.config_timeout,
            ) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let _ = stream.set_read_timeout(Some(self.config_timeout));
            let _ = stream.set_write_timeout(Some(self.config_timeout));

            let new_writer = match stream.try_clone() {
                Ok(w) => w,
                Err(_) => continue,
            };
            let mut new_reader = BufReader::new(stream);

            // Discard welcome banner.
            let mut banner = String::new();
            if new_reader.read_line(&mut banner).is_err() {
                continue;
            }

            // Re-authenticate if credentials were stored.
            if let Some(ref username) = self.config_username {
                let password = self.config_password.as_deref().unwrap_or("");
                let cmd = format!("AUTH {} {}\n", username, password);
                let mut w = new_writer.try_clone().unwrap();
                if w.write_all(cmd.as_bytes()).is_err() {
                    continue;
                }
                let _ = w.flush();
                let mut resp = String::new();
                if new_reader.read_line(&mut resp).is_err() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(resp.trim()) {
                    if parsed.get("error").and_then(|e| e.as_str()).is_some() {
                        continue;
                    }
                }
            }

            // Swap connection. Reconnect always lands on a plaintext stream;
            // callers needing TLS after reconnect must re-issue STARTTLS.
            self.stream = Stream::Plain {
                reader: new_reader,
                writer: new_writer,
            };
            self.is_tls = false;
            return Ok(());
        }
        Err(VedaError::Connection(
            "reconnect failed after 3 attempts".into(),
        ))
    }

    // --- Batch Insert ---

    /// Insert multiple rows in a single batch INSERT statement.
    pub fn insert_many(
        &mut self,
        table: &str,
        columns: &[&str],
        rows: &[Vec<String>],
    ) -> Result<String> {
        let col_list = columns.join(", ");
        let value_sets: Vec<String> = rows
            .iter()
            .map(|row| {
                let quoted: Vec<String> = row.iter().map(|v| format!("'{}'", v)).collect();
                format!("({})", quoted.join(", "))
            })
            .collect();
        let sql = format!(
            "INSERT INTO {} ({}) VALUES {};",
            table,
            col_list,
            value_sets.join(", ")
        );
        self.exec(&sql)
    }

    // --- Cache API ---

    /// Set a cache key with a value and TTL in seconds.
    pub fn cache_set(&mut self, key: &str, value: &str, ttl: i64) -> Result<()> {
        self.exec(&format!("CACHE SET {} {} EX {}", key, value, ttl))?;
        Ok(())
    }

    /// Get a value from the cache by key.
    pub fn cache_get(&mut self, key: &str) -> Result<String> {
        let result = self.query(&format!("CACHE GET {}", key))?;
        Ok(result.get_message())
    }

    /// Delete a key from the cache.
    pub fn cache_del(&mut self, key: &str) -> Result<()> {
        self.exec(&format!("CACHE DEL {}", key))?;
        Ok(())
    }

    /// List cache keys matching a pattern.
    pub fn cache_keys(&mut self, pattern: &str) -> Result<VedaResult> {
        self.query(&format!("CACHE KEYS {}", pattern))
    }

    // --- Search API ---

    /// Perform a full-text search on a table.
    pub fn search(&mut self, table: &str, query: &str, fuzzy: i32) -> Result<String> {
        let sql = format!(
            "SEARCH {} MATCH(*) AGAINST('{}') FUZZY {}",
            table, query, fuzzy
        );
        self.exec(&sql)
    }

    // --- Graph API ---

    /// Add a node to the graph with a label and optional properties.
    pub fn graph_add_node(&mut self, id: &str, label: &str, props: &[(&str, &str)]) -> Result<()> {
        let props_str: Vec<String> = props
            .iter()
            .map(|(k, v)| format!("{}: '{}'", k, v))
            .collect();
        let sql = format!(
            "GRAPH ADD NODE {} LABEL {} {{{}}}",
            id,
            label,
            props_str.join(", ")
        );
        self.exec(&sql)?;
        Ok(())
    }

    /// Add an edge between two nodes.
    pub fn graph_add_edge(&mut self, from: &str, to: &str, edge_type: &str) -> Result<()> {
        self.exec(&format!(
            "GRAPH ADD EDGE {} -> {} TYPE {}",
            from, to, edge_type
        ))?;
        Ok(())
    }

    /// Perform a breadth-first search from a starting node.
    pub fn graph_bfs(&mut self, start: &str, depth: i32) -> Result<VedaResult> {
        self.query(&format!("GRAPH BFS {} DEPTH {}", start, depth))
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod escape_tests {
    //! Audit #23 closure for the Rust driver: pure-unit tests for
    //! escape_sql_value and validate_prepared_arg. No network.
    use super::*;

    #[test]
    fn escape_basic_string() {
        assert_eq!(escape_sql_value("alice"), "'alice'");
    }

    #[test]
    fn escape_doubles_single_quotes() {
        assert_eq!(escape_sql_value("O'Brien"), "'O''Brien'");
        // Classic injection payload: must turn into an inert literal.
        assert_eq!(
            escape_sql_value("'; DROP TABLE users; --"),
            "'''; DROP TABLE users; --'"
        );
    }

    #[test]
    fn escape_empty_string() {
        assert_eq!(escape_sql_value(""), "''");
    }

    #[test]
    fn escape_no_backslash_handling() {
        // SQL-standard: backslash is NOT special. Round-trip verbatim.
        assert_eq!(escape_sql_value("a\\b"), "'a\\b'");
    }

    #[test]
    fn validate_rejects_nul_byte() {
        let s = String::from("a") + "\0" + "b";
        let err = validate_prepared_arg(&s).unwrap_err();
        match err {
            VedaError::Query(msg) => assert!(msg.contains("NUL")),
            _ => panic!("expected VedaError::Query, got {:?}", err),
        }
    }

    #[test]
    fn validate_accepts_normal_string() {
        validate_prepared_arg("alice").expect("normal string rejected");
        validate_prepared_arg("O'Brien").expect("apostrophe rejected");
        validate_prepared_arg("").expect("empty rejected");
    }
}
