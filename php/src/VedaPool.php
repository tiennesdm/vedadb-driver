<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Simple connection pool for VedaDB.
 */
class VedaPool
{
    private string $host;
    private int $port;
    private int $maxSize;
    private int $timeout;

    /** @var list<VedaClient> */
    private array $idle = [];

    private int $activeCount = 0;
    private bool $closed = false;

    public function __construct(
        string $host = 'localhost',
        int $port = 6380,
        int $maxSize = 10,
        int $timeout = 30,
    ) {
        $this->host = $host;
        $this->port = $port;
        $this->maxSize = $maxSize;
        $this->timeout = $timeout;
    }

    /**
     * Acquire a client from the pool.
     */
    public function acquire(): VedaClient
    {
        if ($this->closed) {
            throw new VedaException('Pool is closed');
        }

        if (!empty($this->idle)) {
            $client = array_pop($this->idle);
            $this->activeCount++;
            return $client;
        }

        $client = new VedaClient($this->host, $this->port, $this->timeout);
        $this->activeCount++;
        return $client;
    }

    /**
     * Release a client back to the pool.
     */
    public function release(VedaClient $client): void
    {
        $this->activeCount--;

        if ($this->closed || count($this->idle) >= $this->maxSize) {
            $client->close();
            return;
        }

        $this->idle[] = $client;
    }

    public function getActiveCount(): int
    {
        return $this->activeCount;
    }

    public function getIdleCount(): int
    {
        return count($this->idle);
    }

    /**
     * Close all idle connections.
     */
    public function close(): void
    {
        $this->closed = true;
        foreach ($this->idle as $client) {
            $client->close();
        }
        $this->idle = [];
    }
}
