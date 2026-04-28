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

Clone the repository and register the PSR-4 autoload path yourself, or include the files directly:

```php
require_once __DIR__ . '/drivers/php/src/VedaException.php';
require_once __DIR__ . '/drivers/php/src/VedaResult.php';
require_once __DIR__ . '/drivers/php/src/VedaClient.php';
require_once __DIR__ . '/drivers/php/src/VedaPool.php';
```

## Quick Start

```php
<?php

require_once __DIR__ . '/vendor/autoload.php';

use VedaDB\VedaClient;

$db = new VedaClient('localhost', 6380);

// Create a table
$db->exec('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100), email VARCHAR(200), age INT);');

// Insert rows
$db->insert('users', ['id' => 1, 'name' => 'Alice', 'email' => 'alice@example.com', 'age' => 30]);
$db->insert('users', ['id' => 2, 'name' => 'Bob',   'email' => 'bob@example.com',   'age' => 25]);

// Query
$result = $db->query('SELECT * FROM users WHERE age > 20;');
print_r($result->toDicts());
// [['id' => '1', 'name' => 'Alice', ...], ['id' => '2', 'name' => 'Bob', ...]]

// Select helper
$young = $db->select('users', 'name, age', "age = 25", 'name', 10);
print_r($young->first()); // ['name' => 'Bob', 'age' => '25']

$db->close();
```

## Connection Options

The `VedaClient` constructor accepts three parameters:

| Parameter | Type     | Default       | Description                          |
|-----------|----------|---------------|--------------------------------------|
| `$host`   | `string` | `'localhost'` | VedaDB server hostname or IP address |
| `$port`   | `int`    | `6380`        | VedaDB server port                   |
| `$timeout`| `int`    | `30`          | Socket timeout in seconds            |

```php
// Connect with defaults
$db = new VedaClient();

// Connect to a remote host with a custom timeout
$db = new VedaClient(host: 'db.example.com', port: 6380, timeout: 10);
```

The constructor opens the TCP connection immediately. If the server is unreachable, a `ConnectionException` is thrown.

---

## API Reference

### `__construct`

```php
public function __construct(string $host = 'localhost', int $port = 6380, int $timeout = 30)
```

Creates a new client and connects to the VedaDB server over TCP. The connection is established immediately during construction. A welcome banner is read and discarded from the server.

| Parameter  | Type     | Default       | Description            |
|------------|----------|---------------|------------------------|
| `$host`    | `string` | `'localhost'` | Server hostname        |
| `$port`    | `int`    | `6380`        | Server port            |
| `$timeout` | `int`    | `30`          | Timeout in seconds     |

**Throws:** `ConnectionException` if the connection fails.

```php
$db = new VedaClient('localhost', 6380, 30);
```

---

### `query`

```php
public function query(string $sql): VedaResult
```

Execute a VedaQL query and return a structured result. The query string is sent over the TCP socket followed by a newline. The response is read as a single JSON line and parsed into a `VedaResult`.

| Parameter | Type     | Description                |
|-----------|----------|----------------------------|
| `$sql`    | `string` | The SQL/VedaQL statement   |

**Returns:** `VedaResult`

**Throws:** `ConnectionException` if not connected or the connection is lost, `TimeoutException` if the socket times out, `QueryException` if the server returns an error.

```php
$result = $db->query('SELECT id, name FROM users WHERE age > 20;');
foreach ($result->toDicts() as $row) {
    echo $row['name'] . PHP_EOL;
}
```

---

### `exec`

```php
public function exec(string $sql): string
```

Execute a DDL or DML statement and return the status message. Internally calls `query()` and extracts the message string from the result.

| Parameter | Type     | Description                                                    |
|-----------|----------|----------------------------------------------------------------|
| `$sql`    | `string` | DDL/DML statement (CREATE, DROP, INSERT, UPDATE, DELETE, etc.) |

**Returns:** `string` -- status message from the server, or `"{rowCount} rows"` if no message is provided.

