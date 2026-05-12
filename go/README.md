# VedaDB Go Driver

Official Go client for [VedaDB](https://github.com/vedadb/vedadb) -- the multi-model database engine.

Communicates over raw TCP on port 6380 using the VedaQL wire protocol. Responses are deserialized with the standard library `encoding/json` package -- no third-party dependencies.

## Installation

```bash
go get github.com/vedadb/vedadb-go
```

## Quick Start

```go
package main

import (
    "fmt"
    "log"

    "github.com/vedadb/vedadb-go"
)

func main() {
    client, err := vedadb.Connect("localhost:6380")
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Create a table
    _, err = client.Exec("CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100), email VARCHAR(200), age INT);")
    if err != nil {
        log.Fatal(err)
    }

    // Insert rows
    client.Exec("INSERT INTO users (id, name, email, age) VALUES (1, 'Alice', 'alice@example.com', 30);")
    client.Exec("INSERT INTO users (id, name, email, age) VALUES (2, 'Bob', 'bob@example.com', 25);")

    // Query
    result, err := client.Query("SELECT * FROM users WHERE age > 20;")
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println("Columns:", result.Columns)
    for _, row := range result.Rows {
        fmt.Println(row)
    }
    fmt.Printf("(%d rows)\n", result.RowCount)
}
```

## API Reference

### Types

---

#### `Result`

Holds the parsed response from a VedaDB query.

```go
type Result struct {
    Columns  []string   `json:"columns"`
    Rows     [][]string `json:"rows"`
    RowCount int        `json:"row_count"`
    Message  string     `json:"message"`
    Error    string     `json:"error"`
}
```

| Field      | Type         | Description                                        |
|------------|--------------|----------------------------------------------------|
| `Columns`  | `[]string`   | Column names from the result set                   |
| `Rows`     | `[][]string` | Row data; each row is a slice of string values     |
| `RowCount` | `int`        | Number of rows affected or returned                |
| `Message`  | `string`     | Server message (e.g., `"1 row inserted"`)          |
| `Error`    | `string`     | Error message from the server (empty on success)   |

---

#### `Client`

A VedaDB TCP client. All methods are protected by an internal `sync.Mutex`, making a single `Client` safe for concurrent use from multiple goroutines (queries are serialized).

```go
type Client struct {
    // unexported fields
}
```

---

#### `Options`

Configures the client connection.

```go
type Options struct {
    Addr         string        // "host:port" (default "localhost:6380")
    DialTimeout  time.Duration // Connection timeout (default 5s)
    ReadTimeout  time.Duration // Read timeout per query (default 30s)
    WriteTimeout time.Duration // Write timeout per query (default 30s)
}
```

| Field          | Type            | Default            | Description                    |
|----------------|-----------------|--------------------|--------------------------------|
| `Addr`         | `string`        | `"localhost:6380"` | Server address in `host:port` format |
| `DialTimeout`  | `time.Duration` | `5s`               | Timeout for establishing the TCP connection |
| `ReadTimeout`  | `time.Duration` | `30s`              | Read deadline per query        |
| `WriteTimeout` | `time.Duration` | `30s`              | Write deadline per query       |

---

### Functions

---

#### `DefaultOptions()`

Return a new `Options` struct populated with default values.

```go
func DefaultOptions() *Options
```

**Returns:** `*Options` with `Addr` set to `"localhost:6380"`, `DialTimeout` 5s, `ReadTimeout` 30s, `WriteTimeout` 30s.

```go
opts := vedadb.DefaultOptions()
opts.Addr = "db.example.com:6380"
opts.DialTimeout = 10 * time.Second
```

---

#### `Connect(addr string)`

Create a new client connected to VedaDB at the given address. Uses default options for timeouts.

```go
func Connect(addr string) (*Client, error)
```

| Parameter | Type     | Description                          |
|-----------|----------|--------------------------------------|
| `addr`    | `string` | Server address in `host:port` format |

**Returns:** `*Client`, `error`

```go
client, err := vedadb.Connect("localhost:6380")
if err != nil {
    log.Fatal(err)
}
defer client.Close()
```

---

#### `ConnectWithOptions(opts *Options)`

Create a client with custom connection options.

```go
func ConnectWithOptions(opts *Options) (*Client, error)
```

| Parameter | Type       | Description             |
|-----------|------------|-------------------------|
| `opts`    | `*Options` | Connection options      |

**Returns:** `*Client`, `error`

```go
opts := vedadb.DefaultOptions()
opts.Addr = "db.example.com:6380"
opts.DialTimeout = 10 * time.Second
opts.ReadTimeout = 60 * time.Second

client, err := vedadb.ConnectWithOptions(opts)
if err != nil {
    log.Fatal(err)
}
defer client.Close()
```

---

### Client Methods

---

#### `Query(query string)`

Execute a VedaQL query and return the parsed result.

```go
func (c *Client) Query(query string) (*Result, error)
```

| Parameter | Type     | Description          |
|-----------|----------|----------------------|
| `query`   | `string` | The VedaQL statement |

**Returns:** `*Result`, `error`. Returns a non-nil error if the write or read fails, if the JSON response is malformed, or if the server response contains an `error` field.

```go
result, err := client.Query("SELECT name, age FROM users WHERE age > 25;")
if err != nil {
    log.Fatal(err)
}

for _, row := range result.Rows {
    fmt.Printf("%s is %s years old\n", row[0], row[1])
}
```

---

#### `Exec(query string)`

Execute a query that does not return rows (INSERT, UPDATE, DELETE, CREATE, DROP). Returns the server message string.

```go
func (c *Client) Exec(query string) (string, error)
```

| Parameter | Type     | Description          |
|-----------|----------|----------------------|
| `query`   | `string` | The VedaQL statement |

**Returns:** `string` (server message), `error`

```go
msg, err := client.Exec("CREATE TABLE products (id INT PRIMARY KEY, name VARCHAR(100), price FLOAT);")
if err != nil {
    log.Fatal(err)
}
fmt.Println(msg) // "Table created"
```

---

#### `Ping()`

Check whether the server is reachable by executing a `SHOW TABLES` command.

```go
func (c *Client) Ping() error
```

**Returns:** `error` -- `nil` if the server responds, non-nil otherwise.

```go
if err := client.Ping(); err != nil {
    log.Printf("Server unreachable: %v", err)
}
```

---

#### `Close()`

Close the connection. Sends a `QUIT` command before closing the underlying TCP socket. Always call `Close` when you are done with the client -- typically via `defer`.

```go
func (c *Client) Close() error
```

**Returns:** `error`

```go
client, _ := vedadb.Connect("localhost:6380")
defer client.Close()
```

---

## Connection Pool

`Pool` provides a simple connection pool for concurrent workloads. Idle connections are reused; new connections are created on demand when the pool is empty.

### Types

```go
type Pool struct {
    // unexported fields
}
```

---

### `NewPool(addr string, maxSize int)`

Create a connection pool.

```go
func NewPool(addr string, maxSize int) *Pool
```

| Parameter | Type     | Description                                |
|-----------|----------|--------------------------------------------|
| `addr`    | `string` | Server address in `host:port` format       |
| `maxSize` | `int`    | Maximum number of idle connections to keep  |

```go
pool := vedadb.NewPool("localhost:6380", 10)
defer pool.Close()
```

---

### `Get()`

Get a client from the pool. If an idle connection is available it is returned immediately; otherwise a new connection is created.

```go
func (p *Pool) Get() (*Client, error)
```

**Returns:** `*Client`, `error`

---

### `Put(client *Client)`

Return a client to the pool. If the pool already holds `maxSize` idle connections, the client is closed instead.

```go
func (p *Pool) Put(client *Client)
```

| Parameter | Type      | Description             |
|-----------|-----------|-------------------------|
| `client`  | `*Client` | Client to return        |

---

### `Close()`

Close all idle connections in the pool.

```go
func (p *Pool) Close()
```

---

### Pool Usage

```go
pool := vedadb.NewPool("localhost:6380", 10)
defer pool.Close()

client, err := pool.Get()
if err != nil {
    log.Fatal(err)
}

result, err := client.Query("SELECT * FROM users;")
if err != nil {
    log.Fatal(err)
}
fmt.Println(result.Columns, result.Rows)

pool.Put(client) // return to pool
```

### Concurrent Example

```go
pool := vedadb.NewPool("localhost:6380", 20)
defer pool.Close()

var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()

        client, err := pool.Get()
        if err != nil {
            log.Println(err)
            return
        }
        defer pool.Put(client)

        result, err := client.Query("SELECT COUNT(*) FROM events;")
        if err != nil {
            log.Println(err)
            return
        }
        fmt.Println(result.Rows[0][0])
    }()
}
wg.Wait()
```

---

## Error Handling

Errors follow standard Go conventions. All functions that can fail return an `error` as their last return value.

Server-side errors (e.g., invalid SQL, missing table) are returned as formatted errors prefixed with `vedadb:`. Network-level errors (connection refused, timeout) are wrapped with `fmt.Errorf` and can be unwrapped with `errors.Is` / `errors.As`.

```go
result, err := client.Query("SELECT * FROM nonexistent_table;")
if err != nil {
    // err.Error() == "vedadb: Table not found: nonexistent_table"
    log.Println("Query failed:", err)
    return
}
```

When using `Query()`, the `Result.Error` field is checked internally -- if it is non-empty, a Go `error` is returned and the `*Result` is `nil`. When you receive a non-nil `*Result`, you can be sure `Error` is empty.

```go
// Direct error check pattern
result, err := client.Query("SELECT * FROM users;")
if err != nil {
    log.Fatal(err)
}
// Safe to use result here
fmt.Println(result.RowCount)
```

---

## Concurrency

`Client` uses a `sync.Mutex` to serialize all reads and writes. A single client is safe for use by multiple goroutines, but queries execute one at a time. For true parallelism, use `Pool` to maintain several connections.

`Pool` uses its own `sync.Mutex` to protect the internal slice of idle clients, making `Get()`, `Put()`, and `Close()` safe to call concurrently.

---

## Requirements

- Go 1.22 or later
- A running VedaDB server (default port 6380)

---

## License

Apache-2.0 -- see [LICENSE](https://www.apache.org/licenses/LICENSE-2.0) for details.
