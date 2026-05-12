# VedaDB Rust Driver

Official Rust driver for VedaDB - The Multi-Model Database Engine.

## Features

| # | Feature | Status | Module |
|---|---------|--------|--------|
| 1 | Core Sync Client | Done | `client.rs` |
| 2 | Async Client (tokio) | Done | `async_client.rs` |
| 3 | Connection Pool | Done | `pool.rs` |
| 4 | Wire Protocol | Done | `protocol.rs` |
| 5 | Query Result | Done | `result.rs` |
| 6 | Retry + Exponential Backoff | Done | `retry.rs` |
| 7 | Circuit Breaker | Done | `circuit.rs` |
| 8 | Health Checker | Done | `health.rs` |
| 9 | Bulk Inserter + Pipeline | Done | `bulk.rs` |
| 10 | Streaming Cursor | Done | `cursor.rs` |
| 11 | Pub/Sub | Done | `pubsub.rs` |
| 12 | URI Parser | Done | `uri.rs` |
| 13 | TLS/SSL Support | Done | `tls.rs` |
| 14 | Change Streams | Done | `change_stream.rs` |
| 15 | Fluent Query Builder | Done | `query_builder.rs` |
| 16 | Query Cache | Done | `cache.rs` |
| 17 | Read/Write Splitting | Done | `rw_split.rs` |
| 18 | Load Balancer | Done | `load_balance.rs` |
| 19 | Prometheus Metrics | Done | `metrics.rs` |
| 20 | Middleware / Interceptors | Done | `interceptor.rs` |
| 21 | Multi-Node Failover | Done | `failover.rs` |

## Quick Start

### Synchronous Usage

```rust
use vedadb::{VedaClient, VedaConfig};

fn main() -> vedadb::Result<()> {
    // Connect using builder
    let mut client = VedaClient::new(
        VedaConfig::builder()
            .host("localhost")
            .port(6380)
            .build()?
    )?;
    client.connect()?;

    // Query
    let result = client.query("SELECT * FROM users;", None)?;
    for row in result.to_maps() {
        println!("{:?}", row);
    }

    // With parameters
    let result = client.query(
        "SELECT * FROM users WHERE age > ?;",
        Some(&[25i64.into()]),
    )?;

    client.close();
    Ok(())
}
```

### Async Usage (tokio)

```rust
use vedadb::AsyncVedaClient;

#[tokio::main]
async fn main() -> vedadb::Result<()> {
    let mut client = AsyncVedaClient::from_uri("vedadb://localhost:6380").await?;
    let result = client.query("SELECT * FROM users;", None).await?;
    println!("{:?}", result.to_maps());
    Ok(())
}
```

### Connection Pool

```rust
use vedadb::{VedaPool, VedaConfig};

let pool = VedaPool::new(VedaConfig::builder().host("localhost").port(6380).build()?)?;
let mut conn = pool.acquire()?;
let result = conn.query("SELECT 1;", None)?;
pool.close();
```

### Query Builder

```rust
use vedadb::QueryBuilder;

let sql = QueryBuilder::select("users")
    .columns(&["id", "name"])
    .where_eq("active", true)
    .where_gt("age", 18i64)
    .order_by_desc("created_at")
    .limit(10)
    .build()?;
```

### Circuit Breaker

```rust
use vedadb::CircuitBreaker;

let cb = CircuitBreaker::new("db-query");
let result = cb.execute(|| {
    client.query("SELECT * FROM data;", None)
});
```

### Read/Write Splitting

```rust
use vedadb::ReadWriteSplit;

let rw = ReadWriteSplit::new(primary_config, vec![replica1_config, replica2_config])?;
let result = rw.query("SELECT * FROM users;", None)?; // Routes to replica
let rows = rw.execute("UPDATE users SET active = true;", None)?; // Routes to primary
```

### Load Balancer

```rust
use vedadb::{LoadBalancer, BalanceStrategy};

let lb = LoadBalancer::new(
    vec![node1_config, node2_config, node3_config],
    BalanceStrategy::RoundRobin,
)?;
let result = lb.query("SELECT * FROM data;", None)?;
```

### Multi-Node Failover

```rust
use vedadb::{FailoverCluster, FailoverStrategy};

let cluster = FailoverCluster::new(
    vec![
        ("node1".to_string(), node1_config),
        ("node2".to_string(), node2_config),
        ("node3".to_string(), node3_config),
    ],
    FailoverStrategy::Failover,
)?;
let result = cluster.query("SELECT * FROM data;", None)?;
```

### Change Streams

```rust
let mut stream = client.change_stream("users").await?;
while let Some(event) = stream.next().await {
    println!("Change: {:?} on {}", event.operation, event.table);
}
```

### Pub/Sub

```rust
let pubsub = client.pubsub();
let rx = pubsub.subscribe("notifications")?;
pubsub.publish(&mut client, "notifications", "hello")?;
```

### URI Connection String

```
vedadb://user:pass@host:6380/database?timeout=30&pool_size=10
vedadb+tls://host:6380/db?tls_verify=true
```

## Cargo Features

- `tokio` (default) - Async support via tokio
- `metrics` - Prometheus-compatible metrics export

## Architecture

```
+------------------+     +------------------+     +------------------+
|   VedaClient     |<--->|   Protocol       |<--->|   TCP Stream     |
|                  |     |   (wire format)  |     |   (TLS optional) |
+------------------+     +------------------+     +------------------+
       ^
       | uses
       v
+------------------+     +------------------+     +------------------+
|   VedaPool       |<--->|   RetryPolicy    |<--->|  CircuitBreaker  |
|   (connections)  |     |   (backoff)      |     |  (fault tolerance|
+------------------+     +------------------+     +------------------+
       ^
       | integrates with
       v
+------------------+     +------------------+     +------------------+
|   FailoverCluster|<--->|   LoadBalancer   |<--->|  ReadWriteSplit  |
|   (HA)           |     |   (distribution) |     |  (read replicas) |
+------------------+     +------------------+     +------------------+
       ^
       | monitoring
       v
+------------------+     +------------------+     +------------------+
|   HealthChecker  |     |   Metrics        |     |  InterceptorChain|
|   (node health)  |     |   (prometheus)   |     |  (middleware)    |
+------------------+     +------------------+     +------------------+
```

## License

Apache-2.0