```php
$msg = $db->exec('CREATE TABLE logs (id INT PRIMARY KEY, event VARCHAR(200));');
echo $msg; // "Table created"

$msg = $db->exec("INSERT INTO logs (id, event) VALUES (1, 'startup');");
echo $msg; // "1 rows"
```

---

### `insert`

```php
public function insert(string $table, array $data): string
```

Insert a single row into a table using an associative array. Builds an `INSERT INTO ... VALUES ...` statement from the provided key-value pairs.

| Parameter | Type                   | Description                  |
|-----------|------------------------|------------------------------|
| `$table`  | `string`               | Target table name            |
| `$data`   | `array<string, mixed>` | Column-value pairs to insert |

**Returns:** `string` -- status message

Values are automatically formatted by the internal `formatValue()` method:

| PHP Type   | SQL Output        |
|------------|-------------------|
| `string`   | `'escaped value'` |
| `int/float`| Numeric literal   |
| `bool`     | `TRUE` / `FALSE`  |
| `null`     | `NULL`            |

```php
$db->insert('users', [
    'id'    => 3,
    'name'  => 'Charlie',
    'email' => 'charlie@example.com',
    'age'   => 28,
]);
```

---

### `select`

```php
public function select(
    string  $table,
    string  $columns = '*',
    ?string $where   = null,
    ?string $orderBy = null,
    int     $limit   = 0,
): VedaResult
```

Build and execute a SELECT query from structured parameters.

| Parameter  | Type      | Default | Description                                 |
|------------|-----------|---------|---------------------------------------------|
| `$table`   | `string`  | --      | Table name                                  |
| `$columns` | `string`  | `'*'`  | Comma-separated column list or `*`          |
| `$where`   | `?string` | `null`  | WHERE clause (without the `WHERE` keyword)  |
| `$orderBy` | `?string` | `null`  | ORDER BY clause (without the keyword)       |
| `$limit`   | `int`     | `0`    | Maximum rows to return; 0 means no limit    |

**Returns:** `VedaResult`

```php
// All users
$all = $db->select('users');

// Filtered, ordered, limited
$result = $db->select(
    table:   'users',
    columns: 'name, age',
    where:   'age >= 21',
    orderBy: 'age DESC',
    limit:   5,
);
print_r($result->toDicts());

// Using positional arguments
$admins = $db->select('users', 'id, name', "role = 'admin'", 'name ASC', 100);
```

---

### `update`

```php
public function update(string $table, array $set, ?string $where = null): string
```

Update rows in a table. Builds an `UPDATE ... SET ...` statement from the provided associative array.

| Parameter | Type                   | Description                                                      |
|-----------|------------------------|------------------------------------------------------------------|
| `$table`  | `string`               | Table name                                                       |
| `$set`    | `array<string, mixed>` | Column-value pairs to update                                     |
| `$where`  | `?string`              | WHERE clause (without the keyword); `null` updates all rows      |

**Returns:** `string` -- status message

```php
// Update a single user
$db->update('users', ['age' => 31], "name = 'Alice'");

// Update multiple columns
$db->update('users', ['email' => 'newemail@example.com', 'age' => 32], "id = 1");

// Update all rows (use with caution)
$db->update('users', ['active' => true]);
```

---

### `delete`

```php
public function delete(string $table, ?string $where = null): string
```

Delete rows from a table.

| Parameter | Type      | Description                                                        |
|-----------|-----------|--------------------------------------------------------------------|
| `$table`  | `string`  | Table name                                                         |
| `$where`  | `?string` | WHERE clause (without the keyword); `null` deletes all rows        |

**Returns:** `string` -- status message

```php
// Delete matching rows
$db->delete('users', "age < 18");

// Delete all rows (use with caution)
$db->delete('users');
```

---

### `showTables`

```php
public function showTables(): array
```

List all tables in the current database. Internally executes `SHOW TABLES;` and extracts the first column from each row.

**Returns:** `list<string>` -- array of table names, or an empty array if no tables exist.

```php
$tables = $db->showTables();
// ['users', 'orders', 'products']

foreach ($tables as $table) {
    echo "Table: {$table}" . PHP_EOL;
}
```

---

### `ping`

```php
public function ping(): bool
```

