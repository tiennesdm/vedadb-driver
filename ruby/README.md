# VedaDB Ruby Driver

Official Ruby client for [VedaDB](https://github.com/vedadb/vedadb) -- the multi-model database engine.

Communicates over a plain `TCPSocket` on port 6380 with zero external dependencies.

## Installation

```bash
gem install vedadb
```

Or add to your Gemfile:

```ruby
gem "vedadb", "~> 0.2"
```

Then run:

```bash
bundle install
```

## Quick Start

```ruby
require "vedadb"

VedaDB.connect("localhost", 6380) do |db|
  # Create a table
  db.exec("CREATE TABLE users (id INT, name TEXT, email TEXT, age INT);")

  # Insert rows
  db.insert("users", { id: 1, name: "Alice", email: "alice@example.com", age: 30 })
  db.insert("users", { id: 2, name: "Bob", email: "bob@example.com", age: 25 })

  # Query
  result = db.query("SELECT * FROM users WHERE age > 20;")
  puts result.to_hashes
  # [{"id"=>"1", "name"=>"Alice", "email"=>"alice@example.com", "age"=>"30"}, ...]

  # Select helper
  young = db.select("users", columns: "name, age", where: "age < 30", order_by: "age", limit: 10)
  puts young.to_hashes

  # Update
  db.update("users", { age: 31 }, where: "name = 'Alice'")

  # Delete
  db.delete("users", where: "name = 'Bob'")
end
# Connection is automatically closed when the block exits
```

## Connection Options

| Parameter | Type      | Default       | Description                         |
|-----------|-----------|---------------|-------------------------------------|
| `host`    | `String`  | `"localhost"` | VedaDB server hostname or IP        |
| `port`    | `Integer` | `6380`        | VedaDB server port                  |
| `timeout` | `Integer` | `30`          | Socket read/write timeout (seconds) |

## API Reference

### `VedaDB::Client.new(host, port, timeout:)`

Creates a new client and immediately connects to the VedaDB server.

| Parameter | Type      | Default       | Description               |
|-----------|-----------|---------------|---------------------------|
| `host`    | `String`  | `"localhost"` | Server hostname           |
| `port`    | `Integer` | `6380`        | Server port               |
| `timeout` | `Integer` | `30`          | Socket timeout in seconds |

**Returns:** `VedaDB::Client`

```ruby
db = VedaDB::Client.new("localhost", 6380, timeout: 10)
# ... use db ...
db.close
```

---

### `VedaDB::Client.open(host, port, timeout:) { |db| }`

Opens a connection and yields the client to a block. The connection is automatically closed when the block exits, even if an exception is raised. If no block is given, returns the client (caller is responsible for closing).

| Parameter | Type      | Default       | Description               |
|-----------|-----------|---------------|---------------------------|
| `host`    | `String`  | `"localhost"` | Server hostname           |
| `port`    | `Integer` | `6380`        | Server port               |
| `timeout` | `Integer` | `30`          | Socket timeout in seconds |

**Returns:** Block return value (with block) or `VedaDB::Client` (without block)

```ruby
VedaDB::Client.open("localhost", 6380) do |db|
  result = db.query("SELECT * FROM users;")
  puts result.to_hashes
end
# Connection closed automatically
```

---

### `VedaDB.connect(host, port, timeout:, &block)`

Module-level convenience method. Delegates to `Client.open`.

| Parameter | Type      | Default       | Description               |
|-----------|-----------|---------------|---------------------------|
| `host`    | `String`  | `"localhost"` | Server hostname           |
| `port`    | `Integer` | `6380`        | Server port               |
| `timeout` | `Integer` | `30`          | Socket timeout in seconds |

**Returns:** Block return value (with block) or `VedaDB::Client` (without block)

```ruby
VedaDB.connect("localhost", 6380) do |db|
  db.exec("CREATE TABLE logs (id INT, msg TEXT);")
end
```

---

### `query(sql)`

Executes a VedaQL query and returns a `Result` object containing columns, rows, and metadata.

| Parameter | Type     | Description          |
|-----------|----------|----------------------|
| `sql`     | `String` | The VedaQL statement |

**Returns:** `VedaDB::Result`

**Raises:** `VedaDB::ConnectionError` if the connection is closed, `VedaDB::QueryError` if the server reports an error.

```ruby
result = db.query("SELECT name, age FROM users WHERE age > 25;")
puts result.columns   # ["name", "age"]
puts result.rows      # [["Alice", "30"], ["Charlie", "35"]]
puts result.row_count # 2
```

---

### `exec(sql)`

Executes a DDL or DML statement and returns the status message string. Useful for `CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`, and other non-query statements.

| Parameter | Type     | Description          |
|-----------|----------|----------------------|
| `sql`     | `String` | The VedaQL statement |

**Returns:** `String` -- the server message (e.g. `"Table created"`) or `"N rows"`.

```ruby
msg = db.exec("CREATE TABLE products (id INT, name TEXT, price FLOAT);")
puts msg # "Table created"
```

---

### `insert(table, data)`

Inserts a single row into a table using a Ruby hash.

| Parameter | Type     | Description                        |
|-----------|----------|------------------------------------|
| `table`   | `String` | Target table name                  |
| `data`    | `Hash`   | Column-value pairs for the new row |

**Returns:** `String` -- status message.

Values are auto-formatted: strings are quoted, `nil` becomes `NULL`, booleans become `TRUE`/`FALSE`, and numbers are passed as-is.

```ruby
db.insert("products", { id: 1, name: "Widget", price: 9.99 })
db.insert("products", { id: 2, name: "Gadget", price: 24.50 })
```

---

### `select(table, columns:, where:, order_by:, limit:)`

Builds and executes a `SELECT` query from keyword arguments.

| Parameter  | Type             | Default | Description                        |
|------------|------------------|---------|------------------------------------|
| `table`    | `String`         | --      | Table name                         |
| `columns`  | `String`         | `"*"`   | Comma-separated column list        |
| `where`    | `String`, `nil`  | `nil`   | WHERE clause (without `WHERE`)     |
| `order_by` | `String`, `nil`  | `nil`   | ORDER BY clause (without keyword)  |
| `limit`    | `Integer`, `nil` | `nil`   | Maximum rows to return             |

**Returns:** `VedaDB::Result`

```ruby
result = db.select("products",
  columns: "name, price",
  where: "price > 10",
  order_by: "price DESC",
  limit: 5
)
puts result.to_hashes
```

---

### `update(table, set, where:)`

Updates rows in a table.

| Parameter | Type             | Description                    |
|-----------|------------------|--------------------------------|
| `table`   | `String`         | Table name                     |
| `set`     | `Hash`           | Column-value pairs to update   |
| `where`   | `String`, `nil`  | WHERE clause (without `WHERE`) |

**Returns:** `String` -- status message.

```ruby
db.update("products", { price: 12.99 }, where: "name = 'Widget'")
```

---

### `delete(table, where:)`

Deletes rows from a table.

| Parameter | Type             | Description                    |
|-----------|------------------|--------------------------------|
| `table`   | `String`         | Table name                     |
| `where`   | `String`, `nil`  | WHERE clause (without `WHERE`) |

**Returns:** `String` -- status message.

```ruby
db.delete("products", where: "price < 5")
```

---

### `show_tables`

Lists all table names in the database.

**Returns:** `Array<String>`

```ruby
tables = db.show_tables
puts tables # ["users", "products", "orders"]
```

---

### `ping`

Checks whether the connection to the server is alive.

**Returns:** `true` if the server responds, `false` otherwise.

```ruby
if db.ping
  puts "Connected"
else
  puts "Connection lost"
end
```

---

### `close`

Closes the TCP connection. Sends a `QUIT` command to the server before disconnecting. Safe to call multiple times.

```ruby
db = VedaDB::Client.new
# ... use db ...
db.close
```

## VedaDB::Result

Query results are returned as `VedaDB::Result` objects with the following attributes and methods.

### Attributes

| Attribute   | Type                     | Description                      |
|-------------|--------------------------|----------------------------------|
| `columns`   | `Array<String>` or `nil` | Column names from the query      |
| `rows`      | `Array<Array>` or `nil`  | Row data as nested arrays        |
| `row_count` | `Integer`                | Number of rows returned/affected |
| `message`   | `String` or `nil`        | Server status message            |

### `to_hashes`

Converts rows into an array of hashes keyed by column name.

**Returns:** `Array<Hash>`

```ruby
result = db.query("SELECT id, name FROM users;")
result.to_hashes
# [{"id" => "1", "name" => "Alice"}, {"id" => "2", "name" => "Bob"}]
```

### `first`

Returns the first row as a hash, or `nil` if the result is empty.

**Returns:** `Hash` or `nil`

```ruby
user = db.query("SELECT * FROM users WHERE id = 1;").first
puts user["name"] # "Alice"
```

### `pluck(column)`

Extracts all values from a single column.

| Parameter | Type     | Description         |
|-----------|----------|---------------------|
| `column`  | `String` | Column name to pick |

**Returns:** `Array`

```ruby
names = db.query("SELECT name FROM users;").pluck("name")
puts names # ["Alice", "Bob", "Charlie"]
```

## Connection Pool

`VedaDB::Pool` provides a thread-safe connection pool for concurrent applications.

### Creating a Pool

```ruby
pool = VedaDB::Pool.new("localhost", 6380, max_size: 10, timeout: 30)
```

| Parameter  | Type      | Default       | Description                          |
|------------|-----------|---------------|--------------------------------------|
| `host`     | `String`  | `"localhost"` | Server hostname                      |
| `port`     | `Integer` | `6380`        | Server port                          |
| `max_size` | `Integer` | `10`          | Maximum idle connections in the pool |
| `timeout`  | `Integer` | `30`          | Socket timeout for new connections   |

### `acquire`

Acquires a client from the pool. Returns an idle client if one is available, otherwise creates a new connection.

**Returns:** `VedaDB::Client`

**Raises:** `VedaDB::Error` if the pool is closed.

### `release(client)`

Returns a client to the pool. If the pool is closed or at capacity, the client is closed instead.

| Parameter | Type             | Description          |
|-----------|------------------|----------------------|
| `client`  | `VedaDB::Client` | The client to return |

### `with { |db| }`

Acquires a client, yields it to the block, and releases it automatically when the block exits. This is the recommended pattern.

```ruby
pool.with do |db|
  result = db.query("SELECT * FROM users;")
  puts result.to_hashes
end
# Client is released back to the pool automatically
```

### `active_count`

Returns the number of clients currently checked out.

**Returns:** `Integer`

### `idle_count`

Returns the number of idle clients available in the pool.

**Returns:** `Integer`

### `close`

Closes all idle connections and marks the pool as closed. Active clients are closed when they are released.

```ruby
pool.close
```

### Full Pool Example

```ruby
require "vedadb"

pool = VedaDB::Pool.new("localhost", 6380, max_size: 5)

threads = 10.times.map do |i|
  Thread.new do
    pool.with do |db|
      db.insert("events", { id: i, name: "event_#{i}" })
    end
  end
end

threads.each(&:join)
puts "Active: #{pool.active_count}, Idle: #{pool.idle_count}"
pool.close
```

## Error Classes

All VedaDB errors inherit from `VedaDB::Error`, which itself inherits from `StandardError`.

| Class                     | Description                                     |
|---------------------------|-------------------------------------------------|
| `VedaDB::Error`           | Base error class for all VedaDB errors          |
| `VedaDB::ConnectionError` | Raised when the TCP connection fails or is lost |
| `VedaDB::QueryError`      | Raised when the server returns a query error    |
| `VedaDB::TimeoutError`    | Raised when a socket operation times out        |

### Rescue Examples

```ruby
# Catch specific errors
begin
  db.query("INVALID SQL;")
rescue VedaDB::QueryError => e
  puts "Query failed: #{e.message}"
rescue VedaDB::ConnectionError => e
  puts "Connection lost: #{e.message}"
rescue VedaDB::TimeoutError
  puts "Operation timed out"
rescue VedaDB::Error => e
  puts "VedaDB error: #{e.message}"
end
```

```ruby
# Retry on connection error
def query_with_retry(db, sql, retries: 3)
  db.query(sql)
rescue VedaDB::ConnectionError
  retries -= 1
  retry if retries > 0
  raise
end
```

## Block Syntax

The Ruby driver embraces idiomatic Ruby patterns for resource management.

```ruby
# Module-level convenience (recommended)
VedaDB.connect("localhost", 6380) do |db|
  db.exec("CREATE TABLE temp (id INT);")
  db.insert("temp", { id: 1 })
end # auto-closed

# Class-level block
VedaDB::Client.open("localhost", 6380) do |db|
  result = db.query("SELECT * FROM temp;")
end # auto-closed

# Manual management (when you need a long-lived connection)
db = VedaDB::Client.new("localhost", 6380)
begin
  db.query("SELECT 1;")
ensure
  db.close
end
```

## Thread Safety

The `VedaDB::Client` uses a `Mutex` to synchronize access to the underlying TCP socket. Each call to `query` acquires the lock before writing to or reading from the socket, making individual operations safe to call from multiple threads.

For multi-threaded workloads, prefer using `VedaDB::Pool` so each thread gets its own connection:

```ruby
pool = VedaDB::Pool.new("localhost", 6380, max_size: 10)

threads = 4.times.map do
  Thread.new do
    pool.with do |db|
      db.query("SELECT * FROM users;")
    end
  end
end
threads.each(&:join)
pool.close
```

## Rails Integration

Create an initializer to set up a global connection pool:

```ruby
# config/initializers/vedadb.rb
require "vedadb"

VEDADB_POOL = VedaDB::Pool.new(
  ENV.fetch("VEDADB_HOST", "localhost"),
  ENV.fetch("VEDADB_PORT", 6380).to_i,
  max_size: ENV.fetch("VEDADB_POOL_SIZE", 10).to_i,
  timeout: 15
)

at_exit { VEDADB_POOL.close }
```

Then use it anywhere in your application:

```ruby
# app/models/user.rb
class User
  def self.recent
    VEDADB_POOL.with do |db|
      result = db.select("users", order_by: "created_at DESC", limit: 10)
      result.to_hashes
    end
  end
end
```

## Requirements

- Ruby 3.0 or later
- A running VedaDB server (default port 6380)
- Zero external dependencies

## License

Apache-2.0. See [LICENSE](../../LICENSE) for details.
