<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * VedaDB PHP client driver - Full-featured production driver.
 *
 * Features:
 *   - TCP connection with TLS/SSL support
 *   - Authentication
 *   - Query / Execute / Prepared statements
 *   - CRUD helpers
 *   - Transactions
 *   - Auto-reconnect
 *   - Pipeline
 *   - Bulk insert
 *   - Streaming cursor
 *   - Pub/Sub
 *   - Change streams
 *   - Fluent query builder
 *   - URI-based connection
 *   - Middleware/interceptor support
 *   - Metrics collection
 *
 * Usage:
 *   $db = new VedaClient('localhost', 6380);
 *   $result = $db->query('SELECT * FROM users;');
 *   print_r($result->toDicts());
 *   $db->close();
 */
class VedaClient
{
    /** @var resource|null */
    private $socket;

    private string $host;
    private int $port;
    private int $timeout;
    private bool $tls;
    private bool $tlsVerify;
    private ?string $username;
    private ?string $password;

    /** @var array<string, mixed> */
    private array $config = [];

    private ?VedaCircuitBreaker $circuitBreaker = null;
    private ?VedaInterceptor $interceptor = null;
    private ?VedaMetrics $metrics = null;
    private ?VedaRetryPolicy $retryPolicy = null;

    private int $queryCount = 0;
    private float $totalQueryTime = 0.0;

    /**
     * Create a new VedaClient with individual parameters.
     */
    public function __construct(
        string $host = 'localhost',
        int $port = 6380,
        int $timeout = 30,
        bool $tls = false,
        ?string $username = null,
        ?string $password = null,
        bool $tlsVerify = true,
    ) {
        $this->host       = $host;
        $this->port       = $port;
        $this->timeout    = $timeout;
        $this->tls        = $tls;
        $this->tlsVerify  = $tlsVerify;
        $this->username   = $username;
        $this->password   = $password;

        $this->doConnect();
    }

    /**
     * Create a VedaClient from a configuration array.
     *
     * @param array<string, mixed> $config
     */
    public static function connectWithConfig(array $config): self
    {
        $host     = $config['host'] ?? 'localhost';
        $port     = (int) ($config['port'] ?? 6380);
        $timeout  = (int) ($config['timeout'] ?? 30);
        $tls      = (bool) ($config['tls'] ?? false);
        $username = $config['username'] ?? null;
        $password = $config['password'] ?? null;
        $tlsVerify = (bool) ($config['tls_verify'] ?? true);

        return new self($host, $port, $timeout, $tls, $username, $password, $tlsVerify);
    }

    /**
     * Create a VedaClient from a URI string.
     *
     * @throws ValidationException
     */
    public static function fromURI(string $uri): self
    {
        $config = VedaURIParser::parse($uri);
        return self::connectWithConfig($config);
    }

    /**
     * Create and connect a VedaClient from a URI string (alias for fromURI).
     */
    public static function connect(string $uri): self
    {
        return self::fromURI($uri);
    }

    // -- Connection Management ----------------------------------------------

    private function doConnect(): void
    {
        $errno  = 0;
        $errstr = '';

        $this->socket = @stream_socket_client(
            "tcp://{$this->host}:{$this->port}",
            $errno,
            $errstr,
            $this->timeout,
        );

        if ($this->socket === false) {
            throw new ConnectionException(
                "Failed to connect to {$this->host}:{$this->port}: {$errstr}",
            );
        }

        stream_set_timeout($this->socket, $this->timeout);

        // Read and discard welcome banner
        @fgets($this->socket);

        // STARTTLS upgrade
        if ($this->tls) {
            $this->upgradeTLS();
        }

        // AUTH
        if ($this->username !== null) {
            $this->doAuth();
        }
    }

