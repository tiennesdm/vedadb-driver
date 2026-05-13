<?php
/**
 * VedaDB Async Client using ReactPHP promises.
 *
 * All async operations return React\Promise\PromiseInterface for
 * composable async workflows.
 *
 * @example
 * $async = new AsyncVedaClient("localhost", 6380);
 * $async->queryAsync("SELECT * FROM users;")
 *     ->then(function ($result) {
 *         print_r($result->toDicts());
 *     })
 *     ->catch(function ($error) {
 *         echo "Error: " . $error->getMessage();
 *     });
 */

declare(strict_types=1);

namespace VedaDB;

use React\EventLoop\Loop;
use React\Promise\Deferred;
use React\Promise\PromiseInterface;

class AsyncVedaClient
{
    private VedaClient $client;

    /**
     * @param string $host
     * @param int    $port
     * @param bool   $useTls
     * @param float  $connectTimeout
     * @param float  $commandTimeout
     */
    public function __construct(
        string $host,
        int    $port,
        bool   $useTls = false,
        float  $connectTimeout = 10.0,
        float  $commandTimeout = 30.0
    ) {
        $this->client = new VedaClient(
            $host, $port, $useTls,
            $connectTimeout, $commandTimeout
        );
    }

    /**
     * Wrap a sync call in a ReactPHP promise running on the event loop.
     */
    private function promise(callable $fn): PromiseInterface
    {
        $deferred = new Deferred();
        Loop::addTimer(0.0, function () use ($deferred, $fn) {
            try {
                $result = $fn();
                $deferred->resolve($result);
            } catch (\Throwable $e) {
                $deferred->reject($e);
            }
        });
        return $deferred->promise();
    }

    /**
     * Execute a query asynchronously.
     */
    public function queryAsync(string $sql): PromiseInterface
    {
        return $this->promise(function () use ($sql) {
            return $this->client->query($sql);
        });
    }

    /**
     * Execute a non-query statement asynchronously.
     */
    public function execAsync(string $sql): PromiseInterface
    {
        return $this->promise(function () use ($sql) {
            return $this->client->exec($sql);
        });
    }

    /**
     * Ping the server asynchronously.
     */
    public function pingAsync(): PromiseInterface
    {
        return $this->promise(function () {
            return $this->client->ping();
        });
    }

    /**
     * Insert a row asynchronously.
     */
    public function insertAsync(string $table, array $data): PromiseInterface
    {
        return $this->promise(function () use ($table, $data) {
            return $this->client->insert($table, $data);
        });
    }

    /**
     * Select rows asynchronously.
     */
    public function selectAsync(string $table, string $columns = "*", ?string $where = null,
                                 ?string $orderBy = null, ?int $limit = null): PromiseInterface
    {
        return $this->promise(function () use ($table, $columns, $where, $orderBy, $limit) {
            return $this->client->select($table, $columns, $where, $orderBy, $limit);
        });
    }

    /**
     * Update rows asynchronously.
     */
    public function updateAsync(string $table, array $set, string $where): PromiseInterface
    {
        return $this->promise(function () use ($table, $set, $where) {
            return $this->client->update($table, $set, $where);
        });
    }

    /**
     * Delete rows asynchronously.
     */
    public function deleteAsync(string $table, string $where): PromiseInterface
    {
        return $this->promise(function () use ($table, $where) {
            return $this->client->delete($table, $where);
        });
    }

    /**
     * Begin a transaction asynchronously.
     */
    public function beginAsync(): PromiseInterface
    {
        return $this->promise(function () {
            return $this->client->begin();
        });
    }

    /**
     * Commit a transaction asynchronously.
     */
    public function commitAsync(): PromiseInterface
    {
        return $this->promise(function () {
            return $this->client->commit();
        });
    }

    /**
     * Rollback a transaction asynchronously.
     */
    public function rollbackAsync(): PromiseInterface
    {
        return $this->promise(function () {
            return $this->client->rollback();
        });
    }

    /**
     * Execute a function inside a transaction asynchronously.
     */
    public function transactionAsync(callable $fn): PromiseInterface
    {
        return $this->promise(function () use ($fn) {
            return $this->client->transaction($fn);
        });
    }

    /**
     * Show tables asynchronously.
     */
    public function showTablesAsync(): PromiseInterface
    {
        return $this->promise(function () {
            return $this->client->showTables();
        });
    }

    /**
     * Describe a table asynchronously.
     */
    public function describeTableAsync(string $table): PromiseInterface
    {
        return $this->promise(function () use ($table) {
            return $this->client->describeTable($table);
        });
    }

    /**
     * Graph query asynchronously.
     */
    public function graphAsync(string $sql): PromiseInterface
    {
        return $this->promise(function () use ($sql) {
            return $this->client->graph($sql);
        });
    }

    /**
     * Cache set asynchronously.
     */
    public function cacheSetAsync(string $key, string $value, int $ttl): PromiseInterface
    {
        return $this->promise(function () use ($key, $value, $ttl) {
            return $this->client->cacheSet($key, $value, $ttl);
        });
    }

    /**
     * Cache get asynchronously.
     */
    public function cacheGetAsync(string $key): PromiseInterface
    {
        return $this->promise(function () use ($key) {
            return $this->client->cacheGet($key);
        });
    }

    /**
     * Cache delete asynchronously.
     */
    public function cacheDelAsync(string $key): PromiseInterface
    {
        return $this->promise(function () use ($key) {
            return $this->client->cacheDel($key);
        });
    }

    /**
     * Watch for changes asynchronously.
     */
    public function watchAsync(?string $table = null): PromiseInterface
    {
        return $this->promise(function () use ($table) {
            return $this->client->watch($table);
        });
    }

    /**
     * Close the underlying client connection.
     */
    public function close(): void
    {
        $this->client->close();
    }

    /**
     * Check if the client is connected.
     */
    public function connected(): bool
    {
        return $this->client->connected();
    }

    /**
     * Get the underlying synchronous client.
     */
    public function getSyncClient(): VedaClient
    {
        return $this->client;
    }
}
