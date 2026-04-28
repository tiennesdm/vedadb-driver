# VedaDB .NET Driver

Official .NET client for [VedaDB](https://github.com/vedadb/vedadb) -- the multi-model database engine.

Communicates over TCP (port 6380) using a lightweight JSON wire protocol. Zero external dependencies beyond the .NET runtime -- only `System.Net.Sockets` and `System.Text.Json` from the BCL.

## Installation

### .NET CLI

```bash
dotnet add package VedaDB --version 0.2.0
```

### PackageReference (csproj)

```xml
<PackageReference Include="VedaDB" Version="0.2.0" />
```

### Target Frameworks

The driver multi-targets **net6.0** and **net8.0**, so it works in any project on .NET 6 or later.

---

## Quick Start

```csharp
using VedaDB;

// Connect to VedaDB
await using var db = new VedaClient("localhost", 6380);

// Create a table
await db.ExecAsync(@"
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

## Connection Options

The `VedaClient` constructor accepts three optional parameters:

| Parameter   | Type     | Default       | Description                          |
|-------------|----------|---------------|--------------------------------------|
| `host`      | `string` | `"localhost"` | VedaDB server hostname or IP address |
| `port`      | `int`    | `6380`        | TCP port the server is listening on  |
| `timeoutMs` | `int`    | `30000`       | Send and receive timeout in milliseconds |

```csharp
// All defaults -- localhost:6380, 30 s timeout
var db = new VedaClient();

// Remote server with a longer timeout
var db = new VedaClient("db.example.com", 6380, 60000);
```

---

## API Reference

### Constructor

```csharp
public VedaClient(string host = "localhost", int port = 6380, int timeoutMs = 30000)
```

Opens a TCP connection to the VedaDB server and consumes the welcome banner. The connection is ready to use immediately after construction. Internally creates a `TcpClient`, `StreamReader`, and `StreamWriter` with `AutoFlush = true`.

---

### QueryAsync / Query

Execute any SQL statement and receive the full result set.

```csharp
public async Task<VedaResult> QueryAsync(string sql)
public VedaResult Query(string sql)
```

| Parameter | Type     | Description                  |
|-----------|----------|------------------------------|
| `sql`     | `string` | SQL statement to execute     |

**Returns:** `VedaResult` (or `Task<VedaResult>` for the async variant).

**Throws:** `VedaConnectionException` if the server closes the connection; `VedaQueryException` if the server returns an error.

```csharp
// Async
var result = await db.QueryAsync("SELECT name, age FROM users WHERE age > 25;");

// Sync
var result = db.Query("SELECT name, age FROM users WHERE age > 25;");

foreach (var row in result.ToDicts())
{
    Console.WriteLine($"{row["name"]} is {row["age"]} years old");
}
```

---

### ExecAsync / Exec

Execute a DDL or DML statement (CREATE, INSERT, UPDATE, DELETE, DROP, etc.) and receive a status message. Delegates to `QueryAsync`/`Query` internally and extracts the `Message` property.

```csharp
public async Task<string> ExecAsync(string sql)
public string Exec(string sql)
```

| Parameter | Type     | Description                  |
|-----------|----------|------------------------------|
| `sql`     | `string` | DDL/DML statement to execute |

**Returns:** `string` -- the server status message (e.g. `"Table created"`), or `"{N} rows"` if no message is present.

```csharp
var msg = await db.ExecAsync("DROP TABLE IF EXISTS temp;");
Console.WriteLine(msg); // "Table dropped"
```

---

### InsertAsync

Build and execute an INSERT statement from a dictionary of column-value pairs.

```csharp
public async Task<string> InsertAsync(string table, Dictionary<string, object?> data)
```

| Parameter | Type                              | Description                        |
|-----------|-----------------------------------|------------------------------------|
| `table`   | `string`                          | Target table name                  |
| `data`    | `Dictionary<string, object?>`     | Column names mapped to values      |

**Returns:** `string` -- status message.

Supported value types: `string`, `int`, `long`, `double`, `float`, `bool`, and `null`. Strings are automatically single-quote escaped. `null` values are inserted as SQL `NULL`, and `bool` values become `TRUE` / `FALSE`.

```csharp
await db.InsertAsync("users", new Dictionary<string, object?>
{
    ["id"] = 2,
    ["name"] = "Bob",
    ["email"] = "bob@example.com",
    ["age"] = 28
});
```

---

### SelectAsync

Build and execute a SELECT statement with optional WHERE, ORDER BY, and LIMIT clauses.

```csharp
public async Task<VedaResult> SelectAsync(
    string table,
    string columns = "*",
    string? where = null,
    string? orderBy = null,
    int limit = 0)
```

| Parameter | Type      | Default | Description                               |
|-----------|-----------|---------|-------------------------------------------|
| `table`   | `string`  | --      | Table to select from                      |
| `columns` | `string`  | `"*"`   | Comma-separated column names              |
| `where`   | `string?` | `null`  | WHERE condition (without the `WHERE` keyword)|
| `orderBy` | `string?` | `null`  | ORDER BY expression (without the keyword) |
| `limit`   | `int`     | `0`     | Maximum rows to return; 0 means no limit  |

**Returns:** `VedaResult`.

```csharp
// All columns, filtered and sorted
var result = await db.SelectAsync(
    table: "users",
    columns: "name, email",
    where: "age >= 25",
    orderBy: "name ASC",
    limit: 10
);

foreach (var row in result.ToDicts())
{
    Console.WriteLine(row["name"]);
}
```

---

### UpdateAsync

Build and execute an UPDATE statement.

```csharp
public async Task<string> UpdateAsync(
    string table,
    Dictionary<string, object?> set,
    string? where = null)
```

| Parameter | Type                          | Default | Description                                |
|-----------|-------------------------------|---------|--------------------------------------------|
| `table`   | `string`                      | --      | Table to update                            |
| `set`     | `Dictionary<string, object?>` | --      | Column-value pairs to set                  |
| `where`   | `string?`                     | `null`  | WHERE condition (without the `WHERE` keyword) |

**Returns:** `string` -- status message.

```csharp
await db.UpdateAsync(
    "users",
    new Dictionary<string, object?> { ["age"] = 31 },
    where: "name = 'Alice'"
);
```

---

### DeleteAsync

Build and execute a DELETE statement.

```csharp
public async Task<string> DeleteAsync(string table, string? where = null)
```

| Parameter | Type      | Default | Description                                |
|-----------|-----------|---------|--------------------------------------------|
| `table`   | `string`  | --      | Table to delete from                       |
| `where`   | `string?` | `null`  | WHERE condition (without the `WHERE` keyword) |

**Returns:** `string` -- status message.

```csharp
await db.DeleteAsync("users", where: "age < 18");
```

> **Warning:** Calling `DeleteAsync` without a `where` clause deletes all rows in the table.

---

### ShowTablesAsync

List all tables in the database.

```csharp
public async Task<List<string>> ShowTablesAsync()
```

**Returns:** `List<string>` -- table names.

```csharp
var tables = await db.ShowTablesAsync();
tables.ForEach(t => Console.WriteLine(t));
```

---

### PingAsync / Ping

Health check. Returns `true` if the server responds successfully, `false` on any error.

```csharp
public async Task<bool> PingAsync()
public bool Ping()
```

**Returns:** `bool` (or `Task<bool>`).

```csharp
if (await db.PingAsync())
    Console.WriteLine("VedaDB is alive");
```

---

### Dispose / DisposeAsync

Sends a `QUIT` command to the server and releases the underlying TCP connection, stream reader, stream writer, and semaphore. Calls `GC.SuppressFinalize(this)` to prevent finalization overhead.

```csharp
public void Dispose()
public async ValueTask DisposeAsync()
```

Prefer `using` or `await using` blocks so cleanup is automatic:

```csharp
// Async disposal (preferred)
await using var db = new VedaClient();

// Sync disposal
using var db = new VedaClient();
```

---

## VedaResult

Query results are deserialized from the server's JSON wire protocol response into a `VedaResult` object using `System.Text.Json`.

### Properties

| Property   | Type                        | Description                                  |
|------------|-----------------------------|----------------------------------------------|
| `Columns`  | `List<string>?`             | Column names from the result set             |
| `Rows`     | `List<List<JsonElement>>?`  | Row data; each cell is a `System.Text.Json.JsonElement` |
| `RowCount` | `int`                       | Number of rows returned or affected          |
| `Message`  | `string?`                   | Server status message (for DDL/DML results)  |
| `Error`    | `string?`                   | Error message from the server (if any)       |

All properties carry `[JsonPropertyName(...)]` attributes for wire-format mapping (`columns`, `rows`, `row_count`, `message`, `error`).

### ToDicts

Convert the result into a list of dictionaries keyed by column name. Each value is the string representation of the underlying `JsonElement`, or `null` for JSON null values.

```csharp
public List<Dictionary<string, string?>> ToDicts()
```

**Returns:** `List<Dictionary<string, string?>>` -- empty list if `Columns` or `Rows` is null.

```csharp
var result = await db.QueryAsync("SELECT id, name FROM users;");

foreach (var dict in result.ToDicts())
{
    Console.WriteLine($"id={dict["id"]}, name={dict["name"]}");
}
```

### First

Get the first row as a dictionary, or `null` if the result set is empty.

```csharp
public Dictionary<string, string?>? First()
```

**Returns:** `Dictionary<string, string?>?` -- the first row, or `null`.

```csharp
var result = await db.QueryAsync("SELECT * FROM users WHERE id = 1;");
var user = result.First();

if (user != null)
    Console.WriteLine(user["name"]);
```

### Pluck

Extract a single column's values into a flat list. Returns an empty list if the column name is not found in the result set.

```csharp
public List<string?> Pluck(string column)
```

| Parameter | Type     | Description            |
|-----------|----------|------------------------|
| `column`  | `string` | Column name to extract |

**Returns:** `List<string?>`.

```csharp
var result = await db.QueryAsync("SELECT name FROM users;");
List<string?> names = result.Pluck("name");
// ["Alice", "Bob", "Charlie"]
```

### Internal Parse Method

`VedaResult.Parse` is called by `VedaClient` to deserialize each JSON response. If the deserialized result contains a non-empty `Error` field, a `VedaQueryException` is thrown automatically before the result is returned to the caller.

```csharp
internal static VedaResult Parse(string json)
```

---

## Exception Hierarchy

All VedaDB exceptions derive from a common base class so you can catch them at any level of specificity:

```
Exception
  └── VedaException                 -- base for all VedaDB errors
        ├── VedaConnectionException -- TCP / connection failures
        └── VedaQueryException      -- server-side query errors
```

### VedaException

```csharp
public class VedaException : Exception
{
    public VedaException(string message);
    public VedaException(string message, Exception inner);
}
```

Base class. Thrown for general driver errors such as a failed JSON deserialization.

### VedaConnectionException

```csharp
public class VedaConnectionException : VedaException
{
    public VedaConnectionException(string message);
    public VedaConnectionException(string message, Exception inner);
}
```

Thrown when the TCP connection is lost mid-query or the server closes the stream unexpectedly (e.g. `ReadLine` returns `null`).

### VedaQueryException

```csharp
public class VedaQueryException : VedaException
{
    public VedaQueryException(string message);
}
```

Thrown when the server returns a JSON response with a non-empty `error` field (invalid SQL, constraint violations, unknown table, etc.).

### Error Handling Example

```csharp
try
{
    await db.ExecAsync("INSERT INTO users (id, name) VALUES (1, 'Alice');");
}
catch (VedaQueryException ex)
{
    // Server rejected the query (e.g. duplicate primary key)
    Console.Error.WriteLine($"Query error: {ex.Message}");
}
catch (VedaConnectionException ex)
{
    // Connection was lost mid-query
    Console.Error.WriteLine($"Connection lost: {ex.Message}");
}
catch (VedaException ex)
{
    // Any other driver-level error
    Console.Error.WriteLine($"VedaDB error: {ex.Message}");
}
```

---

## Connection Pooling

The `VedaPool` class provides a thread-safe connection pool backed by `ConcurrentBag<VedaClient>`. Use it when multiple threads or async tasks need concurrent database access.

### Constructor

```csharp
public VedaPool(
    string host = "localhost",
    int port = 6380,
    int maxSize = 10,
    int timeoutMs = 30000)
```

| Parameter   | Type     | Default       | Description                               |
|-------------|----------|---------------|-------------------------------------------|
| `host`      | `string` | `"localhost"` | VedaDB server hostname                    |
| `port`      | `int`    | `6380`        | TCP port                                  |
| `maxSize`   | `int`    | `10`          | Maximum number of idle connections to keep |
| `timeoutMs` | `int`    | `30000`       | Timeout for each connection               |

### Acquire

Retrieve a client from the pool. If no idle connections are available, a new `VedaClient` is created on the fly.

```csharp
public VedaClient Acquire()
```

**Returns:** `VedaClient`.

**Throws:** `VedaException` if the pool has been disposed.

### Release

Return a client to the pool. If the pool already holds `maxSize` idle connections or has been disposed, the client is disposed instead of being returned.

```csharp
public void Release(VedaClient client)
```

| Parameter | Type         | Description                       |
|-----------|--------------|-----------------------------------|
| `client`  | `VedaClient` | The client to return or dispose   |

### Properties

| Property      | Type  | Description                                |
|---------------|-------|--------------------------------------------|
| `ActiveCount` | `int` | Number of checked-out (in-use) clients     |
| `IdleCount`   | `int` | Number of idle clients waiting in the pool |

### Dispose

Marks the pool as closed and disposes every idle connection. Any subsequent call to `Acquire` throws `VedaException`.

```csharp
public void Dispose()
```

### Pool Usage Example

```csharp
using var pool = new VedaPool("localhost", 6380, maxSize: 20);

var client = pool.Acquire();
try
{
    var result = await client.QueryAsync("SELECT * FROM users;");
    Console.WriteLine($"Got {result.RowCount} rows");
}
finally
{
    pool.Release(client);
}

Console.WriteLine($"Active: {pool.ActiveCount}, Idle: {pool.IdleCount}");
```

### Concurrent Pool Usage

```csharp
using var pool = new VedaPool("localhost", 6380, maxSize: 50);

var tasks = Enumerable.Range(1, 100).Select(async i =>
{
    var client = pool.Acquire();
    try
    {
        return await client.QueryAsync($"SELECT * FROM users WHERE id = {i};");
    }
    finally
    {
        pool.Release(client);
    }
});

var results = await Task.WhenAll(tasks);
Console.WriteLine($"Fetched {results.Length} results");
```

---

## Async / Await Patterns

Every query method has both an async and a sync variant:

| Async                | Sync          | Returns            |
|----------------------|---------------|--------------------|
| `QueryAsync(sql)`   | `Query(sql)`  | `VedaResult`       |
| `ExecAsync(sql)`    | `Exec(sql)`   | `string`           |
| `PingAsync()`       | `Ping()`      | `bool`             |

The builder methods (`InsertAsync`, `SelectAsync`, `UpdateAsync`, `DeleteAsync`, `ShowTablesAsync`) are async-only.

```csharp
// Preferred -- async
var result = await db.QueryAsync("SELECT 1;");

// Also available -- sync (blocks the calling thread)
var result = db.Query("SELECT 1;");
```

> **Recommendation:** Use the async methods in ASP.NET Core, background services, and any I/O-bound workload to avoid blocking thread-pool threads.

---

## IDisposable and IAsyncDisposable

`VedaClient` implements both `IDisposable` and `IAsyncDisposable`. Use `using` declarations to ensure the connection is always cleaned up, even when exceptions occur:

```csharp
// Async disposal (recommended in async contexts)
await using var db = new VedaClient();
var result = await db.QueryAsync("SELECT 1;");
// Connection is closed automatically at end of scope

// Sync disposal
using var db = new VedaClient();
var result = db.Query("SELECT 1;");
// Connection is closed automatically at end of scope
```

On disposal the driver:

1. Sends a `QUIT` command to the server (errors are silently caught).
2. Disposes the `StreamReader`, `StreamWriter`, and `TcpClient`.
3. Disposes the internal `SemaphoreSlim`.
4. Calls `GC.SuppressFinalize(this)`.

An internal `_disposed` flag prevents double-disposal.

`VedaPool` implements `IDisposable` only (not `IAsyncDisposable`).

---

## Thread Safety

`VedaClient` is thread-safe. All reads and writes to the underlying TCP stream are serialized with a `SemaphoreSlim(1, 1)`, ensuring that concurrent calls from multiple threads are queued and executed one at a time without data corruption.

```csharp
var db = new VedaClient();

// Safe -- requests are serialized internally
var tasks = Enumerable.Range(1, 10).Select(i =>
    db.QueryAsync($"SELECT * FROM users WHERE id = {i};")
);

var results = await Task.WhenAll(tasks);
```

For higher throughput under heavy concurrency, use `VedaPool` to run queries in parallel across multiple TCP connections rather than serializing through a single client.

`VedaPool` is also thread-safe: `Acquire` and `Release` use `ConcurrentBag` and `Interlocked` operations, so no external locking is needed.

---

## Advanced Usage

### ASP.NET Core Dependency Injection

Register the pool as a singleton service and inject it into controllers or services:

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<VedaPool>(sp =>
    new VedaPool(
        host: builder.Configuration["VedaDB:Host"] ?? "localhost",
        port: int.Parse(builder.Configuration["VedaDB:Port"] ?? "6380"),
        maxSize: 20
    )
);

var app = builder.Build();
```

```csharp
// UserService.cs
public class UserService
{
    private readonly VedaPool _pool;

    public UserService(VedaPool pool)
    {
        _pool = pool;
    }

    public async Task<List<Dictionary<string, string?>>> GetUsersAsync()
    {
        var client = _pool.Acquire();
        try
        {
            var result = await client.QueryAsync("SELECT * FROM users;");
            return result.ToDicts();
        }
        finally
        {
            _pool.Release(client);
        }
    }
}
```

### appsettings.json Configuration

```json
{
  "VedaDB": {
    "Host": "localhost",
    "Port": "6380"
  }
}
```

### Multiple Connections

Open separate connections to different VedaDB instances:

```csharp
await using var primary = new VedaClient("primary.db.local", 6380);
await using var replica = new VedaClient("replica.db.local", 6380);

// Write to primary
await primary.InsertAsync("events", new Dictionary<string, object?>
{
    ["id"] = 1,
    ["type"] = "click"
});

// Read from replica
var result = await replica.QueryAsync("SELECT * FROM events;");
```

---

## License

Apache-2.0. See [LICENSE](LICENSE) for details.