    private function upgradeTLS(): void
    {
        $written = @fwrite($this->socket, "STARTTLS\n");
        if ($written === false) {
            throw new ConnectionException('Failed to send STARTTLS command');
        }

        $response = @fgets($this->socket);
        if ($response === false) {
            throw new ConnectionException('Connection closed during STARTTLS');
        }

        $data = json_decode(trim($response), true);
        if (isset($data['error'])) {
            throw new ConnectionException("STARTTLS failed: {$data['error']}");
        }

        $tls = new VedaTLS(
            verifyPeer:     $this->tlsVerify,
            verifyPeerName: $this->tlsVerify,
            peerName:       $this->host,
        );
        $tls->upgrade($this->socket);
    }

    private function doAuth(): void
    {
        $cmd = "AUTH {$this->username} {$this->password}\n";
        $written = @fwrite($this->socket, $cmd);
        if ($written === false) {
            throw new ConnectionException('Failed to send AUTH command');
        }

        $response = @fgets($this->socket);
        if ($response === false) {
            throw new ConnectionException('Connection closed during AUTH');
        }

        $data = json_decode(trim($response), true);
        if (isset($data['error'])) {
            throw new AuthException("Authentication failed: {$data['error']}");
        }
    }

    /**
     * Check if the socket is connected.
     */
    public function isConnected(): bool
    {
        return $this->socket !== null && !feof($this->socket);
    }

    /**
     * Reconnect to the server.
     */
    public function reconnect(int $maxRetries = 3): void
    {
        $this->close();

        $policy = $this->retryPolicy ?? new VedaRetryPolicy(maxRetries: $maxRetries);

        $policy->execute(function () {
            $this->doConnect();
        });
    }

    // -- Core Query Operations ----------------------------------------------

    /**
     * Execute a VedaQL query and return a structured result.
     */
    public function query(string $sql): VedaResult
    {
        $this->ensureConnected();

        if ($this->interceptor !== null) {
            return $this->interceptor->intercept($sql, function () use ($sql) {
                return $this->doQuery($sql);
            });
        }

        return $this->doQuery($sql);
    }

    private function doQuery(string $sql): VedaResult
    {
        $start = microtime(true);
        $error = false;

        try {
            $written = @fwrite($this->socket, $sql . "\n");
            if ($written === false) {
                throw new ConnectionException('Failed to send query');
            }

            $response = @fgets($this->socket);
            if ($response === false) {
                $meta = stream_get_meta_data($this->socket);
                if ($meta['timed_out'] ?? false) {
                    throw new TimeoutException('Query timed out');
                }
                throw new ConnectionException('Connection closed');
            }

            $result = VedaResult::parse(trim($response));
            return $result;
        } catch (\Throwable $e) {
            $error = true;
            throw $e;
        } finally {
            $duration = (microtime(true) - $start) * 1000;
            $this->queryCount++;
            $this->totalQueryTime += $duration;

            if ($this->metrics !== null) {
                $op = $this->detectOperation($sql);
                $this->metrics->recordQuery($op, $duration, $error ?? false);
            }
        }
    }

    /**
     * Execute a DDL/DML statement, return affected row count.
     */
    public function execute(string $sql, ?array $params = null): int
    {
        if ($params !== null && !empty($params)) {
            $sql = $this->bindParams($sql, $params);
        }

        $result = $this->query($sql);
        return $result->rowCount;
    }

    /**
     * Execute a DDL/DML statement, return status message.
     */
    public function exec(string $sql): string
    {
        $result = $this->query($sql);
        return $result->message ?? "{$result->rowCount} rows";
    }

    /**
     * Execute a query with parameter binding.
     *
     * @param array<int|string, mixed> $params
     */
    public function queryWithParams(string $sql, array $params): VedaResult
    {
        $bound = $this->bindParams($sql, $params);
        return $this->query($bound);
    }

    /**
     * Bind parameters into a SQL string.
     *
     * Supports named :param and positional ? placeholders.
     *
     * @param array<int|string, mixed> $params
     */
    private function bindParams(string $sql, array $params): string
    {
        // Named parameters (:name)
        if (array_is_list($params) && empty($params)) {
            return $sql;
        }

        if (!array_is_list($params)) {
            foreach ($params as $key => $value) {
                $placeholder = is_string($key) && !str_starts_with($key, ':')
                    ? ":{$key}"
                    : $key;
                $sql = str_replace($placeholder, $this->formatValue($value), $sql);
            }
            return $sql;
        }

        // Positional parameters (?)
        foreach ($params as $value) {
            $pos = strpos($sql, '?');
            if ($pos === false) {
                break;
            }
            $sql = substr_replace($sql, $this->formatValue($value), $pos, 1);
        }

        return $sql;
    }

