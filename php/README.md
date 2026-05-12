# VedaDB PHP Driver

Official PHP client for [VedaDB](https://github.com/vedadb/vedadb) -- the multi-model database engine.

Communicates over TCP using `stream_socket_client` on port 6380. Zero external dependencies beyond PHP core extensions.

## Requirements

- PHP 8.0 or later
- `ext-json` (built-in on most installations)
- `ext-sockets`

## Installation

### Composer (recommended)

```bash
composer require vedadb/vedadb
```

### Manual

```php
require_once __DIR__ . '/vendor/autoload.php';
```

## Quick Start

```php
<?php
require_once __DIR__ . '/vendor/autoload.php';

use VedaDB\VedaClient;

// Connect
$db = VedaClient::connect('vedadb://localhost:6380');

// Create a table
$db->exec('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100), email VARCHAR(200), age INT);');

// Insert rows
$db->insert('users', ['id' => 1, 'name' => 'Alice', 'email' => 'alice@example.com', 'age' => 30]);
$db->insert('users', ['id' => 2, 'name' => 'Bob',   'email' => 'bob@example.com',   'age' => 25]);

// Query
$result = $db->query('SELECT * FROM users WHERE age > 20;');
print_r($result->toDicts());

// Fluent query builder
$young = $db->table('users')->where('age', '<', 30)->orderBy('name ASC')->get();
print_r($young->toDicts());

// Transaction
$db->transaction(function (VedaClient $client) {
    $client->insert('users', ['id' => 3, 'name' => 'Charlie', 'age' => 28]);
    $client->update('users', ['age' => 31], "name = 'Alice'");
});

$db->close();
```

## Connection

### Constructor

```php
$db = new VedaClient('localhost', 6380, timeout: 30, tls: true, username: 'admin', password: 'secret');
```

### From URI

```php
$db = VedaClient::fromURI('vedadb://admin:secret@localhost:6380?pool_size=10');
$db = VedaClient::fromURI('vedadbs://user:pass@db.example.com:6380'); // TLS
$db = VedaClient::fromURI('vedadb://node1:6380,node2:6380,node3:6380'); // Multi-node
```

## Feature Overview (20 Features)

| # | Feature | Class | Description |
|---|---------|-------|-------------|
| 1 | **Core Client** | `VedaClient` | TCP connection, TLS, auth, query/execute |
| 2 | **Connection Pool** | `VedaConnectionPool` | Reusable connection pool with health checks |
| 3 | **Wire Protocol** | `VedaProtocol` | Framing, serialization, request/response handling |
| 4 | **Query Result** | `VedaResult` | Structured results with toDicts(), first(), pluck() |
| 5 | **Result Set** | `VedaResultSet` | Iterator/Countable for streaming row access |
| 6 | **Error Classes** | `VedaException` | 9 exception types for different error scenarios |
| 7 | **Retry Policy** | `VedaRetryPolicy` | Configurable backoff (fixed/linear/exponential/jitter) |
| 8 | **Circuit Breaker** | `VedaCircuitBreaker` | CLOSED/OPEN/HALF_OPEN states with metrics |
| 9 | **Health Checker** | `VedaHealthChecker` | Periodic health checks with callbacks |
| 10 | **Bulk Inserter** | `VedaBulkInserter` | Buffered batch insert with automatic flushing |
| 11 | **Pipeline** | `VedaPipeline` | Batch multiple commands in a single round-trip |
| 12 | **Streaming Cursor** | `VedaCursor` | Generator-based cursor for large result sets |
| 13 | **Pub/Sub** | `VedaPubSub` | Publish/subscribe messaging |
| 14 | **URI Parser** | `VedaURIParser` | Parse vedadb:// URIs with multi-node support |
| 15 | **TLS/SSL** | `VedaTLS` | SSL context builder and stream upgrade |
| 16 | **Change Streams** | `VedaChangeStream` | Watch database changes (CDC) |
| 17 | **Query Builder** | `VedaQueryBuilder` | Fluent SQL builder with WHERE, JOIN, ORDER, LIMIT |
| 18 | **Query Cache** | `VedaQueryCache` | Client-side LRU/LFU/FIFO cache with TTL |
| 19 | **Read/Write Split** | `VedaRWSplit` | Route reads to replicas, writes to master |
| 20 | **Load Balancer** | `VedaLoadBalancer` | Round-robin, random, least-conn, weighted, hash |
| 21 | **Metrics** | `VedaMetrics` | Prometheus-compatible metrics export |
| 22 | **Middleware** | `VedaInterceptor` | Before/after/error hooks for cross-cutting concerns |
| 23 | **Failover** | `VedaFailover` | Multi-node failover with retry and circuit breaker |

## Feature Details

### 1. Core Client (VedaClient)

```php
use VedaDB\VedaClient;

$db = new VedaClient('localhost', 6380);

// Query
$result = $db->query('SELECT * FROM users WHERE age > 20;');
$rows = $result->toDicts();

// Execute with parameter binding
$count = $db->execute('SELECT * FROM users WHERE age > ? AND name = ?', [18, 'Alice']);

// Prepared statements
$db->prepare('get_user', 'SELECT * FROM users WHERE id = ?');
$result = $db->executePrepared('get_user', '1');
$db->deallocate('get_user');

// CRUD helpers
$db->insert('users', ['id' => 1, 'name' => 'Alice']);
$db->insertMany('users', [['id' => 1], ['id' => 2]]);
$result = $db->select('users', '*', 'age > 20', 'name ASC', 10);
$db->update('users', ['age' => 31], "name = 'Alice'");
$db->delete('users', "age < 18");

// Transactions
$db->transaction(function (VedaClient $c) {
    $c->insert('accounts', ['id' => 1, 'balance' => 100]);
    $c->update('accounts', ['balance' => 90], 'id = 1');
});

// Cache API
$db->cacheSet('key', 'value', 60);
$result = $db->cacheGet('key');
$db->cacheDel('key');

// Search API
$result = $db->search('articles', 'php database', fuzzy: 2);

// Graph API
$db->graphAddNode('user:1', 'User', ['name' => 'Alice']);
$db->graphAddEdge('user:1', 'user:2', 'FOLLOWS');
$result = $db->graphBFS('user:1', depth: 3);
```

### 2. Connection Pool (VedaConnectionPool)

```php
use VedaDB\VedaConnectionPool;

$pool = new VedaConnectionPool('localhost', 6380, maxSize: 20, timeout: 10);

// Acquire and release manually
$client = $pool->acquire();
try {
    $result = $client->query('SELECT * FROM users;');
} finally {
    $pool->release($client);
}

// Automatic acquire/release
$result = $pool->with(function (VedaClient $client) {
    return $client->query('SELECT COUNT(*) FROM users;');
});

echo 'Active: ' . $pool->getActiveCount() . PHP_EOL;
echo 'Idle: ' . $pool->getIdleCount() . PHP_EOL;

$pool->close();
```

### 3. Wire Protocol (VedaProtocol)

```php
use VedaDB\VedaProtocol;

// Encode/decode frames
$frame = VedaProtocol::encode(['cmd' => 'SELECT', 'table' => 'users']);
$data  = VedaProtocol::decode($jsonLine);

// Validate responses
$response = VedaProtocol::validateResponse($data); // throws on error
$result   = VedaProtocol::buildResult($response);
```

### 4. Query Result (VedaResult)

```php
$result = $db->query('SELECT id, name, age FROM users;');

// Get all rows as dicts
$rows = $result->toDicts();        // [['id' => 1, 'name' => 'Alice', 'age' => 30], ...]

// Get first row
$first = $result->first();          // ['id' => 1, 'name' => 'Alice', 'age' => 30]

// Pluck a column
$names = $result->pluck('name');    // ['Alice', 'Bob', 'Charlie']

// Get scalar value
$count = $result->scalar();         // e.g. 42

// Check if empty
if ($result->isEmpty()) { /* ... */ }

// Map and filter
$adults = $result->filter(fn($row) => $row['age'] >= 18);
$names  = $result->map(fn($row) => strtoupper($row['name']));

// Iterator
foreach ($result->getIterator() as $row) { /* ... */ }
```

### 5. Result Set (VedaResultSet)

```php
$rs = $db->query('SELECT * FROM users;')->getIterator();

// Iterator
foreach ($rs as $row) {
    echo $row['name'] . PHP_EOL;
}

// Count
echo "Total: " . count($rs) . PHP_EOL;

// Array access
$all = $rs->toArray();
$first = $rs->first();
$last = $rs->last();
$slice = $rs->slice(10, 20);

// Functional
$adults = $rs->filter(fn($r) => $r['age'] >= 18);
$names  = $rs->map(fn($r) => $r['name']);
$sum    = $rs->reduce(fn($acc, $r) => $acc + $r['balance'], 0);
```

### 6. Error Classes

```php
use VedaDB\VedaException;
use VedaDB\ConnectionException;
use VedaDB\QueryException;
use VedaDB\TimeoutException;
use VedaDB\AuthException;
use VedaDB\CircuitOpenException;
use VedaDB\FailoverException;
use VedaDB\PoolExhaustedException;
use VedaDB\TLSSException;
use VedaDB\ProtocolException;
use VedaDB\ValidationException;

try {
    $db = new VedaClient('localhost', 6380);
    $result = $db->query('SELECT * FROM nonexistent_table;');
} catch (ConnectionException $e) {
    // TCP connection failure
} catch (TimeoutException $e) {
    // Socket timeout
} catch (QueryException $e) {
    // Server returned error
    echo $e->getMessage();
    echo $e->getErrorCode();   // ?int
    echo $e->getSqlState();    // ?string
} catch (VedaException $e) {
    // Any VedaDB error
}
```

### 7. Retry Policy (VedaRetryPolicy)

```php
use VedaDB\VedaRetryPolicy;

// Default: 3 retries, exponential backoff starting at 100ms
$policy = new VedaRetryPolicy();

// Aggressive: 5 retries, 50ms base, jitter
$policy = VedaRetryPolicy::aggressive();

// Conservative: 2 retries, 500ms base, exponential
$policy = VedaRetryPolicy::conservative();

// Custom
$policy = new VedaRetryPolicy(
    maxRetries: 5,
    baseDelayMs: 50,
    maxDelayMs: 5000,
    multiplier: 2.0,
    strategy: 'jitter', // 'fixed', 'linear', 'exponential', 'jitter'
);

// Execute with retry
$result = $policy->execute(function () use ($db) {
    return $db->query('SELECT * FROM critical_table;');
});
```

### 8. Circuit Breaker (VedaCircuitBreaker)

```php
use VedaDB\VedaCircuitBreaker;

$cb = new VedaCircuitBreaker(
    failureThreshold: 5,
    successThreshold: 3,
    timeoutMs: 30000,
    name: 'primary-db',
);

// Execute under circuit breaker protection
$result = $cb->call(function () use ($db) {
    return $db->query('SELECT * FROM users;');
});

// Check state
if ($cb->isOpen()) {
    echo "Circuit is OPEN - failing fast\n";
}
if ($cb->isClosed()) {
    echo "Circuit is CLOSED - normal operation\n";
}

// Metrics
print_r($cb->getMetrics());
```

### 9. Health Checker (VedaHealthChecker)

```php
use VedaDB\VedaHealthChecker;

$health = new VedaHealthChecker('localhost', 6380);

// One-time check
$isHealthy = $health->check(); // true/false

// Periodic check
$health->onStateChange(function (bool $healthy, string $host, int $port) {
    echo "Node {$host}:{$port} is now " . ($healthy ? 'HEALTHY' : 'UNHEALTHY') . "\n";
});

// Auto-check with interval
if ($health->checkIfNeeded()) {
    // Node is healthy
}

// Metrics
print_r($health->getMetrics());
```

### 10. Bulk Inserter (VedaBulkInserter)

```php
// Create bulk inserter with batch size 500
$inserter = $db->bulkInsert('events', batchSize: 500);

// Add rows individually
$inserter->add(['id' => 1, 'type' => 'click', 'user_id' => 42]);
$inserter->add(['id' => 2, 'type' => 'view', 'user_id' => 43]);

// Add many at once
$inserter->addMany([
    ['id' => 3, 'type' => 'purchase', 'user_id' => 44],
    ['id' => 4, 'type' => 'logout', 'user_id' => 45],
]);

// Flush remaining
$inserter->flush();
echo "Inserted: " . $inserter->getTotalInserted() . " rows\n";

// Auto-close on destruct
$inserter->close();
```

### 11. Pipeline (VedaPipeline)

```php
$pipeline = $db->pipeline();

$results = $pipeline
    ->query('SELECT COUNT(*) FROM users;')
    ->query('SELECT COUNT(*) FROM orders;')
    ->execute("INSERT INTO logs (event) VALUES ('batch_start');")
    ->insert('users', ['id' => 99, 'name' => 'PipelineUser'])
    ->run();

foreach ($results as $i => $result) {
    echo "Result {$i}: " . ($result->scalar() ?? $result->message) . "\n";
}
```

### 12. Streaming Cursor (VedaCursor)

```php
// Create cursor with 100-row batches
$cursor = $db->cursor('SELECT * FROM large_table', fetchSize: 100);

// Iterate with generator
foreach ($cursor->iterate() as $index => $row) {
    processRow($row);
}

// Or use Iterator interface
foreach ($cursor as $row) {
    processRow($row);
}

// Convert to array (careful with memory!)
$all = $cursor->toArray();

// Get first row only
$first = $cursor->first();

$cursor->close();
```

### 13. Pub/Sub (VedaPubSub)

```php
$pubsub = $db->pubsub();

// Subscribe
$pubsub->subscribe('channel1', 'channel2');

// Publish
$pubsub->publish('channel1', 'Hello World!');

// Listen for messages
$pubsub->listen(function (string $channel, string $message) {
    echo "[{$channel}] {$message}\n";
}, timeoutMs: 60000);

// Or receive one message
$msg = $pubsub->receive(timeoutMs: 5000);
if ($msg !== null) {
    echo "[{$msg['channel']}] {$msg['message']}\n";
}

// Cleanup
$pubsub->unsubscribe();
```

### 14. URI Parser (VedaURIParser)

```php
use VedaDB\VedaURIParser;

// Single node
$config = VedaURIParser::parse('vedadb://admin:pass@localhost:6380/mydb?timeout=10');
// ['host' => 'localhost', 'port' => 6380, 'username' => 'admin', ...]

// TLS
$config = VedaURIParser::parse('vedadbs://user:pass@host:6380');

// Multi-node
$config = VedaURIParser::parse('vedadb://node1:6380,node2:6380,node3:6380?pool_size=20');

// Parse manually
$parser = new VedaURIParser('vedadb://admin:pass@host:6380');
echo $parser->getPrimaryHost();   // 'host'
echo $parser->getPrimaryPort();   // 6380
echo $parser->getUsername();       // 'admin'
print_r($parser->getHosts());      // [['host' => 'host', 'port' => 6380]]
```

### 15. TLS/SSL (VedaTLS)

```php
use VedaDB\VedaTLS;

// Development (no verification)
$tls = VedaTLS::development();

// Production with CA
$tls = VedaTLS::production('/path/to/ca.crt');

// Custom
$tls = new VedaTLS(
    verifyPeer:     true,
    verifyPeerName: true,
    caFile:         '/path/to/ca.crt',
    certFile:       '/path/to/client.crt',
    keyFile:        '/path/to/client.key',
    minVersion:     '1.3',
);

// Apply to stream
$context = $tls->createContext();
```

### 16. Change Streams (VedaChangeStream)

```php
// Watch all changes
$stream = $db->watch();

// Watch a specific table
$stream = $db->watch('users');

// Poll for changes
$change = $stream->poll(timeoutMs: 5000);
if ($change !== null) {
    echo "Change: " . json_encode($change) . "\n";
}

// Continuous watch
$stream->watch(function (array $change) {
    echo "Table: {$change['table']}, Op: {$change['operation']}\n";
    print_r($change['data']);
}, timeoutMs: 60000);

// Stop watching
$stream->stop();

// Get buffered changes
$buffered = $stream->getBuffer();
```

### 17. Query Builder (VedaQueryBuilder)

```php
$qb = $db->table('users');

// Simple select
$users = $db->table('users')->get()->toDicts();

// With conditions
$result = $db->table('users')
    ->select('id', 'name', 'email')
    ->where('age', '>=', 18)
    ->whereEqual('status', 'active')
    ->whereIn('role', ['admin', 'moderator'])
    ->whereNotNull('email')
    ->orderBy('created_at DESC')
    ->limit(20)
    ->offset(0)
    ->get();

// Joins
$result = $db->table('users')
    ->join('orders', 'users.id = orders.user_id')
    ->leftJoin('profiles', 'users.id = profiles.user_id')
    ->where('orders.total', '>', 100)
    ->groupBy('users.id')
    ->get();

// Aggregations
$count = $db->table('users')->where('age', '>=', 18)->count();
$exists = $db->table('users')->whereEqual('email', 'test@example.com')->exists();

// Insert/Update/Delete
$db->table('users')->insert(['id' => 1, 'name' => 'Alice']);
$db->table('users')->whereEqual('id', 1)->update(['name' => 'Bob']);
$db->table('users')->whereEqual('id', 1)->delete();
$db->table('users')->truncate();

// To SQL (without executing)
echo $db->table('users')->where('age', '>', 18)->toSql();
// SELECT * FROM users WHERE age > 18;
```

### 18. Query Cache (VedaQueryCache)

```php
use VedaDB\VedaQueryCache;

$cache = new VedaQueryCache(defaultTtlMs: 60000, maxEntries: 1000);

// Cache a query
$result = $cache->remember('SELECT * FROM config;', function () use ($db) {
    return $db->query('SELECT * FROM config;');
}, 300000); // 5 minute TTL

// Manual get/set
$cached = $cache->get($cache->buildKey('SELECT * FROM users;'));
if ($cached !== null) {
    return $cached;
}

// Invalidate
$cache->invalidateTable('users');  // Remove all queries referencing 'users'
$cache->invalidate('*users*');     // Pattern-based invalidation
$cache->clear();                    // Clear all

// Stats
print_r($cache->getStats());
// ['entries' => 42, 'hits' => 150, 'misses' => 30, 'hit_rate' => 0.8333]
```

### 19. Read/Write Split (VedaRWSplit)

```php
use VedaDB\VedaRWSplit;

$rw = new VedaRWSplit(
    writer: $masterClient,
    readers: [$replica1, $replica2, $replica3],
    strategy: 'round_robin', // 'round_robin', 'random', 'least_loaded'
);

// Writes go to master
$rw->write("INSERT INTO users (id, name) VALUES (1, 'Alice');");

// Reads go to replicas
$result = $rw->read('SELECT * FROM users;');

// With callbacks
$users = $rw->onRead(fn(VedaClient $c) => $c->query('SELECT * FROM users;')->toDicts());
$rw->onWrite(fn(VedaClient $c) => $c->insert('users', ['id' => 1, 'name' => 'Alice']));

// Health check
$status = $rw->healthCheck();
// [['client' => $replica1, 'healthy' => true], ...]
```

### 20. Load Balancer (VedaLoadBalancer)

```php
use VedaDB\VedaLoadBalancer;

$lb = new VedaLoadBalancer(strategy: VedaLoadBalancer::STRATEGY_ROUND_ROBIN);

// Add nodes with weights
$lb->addNode($client1, weight: 3);
$lb->addNode($client2, weight: 2);
$lb->addNode($client3, weight: 1);

// Execute on a selected node
$result = $lb->execute(function (VedaClient $client) {
    return $client->query('SELECT * FROM users;');
});

// Get next node
$node = $lb->nextNode();

// Health check
$lb->healthCheck();
$healthyCount = $lb->getHealthyCount();

// Metrics
print_r($lb->getMetrics());
```

### 21. Metrics (VedaMetrics)

```php
use VedaDB\VedaMetrics;

$metrics = new VedaMetrics(namespace: 'vedadb');

// Record queries
$metrics->recordQuery('SELECT', 12.5);
$metrics->recordQuery('INSERT', 45.2, error: false);

// Record gauges
$metrics->recordGauge('active_connections', 15.0);
$metrics->recordPoolMetrics(5, 10, 20);
$metrics->recordCircuitBreaker('primary', 'closed');

// Export Prometheus format
echo $metrics->exportPrometheus();
// # HELP vedadb_info Driver information
// # TYPE vedadb_info gauge
// vedadb_info{version="1.0.0",language="php"} 1
// vedadb_query_duration_ms{operation="SELECT"} ...
```

### 22. Middleware (VedaInterceptor)

```php
use VedaDB\VedaInterceptor;

// Logging interceptor
$interceptor = VedaInterceptor::logging(function (string $msg) {
    error_log($msg);
});

// Slow query detection
$interceptor = VedaInterceptor::slowQuery(100.0, function (string $msg) {
    error_log($msg);
});

// Metrics interceptor
$interceptor = VedaInterceptor::metrics($metrics);

// Custom interceptor
$interceptor = (new VedaInterceptor())
    ->before(function (string $sql): string {
        // Modify SQL before execution
        return $sql;
    })
    ->after(function (string $sql, VedaResult $result, float $durationMs): void {
        // Log after successful execution
        echo "Query completed in {$durationMs}ms\n";
    })
    ->onError(function (string $sql, \Throwable $e, float $durationMs): void {
        // Handle errors
        error_log("Query failed: " . $e->getMessage());
    });

// Attach to client
$db->withInterceptor($interceptor);
```

### 23. Failover (VedaFailover)

```php
use VedaDB\VedaFailover;
use VedaDB\VedaRetryPolicy;
use VedaDB\VedaCircuitBreaker;

$failover = new VedaFailover(
    nodes: [
        ['host' => 'node1.db', 'port' => 6380],
        ['host' => 'node2.db', 'port' => 6380],
        ['host' => 'node3.db', 'port' => 6380],
    ],
    maxRetries: 3,
    retryPolicy: VedaRetryPolicy::aggressive(),
    circuitBreaker: new VedaCircuitBreaker(name: 'db-cluster'),
);

// Execute with automatic failover
$result = $failover->execute(function (VedaClient $client) {
    return $client->query('SELECT * FROM users;');
});

// Get client with failover
$client = $failover->getClient();

// Health check all nodes
$health = $failover->healthCheckAll();

// Force failover
$failover->forceFailover();

// View failover log
print_r($failover->getFailoverLog());
```

## Exception Hierarchy

```
RuntimeException
  └── VedaException                  Base class for all VedaDB errors
        ├── ConnectionException      TCP connection failures
        ├── QueryException           Server-side query errors
        ├── TimeoutException         Socket timeout
        ├── AuthException            Authentication failures
        ├── CircuitOpenException     Circuit breaker is open
        ├── FailoverException        Failover exhaustion
        ├── PoolExhaustedException   Connection pool exhausted
        ├── TLSSException            TLS/SSL errors
        ├── ProtocolException        Wire protocol errors
        └── ValidationException      Validation errors
```

## PSR-4 Autoloading

```json
{
    "autoload": {
        "psr-4": {
            "VedaDB\\": "src/"
        }
    }
}
```

## License

Apache-2.0