Health check. Executes `SHOW TABLES;` internally and returns `true` if the server responds successfully, `false` on any error. This method never throws an exception.

**Returns:** `bool`

```php
if ($db->ping()) {
    echo 'Server is healthy';
} else {
    echo 'Server is unreachable';
}
```

---

### `close`

```php
public function close(): void
```

Close the TCP connection. Sends a `QUIT` command to the server before closing the socket. Safe to call multiple times -- subsequent calls are no-ops. Also called automatically by the destructor (`__destruct`).

```php
$db->close();
```

---

## VedaResult

Query results are returned as `VedaResult` objects. Created internally by `VedaResult::parse()` from the server's JSON response.

### Properties

| Property    | Type                        | Description                                    |
|-------------|-----------------------------|-------------------------------------------------|
| `$columns`  | `?array<string>`            | Column names, or `null` for non-SELECT results  |
| `$rows`     | `?array<array<mixed>>`      | Row data as nested arrays, or `null`             |
| `$rowCount` | `int`                       | Number of rows returned or affected              |
| `$message`  | `?string`                   | Status message from the server (e.g. "Table created") |

### Methods

#### `toDicts`

```php
public function toDicts(): array
```

Convert rows to an array of associative arrays keyed by column name. Returns an empty array if `$columns` or `$rows` is `null`.

**Returns:** `list<array<string, mixed>>`

```php
$result = $db->query('SELECT id, name FROM users;');
$rows = $result->toDicts();
// [['id' => '1', 'name' => 'Alice'], ['id' => '2', 'name' => 'Bob']]

foreach ($rows as $row) {
    echo "{$row['id']}: {$row['name']}" . PHP_EOL;
}
```

#### `first`

```php
public function first(): ?array
```

Get the first row as an associative array, or `null` if the result is empty. Calls `toDicts()` internally.

**Returns:** `?array<string, mixed>`

```php
$user = $db->query("SELECT * FROM users WHERE id = 1;")->first();
if ($user !== null) {
    echo $user['name']; // 'Alice'
}
```

#### `pluck`

```php
public function pluck(string $column): array
```

Extract all values from a single column. Returns an empty array if the column does not exist or the result has no rows.

| Parameter | Type     | Description         |
|-----------|----------|---------------------|
| `$column` | `string` | Column name to extract |

**Returns:** `list<mixed>`

```php
$names = $db->query('SELECT name FROM users;')->pluck('name');
// ['Alice', 'Bob', 'Charlie']

$ids = $db->query('SELECT id, name FROM users;')->pluck('id');
// ['1', '2', '3']
```

#### `parse` (static)

```php
public static function parse(string $json): VedaResult
```

Parse a raw JSON response string from VedaDB into a `VedaResult`. Used internally by `VedaClient::query()` but available for direct use when working with custom transport layers.

| Parameter | Type     | Description               |
|-----------|----------|---------------------------|
| `$json`   | `string` | JSON response from server |

**Returns:** `VedaResult`

**Throws:** `VedaException` if the JSON is malformed, `QueryException` if the response contains an `error` field.

```php
// Manual parsing (advanced usage)
$raw = '{"columns":["id","name"],"rows":[["1","Alice"]],"row_count":1}';
$result = VedaResult::parse($raw);
echo $result->first()['name']; // 'Alice'
```

---

## Exception Hierarchy

All exceptions live in the `VedaDB` namespace and extend `RuntimeException`:

```
RuntimeException
  └── VedaException             Base class for all VedaDB driver errors
        ├── ConnectionException  TCP connection failures (unreachable host, closed socket)
        ├── QueryException       Server-side query errors (bad SQL, missing table)
        └── TimeoutException     Socket read/write timeout
```

### When Each Exception Is Thrown

| Exception             | Thrown When                                                     |
|-----------------------|-----------------------------------------------------------------|
| `ConnectionException` | Server unreachable, socket write fails, connection drops        |
| `QueryException`      | Server returns a JSON response with an `error` field            |
| `TimeoutException`    | Socket read times out (exceeds the configured `$timeout`)       |
| `VedaException`       | JSON parse failure, pool closed, or other general driver errors |