    // -- Prepared Statements ------------------------------------------------

    /**
     * Create a prepared statement on the server.
     */
    public function prepare(string $name, string $queryStr): string
    {
        $result = $this->query("PREPARE {$name} AS {$queryStr}");
        return $result->message ?? '';
    }

    /**
     * Execute a previously prepared statement with arguments.
     */
    public function executePrepared(string $name, string ...$args): VedaResult
    {
        foreach ($args as $i => $a) {
            if (str_contains($a, "\0")) {
                throw new VedaException("vedadb: prepared arg {$i} contains NUL byte");
            }
        }
        $quoted = array_map(
            fn(string $a) => "'" . str_replace("'", "''", $a) . "'",
            $args,
        );
        $argList = implode(', ', $quoted);
        return $this->query("EXECUTE {$name} ({$argList})");
    }

    /**
     * Remove a prepared statement.
     */
    public function deallocate(string $name): string
    {
        $result = $this->query("DEALLOCATE {$name}");
        return $result->message ?? '';
    }

    // -- CRUD Helpers -------------------------------------------------------

    /**
     * Insert a row into a table.
     *
     * @param array<string, mixed> $data
     */
    public function insert(string $table, array $data): string
    {
        $cols = implode(', ', array_keys($data));
        $vals = implode(', ', array_map([$this, 'formatValue'], array_values($data)));
        return $this->exec("INSERT INTO {$table} ({$cols}) VALUES ({$vals});");
    }

    /**
     * Insert multiple rows in a single statement.
     *
     * @param list<array<string, mixed>> $rows
     */
    public function insertMany(string $table, array $rows): string
    {
        if (empty($rows)) {
            return '0 rows';
        }
        $cols   = implode(', ', array_keys($rows[0]));
        $values = [];
        foreach ($rows as $row) {
            $values[] = '(' . implode(', ', array_map([$this, 'formatValue'], array_values($row))) . ')';
        }
        return $this->exec("INSERT INTO {$table} ({$cols}) VALUES " . implode(', ', $values) . ';');
    }

    /**
     * Select rows from a table.
     */
    public function select(
        string $table,
        string $columns = '*',
        ?string $where = null,
        ?string $orderBy = null,
        int $limit = 0,
    ): VedaResult {
        $sql = "SELECT {$columns} FROM {$table}";
        if ($where !== null) $sql .= " WHERE {$where}";
        if ($orderBy !== null) $sql .= " ORDER BY {$orderBy}";
        if ($limit > 0) $sql .= " LIMIT {$limit}";
        return $this->query($sql . ';');
    }

    /**
     * Update rows in a table.
     *
     * @param array<string, mixed> $set
     */
    public function update(string $table, array $set, ?string $where = null): string
    {
        $setClauses = [];
        foreach ($set as $key => $value) {
            $setClauses[] = "{$key} = {$this->formatValue($value)}";
        }
        $sql = "UPDATE {$table} SET " . implode(', ', $setClauses);
        if ($where !== null) $sql .= " WHERE {$where}";
        return $this->exec($sql . ';');
    }

    /**
     * Delete rows from a table.
     */
    public function delete(string $table, ?string $where = null): string
    {
        $sql = "DELETE FROM {$table}";
        if ($where !== null) $sql .= " WHERE {$where}";
        return $this->exec($sql . ';');
    }

    /**
     * List all tables.
     *
     * @return list<string>
     */
    public function showTables(): array
    {
        $result = $this->query('SHOW TABLES;');
        if ($result->rows === null) return [];
        return array_map(fn(array $row) => (string)$row[0], $result->rows);
    }

    // -- Transactions -------------------------------------------------------

