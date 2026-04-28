# VedaDB Node.js Driver

Official Node.js client for [VedaDB](https://github.com/vedadb/vedadb) -- the multi-model database engine.

VedaDB is a multi-model database that combines relational SQL, key-value caching, document storage, and full-text search into a single engine. This driver communicates with VedaDB over a TCP connection using a newline-delimited JSON protocol on port 6380 (by default). It provides a full-featured client with structured query results, connection pooling, transaction support, and a built-in cache sub-API.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Connection Options](#connection-options)
- [API Reference](#api-reference)
  - [createClient()](#createclientoptions)
  - [connect()](#connect)
  - [query()](#querysql)
  - [exec()](#execsql)
  - [ping()](#ping)
  - [createTable()](#createtablesql)
  - [insert()](#inserttable-data)
  - [insertMany()](#insertmanytable-rows)
  - [select()](#selecttable-options)
  - [update()](#updatetable-set-where)
  - [deleteFrom()](#deletefromtable-where)
  - [begin()](#begin)
  - [commit()](#commit)
  - [rollback()](#rollback)
  - [transaction()](#transactionfn)
  - [close()](#close)
- [Result Object](#result-object)
- [Cache Operations](#cache-operations)
- [Connection Pooling](#connection-pooling)
- [Transactions](#transactions)
- [Error Handling](#error-handling)
- [Authentication](#authentication)
- [TypeScript Support](#typescript-support)
- [Advanced Usage](#advanced-usage)
- [License](#license)

---

## Installation

```bash
# npm
npm install vedadb

# yarn
yarn add vedadb

# pnpm
pnpm add vedadb
```

**Requirements:** Node.js >= 14.0.0

---

## Quick Start

```javascript
const { createClient } = require('vedadb');

async function main() {
  // Connect to VedaDB
  const db = await createClient({ host: 'localhost', port: 6380 });

  // Create a table
  await db.exec(`
    CREATE TABLE users (
      id INT PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(200),
      age INT
    );
  `);

  // Insert rows
  await db.insert('users', { id: 1, name: 'Alice', email: 'alice@example.com', age: 30 });
  await db.insert('users', { id: 2, name: 'Bob', email: 'bob@example.com', age: 25 });

  // Query with raw SQL
  const result = await db.query('SELECT * FROM users WHERE age > 20;');
  console.log(result.toObjects());
  // [{ id: '1', name: 'Alice', email: 'alice@example.com', age: '30' }, ...]

  // Query with the select helper
  const young = await db.select('users', {
    columns: ['name', 'age'],
    where: { age: 25 },
    orderBy: 'name',
    limit: 10,
  });
  console.log(young.first()); // { name: 'Bob', age: '25' }

  // Clean up
  db.close();
}

main();
```

---

## Connection Options

The `VedaDB` constructor (and `createClient`) accepts an options object with the following properties:

| Option     | Type     | Default       | Description                                                        |
|------------|----------|---------------|--------------------------------------------------------------------|
| `host`     | `string` | `'localhost'` | Hostname or IP address of the VedaDB server.                       |
| `port`     | `number` | `6380`        | TCP port the VedaDB server is listening on.                        |
| `timeout`  | `number` | `30000`       | Socket timeout in milliseconds. Applies to both connection and per-query deadlines. Set to `0` to disable query timeouts. |
| `user`     | `string` | `null`        | Username for authentication (when the server has auth enabled).    |
| `password` | `string` | `null`        | Password for authentication (when the server has auth enabled).    |

---

## API Reference

### `createClient(options)`

Factory function that creates a `VedaDB` instance and connects it in a single call. This is the recommended way to get started.

**Signature:**

```typescript
function createClient(options?: VedaDBOptions): Promise<VedaDB>
```

**Parameters:**

| Name      | Type            | Default | Description                                          |
|-----------|-----------------|---------|------------------------------------------------------|
| `options` | `VedaDBOptions` | `{}`    | Connection options (see [Connection Options](#connection-options)). |

**Returns:** `Promise<VedaDB>` -- A connected client instance.

**Example:**

```javascript
const { createClient } = require('vedadb');

const db = await createClient({ host: '10.0.0.5', port: 6380, timeout: 5000 });
// db is already connected and ready to use
```

---

### `connect()`

Opens a TCP connection to the VedaDB server. If already connected, resolves immediately. When using `createClient()`, this is called automatically.

**Signature:**

```typescript
connect(): Promise<VedaDB>
```

**Parameters:** None.

**Returns:** `Promise<VedaDB>` -- Resolves with the client instance (`this`) for chaining.

**Example:**

```javascript
const { VedaDB } = require('vedadb');

const db = new VedaDB({ host: 'localhost', port: 6380 });
await db.connect();

console.log(db.connected); // true
```

---

### `query(sql)`

Sends a raw VedaQL/SQL query to the server and returns a structured `Result` object. Use this for `SELECT` statements or any query where you need access to columns and rows.

**Signature:**

```typescript
query(sql: string): Promise<Result>
```

**Parameters:**

| Name  | Type     | Default | Description                         |
|-------|----------|---------|-------------------------------------|
| `sql` | `string` | --      | The SQL or VedaQL query to execute. |

**Returns:** `Promise<Result>` -- A [Result](#result-object) containing columns, rows, row count, and a server message.

**Throws:** `ConnectionError` if the client is not connected, `QueryError` if the server returns an error, `TimeoutError` if the query exceeds the configured timeout.

**Example:**

```javascript
const result = await db.query('SELECT id, name, age FROM users WHERE age >= 21;');

console.log(result.columns);    // ['id', 'name', 'age']
console.log(result.rows);       // [['1', 'Alice', '30'], ['2', 'Bob', '25']]
console.log(result.rowCount);   // 2
console.log(result.toObjects()); // [{ id: '1', name: 'Alice', age: '30' }, ...]
```

---

### `exec(sql)`

Executes a statement that does not return rows (DDL, INSERT, UPDATE, DELETE). Returns the server's response message or a summary string.

**Signature:**

```typescript
exec(sql: string): Promise<string>
```

**Parameters:**

| Name  | Type     | Default | Description                                   |
|-------|----------|---------|-----------------------------------------------|
| `sql` | `string` | --      | The SQL statement to execute (DDL, DML, etc). |

**Returns:** `Promise<string>` -- The server message (e.g., `"1 rows affected"`) or a row-count summary.

**Example:**

```javascript
const msg = await db.exec("INSERT INTO users (id, name) VALUES (3, 'Charlie');");
console.log(msg); // '1 rows affected'

await db.exec('DROP TABLE IF EXISTS temp_data;');
```

---

### `ping()`

Performs a health check against the server by issuing a lightweight `SHOW TABLES` query.

**Signature:**

```typescript
ping(): Promise<boolean>
```

**Parameters:** None.

**Returns:** `Promise<boolean>` -- `true` if the server responded successfully, `false` otherwise.

**Example:**

```javascript
const alive = await db.ping();
if (!alive) {
  console.error('VedaDB server is not responding');
}
```

---

### `createTable(sql)`

Convenience method for executing a `CREATE TABLE` statement. Equivalent to calling `exec(sql)`.

**Signature:**

```typescript
createTable(sql: string): Promise<string>
```

**Parameters:**

| Name  | Type     | Default | Description                                |
|-------|----------|---------|--------------------------------------------|
| `sql` | `string` | --      | The full `CREATE TABLE ...` SQL statement. |

**Returns:** `Promise<string>` -- The server's confirmation message.

**Example:**

```javascript
await db.createTable(`
  CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(200),
    price FLOAT,
    in_stock BOOLEAN
  );
`);
```

---

### `insert(table, data)`

Inserts a single row into a table using a plain JavaScript object. Keys become column names; values are automatically escaped.

**Signature:**

```typescript
insert(table: string, data: Record<string, any>): Promise<string>
```

**Parameters:**

| Name    | Type                   | Default | Description                                       |
|---------|------------------------|---------|---------------------------------------------------|
| `table` | `string`               | --      | The target table name.                            |
| `data`  | `Record<string, any>`  | --      | An object mapping column names to values.         |

**Returns:** `Promise<string>` -- The server message.

**Example:**

```javascript
await db.insert('products', {
  id: 1,
  name: 'Laptop',
  price: 999.99,
  in_stock: true,
});
```

---

### `insertMany(table, rows)`

Inserts multiple rows in a single statement. All objects in the array must have the same keys (column names are derived from the first object).

**Signature:**

```typescript
insertMany(table: string, rows: Record<string, any>[]): Promise<string>
```

**Parameters:**

| Name   | Type                     | Default | Description                                               |
|--------|--------------------------|---------|-----------------------------------------------------------|
| `table`| `string`                 | --      | The target table name.                                    |
| `rows` | `Record<string, any>[]`  | --      | An array of objects, each representing a row to insert.   |

**Returns:** `Promise<string>` -- The server message. Returns `'0 rows affected'` if the array is empty.

**Example:**

```javascript
await db.insertMany('products', [
  { id: 2, name: 'Mouse', price: 29.99, in_stock: true },
  { id: 3, name: 'Keyboard', price: 79.99, in_stock: false },
  { id: 4, name: 'Monitor', price: 449.00, in_stock: true },
]);
```

---

### `select(table, options)`

Builds and executes a `SELECT` query from a structured options object. Supports column selection, filtering, ordering, pagination, and offsets.

**Signature:**

```typescript
select(table: string, options?: SelectOptions): Promise<Result>
```

**Parameters:**

| Name      | Type            | Default | Description                     |
|-----------|-----------------|---------|---------------------------------|
| `table`   | `string`        | --      | The table to query.             |
| `options` | `SelectOptions` | `{}`    | Query options (see table below).|

**SelectOptions:**

| Option    | Type                   | Default | Description                                                              |
|-----------|------------------------|---------|--------------------------------------------------------------------------|
| `columns` | `string[]`             | `['*']` | Columns to select. Defaults to all columns.                              |
| `where`   | `Record<string, any>`  | --      | WHERE conditions as key-value pairs, joined with `AND`. Use `null` values for `IS NULL` checks. |
| `orderBy` | `string`               | --      | Column name to order by.                                                 |
| `desc`    | `boolean`              | `false` | If `true`, adds `DESC` to the ORDER BY clause.                          |
| `limit`   | `number`               | --      | Maximum number of rows to return.                                        |
| `offset`  | `number`               | --      | Number of rows to skip (for pagination).                                 |

**Returns:** `Promise<Result>` -- A [Result](#result-object) containing the selected rows.

**Example:**

```javascript
// Select specific columns with filtering, ordering, and pagination
const page = await db.select('products', {
  columns: ['name', 'price'],
  where: { in_stock: true },
  orderBy: 'price',
  desc: true,
  limit: 10,
  offset: 0,
});

console.log(page.toObjects());
// [{ name: 'Laptop', price: '999.99' }, { name: 'Monitor', price: '449.00' }]
```

---

### `update(table, set, where)`

Updates rows in a table. The `set` object defines new column values; the optional `where` object filters which rows to update.

**Signature:**

```typescript
update(table: string, set: Record<string, any>, where?: Record<string, any>): Promise<string>
```

**Parameters:**

| Name    | Type                  | Default | Description                                                       |
|---------|-----------------------|---------|-------------------------------------------------------------------|
| `table` | `string`              | --      | The target table name.                                            |
| `set`   | `Record<string, any>` | --      | An object mapping column names to their new values.               |
| `where` | `Record<string, any>` | --      | Optional WHERE conditions. Omit to update all rows (use caution). |

**Returns:** `Promise<string>` -- The server message indicating rows affected.

**Example:**

```javascript
// Update a single product's price
await db.update('products', { price: 899.99 }, { id: 1 });

// Set all products as in-stock
await db.update('products', { in_stock: true });
```

---

### `deleteFrom(table, where)`

Deletes rows from a table matching the given conditions.

**Signature:**

```typescript
deleteFrom(table: string, where?: Record<string, any>): Promise<string>
```

**Parameters:**

| Name    | Type                  | Default | Description                                                        |
|---------|-----------------------|---------|--------------------------------------------------------------------|
| `table` | `string`              | --      | The target table name.                                             |
| `where` | `Record<string, any>` | --      | Optional WHERE conditions. Omit to delete all rows (use caution).  |

**Returns:** `Promise<string>` -- The server message indicating rows affected.

**Example:**

```javascript
// Delete a specific product
await db.deleteFrom('products', { id: 3 });

// Delete all out-of-stock products
await db.deleteFrom('products', { in_stock: false });
```

---

### `begin()`

Starts a new transaction. All subsequent queries will be part of this transaction until `commit()` or `rollback()` is called.

**Signature:**

```typescript
begin(): Promise<string>
```

**Returns:** `Promise<string>` -- The server's confirmation message.

---

### `commit()`

Commits the current transaction, making all changes permanent.

**Signature:**

```typescript
commit(): Promise<string>
```

**Returns:** `Promise<string>` -- The server's confirmation message.

---

### `rollback()`

Rolls back the current transaction, discarding all changes since `begin()`.

**Signature:**

```typescript
rollback(): Promise<string>
```

**Returns:** `Promise<string>` -- The server's confirmation message.

---

### `transaction(fn)`

Executes a callback inside an automatically managed transaction. If the callback succeeds, the transaction is committed. If it throws, the transaction is rolled back and the error is re-thrown.

**Signature:**

```typescript
transaction<T>(fn: (client: VedaDB) => Promise<T>): Promise<T>
```

**Parameters:**

| Name | Type                              | Default | Description                                                              |
|------|-----------------------------------|---------|--------------------------------------------------------------------------|
| `fn` | `(client: VedaDB) => Promise<T>` | --      | An async function receiving the client. Use it to run queries/statements.|

**Returns:** `Promise<T>` -- The return value of the callback function.

**Throws:** Re-throws any error from the callback after rolling back the transaction.

**Example:**

```javascript
const orderId = await db.transaction(async (tx) => {
  await tx.exec("INSERT INTO orders (user_id, total) VALUES (1, 149.99);");
  await tx.exec("UPDATE users SET balance = balance - 149.99 WHERE id = 1;");
  const result = await tx.query("SELECT MAX(id) AS last_id FROM orders;");
  return result.first().last_id;
});

console.log('New order ID:', orderId);
```

---

### `close()`

Closes the TCP connection gracefully. Sends a `QUIT` command to the server before destroying the socket. Safe to call multiple times.

**Signature:**

```typescript
close(): void
```

**Parameters:** None.

**Returns:** `void`

**Example:**

```javascript
db.close();
console.log(db.connected); // false
```

---

## Result Object

Every call to `query()` or `select()` returns a `Result` instance. The `Result` class wraps the raw server response and provides convenient accessors.

### Properties

| Property   | Type       | Description                                                              |
|------------|------------|--------------------------------------------------------------------------|
| `columns`  | `string[]` | Array of column names returned by the query.                             |
| `rows`     | `any[][]`  | Array of rows, where each row is an array of values (positional).        |
| `rowCount` | `number`   | Number of rows affected or returned.                                     |
| `message`  | `string`   | Server message (e.g., status text for DDL/DML statements).               |

### Methods

#### `toObjects()`

Converts the positional row arrays into an array of plain objects, keyed by column name.

**Signature:**

```typescript
toObjects(): Record<string, any>[]
```

**Returns:** An array of objects, one per row.

**Example:**

```javascript
const result = await db.query('SELECT id, name FROM users;');
const users = result.toObjects();
// [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }]
```

#### `first()`

Returns the first row as a plain object, or `null` if the result set is empty. Useful for queries expected to return a single row.

**Signature:**

```typescript
first(): Record<string, any> | null
```

**Returns:** The first row as an object, or `null`.

**Example:**

```javascript
const result = await db.query("SELECT * FROM users WHERE id = 1;");
const user = result.first();
// { id: '1', name: 'Alice', email: 'alice@example.com', age: '30' }

const empty = await db.query("SELECT * FROM users WHERE id = 999;");
console.log(empty.first()); // null
```

#### `pluck(column)`

Extracts a single column from every row, returning a flat array of values. Returns an empty array if the column name is not found in the result set.

**Signature:**

```typescript
pluck(column: string): any[]
```

**Parameters:**

| Name     | Type     | Default | Description                      |
|----------|----------|---------|----------------------------------|
| `column` | `string` | --      | The column name to extract.      |

**Returns:** `any[]` -- Array of values from the specified column.

**Example:**

```javascript
const result = await db.query('SELECT name, email FROM users;');

const names = result.pluck('name');
// ['Alice', 'Bob']

const emails = result.pluck('email');
// ['alice@example.com', 'bob@example.com']

const missing = result.pluck('nonexistent');
// []
```

---

## Cache Operations

VedaDB includes a built-in key-value cache. The cache sub-API is available on every `VedaDB` client instance via the `cache` property.

### `cache.set(key, value, ttl?)`

Sets a cache key to a value with an optional time-to-live.

**Signature:**

```typescript
cache.set(key: string, value: any, ttl?: number): Promise<Result>
```

**Parameters:**

| Name    | Type     | Default | Description                                                     |
|---------|----------|---------|-----------------------------------------------------------------|
| `key`   | `string` | --      | The cache key.                                                  |
| `value` | `any`    | --      | The value to store. Objects are automatically JSON-serialized.  |
| `ttl`   | `number` | --      | Optional time-to-live in seconds. Omit for no expiration.       |

**Example:**

```javascript
// Store a string
await db.cache.set('greeting', 'hello');

// Store an object with a 1-hour TTL
await db.cache.set('session:abc123', { userId: 42, role: 'admin' }, 3600);
```

### `cache.get(key)`

Retrieves the value stored at a cache key.

**Signature:**

```typescript
cache.get(key: string): Promise<Result>
```

**Parameters:**

| Name  | Type     | Default | Description      |
|-------|----------|---------|------------------|
| `key` | `string` | --      | The cache key.   |

**Example:**

```javascript
const result = await db.cache.get('session:abc123');
console.log(result.message); // The stored value
```

### `cache.del(key)`

Deletes a cache key.

**Signature:**

```typescript
cache.del(key: string): Promise<Result>
```

**Parameters:**

| Name  | Type     | Default | Description              |
|-------|----------|---------|--------------------------|
| `key` | `string` | --      | The cache key to delete. |

**Example:**

```javascript
await db.cache.del('session:abc123');
```

### `cache.incr(key)`

Atomically increments a numeric cache value by 1.

**Signature:**

```typescript
cache.incr(key: string): Promise<Result>
```

**Parameters:**

| Name  | Type     | Default | Description                 |
|-------|----------|---------|-----------------------------|
| `key` | `string` | --      | The cache key to increment. |

**Example:**

```javascript
await db.cache.set('page_views', '0');
await db.cache.incr('page_views');
await db.cache.incr('page_views');
const result = await db.cache.get('page_views');
// value is now '2'
```

### `cache.keys(pattern)`

Lists cache keys matching a glob-style pattern.

**Signature:**

```typescript
cache.keys(pattern: string): Promise<Result>
```

**Parameters:**

| Name      | Type     | Default | Description                                       |
|-----------|----------|---------|---------------------------------------------------|
| `pattern` | `string` | --      | A glob pattern (e.g., `'session:*'`, `'user:?'`). |

**Example:**

```javascript
const result = await db.cache.keys('session:*');
console.log(result.rows); // All keys matching the pattern
```

### `cache.flush()`

Removes all keys from the cache.

**Signature:**

```typescript
cache.flush(): Promise<Result>
```

**Example:**

```javascript
await db.cache.flush();
```

### `cache.stats()`

Returns cache statistics (hit rate, key count, memory usage, etc.).

**Signature:**

```typescript
cache.stats(): Promise<Result>
```

**Example:**

```javascript
const stats = await db.cache.stats();
console.log(stats.toObjects());
```

---

## Connection Pooling

For applications that need multiple concurrent connections, use `VedaPool`. The pool manages a set of `VedaDB` clients, automatically creating and reusing connections as needed.

### Constructor

```javascript
const { VedaPool } = require('vedadb');

const pool = new VedaPool(options);
```

### Pool Options

| Option           | Type     | Default   | Description                                                                  |
|------------------|----------|-----------|------------------------------------------------------------------------------|
| `host`           | `string` | `'localhost'` | Hostname of the VedaDB server.                                          |
| `port`           | `number` | `6380`    | TCP port of the VedaDB server.                                               |
| `min`            | `number` | `0`       | Minimum number of idle connections to keep in the pool.                       |
| `max`            | `number` | `10`      | Maximum total connections (idle + active). New requests wait when exhausted.  |
| `timeout`        | `number` | `30000`   | Socket timeout in milliseconds for each connection.                          |
| `idleTimeout`    | `number` | `60000`   | Time in milliseconds before an idle connection is closed. Set to `0` to disable idle eviction. |
| `acquireTimeout` | `number` | `10000`   | Maximum time in milliseconds to wait for a connection when the pool is exhausted. |

### Pool Properties

| Property       | Type     | Description                                      |
|----------------|----------|--------------------------------------------------|
| `size`         | `number` | Total number of connections (active + idle).      |
| `idleCount`    | `number` | Number of idle connections available.             |
| `activeCount`  | `number` | Number of connections currently checked out.      |
| `waitingCount` | `number` | Number of callers waiting for a connection.       |

### Pool Methods

#### `warmup()`

Pre-creates `min` connections so they are ready when needed. This is optional -- `acquire()` creates connections on demand.

**Signature:**

```typescript
warmup(): Promise<void>
```

**Example:**

```javascript
const pool = new VedaPool({ min: 5, max: 20 });
await pool.warmup(); // 5 connections now ready
```

#### `query(sql)`

Executes a query using a pooled connection. The connection is automatically acquired before the query and released after it completes (even on error).

**Signature:**

```typescript
query(sql: string): Promise<Result>
```

**Example:**

```javascript
const result = await pool.query('SELECT COUNT(*) AS total FROM orders;');
console.log(result.first()); // { total: '42' }
```

#### `exec(sql)`

Executes a non-row statement using a pooled connection. The connection is automatically acquired and released.

**Signature:**

```typescript
exec(sql: string): Promise<string>
```

**Example:**

```javascript
await pool.exec("INSERT INTO logs (event) VALUES ('startup');");
```

#### `acquire()`

Manually checks out a connection from the pool. You must call `release()` when finished to return it. If no connections are available and the pool is at capacity, this will wait up to `acquireTimeout` milliseconds before throwing a `ConnectionError`.

**Signature:**

```typescript
acquire(): Promise<VedaDB>
```

**Returns:** `Promise<VedaDB>` -- A connected client instance.

**Example:**

```javascript
const client = await pool.acquire();
try {
  await client.begin();
  await client.insert('orders', { user_id: 1, total: 59.99 });
  await client.commit();
} catch (err) {
  await client.rollback();
  throw err;
} finally {
  pool.release(client);
}
```

#### `release(client)`

Returns a previously acquired connection back to the pool. If the pool is closed or the connection is broken, the client is destroyed instead.

**Signature:**

```typescript
release(client: VedaDB): void
```

**Parameters:**

| Name     | Type     | Default | Description                               |
|----------|----------|---------|-------------------------------------------|
| `client` | `VedaDB` | --      | The client instance to return to the pool.|

#### `close()`

Closes all idle connections and rejects any pending waiters. Active (checked-out) connections will be destroyed when they are released.

**Signature:**

```typescript
close(): void
```

**Example:**

```javascript
pool.close();
```

### Full Pool Example

```javascript
const { VedaPool } = require('vedadb');

const pool = new VedaPool({
  host: 'localhost',
  port: 6380,
  min: 2,
  max: 20,
  idleTimeout: 60000,
  acquireTimeout: 10000,
});

// Pre-warm connections (optional)
await pool.warmup();

// Automatic acquire/release -- simplest usage
const result = await pool.query('SELECT * FROM users LIMIT 10;');
console.log(result.toObjects());

// Manual acquire/release -- needed for transactions
const client = await pool.acquire();
try {
  await client.begin();
  await client.insert('audit_log', { action: 'login', user_id: 1 });
  await client.commit();
} catch (err) {
  await client.rollback();
  throw err;
} finally {
  pool.release(client);
}

// Shut down the pool when your application exits
pool.close();
```

---

## Transactions

VedaDB supports ACID transactions. There are two ways to use them.

### Manual Transaction Control

Use `begin()`, `commit()`, and `rollback()` for fine-grained control:

```javascript
await db.begin();

try {
  await db.exec("INSERT INTO orders (user_id, total) VALUES (1, 99.99);");
  await db.exec("UPDATE accounts SET balance = balance - 99.99 WHERE user_id = 1;");
  await db.commit();
} catch (err) {
  await db.rollback();
  throw err;
}
```

### Automatic Transaction Block

Use `transaction()` for cleaner code. It automatically commits on success and rolls back on error:

```javascript
const result = await db.transaction(async (tx) => {
  await tx.exec("INSERT INTO orders (user_id, total) VALUES (1, 99.99);");
  await tx.exec("UPDATE accounts SET balance = balance - 99.99 WHERE user_id = 1;");
  const order = await tx.query("SELECT MAX(id) AS last_id FROM orders;");
  return order.first().last_id;
});

console.log('Created order:', result);
```

If the callback throws, the transaction is rolled back and the error is re-thrown to the caller.

---

## Error Handling

The driver provides a hierarchy of error classes for granular error handling. All error classes extend `VedaDBError`, which extends the built-in `Error`.

### Error Classes

| Error Class       | Description                                                                  |
|-------------------|------------------------------------------------------------------------------|
| `VedaDBError`     | Base class for all VedaDB errors. Catch this to handle any driver error.     |
| `ConnectionError` | Thrown when the client cannot connect, the connection drops, or the pool is closed. |
| `QueryError`      | Thrown when the server rejects a query (syntax errors, constraint violations, etc.). |
| `TimeoutError`    | Thrown when a query or socket operation exceeds the configured timeout.      |

### Usage

```javascript
const {
  createClient,
  VedaDBError,
  ConnectionError,
  QueryError,
  TimeoutError,
} = require('vedadb');

try {
  const db = await createClient({ host: 'localhost', port: 6380 });
  const result = await db.query('SELECT * FROM nonexistent_table;');
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error('Query timed out:', err.message);
  } else if (err instanceof QueryError) {
    console.error('Invalid query:', err.message);
  } else if (err instanceof ConnectionError) {
    console.error('Connection failed:', err.message);
  } else if (err instanceof VedaDBError) {
    console.error('VedaDB error:', err.message);
  } else {
    throw err; // unexpected error
  }
}
```

### Checking Error Types with `instanceof`

All custom errors set their `name` property, so you can also check `err.name`:

```javascript
catch (err) {
  switch (err.name) {
    case 'TimeoutError':
      // handle timeout
      break;
    case 'QueryError':
      // handle bad query
      break;
    case 'ConnectionError':
      // handle connection issue
      break;
  }
}
```

---

## Authentication

When VedaDB is configured with authentication, pass the `user` and `password` options to the client constructor:

```javascript
const db = await createClient({
  host: 'db.example.com',
  port: 6380,
  user: 'app_service',
  password: 'secret_token',
});
```

If the credentials are invalid, the server will reject queries with an error. The same options are available on the `VedaDB` constructor:

```javascript
const db = new VedaDB({
  host: 'db.example.com',
  port: 6380,
  user: 'app_service',
  password: 'secret_token',
});
await db.connect();
```

---

## TypeScript Support

The package ships with built-in TypeScript declarations (`index.d.ts`). No additional `@types` package is needed.

```typescript
import { createClient, VedaDB, Result, VedaPool, QueryError } from 'vedadb';

async function main(): Promise<void> {
  const db: VedaDB = await createClient({ host: 'localhost', port: 6380 });

  const result: Result = await db.query('SELECT id, name FROM users;');
  const users: Record<string, any>[] = result.toObjects();
  const names: any[] = result.pluck('name');

  const first: Record<string, any> | null = result.first();

  await db.transaction<string>(async (tx: VedaDB): Promise<string> => {
    await tx.exec("INSERT INTO logs (msg) VALUES ('hello');");
    return 'done';
  });

  db.close();
}
```

### Available Types

The following types and interfaces are exported:

- `VedaDBOptions` -- Options for the `VedaDB` constructor and `createClient`.
- `VedaPoolOptions` -- Options for the `VedaPool` constructor.
- `SelectOptions` -- Options for the `select()` method.
- `VedaDB` -- The client class.
- `VedaPool` -- The connection pool class.
- `Result` -- The query result class.
- `VedaDBError`, `ConnectionError`, `QueryError`, `TimeoutError` -- Error classes.
- `createClient` -- The factory function.
- `escapeValue` -- The value escaping utility function.

---

## Advanced Usage

### Reconnection

The client does not automatically reconnect. If the connection drops, you will receive a `ConnectionError`. Implement reconnection logic in your application:

```javascript
async function connectWithRetry(options, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await createClient(options);
    } catch (err) {
      console.error(`Connection attempt ${attempt} failed: ${err.message}`);
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt)); // exponential backoff
    }
  }
}

const db = await connectWithRetry({ host: 'localhost', port: 6380 });
```

### Timeout Handling

Configure the `timeout` option to control how long the client waits for responses. The timeout applies both to the TCP socket and to individual queries:

```javascript
// Short timeout for latency-sensitive operations
const fast = await createClient({ host: 'localhost', port: 6380, timeout: 5000 });

// Long timeout for analytical queries
const analytics = await createClient({ host: 'localhost', port: 6380, timeout: 120000 });
```

### Multiple Connections

You can create multiple independent client instances to the same or different servers:

```javascript
const primary = await createClient({ host: 'primary.db.local', port: 6380 });
const replica = await createClient({ host: 'replica.db.local', port: 6380 });

// Write to primary
await primary.insert('events', { type: 'click', timestamp: Date.now() });

// Read from replica
const events = await replica.query('SELECT * FROM events ORDER BY timestamp DESC LIMIT 100;');
```

### Using `escapeValue`

The driver exports an `escapeValue` utility for safely escaping values in manually constructed SQL strings:

```javascript
const { escapeValue } = require('vedadb');

escapeValue(null);           // 'NULL'
escapeValue(true);           // 'TRUE'
escapeValue(false);          // 'FALSE'
escapeValue(42);             // '42'
escapeValue("O'Reilly");     // "'O''Reilly'"
escapeValue({ a: 1 });       // '\'{"a":1}\''
```

### The `connected` Property

Check whether the client is currently connected:

```javascript
const db = new VedaDB({ host: 'localhost' });
console.log(db.connected); // false

await db.connect();
console.log(db.connected); // true

db.close();
console.log(db.connected); // false
```

---

## Running Tests

```bash
npm test
```

---

## License

Apache-2.0
