# VedaDB Rust Driver

Official Rust client for [VedaDB](https://github.com/vedadb/vedadb) -- the multi-model database engine.

Communicates over a `TcpStream` on port 6380 using a line-based JSON protocol.

## Installation

Add `vedadb` to your `Cargo.toml`:

```toml
[dependencies]
vedadb = "0.2"
```

Or via the command line:

```bash
cargo add vedadb
```

## Quick Start

```rust
use vedadb::Client;

fn main() -> vedadb::Result<()> {
    let mut db = Client::connect("localhost", 6380)?;

    // Create a table
    db.exec("CREATE TABLE users (id INT, name TEXT, email TEXT, age INT);")?;

    // Insert rows
    db.insert("users", &[("id", &1), ("name", &"Alice"), ("email", &"alice@example.com"), ("age", &30)])?;
    db.insert("users", &[("id", &2), ("name", &"Bob"), ("email", &"bob@example.com"), ("age", &25)])?;

    // Query
    let result = db.query("SELECT * FROM users WHERE age > 20;")?;
    for row in result.to_maps() {
        println!("{:?}", row);
    }

    // Select helper
    let young = db.select("users", Some("name, age"), Some("age < 30"), Some("age"), Some(10))?;
    for row in young.to_maps() {
        println!("{:?}", row);
    }

    // Update
    db.update("users", &[("age", &31)], Some("name = 'Alice'"))?;

    // Delete
    db.delete("users", Some("name = 'Bob'"))?;

    Ok(())
}
// Client is automatically closed via Drop when `db` goes out of scope
```

## Connection Options

```rust
use std::time::Duration;
use vedadb::Client;

// Default 30-second timeout
let mut db = Client::connect("localhost", 6380)?;

// Custom timeout
let mut db = Client::connect_with_timeout("localhost", 6380, Duration::from_secs(10))?;
```

## API Reference

### `Client::connect(host, port)`

Connects to a VedaDB server with the default 30-second timeout.

```rust
pub fn connect(host: &str, port: u16) -> Result<Self>
```

| Parameter | Type   | Description           |
|-----------|--------|-----------------------|
| `host`    | `&str` | Server hostname or IP |
| `port`    | `u16`  | Server port           |

**Returns:** `Result<Client>`

```rust
let mut db = Client::connect("localhost", 6380)?;
```

---

### `Client::connect_with_timeout(host, port, timeout)`

Connects with a custom read/write timeout.

```rust
pub fn connect_with_timeout(host: &str, port: u16, timeout: Duration) -> Result<Self>
```

| Parameter | Type       | Description            |
|-----------|------------|------------------------|
| `host`    | `&str`     | Server hostname or IP  |
| `port`    | `u16`      | Server port            |
| `timeout` | `Duration` | TCP read/write timeout |

**Returns:** `Result<Client>`

```rust
use std::time::Duration;

let mut db = Client::connect_with_timeout("localhost", 6380, Duration::from_secs(5))?;
```

---

### `client.query(sql)`

Executes a VedaQL query and returns the full result.

```rust
pub fn query(&mut self, sql: &str) -> Result<VedaResult>
```

| Parameter | Type   | Description          |
|-----------|--------|----------------------|
| `sql`     | `&str` | The VedaQL statement |

**Returns:** `Result<VedaResult>`

**Errors:** `VedaError::Connection` if the connection is closed, `VedaError::Query` if the server reports an error.

```rust
let result = db.query("SELECT name, age FROM users WHERE age > 25;")?;
println!("Columns: {:?}", result.columns);   // Some(["name", "age"])
println!("Row count: {}", result.row_count);  // 2
```

---

### `client.exec(sql)`

Executes a DDL or DML statement and returns the status message. Useful for `CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`, and other non-query statements.

```rust
pub fn exec(&mut self, sql: &str) -> Result<String>
```

| Parameter | Type   | Description          |
|-----------|--------|----------------------|
| `sql`     | `&str` | The VedaQL statement |

**Returns:** `Result<String>` -- the server message (e.g. `"Table created"`) or `"N rows"`.

```rust
let msg = db.exec("CREATE TABLE products (id INT, name TEXT, price FLOAT);")?;
println!("{}", msg); // "Table created"
```

---

### `client.insert(table, data)`

Inserts a single row into a table.

```rust
pub fn insert(&mut self, table: &str, data: &[(&str, &dyn std::fmt::Display)]) -> Result<String>
```

| Parameter | Type                                | Description                        |
|-----------|-------------------------------------|------------------------------------|
| `table`   | `&str`                              | Target table name                  |
| `data`    | `&[(&str, &dyn std::fmt::Display)]` | Column-value pairs for the new row |

**Returns:** `Result<String>` -- status message.

All values are formatted through the `Display` trait and wrapped in single quotes.

```rust
db.insert("products", &[
    ("id", &1),
    ("name", &"Widget"),
    ("price", &9.99),
])?;
```

---

### `client.select(table, columns, where_clause, order_by, limit)`

Builds and executes a `SELECT` query.

```rust
pub fn select(
    &mut self,
    table: &str,
    columns: Option<&str>,
    where_clause: Option<&str>,
    order_by: Option<&str>,
    limit: Option<u32>,
) -> Result<VedaResult>
```

| Parameter      | Type           | Description                            |
|----------------|----------------|----------------------------------------|
| `table`        | `&str`         | Table name                             |
| `columns`      | `Option<&str>` | Comma-separated columns, `None` = `*`  |
| `where_clause` | `Option<&str>` | WHERE condition (without keyword)      |
| `order_by`     | `Option<&str>` | ORDER BY clause (without keyword)      |
| `limit`        | `Option<u32>`  | Maximum rows to return                 |

**Returns:** `Result<VedaResult>`

```rust
let result = db.select(
    "products",
    Some("name, price"),
    Some("price > 10"),
    Some("price DESC"),
    Some(5),
)?;
for row in result.to_maps() {
    println!("{:?}", row);
}
```

---

### `client.update(table, set, where_clause)`

Updates rows in a table.

```rust
pub fn update(
    &mut self,
    table: &str,
    set: &[(&str, &dyn std::fmt::Display)],
    where_clause: Option<&str>,
) -> Result<String>
```

| Parameter      | Type                                | Description                       |
|----------------|-------------------------------------|-----------------------------------|
| `table`        | `&str`                              | Table name                        |
| `set`          | `&[(&str, &dyn std::fmt::Display)]` | Column-value pairs to update      |
| `where_clause` | `Option<&str>`                      | WHERE condition (without keyword) |

**Returns:** `Result<String>` -- status message.

```rust
db.update("products", &[("price", &12.99)], Some("name = 'Widget'"))?;
```

---

### `client.delete(table, where_clause)`

Deletes rows from a table.

```rust
pub fn delete(&mut self, table: &str, where_clause: Option<&str>) -> Result<String>
```

| Parameter      | Type           | Description                       |
|----------------|----------------|-----------------------------------|
| `table`        | `&str`         | Table name                        |
| `where_clause` | `Option<&str>` | WHERE condition (without keyword) |

**Returns:** `Result<String>` -- status message.

```rust
db.delete("products", Some("price < 5"))?;
```

---

### `client.show_tables()`

Lists all table names in the database.

```rust
pub fn show_tables(&mut self) -> Result<Vec<String>>
```

**Returns:** `Result<Vec<String>>`

```rust
let tables = db.show_tables()?;
println!("{:?}", tables); // ["users", "products", "orders"]
```

---

### `client.ping()`

Checks whether the connection to the server is alive.

```rust
pub fn ping(&mut self) -> bool
```

**Returns:** `true` if the server responds, `false` otherwise.

```rust
if db.ping() {
    println!("Connected");
} else {
    println!("Connection lost");
}
```

---

### `client.close()`

Sends a `QUIT` command and flushes the stream. Also called automatically via the `Drop` trait when the client goes out of scope.

```rust
pub fn close(&mut self)
```

```rust
let mut db = Client::connect("localhost", 6380)?;
// ... use db ...
db.close();
```

## VedaResult

Query results are returned as `VedaResult` structs deserialized from the server's JSON response.

### Fields

| Field      | Type                                  | Description                      |
|------------|---------------------------------------|----------------------------------|
| `columns`  | `Option<Vec<String>>`                 | Column names from the query      |
| `rows`     | `Option<Vec<Vec<serde_json::Value>>>` | Row data as nested vectors       |
| `row_count`| `i64`                                 | Number of rows returned/affected |
| `message`  | `Option<String>`                      | Server status message            |
| `error`    | `Option<String>`                      | Error message (if any)           |

### `to_maps()`

Converts rows into a vector of `HashMap<String, String>` keyed by column name.

**Returns:** `Vec<HashMap<String, String>>`

```rust
let result = db.query("SELECT id, name FROM users;")?;
for map in result.to_maps() {
    println!("id={}, name={}", map["id"], map["name"]);
}
```

### `first()`

Returns the first row as a `HashMap`, or `None` if the result is empty.

**Returns:** `Option<HashMap<String, String>>`

```rust
if let Some(user) = db.query("SELECT * FROM users WHERE id = 1;")?.first() {
    println!("Name: {}", user["name"]);
}
```

### `pluck(column)`

Extracts all values from a single column as strings.

| Parameter | Type   | Description         |
|-----------|--------|---------------------|
| `column`  | `&str` | Column name to pick |

**Returns:** `Vec<String>`

```rust
let names = db.query("SELECT name FROM users;")?.pluck("name");
println!("{:?}", names); // ["Alice", "Bob", "Charlie"]
```

### `get_message()`

Returns the server message, or a default `"N rows"` string if no message is present.

**Returns:** `String`

```rust
let result = db.query("INSERT INTO users (id, name) VALUES (3, 'Charlie');")?;
println!("{}", result.get_message()); // "1 rows"
```

## VedaError

All errors are represented by the `VedaError` enum, derived with the `thiserror` crate.

| Variant                    | Description                                           |
|----------------------------|-------------------------------------------------------|
| `Connection(String)`       | TCP connection failed or was lost                     |
| `Query(String)`            | Server returned a query error                         |
| `Timeout`                  | Socket operation timed out                            |
| `Io(std::io::Error)`       | Underlying I/O error (auto-converted via `From`)      |
| `Parse(serde_json::Error)` | JSON deserialization failed (auto-converted via `From`)|

### Pattern Matching

```rust
use vedadb::VedaError;

match db.query("INVALID SQL;") {
    Ok(result) => println!("{:?}", result.to_maps()),
    Err(VedaError::Query(msg)) => eprintln!("Query failed: {}", msg),
    Err(VedaError::Connection(msg)) => eprintln!("Connection lost: {}", msg),
    Err(VedaError::Timeout) => eprintln!("Operation timed out"),
    Err(VedaError::Io(e)) => eprintln!("I/O error: {}", e),
    Err(VedaError::Parse(e)) => eprintln!("Parse error: {}", e),
}
```

### The `?` Operator

The crate defines `pub type Result<T> = std::result::Result<T, VedaError>`, so you can use `?` for concise error propagation:

```rust
fn setup_database() -> vedadb::Result<()> {
    let mut db = Client::connect("localhost", 6380)?;
    db.exec("CREATE TABLE items (id INT, name TEXT);")?;
    db.insert("items", &[("id", &1), ("name", &"Hammer")])?;

    let result = db.query("SELECT * FROM items;")?;
    println!("{:?}", result.to_maps());
    Ok(())
}
```

## Connection Pool

`vedadb::Pool` provides a thread-safe connection pool.

### Creating a Pool

```rust
use vedadb::Pool;
use std::time::Duration;

// Default 30-second timeout
let pool = Pool::new("localhost", 6380, 10);

// Custom timeout
let pool = Pool::with_timeout("localhost", 6380, 10, Duration::from_secs(5));
```

| Parameter  | Type       | Description                          |
|------------|------------|--------------------------------------|
| `host`     | `&str`     | Server hostname                      |
| `port`     | `u16`      | Server port                          |
| `max_size` | `usize`    | Maximum idle connections in the pool |
| `timeout`  | `Duration` | TCP timeout for new connections      |

### `pool.acquire()`

Acquires a client from the pool. Returns an idle client if available, otherwise opens a new connection.

```rust
pub fn acquire(&self) -> Result<Client>
```

**Returns:** `Result<Client>`

**Errors:** `VedaError::Connection` if the pool is closed.

### `pool.release(client)`

Returns a client to the pool. If the pool is closed or at capacity, the client is dropped (triggering `close` via the `Drop` trait).

```rust
pub fn release(&self, client: Client)
```

| Parameter | Type     | Description          |
|-----------|----------|----------------------|
| `client`  | `Client` | The client to return |

### `pool.idle_count()`

Returns the number of idle clients available in the pool.

```rust
pub fn idle_count(&self) -> usize
```

**Returns:** `usize`

### `pool.close()`

Closes all idle connections and marks the pool as closed. Future calls to `acquire` will return an error. Active clients are closed when they are dropped.

```rust
pub fn close(&self)
```

### Full Pool Example

```rust
use vedadb::Pool;
use std::thread;

fn main() -> vedadb::Result<()> {
    let pool = Pool::new("localhost", 6380, 10);

    thread::scope(|s| {
        for i in 0..4 {
            s.spawn(|| {
                let mut client = pool.acquire().unwrap();
                client
                    .insert(
                        "events",
                        &[
                            ("id", &i as &dyn std::fmt::Display),
                            ("name", &format!("event_{}", i)),
                        ],
                    )
                    .unwrap();
                pool.release(client);
            });
        }
    });

    println!("Idle connections: {}", pool.idle_count());
    pool.close();
    Ok(())
}
```

## Drop Trait (RAII)

`Client` implements the `Drop` trait, so the connection is automatically closed when the client goes out of scope. You do not need to call `close()` explicitly in most cases.

```rust
{
    let mut db = Client::connect("localhost", 6380)?;
    db.exec("CREATE TABLE temp (id INT);")?;
    // db.close() is called automatically when `db` is dropped here
}
```

This follows the standard Rust RAII (Resource Acquisition Is Initialization) pattern. The `Drop` implementation sends a `QUIT` command and flushes the TCP stream.

## Thread Safety

The `Client` struct uses an internal `Mutex` to synchronize access to the TCP stream. Each call to `query` acquires the lock before writing to or reading from the socket.

For multi-threaded workloads, prefer `Pool` so each thread gets its own connection:

```rust
use vedadb::Pool;
use std::thread;

let pool = Pool::new("localhost", 6380, 8);

thread::scope(|s| {
    for _ in 0..8 {
        s.spawn(|| {
            let mut client = pool.acquire().unwrap();
            let result = client.query("SELECT * FROM users;").unwrap();
            println!("{:?}", result.to_maps());
            pool.release(client);
        });
    }
});

pool.close();
```

## Error Handling

The idiomatic Rust approach uses `Result<T, VedaError>` (aliased as `vedadb::Result<T>`) and the `?` operator for concise error propagation.

```rust
fn run() -> vedadb::Result<()> {
    let mut db = Client::connect("localhost", 6380)?;

    // All operations return Result, so ? works throughout
    db.exec("CREATE TABLE logs (id INT, level TEXT, msg TEXT);")?;
    db.insert("logs", &[("id", &1), ("level", &"INFO"), ("msg", &"started")])?;

    let result = db.query("SELECT * FROM logs;")?;
    for row in result.to_maps() {
        println!("{}: {}", row["level"], row["msg"]);
    }

    Ok(())
}
```

For more granular handling, match on specific `VedaError` variants:

```rust
use vedadb::{Client, VedaError, VedaResult};

fn query_with_retry(db: &mut Client, sql: &str, retries: u32) -> vedadb::Result<VedaResult> {
    for attempt in 0..retries {
        match db.query(sql) {
            Ok(result) => return Ok(result),
            Err(VedaError::Connection(_)) if attempt < retries - 1 => continue,
            Err(e) => return Err(e),
        }
    }
    Err(VedaError::Connection("max retries exceeded".into()))
}
```

## Dependencies

| Crate        | Purpose                                                |
|--------------|--------------------------------------------------------|
| `serde`      | Derive `Deserialize` for the `VedaResult` struct       |
| `serde_json` | Parse JSON responses from the VedaDB wire protocol     |
| `thiserror`  | Derive `Error` and `Display` for the `VedaError` enum  |

All dependencies are stable, well-maintained crates from the Rust ecosystem. The driver has no async runtime dependency.

## Requirements

- Rust 1.70 or later (2021 edition)
- A running VedaDB server (default port 6380)

## License

Apache-2.0. See [LICENSE](../../LICENSE) for details.