    /**
     * Begin a transaction.
     */
    public function begin(): string
    {
        return $this->exec('BEGIN');
    }

    /**
     * Commit the current transaction.
     */
    public function commit(): string
    {
        return $this->exec('COMMIT');
    }

    /**
     * Roll back the current transaction.
     */
    public function rollback(): string
    {
        return $this->exec('ROLLBACK');
    }

    /**
     * Run a callback inside a transaction.
     *
     * @template T
     * @param callable(VedaClient): T $fn
     * @return T
     */
    public function transaction(callable $fn): mixed
    {
        $this->begin();
        try {
            $result = $fn($this);
            $this->commit();
            return $result;
        } catch (\Exception $e) {
            $this->rollback();
            throw $e;
        }
    }

    // -- Cache API ------------------------------------------------------------

    /**
     * Set a cache key.
     */
    public function cacheSet(string $key, string $value, int $ttl = 0): VedaResult
    {
        $safeKey = str_replace("'", "''", $key);
        $safeVal = str_replace("'", "''", $value);
        $sql = "CACHE SET '{$safeKey}' '{$safeVal}'";
        if ($ttl > 0) {
            $sql .= " TTL {$ttl}";
        }
        return $this->query($sql . ';');
    }

    /**
     * Get a cache key.
     */
    public function cacheGet(string $key): VedaResult
    {
        $safeKey = str_replace("'", "''", $key);
        return $this->query("CACHE GET '{$safeKey}';");
    }

    /**
     * Delete a cache key.
     */
    public function cacheDel(string $key): VedaResult
    {
        $safeKey = str_replace("'", "''", $key);
        return $this->query("CACHE DEL '{$safeKey}';");
    }

    // -- Search API -----------------------------------------------------------

    /**
     * Full-text search on a table.
     */
    public function search(string $table, string $queryStr, int $fuzzy = 0): VedaResult
    {
        $escaped = str_replace("'", "''", $queryStr);
        $sql = "SEARCH {$table} MATCH(*) AGAINST('{$escaped}')";
        if ($fuzzy > 0) {
            $sql .= " FUZZY {$fuzzy}";
        }
        return $this->query($sql);
    }

    // -- Graph API ------------------------------------------------------------

    /**
     * Add a node to the graph.
     *
     * @param array<string, mixed> $props
     */
    public function graphAddNode(string $id, string $label, array $props = []): VedaResult
    {
        $propsJson = str_replace("'", "''", json_encode($props));
        return $this->query("GRAPH ADD NODE '{$id}' LABEL '{$label}' PROPERTIES '{$propsJson}'");
    }

    /**
     * Add an edge between two nodes.
     *
     * @param array<string, mixed> $props
     */
    public function graphAddEdge(string $from, string $to, string $relation, array $props = []): VedaResult
    {
        $propsJson = str_replace("'", "''", json_encode($props));
        return $this->query("GRAPH ADD EDGE '{$from}' -> '{$to}' LABEL '{$relation}' PROPERTIES '{$propsJson}'");
    }

    /**
     * Breadth-first traversal from a starting node.
     */
    public function graphBFS(string $start, int $depth = 3): VedaResult
    {
        return $this->query("GRAPH BFS '{$start}' DEPTH {$depth}");
    }

    // -- Feature Factory Methods --------------------------------------------

    /**
     * Create a pipeline for batching commands.
     */
    public function pipeline(): VedaPipeline
    {
        return new VedaPipeline($this);
    }

    /**
     * Create a bulk inserter for a table.
     */
    public function bulkInsert(string $table, int $batchSize = 1000): VedaBulkInserter
    {
        return new VedaBulkInserter($this, $table, $batchSize);
    }

    /**
     * Create a streaming cursor.
     */
    public function cursor(string $sql, ?array $params = null, int $fetchSize = 100): VedaCursor
    {
        if ($params !== null && !empty($params)) {
            $sql = $this->bindParams($sql, $params);
        }
        return new VedaCursor($this, $sql, null, $fetchSize);
    }

