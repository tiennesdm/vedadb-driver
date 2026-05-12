# VedaDB Java Driver

Official Java client for [VedaDB](https://github.com/vedadb/vedadb) -- the multi-model database engine.

Communicates over raw TCP on port 6380 using the VedaQL wire protocol. Zero external dependencies -- includes a built-in JSON parser for response handling.

## Installation

### Maven

```xml
<dependency>
    <groupId>io.vedadb</groupId>
    <artifactId>vedadb</artifactId>
    <version>0.2.0</version>
</dependency>
```

### Gradle

```groovy
implementation 'io.vedadb:vedadb:0.2.0'
```

## Quick Start

```java
import io.vedadb.*;
import java.util.Map;

public class Example {
    public static void main(String[] args) throws Exception {
        try (VedaClient db = new VedaClient("localhost", 6380)) {
            // Create a table
            db.exec("CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100), email VARCHAR(200), age INT);");

            // Insert rows
            db.insert("users", Map.of("id", 1, "name", "Alice", "email", "alice@example.com", "age", 30));
            db.insert("users", Map.of("id", 2, "name", "Bob", "email", "bob@example.com", "age", 25));

            // Query
            VedaResult result = db.query("SELECT * FROM users WHERE age > 20;");
            System.out.println(result);

            // Close is called automatically via try-with-resources
        }
    }
}
```

## API Reference

### VedaClient

`VedaClient` is the primary class for communicating with VedaDB. It implements `AutoCloseable` and is safe for use with try-with-resources blocks.

---

#### Constructors

##### `VedaClient(String host, int port)`

Connect to a VedaDB server at the given host and port.

| Parameter | Type     | Description             |
|-----------|----------|-------------------------|
| `host`    | `String` | Server hostname or IP   |
| `port`    | `int`    | Server port (usually 6380) |

**Throws:** `IOException` if the connection fails.

```java
VedaClient db = new VedaClient("localhost", 6380);
```

##### `VedaClient()`

Connect to VedaDB on `localhost:6380` using default settings.

**Throws:** `IOException` if the connection fails.

```java
VedaClient db = new VedaClient();
```

---

#### `query(String sql)`

Execute a VedaQL query and return the parsed result.

| Parameter | Type     | Description          |
|-----------|----------|----------------------|
| `sql`     | `String` | The VedaQL statement |

**Returns:** `VedaResult` -- the parsed query response containing columns, rows, row count, and message.

**Throws:**
- `IOException` if the connection is lost or the server closes unexpectedly.
- `VedaException` if the server returns a query error.

```java
VedaResult result = db.query("SELECT name, age FROM users WHERE age > 25;");
for (List<String> row : result.getRows()) {
    System.out.println(row.get(0) + " is " + row.get(1) + " years old");
}
```

---

#### `exec(String sql)`

Execute a query that does not return rows (CREATE, DROP, INSERT, UPDATE, DELETE). Returns the server message.

| Parameter | Type     | Description          |
|-----------|----------|----------------------|
| `sql`     | `String` | The VedaQL statement |

**Returns:** `String` -- the server response message (e.g., `"1 row inserted"`).

**Throws:** `IOException`, `VedaException`

```java
String msg = db.exec("CREATE TABLE products (id INT PRIMARY KEY, name VARCHAR(100), price FLOAT);");
System.out.println(msg); // "Table created"
```

---

#### `insert(String table, Map<String, Object> data)`

Insert a single row into a table using a key-value map. Values are automatically formatted (strings are quoted, booleans converted, nulls handled).

| Parameter | Type                    | Description                    |
|-----------|-------------------------|--------------------------------|
| `table`   | `String`                | Target table name              |
| `data`    | `Map<String, Object>`   | Column-value pairs to insert   |

**Returns:** `String` -- the server response message.

**Throws:** `IOException`, `VedaException`

```java
db.insert("users", Map.of(
    "id", 1,
    "name", "Alice",
    "email", "alice@example.com",
    "age", 30
));
```

Supported value types:
- `String` -- quoted with single quotes, internal quotes escaped
- `Integer`, `Long`, `Float`, `Double` -- inserted as-is
- `Boolean` -- converted to `TRUE` / `FALSE`
- `null` -- inserted as `NULL`

---

#### `select(String table, String columns, String where, String orderBy, int limit)`

Build and execute a SELECT query with optional filtering, ordering, and limiting.

| Parameter | Type     | Description                                   |
|-----------|----------|-----------------------------------------------|
| `table`   | `String` | Table to query                                |
| `columns` | `String` | Comma-separated column names, or `null` for `*` |
| `where`   | `String` | WHERE clause (without the `WHERE` keyword), or `null` |
| `orderBy` | `String` | ORDER BY clause (without the keywords), or `null` |
| `limit`   | `int`    | Maximum rows to return, or `0` for no limit   |

**Returns:** `VedaResult`

**Throws:** `IOException`, `VedaException`

```java
// Select specific columns with filtering
VedaResult result = db.select("users", "name, email", "age > 25", "name ASC", 10);

// Select all columns, no filter
VedaResult all = db.select("users", null, null, null, 0);
```

---

#### `selectAll(String table)`

Select all rows and all columns from a table. Equivalent to `select(table, "*", null, null, 0)`.

| Parameter | Type     | Description    |
|-----------|----------|----------------|
| `table`   | `String` | Table to query |

**Returns:** `VedaResult`

**Throws:** `IOException`, `VedaException`

```java
VedaResult allUsers = db.selectAll("users");
System.out.println("Total users: " + allUsers.getRowCount());
```

---

#### `update(String table, Map<String, Object> set, String where)`

Update rows in a table.

| Parameter | Type                    | Description                                   |
|-----------|-------------------------|-----------------------------------------------|
| `table`   | `String`                | Target table name                             |
| `set`     | `Map<String, Object>`   | Column-value pairs to update                  |
| `where`   | `String`                | WHERE clause (without the keyword), or `null` for all rows |

**Returns:** `String` -- the server response message (e.g., `"2 rows updated"`).

**Throws:** `IOException`, `VedaException`

```java
db.update("users", Map.of("age", 31), "name = 'Alice'");
```

---

#### `delete(String table, String where)`

Delete rows from a table.

| Parameter | Type     | Description                                   |
|-----------|----------|-----------------------------------------------|
| `table`   | `String` | Target table name                             |
| `where`   | `String` | WHERE clause (without the keyword), or `null` for all rows |

**Returns:** `String` -- the server response message.

**Throws:** `IOException`, `VedaException`

```java
db.delete("users", "age < 18");
```

---

#### `showTables()`

Retrieve a list of all table names in the current database.

**Returns:** `List<String>` -- table names.

**Throws:** `IOException`, `VedaException`

```java
List<String> tables = db.showTables();
tables.forEach(System.out::println);
```

---

#### `ping()`

Check whether the server is reachable. Does not throw on failure -- returns a boolean instead.

**Returns:** `boolean` -- `true` if the server responds, `false` otherwise.

```java
if (db.ping()) {
    System.out.println("Server is up");
} else {
    System.out.println("Server is unreachable");
}
```

---

#### `close()`

Close the connection. Sends a `QUIT` command to the server before closing the underlying socket. Because `VedaClient` implements `AutoCloseable`, this is called automatically inside try-with-resources blocks.

**Throws:** `IOException`

```java
db.close();
```

---

## VedaResult

`VedaResult` represents the parsed response from a VedaDB query. It is returned by `query()`, `select()`, and `selectAll()`.

### Methods

| Method          | Return Type            | Description                                      |
|-----------------|------------------------|--------------------------------------------------|
| `getColumns()`  | `List<String>`         | Column names from the result set                 |
| `getRows()`     | `List<List<String>>`   | Row data, each row is a list of string values    |
| `getRowCount()` | `int`                  | Number of rows affected or returned              |
| `getMessage()`  | `String`               | Server message, or `"{rowCount} rows"` if absent |
| `toString()`    | `String`               | Human-readable table format with column headers  |
| `parse(String)` | `VedaResult` (static)  | Parse a raw JSON response into a `VedaResult`    |

### Examples

```java
VedaResult result = db.query("SELECT name, email FROM users;");

// Access columns
List<String> columns = result.getColumns(); // ["name", "email"]

// Iterate rows
for (List<String> row : result.getRows()) {
    String name  = row.get(0);
    String email = row.get(1);
    System.out.println(name + ": " + email);
}

// Row count
System.out.println("Found " + result.getRowCount() + " rows");

// Pretty-print
System.out.println(result);
// name | email
// ------------------------------------
// Alice | alice@example.com
// Bob | bob@example.com
// (2 rows)
```

### `parse(String json)` (static)

Parse a raw JSON response string from VedaDB into a `VedaResult`. This is called internally by `VedaClient.query()` and generally does not need to be invoked directly.

| Parameter | Type     | Description             |
|-----------|----------|-------------------------|
| `json`    | `String` | Raw JSON response       |

**Returns:** `VedaResult`

**Throws:** `VedaException` if the JSON contains an `"error"` field.

---

## VedaException

`VedaException` extends `Exception` and is thrown when VedaDB returns a server-side error. The message is prefixed with `"VedaDB Error: "`.

### Exception Hierarchy

```
java.lang.Exception
  +-- io.vedadb.VedaException
```

### Handling Errors

```java
try {
    db.query("SELECT * FROM nonexistent_table;");
} catch (VedaException e) {
    // Server-side error (e.g., table not found)
    System.err.println(e.getMessage());
} catch (IOException e) {
    // Network-level error (connection lost, timeout, etc.)
    System.err.println("Connection error: " + e.getMessage());
}
```

---

## Connection Pooling

`VedaPool` provides a thread-safe connection pool backed by a `LinkedBlockingQueue`. It reuses idle connections and creates new ones on demand.

### Constructor

#### `VedaPool(String host, int port, int maxSize)`

| Parameter | Type     | Description                               |
|-----------|----------|-------------------------------------------|
| `host`    | `String` | Server hostname or IP                     |
| `port`    | `int`    | Server port                               |
| `maxSize` | `int`    | Maximum number of idle connections to keep |

```java
VedaPool pool = new VedaPool("localhost", 6380, 10);
```

### Methods

| Method            | Return Type   | Description                                         |
|-------------------|---------------|-----------------------------------------------------|
| `acquire()`       | `VedaClient`  | Get a connection (reused or new)                    |
| `release(client)` | `void`        | Return a connection to the pool                     |
| `close()`         | `void`        | Close all idle connections and mark the pool closed  |
| `getActiveCount()`| `int`         | Number of connections currently checked out          |
| `getIdleCount()`  | `int`         | Number of connections available in the pool          |
| `isClosed()`      | `boolean`     | Whether the pool has been shut down                 |

### Pool Usage

```java
VedaPool pool = new VedaPool("localhost", 6380, 10);

VedaClient client = pool.acquire();
try {
    VedaResult result = client.query("SELECT * FROM users;");
    System.out.println(result);
} finally {
    pool.release(client);
}

// When shutting down
pool.close();
```

### Pool Behavior

- `acquire()` first checks for an idle connection. If none is available, a new connection is created.
- `release()` returns the connection to the idle queue. If the pool is full or has been closed, the connection is closed instead.
- `close()` marks the pool as closed and drains all idle connections. Calling `acquire()` after `close()` throws an `IOException`.
- Active count and idle count are tracked atomically and are safe to read from any thread.

---

## Thread Safety

All operations on `VedaClient` are synchronized using an internal `Object` lock. This means a single `VedaClient` instance can safely be shared across threads, though only one query will execute at a time per client.

For concurrent workloads, use `VedaPool` to maintain multiple connections.

```java
// Concurrent usage with pool
VedaPool pool = new VedaPool("localhost", 6380, 20);

ExecutorService executor = Executors.newFixedThreadPool(10);
for (int i = 0; i < 100; i++) {
    executor.submit(() -> {
        try {
            VedaClient client = pool.acquire();
            try {
                VedaResult result = client.query("SELECT COUNT(*) FROM events;");
                System.out.println(result.getRows().get(0).get(0));
            } finally {
                pool.release(client);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    });
}
executor.shutdown();
pool.close();
```

---

## Try-With-Resources

`VedaClient` implements `AutoCloseable`, making it compatible with Java try-with-resources blocks. The connection is closed automatically when the block exits, even if an exception is thrown.

```java
try (VedaClient db = new VedaClient("localhost", 6380)) {
    db.exec("CREATE TABLE logs (id INT PRIMARY KEY, message VARCHAR(500));");
    db.insert("logs", Map.of("id", 1, "message", "Application started"));

    VedaResult logs = db.selectAll("logs");
    System.out.println(logs);
} // db.close() called automatically
```

---

## Zero Dependencies

The VedaDB Java driver has no runtime dependencies. JSON response parsing is implemented using a built-in parser, so no Jackson, Gson, or other libraries are required. The only test dependency is JUnit 5.

---

## Requirements

- Java 11 or later
- A running VedaDB server (default port 6380)

---

## License

Apache-2.0 -- see [LICENSE](https://www.apache.org/licenses/LICENSE-2.0) for details.
