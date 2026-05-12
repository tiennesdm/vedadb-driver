# VedaDB Ruby Driver

Official Ruby client for [VedaDB](https://github.com/vedadb/vedadb) — the multi-model database engine.

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

# Block form (auto-closes)
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
end
# Connection is automatically closed when the block exits
```

## Feature Overview

The VedaDB Ruby driver implements **20 production-grade features**:

| # | Feature | File | Description |
|---|---------|------|-------------|
| 1 | **Core Client** | `client.rb` | TCP connection, query, TLS, auth |
| 2 | **Connection Pool** | `pool.rb` | Thread-safe pool with `with_connection` |
| 3 | **Wire Protocol** | `protocol.rb` | JSON framing, encoding/decoding |
| 4 | **Query Result** | `result.rb` | Enumerable results, `to_hashes`, `pluck` |
| 5 | **Error Hierarchy** | `errors.rb` | 10 specialized error classes |
| 6 | **Retry + Backoff** | `retry.rb` | Exponential backoff with jitter mixin |
| 7 | **Circuit Breaker** | `circuit_breaker.rb` | CLOSED/OPEN/HALF_OPEN states |
| 8 | **Health Checker** | `health.rb` | Periodic background health checks |
| 9 | **Bulk Inserter** | `bulk.rb` | Auto-batching inserts + pipeline |
| 10 | **Streaming Cursor** | `cursor.rb` | Server-side cursor with `Enumerable` |
| 11 | **Pub/Sub** | `pubsub.rb` | Channel subscribe/publish/messaging |
| 12 | **URI Parser** | `uri.rb` | `vedadb://` URI with query params |
| 13 | **TLS/SSL** | `tls.rb` | STARTTLS upgrade + client certs |
| 14 | **Change Streams** | `change_stream.rb` | Real-time table change notifications |
| 15 | **Fluent Query Builder** | `query_builder.rb` | Method-chaining SQL builder |
| 16 | **Query Cache** | `cache.rb` | In-memory TTL cache |
| 17 | **Read/Write Split** | `rw_split.rb` | Route reads to replicas |
| 18 | **Load Balancer** | `load_balancer.rb` | Round-robin/random/least-conn/hash |
| 19 | **Prometheus Metrics** | `metrics.rb` | Full exposition format output |
| 20 | **Middleware** | `interceptor.rb` | Pluggable interceptor pipeline |
| 21 | **Multi-node Failover** | `failover.rb` | Auto leader election + failover |

---

## Connection Options

| Parameter | Type      | Default       | Description                         |
|-----------|-----------|---------------|-------------------------------------|
| `host`    | `String`  | `"localhost"` | VedaDB server hostname or IP        |
| `port`    | `Integer` | `6380`        | VedaDB server port                  |
| `timeout` | `Integer` | `30`          | Socket read/write timeout (seconds) |
| `tls`     | `Boolean` | `false`       | Enable TLS encryption               |
| `username`| `String`  | `nil`         | Authentication username             |
| `password`| `String`  | `nil`         | Authentication password             |

---

## Core API

### `VedaDB.connect(host, port, **opts) { |db| }`

Module-level convenience. Creates a client, yields it, auto-closes.

```ruby
VedaDB.connect("localhost", 6380, timeout: 15) do |db|
  db.query("SELECT * FROM users;")
end
```

### `VedaDB.connect_uri(uri_string) { |db| }`

Connect from a `vedadb://` URI:

```ruby
VedaDB.connect_uri("vedadb://admin:secret@db.example.com:6380/mydb?tls=true&timeout=15") do |db|
  db.query("SELECT 1;")
end
```

### `VedaDB::Client.new(host, port, **opts)`

```ruby
db = VedaDB::Client.new("localhost", 6380, timeout: 10, tls: true, username: "admin", password: "secret")
```

### `VedaDB::Client.open(host, port, **opts) { |db| }`

Class-level block form with auto-close.

### `VedaDB::Client.from_uri(uri_string)` / `VedaDB::Client.connect(uri_string)`

Factory from URI string.

---

## Query Methods

```ruby
# Execute a query
result = db.query("SELECT * FROM users WHERE age > ?;", [21])

# DDL/DML — returns status string
db.exec("CREATE TABLE logs (id INT, msg TEXT);")

# Insert from Hash
db.insert("users", { id: 1, name: "Alice", age: 30 })

# Select helper
result = db.select("users", columns: "name, age", where: "age > 21", order_by: "age DESC", limit: 10)

# Update
db.update("users", { age: 31 }, where: "name = 'Alice'")

# Delete
db.delete("users", where: "name = 'Bob'")
```

### Prepared Statements

```ruby
db.prepare("get_user", "SELECT * FROM users WHERE id = ?;")
result = db.execute_prepared("get_user", 1)
db.deallocate("get_user")
```

### Transactions

```ruby
db.transaction do |tx|
  tx.insert("accounts", { id: 1, balance: 100 })
  tx.insert("ledger", { account_id: 1, amount: -50 })
end # auto commit on success, rollback on error
```

---

## Feature Deep-Dive

### 1. Connection Pool

```ruby
pool = VedaDB.pool("localhost", 6380, max_size: 10)

# with_connection block (recommended)
pool.with_connection do |db|
  db.query("SELECT * FROM users;")
end

# Pool stats
puts pool.stats
# { max_size: 10, active: 2, idle: 3, created: 5, available: 8, closed: false }

pool.close
```

### 2. Retry with Backoff

```ruby
# Client-level retry
db = VedaDB::Client.new("localhost", 6380, retry: { max: 5, base: 0.1 })

# Standalone retryer
retryer = VedaDB::Retry.new(max: 3, base: 0.1)
retryer.call { db.query("SELECT * FROM users;") }

# Mixin
class MyService
  include VedaDB::Retryable
  def fetch(db)
    retryable(on: VedaDB::ConnectionError, max: 3) { db.query("SELECT 1;") }
  end
end
```

### 3. Circuit Breaker

```ruby
db = VedaDB::Client.new("localhost", 6380,
                        circuit_breaker: { threshold: 5, recovery_timeout: 30 })

db.circuit_breaker.state  # => :closed
# After 5 failures: => :open
# Calls fail fast with VedaDB::CircuitOpenError
```

### 4. Health Checker

```ruby
db = VedaDB::Client.new("localhost", 6380)
health = VedaDB::Health.new(db, interval: 5, timeout: 3)

health.on_change { |status, info| puts "Health: #{status}" }
health.start
# ...
puts health.healthy?  # => true / false
health.stop
```

### 5. Bulk Inserter + Pipeline

```ruby
# Bulk insert with auto-batching
db.bulk_insert("users", batch_size: 500) do |bulk|
  10000.times { |i| bulk.add(id: i, name: "user_#{i}") }
end # auto-flush

# Pipeline multiple queries
results = db.pipeline do |p|
  p << "SELECT * FROM users;"
  p << "SELECT COUNT(*) FROM orders;"
  p << "SELECT * FROM products;"
end
# => [Result, Result, Result]
```

### 6. Streaming Cursor

```ruby
# Enumerable cursor
db.cursor("SELECT * FROM large_table;") do |cursor|
  cursor.each do |row|
    puts row["name"]
  end
end

# Lazy processing
db.cursor("SELECT * FROM logs;").lazy
  .select { |r| r["level"] == "ERROR" }
  .first(100)
```

### 7. Pub/Sub

```ruby
pubsub = db.pubsub

# Subscribe in background
pubsub.subscribe("orders", "events") do |channel, message|
  puts "[#{channel}] #{message}"
end

# Publish
pubsub.publish("orders", { id: 1, status: "shipped" })
pubsub.publish("orders", "Hello, world!")

# Cleanup
pubsub.unsubscribe("orders")
pubsub.close
```

### 8. Change Streams

```ruby
# Watch a table for changes
db.watch("users").each do |event|
  puts "#{event['type']}: #{event['data']}"
end

# Filter by operation type
db.watch("orders")
  .filter(:insert, :update)
  .each { |ev| process(ev) }

# Typed handlers
stream = db.watch("logs")
stream.on(:insert) { |ev| index_log(ev) }
stream.on(:delete) { |ev| purge_cache(ev) }
stream.start  # background thread
# ...
stream.stop
```

### 9. Fluent Query Builder

```ruby
db.table("users")
  .select("id", "name", "email")
  .where("age > ?", 21)
  .where("status = ?", "active")
  .order("name ASC")
  .limit(10)
  .all
# => [{"id"=>"1", "name"=>"Alice", ...}, ...]

# Count, exists, first
users = db.table("users")
users.where("age > ?", 21).count      # => 42
users.where("email = ?", "a@b.com").exists? # => true
users.where("id = ?", 1).first        # => {"id"=>"1", ...}

# Insert, update, delete
db.table("users").insert(id: 3, name: "Carol")
db.table("users").where("id = ?", 3).update(name: "Caroline")
db.table("users").where("id = ?", 3).delete
```

### 10. Query Cache

```ruby
cache = VedaDB::Cache.new(ttl: 60, max_size: 1000)

# Fetch or compute
result = cache.get("SELECT * FROM users;") do
  db.query("SELECT * FROM users;")
end

# Direct set/get
cache.set("key", value, ttl: 30)
cache.has?("key")  # => true

# Invalidate by table
cache.invalidate("users")
cache.stats
# => { size: 42, hits: 100, misses: 10, hit_rate: 0.909 }
```

### 11. Read/Write Splitting

```ruby
splitter = VedaDB.rw_split(
  primary: primary_db,
  replicas: [replica1, replica2],
  read_preference: :secondary_preferred,
  strategy: :round_robin
)

splitter.query("SELECT * FROM users;")   # => replica
splitter.exec("INSERT INTO users ...")    # => primary
splitter.stats
# => { reads: 100, writes: 10, read_replicas: 85, read_primary: 15 }
```

### 12. Load Balancer

```ruby
nodes = [db1, db2, db3]
lb = VedaDB.load_balancer(nodes, strategy: :round_robin)

lb.with do |db|
  db.query("SELECT * FROM users;")
end

lb.health_check
lb.stats
# => { total_nodes: 3, healthy: 3, unhealthy: 0, active_connections: 5 }
```

Strategies: `:round_robin`, `:random`, `:least_conn`, `:hash`

### 13. Failover

```ruby
nodes = [
  { host: "db1", port: 6380 },
  { host: "db2", port: 6380 },
  { host: "db3", port: 6380 },
]
fo = VedaDB.failover(nodes, connect_timeout: 5, retry_interval: 3)

client = fo.client        # => connected to leader
fo.leader                 # => { host: "db1", port: 6380 }
fo.failover!              # => manual failover
fo.health_check           # => { "db1:6380" => { healthy: true, ... } }
fo.close
```

### 14. Prometheus Metrics

```ruby
metrics = VedaDB::Metrics.new(namespace: "vedadb")

metrics.query_executed(duration: 0.015, success: true)
metrics.connection_event(event: "open")
metrics.cache_access(hit: true)
metrics.pool_gauge(active: 2, idle: 3, max: 10)
metrics.bulk_inserted(rows: 500)

puts metrics.render
# # HELP vedadb_queries_total Total queries executed
# # TYPE vedadb_queries_total counter
# vedadb_queries_total{status="success"} 42
# ...
```

### 15. Middleware / Interceptors

```ruby
db = VedaDB::Client.new("localhost", 6380)

# Logging
db.use VedaDB::Interceptor::Logging.new(logger: Logger.new($stdout))

# Timing
db.use VedaDB::Interceptor::Timing.new(metrics: my_metrics)

# Retry
db.use VedaDB::Interceptor::Retry.new(max: 3)

# Circuit breaker
db.use VedaDB::Interceptor::Circuit.new(breaker: my_breaker)

# SQL validation
db.use VedaDB::Interceptor::Validate.new

# All queries now flow through the interceptor chain
```

### 16. TLS / SSL

```ruby
# TLS via option
db = VedaDB::Client.new("db.example.com", 6380, tls: true, tls_verify: true)
puts db.tls_info
# => { cipher: "AES256-GCM-SHA384", protocol: "TLSv1.2", ... }

# From URI
VedaDB.connect_uri("vedadb://db.example.com:6380/?tls=true&tls_verify=true")

# Client certificates
db = VedaDB::Client.new("db.example.com", 6380, tls: true,
                        cert_file: "/path/to/client.crt",
                        key_file:  "/path/to/client.key",
                        ca_file:   "/path/to/ca.crt")
```

---

## Ruby Idioms Used

- **Blocks & `yield`** — All resource acquisition uses block form with `ensure` cleanup
- **`Enumerable` mixin** — `Result`, `Cursor`, `ChangeStream` all include `Enumerable`
- **Connection pool `with_connection`** — Block-based pool checkout
- **Retry mixin** — `include VedaDB::Retryable` + `retryable { ... }`
- **Fluent API** — Method chaining on `QueryBuilder`, `ChangeStream`
- **`VedaDB.connect { |db| ... }`** — Module-level block form

---

## Error Hierarchy

```
VedaDB::Error                    # base
├── VedaDB::ConnectionError      # TCP / socket errors
├── VedaDB::QueryError           # server-reported query errors
├── VedaDB::TimeoutError         # socket timeout
├── VedaDB::AuthError            # authentication failure
├── VedaDB::TLSError             # TLS handshake / cert errors
├── VedaDB::PoolError            # pool exhausted / closed
├── VedaDB::CircuitOpenError     # circuit breaker open
├── VedaDB::RetryExhaustedError  # all retries failed
├── VedaDB::URIError             # malformed URI
├── VedaDB::FailoverError        # no healthy nodes
└── VedaDB::MetricsError         # metrics collection error
```

---

## Rails Integration

```ruby
# config/initializers/vedadb.rb
require "vedadb"

VEDADB_POOL = VedaDB.pool(
  ENV.fetch("VEDADB_HOST", "localhost"),
  ENV.fetch("VEDADB_PORT", 6380).to_i,
  max_size: ENV.fetch("VEDADB_POOL_SIZE", 10).to_i,
  timeout:  15,
  tls:      ENV.fetch("VEDADB_TLS", "false") == "true",
  username: ENV["VEDADB_USER"],
  password: ENV["VEDADB_PASS"]
)

at_exit { VEDADB_POOL.close }

# app/models/user.rb
class User
  def self.all
    VEDADB_POOL.with_connection do |db|
      db.table("users").all
    end
  end

  def self.find(id)
    VEDADB_POOL.with_connection do |db|
      db.table("users").where("id = ?", id).first
    end
  end
end
```

---

## Requirements

- Ruby 3.0 or later
- A running VedaDB server (default port 6380)
- Zero external dependencies (stdlib only)

## License

Apache-2.0. See [LICENSE](../../LICENSE) for details.