    /**
     * Create a Pub/Sub interface.
     */
    public function pubsub(): VedaPubSub
    {
        return new VedaPubSub($this);
    }

    /**
     * Create a change stream watcher.
     */
    public function watch(?string $table = null): VedaChangeStream
    {
        return new VedaChangeStream($this, $table);
    }

    /**
     * Create a fluent query builder for a table.
     */
    public function table(string $name): VedaQueryBuilder
    {
        return new VedaQueryBuilder($this, $name);
    }

    // -- Middleware / Feature Configuration -----------------------------------

    /**
     * Set a circuit breaker.
     */
    public function withCircuitBreaker(VedaCircuitBreaker $cb): self
    {
        $this->circuitBreaker = $cb;
        return $this;
    }

    /**
     * Set an interceptor pipeline.
     */
    public function withInterceptor(VedaInterceptor $interceptor): self
    {
        $this->interceptor = $interceptor;
        return $this;
    }

    /**
     * Set a metrics collector.
     */
    public function withMetrics(VedaMetrics $metrics): self
    {
        $this->metrics = $metrics;
        return $this;
    }

    /**
     * Set a retry policy.
     */
    public function withRetryPolicy(VedaRetryPolicy $policy): self
    {
        $this->retryPolicy = $policy;
        return $this;
    }

    // -- Health & Utility ---------------------------------------------------

    /**
     * Health check. Returns true if the server responds.
     */
    public function ping(): bool
    {
        try {
            if ($this->socket === null) {
                return false;
            }
            $this->query('SHOW TABLES;');
            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Close the connection.
     */
    public function close(): void
    {
        if ($this->socket !== null) {
            @fwrite($this->socket, "QUIT\n");
            @fclose($this->socket);
            $this->socket = null;
        }
    }

    /**
     * Get driver statistics.
     */
    public function getStats(): array
    {
        return [
            'host'             => $this->host,
            'port'             => $this->port,
            'connected'        => $this->isConnected(),
            'query_count'      => $this->queryCount,
            'total_query_time' => round($this->totalQueryTime, 3),
            'avg_query_time'   => $this->queryCount > 0
                ? round($this->totalQueryTime / $this->queryCount, 3)
                : 0,
            'tls_enabled'      => $this->tls,
        ];
    }

    /**
     * Format a PHP value for SQL.
     */
    private function formatValue(mixed $value): string
    {
        if ($value === null) return 'NULL';
        if (is_bool($value)) return $value ? 'TRUE' : 'FALSE';
        if (is_string($value)) return "'" . str_replace("'", "''", $value) . "'";
        if (is_array($value)) return "'" . str_replace("'", "''", json_encode($value)) . "'";
        return (string) $value;
    }

    /**
     * Ensure the socket is connected.
     */
    private function ensureConnected(): void
    {
        if ($this->socket === null) {
            throw new ConnectionException('Not connected');
        }
    }

    /**
     * Detect the SQL operation type.
     */
    private function detectOperation(string $sql): string
    {
        $trimmed = strtoupper(ltrim($sql));
        if (str_starts_with($trimmed, 'SELECT')) return 'SELECT';
        if (str_starts_with($trimmed, 'INSERT')) return 'INSERT';
        if (str_starts_with($trimmed, 'UPDATE')) return 'UPDATE';
        if (str_starts_with($trimmed, 'DELETE')) return 'DELETE';
        if (str_starts_with($trimmed, 'CREATE')) return 'DDL';
        if (str_starts_with($trimmed, 'DROP')) return 'DDL';
        if (str_starts_with($trimmed, 'ALTER')) return 'DDL';
        if (str_starts_with($trimmed, 'CACHE')) return 'CACHE';
        if (str_starts_with($trimmed, 'SEARCH')) return 'SEARCH';
        if (str_starts_with($trimmed, 'GRAPH')) return 'GRAPH';
        if (str_starts_with($trimmed, 'PIPELINE')) return 'PIPELINE';
        return 'OTHER';
    }

    public function __destruct()
    {
        $this->close();
    }
}
