<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * VedaDB PHP client driver.
 *
 * Usage:
 *   $db = new VedaClient('localhost', 6380);
 *   $result = $db->query('SELECT * FROM users;');
 *   print_r($result->toDicts());
 *   $db->close();
 *
 * TLS + Auth:
 *   $db = new VedaClient('localhost', 6380, tls: true, username: 'admin', password: 'secret');
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

    public function __construct(
        string $host = 'localhost',
        int $port = 6380,
        int $timeout = 30,
        bool $tls = false,
        ?string $username = null,
        ?string $password = null,
        bool $tlsVerify = true,
    ) {
        $this->host = $host;
        $this->port = $port;
        $this->timeout = $timeout;
        $this->tls = $tls;
        $this->tlsVerify = $tlsVerify;
        $this->username = $username;
        $this->password = $password;

        $this->connect();
    }

    private function connect(): void
    {
        $errno = 0;
        $errstr = '';

        $this->socket = @stream_socket_client(
            "tcp://{$this->host}:{$this->port}",
            $errno,
            $errstr,
            $this->timeout,
        );

        if ($this->socket === false) {
            throw new ConnectionException("Failed to connect to {$this->host}:{$this->port}: {$errstr}");
        }

        stream_set_timeout($this->socket, $this->timeout);

        // Read and discard welcome banner
        fgets($this->socket);

        // STARTTLS upgrade
        if ($this->tls) {
            $this->starttls();
        }

        // AUTH
        if ($this->username !== null) {
            $this->auth();
        }
    }

    private function starttls(): void
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

        // Apply an SSL context so peer/cert/hostname verification actually
        // happens. `stream_socket_client('tcp://...')` ignores SSL options
        // until we attach a context here. Without this block, PHP would
        // accept any certificate (including self-signed / wrong-host).
        $sslOptions = [
            'verify_peer'       => $this->tlsVerify,
            'verify_peer_name'  => $this->tlsVerify,
            'peer_name'         => $this->host,
            'SNI_enabled'       => true,
            'allow_self_signed' => !$this->tlsVerify,
        ];
        $context = stream_context_create(['ssl' => $sslOptions]);
        foreach ($sslOptions as $k => $v) {
            stream_context_set_option($this->socket, 'ssl', $k, $v);
        }
        // Suppress unused-variable warning; $context is the canonical form
        // for new sockets — stream_context_set_option mirrors it onto the
        // existing one.
        unset($context);

        $result = @stream_socket_enable_crypto(
            $this->socket,
            true,
            STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT
        );

        if ($result !== true) {
            throw new ConnectionException('TLS handshake failed');
        }
    }

    private function auth(): void
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
     * Execute a VedaQL query.
     */
    public function query(string $sql): VedaResult
    {
        if ($this->socket === null) {
            throw new ConnectionException('Not connected');
        }

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

        return VedaResult::parse(trim($response));
    }

    /**
     * Execute a DDL/DML statement, returns the status message.
     */
    public function exec(string $sql): string
    {
        $result = $this->query($sql);
        return $result->message ?? "{$result->rowCount} rows";
    }

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
     *
     * @param string ...$args Values to bind to placeholders
     */
    public function executePrepared(string $name, string ...$args): VedaResult
    {
        // SQL-standard `''`-doubling — never `\'`.
        $quoted = array_map(fn(string $a) => "'" . str_replace("'", "''", $a) . "'", $args);
        $argList = implode(', ', $quoted);
        return $this->query("EXECUTE {$name} ({$argList})");
    }

    /**
     * Remove a prepared statement from the server.
     */
    public function deallocate(string $name): string
    {
        $result = $this->query("DEALLOCATE {$name}");
        return $result->message ?? '';
    }

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

    /**
     * Health check.
     */
    public function ping(): bool
    {
        try {
            $this->query('SHOW TABLES;');
            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    // -- Transaction helpers --------------------------------------------------

    /**
     * Begin a transaction.
     */
    public function begin(): string
    {
        return $this->exec("BEGIN");
    }

    /**
     * Commit the current transaction.
     */
    public function commit(): string
    {
        return $this->exec("COMMIT");
    }

    /**
     * Roll back the current transaction.
     */
    public function rollback(): string
    {
        return $this->exec("ROLLBACK");
    }

    /**
     * Run a callback inside a transaction. Auto-commits on success, rolls back on error.
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

    // -- Auto-Reconnect -------------------------------------------------------

    /**
     * Reconnect to the server with retry logic.
     */
    public function reconnect(int $maxRetries = 3): void
    {
        for ($i = 0; $i < $maxRetries; $i++) {
            try {
                $this->close();
                $this->connect();
                return;
            } catch (\Exception $e) {
                sleep($i + 1);
            }
        }
        throw new ConnectionException("Reconnect failed after {$maxRetries} attempts");
    }

    // -- Batch Insert ---------------------------------------------------------

    /**
     * Insert multiple rows in a single statement.
     *
     * @param array<array<string, mixed>> $rows
     */
    public function insertMany(string $table, array $rows): string
    {
        if (empty($rows)) {
            return '0 rows';
        }
        $cols = implode(', ', array_keys($rows[0]));
        $values = [];
        foreach ($rows as $row) {
            $values[] = '(' . implode(', ', array_map([$this, 'formatValue'], array_values($row))) . ')';
        }
        return $this->exec("INSERT INTO {$table} ({$cols}) VALUES " . implode(', ', $values) . ';');
    }

    // -- Cache API ------------------------------------------------------------

    /**
     * Set a cache key.
     */
    public function cacheSet(string $key, string $value, int $ttl = 0): VedaResult
    {
        $safeKey = str_replace("'", "\\'", $key);
        $safeVal = str_replace("'", "\\'", $value);
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
        $safeKey = str_replace("'", "\\'", $key);
        return $this->query("CACHE GET '{$safeKey}';");
    }

    /**
     * Delete a cache key.
     */
    public function cacheDel(string $key): VedaResult
    {
        $safeKey = str_replace("'", "\\'", $key);
        return $this->query("CACHE DEL '{$safeKey}';");
    }

    /**
     * List cache keys matching a pattern.
     */
    public function cacheKeys(string $pattern = '*'): VedaResult
    {
        $safePattern = str_replace("'", "\\'", $pattern);
        return $this->query("CACHE KEYS '{$safePattern}';");
    }

    // -- Search API -----------------------------------------------------------

    /**
     * Full-text search on a table.
     */
    public function search(string $table, string $queryStr, int $fuzzy = 0): VedaResult
    {
        $escaped = str_replace("'", "\\'", $queryStr);
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
        $propsJson = str_replace("'", "\\'", json_encode($props));
        return $this->query("GRAPH ADD NODE '{$id}' LABEL '{$label}' PROPERTIES '{$propsJson}'");
    }

    /**
     * Add an edge between two nodes.
     *
     * @param array<string, mixed> $props
     */
    public function graphAddEdge(string $from, string $to, string $relation, array $props = []): VedaResult
    {
        $propsJson = str_replace("'", "\\'", json_encode($props));
        return $this->query("GRAPH ADD EDGE '{$from}' -> '{$to}' LABEL '{$relation}' PROPERTIES '{$propsJson}'");
    }

    /**
     * Breadth-first traversal from a starting node.
     */
    public function graphBFS(string $start, int $depth = 3): VedaResult
    {
        return $this->query("GRAPH BFS '{$start}' DEPTH {$depth}");
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

    private function formatValue(mixed $value): string
    {
        if ($value === null) return 'NULL';
        if (is_bool($value)) return $value ? 'TRUE' : 'FALSE';
        // SQL-standard single-quote doubling — never `\'`.
        if (is_string($value)) return "'" . str_replace("'", "''", $value) . "'";
        return (string)$value;
    }

    public function __destruct()
    {
        $this->close();
    }
}