### Error Handling Examples

#### Catch specific exception types

```php
use VedaDB\VedaClient;
use VedaDB\ConnectionException;
use VedaDB\QueryException;
use VedaDB\TimeoutException;
use VedaDB\VedaException;

try {
    $db = new VedaClient('localhost', 6380);
    $result = $db->query('SELECT * FROM nonexistent_table;');
} catch (ConnectionException $e) {
    echo 'Connection failed: ' . $e->getMessage();
} catch (TimeoutException $e) {
    echo 'Query timed out: ' . $e->getMessage();
} catch (QueryException $e) {
    echo 'Query error: ' . $e->getMessage();
} catch (VedaException $e) {
    echo 'General VedaDB error: ' . $e->getMessage();
}
```

#### Catch all VedaDB errors

```php
try {
    $db->exec('DROP TABLE important_data;');
} catch (VedaException $e) {
    error_log('VedaDB error: ' . $e->getMessage());
}
```

#### Retry on connection failure

```php
function connectWithRetry(int $maxRetries = 3): VedaClient
{
    for ($i = 0; $i < $maxRetries; $i++) {
        try {
            return new VedaClient('localhost', 6380);
        } catch (ConnectionException $e) {
            if ($i === $maxRetries - 1) {
                throw $e;
            }
            sleep(1);
        }
    }
}
```

#### Using the group use declaration

```php
use VedaDB\{VedaClient, QueryException, ConnectionException, TimeoutException};

try {
    $db = new VedaClient();
    $db->query('INVALID SQL');
} catch (QueryException $e) {
    echo "Query error: {$e->getMessage()}\n";
} catch (ConnectionException $e) {
    echo "Connection lost: {$e->getMessage()}\n";
} catch (TimeoutException $e) {
    echo "Timed out\n";
}
```

---

## Connection Pooling

The `VedaPool` class manages a pool of reusable `VedaClient` connections, reducing the overhead of establishing new TCP connections on every request.

### Constructor

```php
public function __construct(
    string $host    = 'localhost',
    int    $port    = 6380,
    int    $maxSize = 10,
    int    $timeout = 30,
)
```

| Parameter  | Type     | Default       | Description                              |
|------------|----------|---------------|------------------------------------------|
| `$host`    | `string` | `'localhost'` | Server hostname                          |
| `$port`    | `int`    | `6380`        | Server port                              |
| `$maxSize` | `int`    | `10`          | Maximum idle connections held in the pool |
| `$timeout` | `int`    | `30`          | Timeout in seconds for new connections   |

### Methods

| Method                         | Returns      | Description                                           |
|--------------------------------|--------------|-------------------------------------------------------|
| `acquire()`                    | `VedaClient` | Get a client from the pool or create a new one        |
| `release(VedaClient $client)`  | `void`       | Return a client to the pool                           |
| `getActiveCount()`             | `int`        | Number of clients currently checked out               |
| `getIdleCount()`               | `int`        | Number of idle clients waiting in the pool            |
| `close()`                      | `void`       | Close all idle connections and mark the pool as closed |

### Pool Behavior

- `acquire()` first checks for idle connections. If one is available, it is returned. Otherwise a new `VedaClient` is created.
- `release()` returns the client to the idle list if the pool has room (below `$maxSize`). If the pool is full or closed, the client is closed instead.
- After `close()` is called, any call to `acquire()` throws a `VedaException`.
- There is no hard cap on total active connections -- `$maxSize` only limits the number of idle connections stored in the pool.

### Usage

```php
use VedaDB\VedaPool;

$pool = new VedaPool('localhost', 6380, maxSize: 20, timeout: 10);

$client = $pool->acquire();
try {
    $client->insert('logs', ['event' => 'page_view', 'path' => '/home']);
    $result = $client->query('SELECT COUNT(*) FROM logs;');
    echo $result->first()['COUNT(*)'];
} finally {
    $pool->release($client);
}

echo 'Active: ' . $pool->getActiveCount() . PHP_EOL; // 0
echo 'Idle: '   . $pool->getIdleCount()   . PHP_EOL; // 1

$pool->close();
```

