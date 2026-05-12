# VedaDB Python Driver

Official Python driver for **VedaDB**, the multi-model database engine. This driver provides a synchronous TCP client that communicates with VedaDB using a newline-delimited JSON protocol over port 6380.

VedaDB combines relational SQL, key-value caching, and full-text search in a single engine. This driver exposes all three paradigms through a unified Python API with connection pooling, automatic reconnection, and thread safety.

- **Protocol**: TCP with newline-delimited JSON messages
- **Default port**: 6380
- **Python**: 3.8+
- **License**: Apache-2.0

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Connection Options](#connection-options)
- [API Reference](#api-reference)
  - [query()](#query)
  - [execute()](#execute)
  - [insert()](#insert)
  - [select()](#select)
  - [update()](#update)
  - [delete()](#delete)
  - [show_tables()](#show_tables)
  - [drop_table()](#drop_table)
  - [count()](#count)
  - [search()](#search)
  - [cache_set()](#cache_set)
  - [cache_get()](#cache_get)
  - [cache_del()](#cache_del)
  - [cache_incr()](#cache_incr)
  - [ping()](#ping)
  - [connect()](#connect)
  - [close()](#close)
- [Result Object](#result-object)
- [Connection Pooling](#connection-pooling)
- [Context Manager](#context-manager)
- [Error Handling](#error-handling)
- [Full-Text Search](#full-text-search)
- [Cache Operations](#cache-operations)
- [Thread Safety](#thread-safety)
- [Auto-Reconnect](#auto-reconnect)
- [Type Hints](#type-hints)
- [Advanced Usage](#advanced-usage)
- [License](#license)

---

## Installation

### pip

```bash
pip install vedadb
```

### Poetry

```bash
poetry add vedadb
```

### Pipenv

```bash
pipenv install vedadb
```

### From source

```bash
git clone https://github.com/vedadb/vedadb.git
cd drivers/python
pip install .
```

---

## Quick Start

```python
from vedadb import VedaDB

with VedaDB(host="localhost", port=6380) as db:
    # Create a table
    db.execute("CREATE TABLE users (id INT, name TEXT, email TEXT);")

    # Insert rows
    db.insert("users", {"id": 1, "name": "Alice", "email": "alice@example.com"})
    db.insert("users", {"id": 2, "name": "Bob", "email": "bob@example.com"})

    # Query
    result = db.select("users", where={"name": "Alice"})
    for record in result.to_dicts():
        print(record)
    # {'id': 1, 'name': 'Alice', 'email': 'alice@example.com'}

    # Count
    total = db.count("users")
    print(f"Total users: {total}")
```

---

## Connection Options

The `VedaDB` constructor accepts the following parameters:

| Parameter        | Type   | Default       | Description                                          |
|------------------|--------|---------------|------------------------------------------------------|
| `host`           | `str`  | `"localhost"` | Hostname or IP address of the VedaDB server.         |
| `port`           | `int`  | `6380`        | TCP port the server is listening on.                  |
| `timeout`        | `float`| `30.0`        | Socket timeout in seconds for all operations.         |
| `auto_reconnect` | `bool` | `True`        | Automatically retry once on connection loss.          |

```python
db = VedaDB(
    host="db.example.com",
    port=6380,
    timeout=10.0,
    auto_reconnect=True,
)
db.connect()
```

---

## API Reference

### `query()`

Execute any VedaQL statement and return a structured `Result`.

```python
def query(self, sql: str) -> Result
```

| Parameter | Type  | Default | Description                        |
|-----------|-------|---------|------------------------------------|
| `sql`     | `str` | --      | The VedaQL statement to execute.   |

**Returns**: `Result`

**Raises**:
- `ConnectionError` -- server unreachable and auto-reconnect disabled or failed.
- `QueryError` -- the server reported a query-level error.
- `AuthError` -- authentication or permission failure.

```python
result = db.query("SELECT * FROM products WHERE price > 100;")
for row in result.rows:
    print(row)
```

---

### `execute()`

Alias for `query()`. Use this when the intent is DDL or DML (CREATE, DROP, INSERT, UPDATE, DELETE) to improve code readability.

```python
def execute(self, sql: str) -> Result
```

| Parameter | Type  | Default | Description                        |
|-----------|-------|---------|------------------------------------|
| `sql`     | `str` | --      | The VedaQL statement to execute.   |

**Returns**: `Result`

```python
db.execute("CREATE TABLE logs (id INT, message TEXT, level TEXT);")
db.execute("DROP TABLE old_logs;")
```

---

### `insert()`

Insert a single row into a table using a Python dictionary.

```python
def insert(self, table: str, data: Dict[str, Any]) -> Result
```

| Parameter | Type             | Default | Description                             |
|-----------|------------------|---------|-----------------------------------------|
| `table`   | `str`            | --      | Target table name.                      |
| `data`    | `Dict[str, Any]` | --      | Column-value mapping for the new row.   |

**Returns**: `Result`

Values are automatically formatted: strings are quoted and escaped, booleans become `TRUE`/`FALSE`, `None` becomes `NULL`, and numbers are passed as-is.

```python
db.insert("users", {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.com",
    "active": True,
    "score": 95.5,
    "notes": None,
})
```

---

### `select()`

Build and execute a SELECT query with optional filtering, ordering, and pagination.

```python
def select(
    self,
    table: str,
    columns: str = "*",
    where: Optional[Dict[str, Any]] = None,
    order_by: Optional[str] = None,
    desc: bool = False,
    limit: Optional[int] = None,
    offset: Optional[int] = None,
) -> Result
```

| Parameter  | Type                       | Default | Description                                       |
|------------|----------------------------|---------|---------------------------------------------------|
| `table`    | `str`                      | --      | Table to query.                                   |
| `columns`  | `str`                      | `"*"`   | Comma-separated column names or `"*"` for all.    |
| `where`    | `Optional[Dict[str, Any]]` | `None`  | Equality filters joined with AND.                 |
| `order_by` | `Optional[str]`            | `None`  | Column name to sort by.                           |
| `desc`     | `bool`                     | `False` | Sort in descending order when `True`.             |
| `limit`    | `Optional[int]`            | `None`  | Maximum number of rows to return.                 |
| `offset`   | `Optional[int]`            | `None`  | Number of rows to skip before returning results.  |

**Returns**: `Result`

```python
# Basic select
result = db.select("users")

# With filters and pagination
result = db.select(
    "users",
    columns="name, email",
    where={"active": True},
    order_by="name",
    desc=False,
    limit=20,
    offset=0,
)
for record in result.to_dicts():
    print(record["name"], record["email"])
```

---

### `update()`

Build and execute an UPDATE query.

```python
def update(
    self,
    table: str,
    set_values: Dict[str, Any],
    where: Optional[Dict[str, Any]] = None,
) -> Result
```

| Parameter    | Type                       | Default | Description                                    |
|--------------|----------------------------|---------|------------------------------------------------|
| `table`      | `str`                      | --      | Table to update.                               |
| `set_values` | `Dict[str, Any]`          | --      | Column-value pairs to set.                     |
| `where`      | `Optional[Dict[str, Any]]` | `None`  | Equality filters to restrict affected rows.    |

**Returns**: `Result`

```python
# Update a single user
db.update("users", {"email": "newalice@example.com"}, where={"id": 1})

# Update all rows (no where clause)
db.update("users", {"active": False})
```

---

### `delete()`

Build and execute a DELETE query.

```python
def delete(self, table: str, where: Optional[Dict[str, Any]] = None) -> Result
```

| Parameter | Type                       | Default | Description                                    |
|-----------|----------------------------|---------|------------------------------------------------|
| `table`   | `str`                      | --      | Table to delete from.                          |
| `where`   | `Optional[Dict[str, Any]]` | `None`  | Equality filters to restrict deleted rows.     |

**Returns**: `Result`

```python
# Delete specific rows
db.delete("users", where={"active": False})

# Delete all rows (no where clause)
db.delete("temp_data")
```

---

### `show_tables()`

Return a list of all table names in the database.

```python
def show_tables(self) -> List[str]
```

**Returns**: `List[str]` -- table names, or an empty list if no tables exist.

```python
tables = db.show_tables()
print(tables)
# ['users', 'products', 'orders']
```

---

### `drop_table()`

Drop (delete) a table from the database.

```python
def drop_table(self, table: str) -> Result
```

| Parameter | Type  | Default | Description                |
|-----------|-------|---------|----------------------------|
| `table`   | `str` | --      | Name of the table to drop. |

**Returns**: `Result`

```python
db.drop_table("temp_data")
print(db.show_tables())  # table no longer listed
```

---

### `count()`

Return the number of rows in a table, optionally filtered by conditions.

```python
def count(self, table: str, where: Optional[Dict[str, Any]] = None) -> int
```

| Parameter | Type                       | Default | Description                              |
|-----------|----------------------------|---------|------------------------------------------|
| `table`   | `str`                      | --      | Table to count rows in.                  |
| `where`   | `Optional[Dict[str, Any]]` | `None`  | Equality filters to restrict the count.  |

**Returns**: `int`

```python
total = db.count("users")
active = db.count("users", where={"active": True})
print(f"{active} of {total} users are active")
```

---

### `search()`

Perform a full-text search on a table column with optional fuzzy matching.

```python
def search(self, table: str, column: str, query: str, fuzzy: int = 0) -> Result
```

| Parameter | Type  | Default | Description                                           |
|-----------|-------|---------|-------------------------------------------------------|
| `table`   | `str` | --      | Table to search.                                      |
| `column`  | `str` | --      | Column to match against.                              |
| `query`   | `str` | --      | Search term or phrase.                                |
| `fuzzy`   | `int` | `0`     | Fuzzy matching distance (0 = exact, 1+ = tolerance).  |

**Returns**: `Result`

```python
# Exact match search
result = db.search("articles", "title", "database performance")

# Fuzzy search (tolerates typos)
result = db.search("articles", "title", "databse", fuzzy=2)
for record in result.to_dicts():
    print(record["title"])
```

---

### `cache_set()`

Set a key in the built-in cache with an optional time-to-live.

```python
def cache_set(self, key: str, value: Any, ttl: Optional[int] = None) -> Result
```

| Parameter | Type            | Default | Description                                 |
|-----------|-----------------|---------|---------------------------------------------|
| `key`     | `str`           | --      | Cache key.                                  |
| `value`   | `Any`           | --      | Value to store (strings, dicts, lists).     |
| `ttl`     | `Optional[int]` | `None`  | Time-to-live in seconds. `None` = no expiry.|

**Returns**: `Result`

```python
# Simple string
db.cache_set("greeting", "hello world")

# With TTL (expires after 300 seconds)
db.cache_set("session:abc123", "user_42", ttl=300)

# JSON-serializable objects are stored as JSON
db.cache_set("config", {"theme": "dark", "lang": "en"}, ttl=3600)
```

---

### `cache_get()`

Retrieve a value from the cache by key.

```python
def cache_get(self, key: str) -> Result
```

| Parameter | Type  | Default | Description     |
|-----------|-------|---------|-----------------|
| `key`     | `str` | --      | Cache key.      |

**Returns**: `Result`

```python
result = db.cache_get("greeting")
print(result.scalar())  # 'hello world'
```

---

### `cache_del()`

Delete a key from the cache.

```python
def cache_del(self, key: str) -> Result
```

| Parameter | Type  | Default | Description            |
|-----------|-------|---------|------------------------|
| `key`     | `str` | --      | Cache key to delete.   |

**Returns**: `Result`

```python
db.cache_del("session:abc123")
```

---

### `cache_incr()`

Atomically increment a numeric cache counter by 1.

```python
def cache_incr(self, key: str) -> Result
```

| Parameter | Type  | Default | Description               |
|-----------|-------|---------|---------------------------|
| `key`     | `str` | --      | Cache key to increment.   |

**Returns**: `Result`

```python
db.cache_set("page_views", "0")
db.cache_incr("page_views")
db.cache_incr("page_views")
result = db.cache_get("page_views")
print(result.scalar())  # '2'
```

---

### `ping()`

Check whether the server is reachable.

```python
def ping(self) -> bool
```

**Returns**: `bool` -- `True` if the server responds, `False` otherwise.

```python
if db.ping():
    print("VedaDB is up")
else:
    print("VedaDB is unreachable")
```

---

### `connect()`

Open a TCP connection to the VedaDB server. This is called automatically when using the context manager (`with` statement).

```python
def connect(self) -> VedaDB
```

**Returns**: `VedaDB` -- the client instance (for chaining).

**Raises**: `ConnectionError` -- if the connection cannot be established.

```python
db = VedaDB(host="localhost", port=6380).connect()
# ... use db ...
db.close()
```

---

### `close()`

Close the connection gracefully. Sends a `QUIT` command to the server before closing the socket.

```python
def close(self) -> None
```

```python
db = VedaDB().connect()
try:
    result = db.query("SELECT 1;")
finally:
    db.close()
```

---

## Result Object

Every query returns a `Result` instance that provides structured access to the server response.

### Properties

| Property    | Type         | Description                                       |
|-------------|--------------|---------------------------------------------------|
| `columns`   | `List[str]`  | Column names from the query result.               |
| `rows`      | `List[list]` | Row data as a list of lists.                      |
| `row_count` | `int`        | Number of rows affected or returned.              |
| `message`   | `str`        | Human-readable status message (DDL/DML results).  |
| `error`     | `str`        | Error string (empty on success).                  |

### Methods

#### `to_dicts() -> List[Dict[str, Any]]`

Convert all rows into a list of dictionaries keyed by column name.

```python
result = db.query("SELECT id, name FROM users;")
records = result.to_dicts()
# [{'id': 1, 'name': 'Alice'}, {'id': 2, 'name': 'Bob'}]
```

#### `first() -> Optional[Dict[str, Any]]`

Return the first row as a dictionary, or `None` if the result is empty.

```python
result = db.query("SELECT * FROM users WHERE id = 1;")
user = result.first()
if user:
    print(user["name"])
```

#### `scalar() -> Any`

Return the single value from a one-row, one-column result. Returns `None` if empty.

```python
result = db.query("SELECT COUNT(*) FROM users;")
total = result.scalar()
print(total)  # 42
```

### Iteration

`Result` supports `len()`, `for` loops, and boolean evaluation:

```python
result = db.query("SELECT * FROM users;")

# Length
print(len(result))  # number of rows

# Iteration (yields raw row lists)
for row in result:
    print(row)

# Boolean: True if rows exist or a message was returned
if result:
    print("Got data")
```

### Repr

```python
print(result)
# Result(rows=5, columns=['id', 'name', 'email'])
# or
# Result(message='Table created')
```

---

## Connection Pooling

The `ConnectionPool` class manages a pool of reusable `VedaDB` connections for multi-threaded applications.

### Constructor

```python
ConnectionPool(
    host: str = "localhost",
    port: int = 6380,
    min_size: int = 2,
    max_size: int = 10,
    timeout: float = 30.0,
)
```

| Parameter  | Type    | Default       | Description                                        |
|------------|---------|---------------|----------------------------------------------------|
| `host`     | `str`   | `"localhost"` | VedaDB server hostname.                            |
| `port`     | `int`   | `6380`        | VedaDB server port.                                |
| `min_size` | `int`   | `2`           | Connections opened eagerly at pool creation.        |
| `max_size` | `int`   | `10`          | Maximum number of concurrent connections.           |
| `timeout`  | `float` | `30.0`        | Socket timeout passed to each connection.           |

**Raises**: `ValueError` if `min_size < 0`, `max_size < 1`, or `min_size > max_size`.

### Methods

#### `acquire() -> VedaDB`

Take a connection from the pool. If no idle connections are available and the pool has not reached `max_size`, a new connection is created. Stale connections are automatically discarded.

**Raises**: `ConnectionError` if the pool is exhausted or closed.

#### `release(conn: VedaDB) -> None`

Return a connection to the pool. If the connection is dead or the pool is full, the connection is closed instead.

#### `close() -> None`

Close all connections in the pool and mark the pool as closed. No further `acquire()` calls will succeed.

### Properties

| Property    | Type  | Description                                          |
|-------------|-------|------------------------------------------------------|
| `size`      | `int` | Total managed connections (in-pool + checked-out).   |
| `available` | `int` | Number of idle connections waiting in the pool.      |

### Example

```python
from vedadb import ConnectionPool

pool = ConnectionPool(host="localhost", port=6380, min_size=2, max_size=10)

# Acquire and use a connection
conn = pool.acquire()
try:
    result = conn.query("SELECT * FROM users;")
    print(result.to_dicts())
finally:
    pool.release(conn)

# Check pool status
print(f"Total connections: {pool.size}")
print(f"Idle connections: {pool.available}")

# Shutdown
pool.close()
```

### Thread-Safe Pool Usage

```python
import threading
from vedadb import ConnectionPool

pool = ConnectionPool(min_size=4, max_size=20)

def worker(user_id: int):
    conn = pool.acquire()
    try:
        result = conn.select("users", where={"id": user_id})
        print(result.first())
    finally:
        pool.release(conn)

threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()

pool.close()
```

---

## Context Manager

The `VedaDB` client implements the context manager protocol. Using `with` ensures the connection is opened on entry and closed on exit, even if an exception occurs.

```python
from vedadb import VedaDB

with VedaDB(host="localhost", port=6380) as db:
    db.insert("events", {"type": "login", "user_id": 42})
    result = db.select("events", where={"user_id": 42})
    print(result.to_dicts())
# Connection is automatically closed here
```

If the client is already connected before entering the `with` block, it will not reconnect:

```python
db = VedaDB().connect()
with db:
    result = db.query("SELECT 1;")
# Connection closed on exit
```

---

## Error Handling

The driver defines a hierarchy of exceptions, all inheriting from `VedaDBError`:

| Exception         | Parent        | Raised When                                         |
|-------------------|---------------|-----------------------------------------------------|
| `VedaDBError`     | `Exception`   | Base class for all VedaDB errors.                   |
| `ConnectionError` | `VedaDBError` | TCP connection fails, is lost, or server closes it. |
| `QueryError`      | `VedaDBError` | The server returns an error for a query.            |
| `AuthError`       | `VedaDBError` | Authentication or permission failure.               |

### Import

```python
from vedadb import VedaDBError, ConnectionError, QueryError, AuthError
```

### Examples

```python
from vedadb import VedaDB, ConnectionError, QueryError, AuthError, VedaDBError

with VedaDB() as db:
    # Catch specific errors
    try:
        result = db.query("SELECT * FROM nonexistent_table;")
    except QueryError as e:
        print(f"Query failed: {e}")

    # Catch authentication errors
    try:
        result = db.query("DROP TABLE restricted_data;")
    except AuthError as e:
        print(f"Permission denied: {e}")

    # Catch connection problems
    try:
        result = db.query("SELECT 1;")
    except ConnectionError as e:
        print(f"Connection lost: {e}")

    # Catch all VedaDB errors
    try:
        result = db.query("INVALID SYNTAX HERE;")
    except VedaDBError as e:
        print(f"VedaDB error: {e}")
```

---

## Full-Text Search

The `search()` method provides full-text search with optional fuzzy matching. Fuzzy matching uses edit distance to tolerate typos and spelling variations.

```python
with VedaDB() as db:
    # Exact full-text search
    result = db.search("articles", "body", "machine learning")
    for article in result.to_dicts():
        print(article["title"])

    # Fuzzy search with edit distance 1 (tolerates single-character typos)
    result = db.search("products", "name", "laptp", fuzzy=1)
    print(result.to_dicts())

    # Higher fuzzy distance for more tolerance
    result = db.search("articles", "title", "artifcial inteligence", fuzzy=2)
    for row in result.to_dicts():
        print(row["title"])
```

The `fuzzy` parameter controls the maximum edit distance:

| Value | Behavior                                                          |
|-------|-------------------------------------------------------------------|
| `0`   | Exact match only (default).                                       |
| `1`   | Tolerates one insertion, deletion, or substitution.               |
| `2`   | Tolerates up to two edits. Good for catching common typos.        |
| `3+`  | Increasingly permissive. Higher values may return less relevant results. |

---

## Cache Operations

VedaDB includes a built-in key-value cache accessible through dedicated cache methods. This is useful for session storage, counters, rate limiting, and configuration caching without needing a separate system like Redis.

### Set a Value

```python
# Simple string
db.cache_set("user:42:name", "Alice")

# With expiration (TTL in seconds)
db.cache_set("session:token123", "user_42", ttl=1800)

# Dicts and lists are JSON-serialized automatically
db.cache_set("app:config", {"debug": False, "workers": 4}, ttl=3600)
```

### Get a Value

```python
result = db.cache_get("user:42:name")
name = result.scalar()  # 'Alice'
```

### Delete a Key

```python
db.cache_del("session:token123")
```

### Increment a Counter

```python
db.cache_set("api:hits", "0")
db.cache_incr("api:hits")
db.cache_incr("api:hits")
db.cache_incr("api:hits")

result = db.cache_get("api:hits")
print(result.scalar())  # '3'
```

### Rate Limiting Example

```python
def check_rate_limit(db: VedaDB, client_ip: str, max_requests: int = 100) -> bool:
    key = f"ratelimit:{client_ip}"
    result = db.cache_get(key)
    current = int(result.scalar() or 0)
    if current >= max_requests:
        return False
    db.cache_incr(key)
    if current == 0:
        db.cache_set(key, "1", ttl=60)  # reset window every 60 seconds
    return True
```

---

## Thread Safety

The `VedaDB` client uses a per-connection `threading.Lock` to serialize access to the underlying TCP socket. This means:

- A single `VedaDB` instance can be shared across threads safely, but queries will be serialized (one at a time).
- For concurrent query execution, use `ConnectionPool` to give each thread its own connection.
- The `ConnectionPool` class itself is fully thread-safe, using its own lock to protect pool state.

```python
import threading
from vedadb import VedaDB

db = VedaDB().connect()

def worker():
    # Safe: the internal lock serializes socket access
    result = db.query("SELECT * FROM users LIMIT 5;")
    print(result.row_count)

threads = [threading.Thread(target=worker) for _ in range(5)]
for t in threads:
    t.start()
for t in threads:
    t.join()

db.close()
```

For higher throughput, prefer the connection pool:

```python
from vedadb import ConnectionPool

pool = ConnectionPool(min_size=4, max_size=20)
# Each thread gets its own connection via pool.acquire()
```

---

## Auto-Reconnect

When `auto_reconnect=True` (the default), the client automatically handles transient connection failures:

1. If a `query()` call detects that the client is not connected, it calls `connect()` before sending the query.
2. If a `query()` call fails with a `ConnectionError`, the client closes the stale socket, opens a new connection, and retries the query exactly once.
3. If the retry also fails, the `ConnectionError` is raised to the caller.

This makes the client resilient to server restarts, brief network interruptions, and idle connection timeouts.

```python
# Auto-reconnect enabled (default)
db = VedaDB(auto_reconnect=True).connect()

# Even if the server restarts, the next query will reconnect
result = db.query("SELECT 1;")

# Disable auto-reconnect for strict connection control
db = VedaDB(auto_reconnect=False).connect()
```

---

## Type Hints

The driver ships with full type annotations on all public classes and methods. It is compatible with static analysis tools:

- **mypy**: Fully type-checked. Add `vedadb` to your `mypy` configuration for strict mode checking.
- **pyright**: Fully supported.
- **IDE support**: Autocomplete and inline documentation work in VS Code, PyCharm, and other editors.

All public types are exported from the top-level `vedadb` package:

```python
from vedadb import VedaDB, Result, ConnectionPool
from vedadb import VedaDBError, ConnectionError, QueryError, AuthError
```

---

## Advanced Usage

### Manual Connection Lifecycle

```python
from vedadb import VedaDB

db = VedaDB(host="db.prod.internal", port=6380, timeout=5.0)
db.connect()

try:
    tables = db.show_tables()
    for table in tables:
        n = db.count(table)
        print(f"{table}: {n} rows")
finally:
    db.close()
```

### Multiple Database Connections

```python
from vedadb import VedaDB

with VedaDB(host="primary.db", port=6380) as primary:
    with VedaDB(host="replica.db", port=6380) as replica:
        # Write to primary
        primary.insert("events", {"type": "click", "page": "/home"})

        # Read from replica
        result = replica.select("events", limit=100)
        print(result.to_dicts())
```

### Custom Timeout for Long Queries

```python
# Short timeout for health checks
health_db = VedaDB(timeout=2.0).connect()
is_alive = health_db.ping()
health_db.close()

# Longer timeout for analytics queries
analytics_db = VedaDB(timeout=120.0).connect()
result = analytics_db.query("SELECT COUNT(*) FROM events;")
analytics_db.close()
```

### Production Pattern with Connection Pool

```python
from vedadb import ConnectionPool, VedaDBError

pool = ConnectionPool(
    host="db.prod.internal",
    port=6380,
    min_size=5,
    max_size=50,
    timeout=10.0,
)

def handle_request(user_id: int) -> dict:
    conn = pool.acquire()
    try:
        result = conn.select("users", where={"id": user_id})
        user = result.first()
        if not user:
            return {"error": "not found"}
        return user
    except VedaDBError as e:
        return {"error": str(e)}
    finally:
        pool.release(conn)

# Application shutdown
pool.close()
```

### Bulk Inserts

```python
with VedaDB() as db:
    users = [
        {"id": i, "name": f"user_{i}", "email": f"user_{i}@example.com"}
        for i in range(1000)
    ]
    for user in users:
        db.insert("users", user)

    print(f"Inserted {db.count('users')} users")
```

### Conditional Logic with Result

```python
with VedaDB() as db:
    result = db.select("users", where={"email": "alice@example.com"})

    if result:
        user = result.first()
        print(f"Found: {user['name']}")
    else:
        print("User not found")
        db.insert("users", {"name": "Alice", "email": "alice@example.com"})
```

---

## License

Apache-2.0. See the [LICENSE](https://github.com/vedadb/vedadb/blob/main/LICENSE) file for details.
