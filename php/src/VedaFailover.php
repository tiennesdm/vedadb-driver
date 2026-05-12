<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Failover manager for VedaDB with multi-node support.
 */
class VedaFailover
{
    /** @var list<array{host: string, port: int, config: array<string, mixed>}> */
    private array $nodes;

    private int $currentIndex = 0;
    private int $maxRetries;
    private VedaRetryPolicy $retryPolicy;

    /** @var list<string> */
    private array $failoverLog = [];

    private ?VedaClient $currentClient = null;
    private ?VedaCircuitBreaker $circuitBreaker = null;
    private ?VedaHealthChecker $healthChecker = null;

    public function __construct(
        array $nodes,
        int $maxRetries = 3,
        ?VedaRetryPolicy $retryPolicy = null,
        ?VedaCircuitBreaker $circuitBreaker = null,
    ) {
        if (empty($nodes)) {
            throw new ValidationException('At least one node is required for failover');
        }

        $this->nodes           = $nodes;
        $this->maxRetries      = max(1, $maxRetries);
        $this->retryPolicy     = $retryPolicy ?? new VedaRetryPolicy();
        $this->circuitBreaker  = $circuitBreaker;
    }

    /**
     * Get a working client, with failover support.
     */
    public function getClient(): VedaClient
    {
        // Try current client first
        if ($this->currentClient !== null) {
            try {
                if ($this->currentClient->ping()) {
                    return $this->currentClient;
                }
            } catch (\Throwable) {
                // Client is dead, will failover
            }
            $this->currentClient = null;
        }

        // Try each node in order
        $startIndex = $this->currentIndex;
        $tried = 0;

        while ($tried < count($this->nodes)) {
            $node = $this->nodes[$this->currentIndex];

            try {
                $client = $this->connectToNode($node);
                $this->currentClient = $client;
                $this->failoverLog[] = sprintf(
                    "Connected to %s:%d",
                    $node['host'],
                    $node['port'],
                );
                return $client;
            } catch (\Throwable $e) {
                $this->failoverLog[] = sprintf(
                    "Failed %s:%d - %s",
                    $node['host'],
                    $node['port'],
                    $e->getMessage(),
                );
            }

            $this->currentIndex = ($this->currentIndex + 1) % count($this->nodes);
            $tried++;

            // Wrapped around without finding a node
            if ($this->currentIndex === $startIndex) {
                break;
            }
        }

        throw new FailoverException(
            'All failover nodes exhausted. Tried: '
            . implode(', ', array_map(
                fn(array $n) => "{$n['host']}:{$n['port']}",
                $this->nodes,
            )),
        );
    }

    /**
     * Execute an operation with failover.
     *
     * @template T
     * @param callable(VedaClient): T $operation
     * @return T
     */
    public function execute(callable $operation): mixed
    {
        if ($this->circuitBreaker !== null) {
            return $this->circuitBreaker->call(function () use ($operation) {
                return $this->doExecute($operation);
            });
        }

        return $this->doExecute($operation);
    }

    /**
     * @template T
     * @param callable(VedaClient): T $operation
     * @return T
     */
    private function doExecute(callable $operation): mixed
    {
        return $this->retryPolicy->execute(function () use ($operation) {
            $client = $this->getClient();
            try {
                return $operation($client);
            } catch (ConnectionException $e) {
                // Connection failed, mark current client as dead
                $this->currentClient = null;
                throw $e;
            }
        });
    }

    /**
     * Connect to a specific node.
     *
     * @param array{host: string, port: int, config?: array<string, mixed>} $node
     */
    private function connectToNode(array $node): VedaClient
    {
        $config = array_merge(
            $node['config'] ?? [],
            [
                'host' => $node['host'],
                'port' => $node['port'],
            ],
        );

        return VedaClient::connectWithConfig($config);
    }

    /**
     * Force a failover to the next node.
     */
    public function forceFailover(): void
    {
        $this->currentClient = null;
        $this->currentIndex = ($this->currentIndex + 1) % count($this->nodes);
    }

    /**
     * Get the current primary node info.
     */
    public function getCurrentNode(): array
    {
        return $this->nodes[$this->currentIndex] ?? $this->nodes[0];
    }

    /**
     * Get all node info.
     */
    public function getNodes(): array
    {
        return $this->nodes;
    }

    /**
     * Get failover log.
     *
     * @return list<string>
     */
    public function getFailoverLog(): array
    {
        return $this->failoverLog;
    }

    /**
     * Clear failover log.
     */
    public function clearLog(): void
    {
        $this->failoverLog = [];
    }

    /**
     * Health check all nodes.
     *
     * @return list<array{node: string, port: int, healthy: bool}>
     */
    public function healthCheckAll(): array
    {
        $results = [];
        foreach ($this->nodes as $node) {
            $checker = new VedaHealthChecker(
                $node['host'],
                $node['port'],
                checkIntervalMs: $this->retryPolicy->getBaseDelayMs(),
            );
            $results[] = [
                'node'    => $node['host'],
                'port'    => $node['port'],
                'healthy' => $checker->check(),
            ];
        }
        return $results;
    }

    /**
     * Get node status summary.
     */
    public function getStatus(): array
    {
        return [
            'nodes'          => $this->nodes,
            'current_index'  => $this->currentIndex,
            'current_node'   => $this->getCurrentNode(),
            'has_connection' => $this->currentClient !== null,
            'failover_log'   => $this->failoverLog,
        ];
    }
}
