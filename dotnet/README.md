# VedaDB .NET Driver

Official .NET client for [VedaDB](https://github.com/vedadb/vedadb) -- the multi-model database engine.

Communicates over TCP (port 6380) using a lightweight JSON wire protocol. Zero external dependencies beyond the .NET runtime -- only `System.Net.Sockets` and `System.Text.Json` from the BCL.

## Features (20 Production Features)

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Core Client** | Full-featured async/sync client with connection management |
| 2 | **Connection Pool** | Min/max sizing, async acquisition, idle reaping, health validation |
| 3 | **Wire Protocol** | Low-level protocol handler with TLS upgrade and message framing |
| 4 | **Query Result** | Rich result set with dictionary mapping, plucking, and scalar values |
| 5 | **Exception Hierarchy** | 9 exception types for different error scenarios |
| 6 | **Retry Policy** | Exponential backoff with jitter, configurable retryable exceptions |
| 7 | **Circuit Breaker** | State machine (Closed/Open/HalfOpen) with automatic recovery |
| 8 | **Health Checker** | Periodic health checks with configurable intervals and thresholds |
| 9 | **Bulk Inserter** | High-performance batch inserts with configurable batch sizes |
| 10 | **Pipeline** | Command batching with optional atomic (transactional) execution |
| 11 | **Streaming Cursor** | `IAsyncEnumerable`-based cursor for large result sets |
| 12 | **Pub/Sub** | Real-time publish/subscribe messaging between clients |
| 13 | **URI Parser** | Parse `vedadb://` and `vedadbs://` connection strings |
| 14 | **TLS/SSL Config** | Full TLS configuration with client certificates and cipher suites |
| 15 | **Change Streams** | Watch table changes in real-time with `IAsyncEnumerable` |
| 16 | **Fluent Query Builder** | Type-safe chainable SQL query construction |
| 17 | **Query Cache** | In-memory cache with TTL, LRU eviction, and pattern invalidation |
| 18 | **Read/Write Split** | Route writes to primary, reads to replicas with fallback |
| 19 | **Load Balancer** | 5 strategies: round-robin, random, least-connections, weighted, IP-hash |
| 20 | **Prometheus Metrics** | Counter, gauge, histogram metrics with text format export |
| 21 | **Interceptor Pipeline** | Middleware for logging, metrics, custom behavior |
| 22 | **Failover Manager** | Automatic failover to backup nodes with optional failback |

## Installation

### .NET CLI

```bash
dotnet add package VedaDB --version 1.0.0
```

### PackageReference

```xml
<PackageReference Include="VedaDB" Version="1.0.0" />
```

### Target Frameworks

Multi-targets **net6.0** and **net8.0**.

---

## Quick Start

```csharp
using VedaDB;

// Connect to VedaDB
await using var db = await VedaClient.ConnectAsync("vedadb://localhost:6380");

// Create a table
await db.ExecuteAsync(@"
    CREATE TABLE users (
        id INT PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(200),
        age INT
    );
");

// Insert a row
await db.InsertAsync("users", new Dictionary<string, object?>
{
    ["id"] = 1,
    ["name"] = "Alice",
    ["email"] = "alice@example.com",
    ["age"] = 30
});

// Query rows
var result = await db.QueryAsync("SELECT * FROM users;");
foreach (var row in result.ToDicts())
{
    Console.WriteLine($"{row["name"]} ({row["email"]})");
}
```

---

## Feature Usage Examples

### Connection Pool

```csharp
var pool = VedaConnectionPool.FromConfig(new VedaConfig
{
    Host = "localhost",
    Port = 6380,
    PoolMinSize = 5,
    PoolMaxSize = 50
});

var client = await pool.AcquireAsync();
try
{
    var result = await client.QueryAsync("SELECT * FROM users;");
}
finally
{
    await pool.ReleaseAsync(client);
}

Console.WriteLine($"Stats: {pool.Stats.ActiveCount} active, {pool.Stats.IdleCount} idle");
```

### Retry Policy

```csharp
var config = new VedaConfig
{
    Host = "localhost",
    Port = 6380,
    Retry = new VedaRetryConfig
    {
        MaxRetries = 5,
        InitialDelayMs = 500,
        BackoffMultiplier = 2.0,
        JitterFactor = 0.1
    }
};

await using var db = new VedaClient(config);
await db.ConnectAsync();
```

### Circuit Breaker

```csharp
var config = new VedaConfig
{
    Host = "localhost",
    Port = 6380,
    CircuitBreaker = new VedaCircuitBreakerConfig
    {
        FailureThreshold = 5,
        RecoveryTimeoutSeconds = 30,
        SuccessThreshold = 2
    }
};

await using var db = new VedaClient(config);
await db.ConnectAsync();

// All queries automatically go through the circuit breaker
var result = await db.QueryAsync("SELECT * FROM users;");
Console.WriteLine($"Circuit state: {db.CircuitBreaker?.State}");
```

### Query Builder

```csharp
var result = await db.Table("users")
    .Select("id", "name", "email")
    .Where("age", ">=", 18)
    .WhereLike("name", "A%")
    .OrderBy("name")
    .Limit(10)
    .ExecuteAsync();

var count = await db.Table("users").Where("active", true).CountAsync();
var exists = await db.Table("users").Where("id", 1).ExistsAsync();
```

### Bulk Insert

```csharp
var bulk = db.CreateBulkInserter("users", batchSize: 500);
foreach (var user in users)
{
    await bulk.AddAsync(new Dictionary<string, object?>
    {
        ["name"] = user.Name,
        ["email"] = user.Email,
        ["age"] = user.Age
    });
}
var stats = await bulk.ExecuteAsync();
Console.WriteLine($"Inserted {stats.TotalInserted} rows in {stats.BatchCount} batches");
```

### Pipeline

```csharp
var pipe = db.CreatePipeline();
pipe
    .AddQuery("SELECT COUNT(*) FROM users;")
    .AddInsert("users", new() { ["name"] = "Alice", ["email"] = "alice@test.com" })
    .AddQuery("SELECT * FROM users WHERE name = 'Alice';");

var result = await pipe.ExecuteAsync();
foreach (var r in result.Results)
    Console.WriteLine($"Rows: {r.RowCount}");
```

### Change Streams

```csharp
await foreach (var evt in db.WatchAsync("users"))
{
    Console.WriteLine($"[{evt.Type}] {evt.Table} at {evt.Timestamp}");
    if (evt.Row != null)
        foreach (var kv in evt.Row)
            Console.WriteLine($"  {kv.Key}: {kv.Value}");
}
```

### Pub/Sub

```csharp
var pubsub = db.CreatePubSub();

await pubsub.SubscribeAsync("notifications", msg =>
{
    Console.WriteLine($"Received on {msg.Channel}: {msg.Payload}");
});

await pubsub.PublishAsync("notifications", "Hello World!");
```

### Load Balancer

```csharp
var lb = new VedaLoadBalancer(LoadBalanceStrategy.LeastConnections);
lb.AddNode("db1.local", 6380, weight: 3);
lb.AddNode("db2.local", 6380, weight: 2);
lb.AddNode("db3.local", 6380, weight: 1);

var node = lb.SelectNode();
var result = await lb.ExecuteAsync(async n =>
{
    var client = new VedaClient(n.Host, n.Port);
    return await client.QueryAsync("SELECT 1;");
});
```

### Read/Write Splitting

```csharp
var rwConfig = new VedaRWSplitConfig
{
    PrimaryHost = "primary.db.local",
    PrimaryPort = 6380,
    Replicas = new() { ("replica1.db.local", 6380), ("replica2.db.local", 6380) },
    FallbackToPrimary = true
};

using var rw = new VedaRWSplit(rwConfig);

// Writes go to primary
var writeResult = await rw.WriteAsync(c => c.QueryAsync("INSERT INTO ..."));

// Reads go to replicas
var readResult = await rw.ReadAsync(c => c.QueryAsync("SELECT * FROM ..."));
```

### Failover

```csharp
var failoverConfig = new VedaFailoverConfig
{
    FailoverNodes = new() { ("backup1.local", 6380), ("backup2.local", 6380) },
    AutoFailback = true,
    FailoverDelay = TimeSpan.FromSeconds(5)
};

using var failover = new VedaFailover(failoverConfig, "primary.local", 6380);
await failover.InitializeAsync();

var result = await failover.ExecuteAsync(c => c.QueryAsync("SELECT * FROM users;"));
```

### Query Cache

```csharp
var config = new VedaConfig
{
    Host = "localhost",
    Port = 6380,
    Cache = new VedaQueryCacheConfig
    {
        MaxEntries = 500,
        DefaultTtl = TimeSpan.FromSeconds(30)
    }
};

await using var db = new VedaClient(config);
await db.ConnectAsync();

// First call hits the database
var r1 = await db.QueryAsync("SELECT * FROM users;");

// Second call returns from cache
var r2 = await db.QueryAsync("SELECT * FROM users;");

var stats = db.QueryCache?.GetStats();
Console.WriteLine($"Hit rate: {stats?.HitRate:P}");
```

### Interceptors

```csharp
db.Interceptors
    .Add(new VedaLoggingInterceptor(msg => Console.WriteLine($"[DB] {msg}")))
    .Add(new VedaMetricsInterceptor());
```

### Prometheus Metrics Export

```csharp
var metrics = VedaMetrics.ExportPrometheus();
// Serve this via your HTTP endpoint for Prometheus scraping
```

---

## Exception Hierarchy

```
Exception
  VedaException                           -- base for all VedaDB errors
    VedaConnectionException                 -- TCP / connection failures
    VedaQueryException                      -- server-side query errors
    VedaCircuitBreakerOpenException         -- circuit breaker is open
    VedaRetryExhaustedException             -- all retries exhausted
    VedaFailoverException                   -- failover failures
    VedaPoolExhaustedException              -- pool is exhausted
    VedaBulkInsertException                 -- bulk insert failures
    VedaUriParseException                   -- URI parsing errors
    VedaInterceptorException                -- interceptor rejected
```

---

## Thread Safety

`VedaClient` is thread-safe. All wire operations are serialized via a `SemaphoreSlim`.

`VedaConnectionPool` is fully thread-safe for concurrent acquire/release.

---

## License

Apache-2.0. See [LICENSE](LICENSE) for details.
