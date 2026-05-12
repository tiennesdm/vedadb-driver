<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Advanced connection pool for VedaDB with health checks,
 * max age, validation on checkout, and wait queue support.
 */
class VedaConnectionPool
{
    private string $host;
    private int $port;
    private int $maxSize;
    private int $timeout;
    private float $maxWaitMs;
    private float $maxIdleMs;
    private ?array $config;

    /** @var list<array{client: VedaClient, created_at: float, last_used: float}> */
    private array $idle = [];

    /** @var list<VedaClient> */
    private array $active = [];

    private int $totalCreated = 0;
    private int $totalDestroyed = 0;
    private bool $closed = false;

    /** @var list<callable> */
    private array $waitQueue = [];

    private ?VedaHealthChecker $healthChecker = null;

    public function __construct(
        string $host = 'localhost',
        int $port = 6380,
        int $maxSize = 10,
        int $timeout = 30,
        float $maxWaitMs = 5000.0,
        float $maxIdleMs = 300000.0,
        ?array $config = null,
    ) {
        $this->host          = $host;
        $this->port          = $port;
        $this->maxSize       = max(1, $maxSize);
        $this->timeout       = $timeout;
        $this->maxWaitMs     = $maxWaitMs;
        $this->maxIdleMs     = $maxIdleMs;
        $this->config        = $config;
    }

    /**
     * Acquire a client from the pool.
     */
    public function acquire(): VedaClient
    {
        if ($this->closed) {
            throw new PoolExhaustedException('Pool is closed');
        }

        // Reap stale idle connections
        $this->reapIdle();

        // Try to get an idle connection
        if (!empty($this->idle)) {
            $entry = array_pop($this->idle);
            $client = $entry['client'];

            // Validate the connection is still alive
            if (!$client->ping()) {
                $client->close();
                $this->totalDestroyed++;
                return $this->createClient();
            }

            $this->active[] = $client;
            return $client;
        }

        // Create a new connection if under max
        if (count($this->active) < $this->maxSize) {
            $client = $this->createClient();
            $this->active[] = $client;
            return $client;
        }

        // Pool exhausted - wait for a release
        return $this->waitForClient();
    }

    /**
     * Release a client back to the pool.
     */
    public function release(VedaClient $client): void
    {
        $idx = array_search($client, $this->active, true);
        if ($idx !== false) {
            array_splice($this->active, $idx, 1);
        }

        if ($this->closed) {
            $client->close();
            $this->totalDestroyed++;
            return;
        }

        // Check if connection is still alive
        if (!$client->ping()) {
            $client->close();
            $this->totalDestroyed++;
            return;
        }

        // If idle list is full, close it
        if (count($this->idle) >= $this->maxSize) {
            $client->close();
            $this->totalDestroyed++;
            return;
        }

        $this->idle[] = [
            'client'     => $client,
            'created_at' => microtime(true),
            'last_used'  => microtime(true),
        ];

        // Notify waiters
        if (!empty($this->waitQueue)) {
            $waiter = array_shift($this->waitQueue);
            $waiter();
        }
    }

    /**
     * Execute a callback with pooled connection.
     *
     * @template T
     * @param callable(VedaClient): T $fn
     * @return T
     */
    public function with(callable $fn): mixed
    {
        $client = $this->acquire();
        try {
            return $fn($client);
        } finally {
            $this->release($client);
        }
    }

    /**
     * Wait for a client to become available.
     */
    private function waitForClient(): VedaClient
    {
        $start = microtime(true);
        $waitMs = $this->maxWaitMs;

        while ($waitMs > 0) {
            usleep(10000); // 10ms

            $elapsed = (microtime(true) - $start) * 1000;
            $waitMs = $this->maxWaitMs - $elapsed;

            // Reap and try again
            $this->reapIdle();

            if (!empty($this->idle)) {
                $entry = array_pop($this->idle);
                $client = $entry['client'];
                if ($client->ping()) {
                    $this->active[] = $client;
                    return $client;
                }
                $client->close();
                $this->totalDestroyed++;
            }

            if (count($this->active) < $this->maxSize) {
                $client = $this->createClient();
                $this->active[] = $client;
                return $client;
            }
        }

        throw new PoolExhaustedException(
            "Pool exhausted: max {$this->maxSize} connections, wait timeout exceeded",
        );
    }

    /**
     * Create a new VedaClient.
     */
    private function createClient(): VedaClient
    {
        $this->totalCreated++;
        $host = $this->config['host'] ?? $this->host;
        $port = $this->config['port'] ?? $this->port;

        return VedaClient::connectWithConfig(
            array_merge($this->config ?? [], [
                'host'    => $host,
                'port'    => $port,
                'timeout' => $this->timeout,
            ]),
        );
    }

    /**
     * Remove stale idle connections.
     */
    public function reapIdle(): void
    {
        $now = microtime(true);
        $this->idle = array_values(array_filter(
            $this->idle,
            function (array $entry) use ($now): bool {
                $age = ($now - $entry['last_used']) * 1000;
                if ($age > $this->maxIdleMs) {
                    $entry['client']->close();
                    $this->totalDestroyed++;
                    return false;
                }
                return true;
            },
        ));
    }

    /**
     * Close all connections.
     */
    public function close(): void
    {
        $this->closed = true;

        foreach ($this->idle as $entry) {
            $entry['client']->close();
        }
        $this->idle = [];

        foreach ($this->active as $client) {
            $client->close();
        }
        $this->active = [];
    }

    public function getActiveCount(): int
    {
        return count($this->active);
    }

    public function getIdleCount(): int
    {
        return count($this->idle);
    }

    public function getTotalCreated(): int
    {
        return $this->totalCreated;
    }

    public function getTotalDestroyed(): int
    {
        return $this->totalDestroyed;
    }

    public function isClosed(): bool
    {
        return $this->closed;
    }

    public function getMetrics(): array
    {
        return [
            'active'           => $this->getActiveCount(),
            'idle'             => $this->getIdleCount(),
            'max_size'         => $this->maxSize,
            'total_created'    => $this->totalCreated,
            'total_destroyed'  => $this->totalDestroyed,
            'closed'           => $this->closed,
            'host'             => $this->host,
            'port'             => $this->port,
        ];
    }
}