### Pool in a Long-Running Process

```php
$pool = new VedaPool('localhost', 6380, maxSize: 50);

// Handle many requests, reusing connections
for ($i = 0; $i < 1000; $i++) {
    $client = $pool->acquire();
    try {
        $client->exec("INSERT INTO events (id, type) VALUES ({$i}, 'tick');");
    } finally {
        $pool->release($client);
    }
}

$pool->close();
```

---

## PSR-4 Autoloading

The driver follows PSR-4 with the `VedaDB\` namespace mapped to the `src/` directory. The relevant `composer.json` section:

```json
{
    "autoload": {
        "psr-4": {
            "VedaDB\\": "src/"
        }
    },
    "autoload-dev": {
        "psr-4": {
            "VedaDB\\Tests\\": "tests/"
        }
    }
}
```

All classes reside in the `VedaDB` namespace:

| Class                          | File                    |
|--------------------------------|-------------------------|
| `VedaDB\VedaClient`           | `src/VedaClient.php`    |
| `VedaDB\VedaResult`           | `src/VedaResult.php`    |
| `VedaDB\VedaException`        | `src/VedaException.php` |
| `VedaDB\ConnectionException`  | `src/VedaException.php` |
| `VedaDB\QueryException`       | `src/VedaException.php` |
| `VedaDB\TimeoutException`     | `src/VedaException.php` |
| `VedaDB\VedaPool`             | `src/VedaPool.php`      |

---

## PHP 8.0+ Features

The driver takes advantage of PHP 8.0+ language features:

- **Named arguments** -- pass parameters by name for clarity:
  ```php
  $db = new VedaClient(host: 'db.example.com', timeout: 5);
  $result = $db->select(table: 'users', columns: 'name', limit: 10);
  $pool = new VedaPool(maxSize: 50, timeout: 15);
  ```

- **Union types and `mixed`** -- the internal `formatValue(mixed $value)` method accepts any type and converts it to a SQL literal.

- **Trailing commas in parameter lists** -- used in method signatures and function calls for cleaner diffs.

- **Arrow functions** -- used internally for concise row mapping (e.g., `fn(array $row) => (string)$row[0]` in `showTables()`).

- **Typed properties** -- all class properties use strict type declarations (`string`, `int`, `bool`, `?array`).

- **`declare(strict_types=1)`** -- enforced in every file for strict type checking.

---

## Laravel Integration

Register VedaDB as a singleton service in a Laravel service provider:

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use VedaDB\VedaClient;
use VedaDB\VedaPool;

class VedaDBServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Singleton client
        $this->app->singleton(VedaClient::class, function ($app) {
            return new VedaClient(
                host:    config('vedadb.host', 'localhost'),
                port:    (int) config('vedadb.port', 6380),
                timeout: (int) config('vedadb.timeout', 30),
            );
        });

        // Connection pool
        $this->app->singleton(VedaPool::class, function ($app) {
            return new VedaPool(
                host:    config('vedadb.host', 'localhost'),
                port:    (int) config('vedadb.port', 6380),
                maxSize: (int) config('vedadb.pool_size', 10),
                timeout: (int) config('vedadb.timeout', 30),
            );
        });
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../../config/vedadb.php' => config_path('vedadb.php'),
        ], 'vedadb-config');
    }
}
```

Add the config file at `config/vedadb.php`:

```php
<?php

return [
    'host'      => env('VEDADB_HOST', 'localhost'),
    'port'      => env('VEDADB_PORT', 6380),
    'timeout'   => env('VEDADB_TIMEOUT', 30),
    'pool_size' => env('VEDADB_POOL_SIZE', 10),
];
```

Then inject where needed:

```php
use VedaDB\VedaClient;

class UserController extends Controller
{
    public function index(VedaClient $db)
    {
        $result = $db->query('SELECT * FROM users;');
        return response()->json($result->toDicts());
    }
}
```

---

## Running Tests

```bash
composer test
```

Or with PHPUnit directly:

```bash
./vendor/bin/phpunit
```

---

## License

Apache-2.0
