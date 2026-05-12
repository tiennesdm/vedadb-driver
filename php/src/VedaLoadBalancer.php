<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Load balancer across multiple VedaDB nodes.
 */
class VedaLoadBalancer
{
    public const STRATEGY_ROUND_ROBIN = 'round_robin';
    public const STRATEGY_RANDOM      = 'random';
    public const STRATEGY_LEAST_CONN  = 'least_connections';
    public const STRATEGY_WEIGHTED    = 'weighted';
    public const STRATEGY_HASH        = 'hash';

    /** @var list<array{client: VedaClient, weight: int, healthy: bool, connections: int}> */
    private array $nodes = [];

    private string $strategy;
    private int $currentIndex = 0;
    private int $healthCheckIntervalMs;
    private ?float $lastHealthCheck = null;

    public function __construct(
        string $strategy = self::STRATEGY_ROUND_ROBIN,
        int $healthCheckIntervalMs = 30000,
    ) {
        $this->strategy                = $strategy;
        $this->healthCheckIntervalMs   = $healthCheckIntervalMs;
    }

    /**
     * Add a node to the pool.
     */
    public function addNode(VedaClient $client, int $weight = 1): void
    {
        $this->nodes[] = [
            'client'      => $client,
            'weight'      => max(1, $weight),
            'healthy'     => true,
            'connections' => 0,
        ];
    }

    /**
     * Remove a node from the pool.
     */
    public function removeNode(VedaClient $client): void
    {
        $oid = spl_object_id($client);
        $this->nodes = array_values(array_filter(
            $this->nodes,
            fn(array $n) => spl_object_id($n['client']) !== $oid,
        ));
    }

    /**
     * Get the next node based on strategy.
     */
    public function nextNode(): VedaClient
    {
        $this->maybeHealthCheck();

        $healthyNodes = array_filter($this->nodes, fn(array $n) => $n['healthy']);
        if (empty($healthyNodes)) {
            throw new FailoverException('No healthy nodes available');
        }

        $node = match ($this->strategy) {
            self::STRATEGY_ROUND_ROBIN => $this->pickRoundRobin($healthyNodes),
            self::STRATEGY_RANDOM      => $this->pickRandom($healthyNodes),
            self::STRATEGY_LEAST_CONN  => $this->pickLeastConnections($healthyNodes),
            self::STRATEGY_WEIGHTED    => $this->pickWeighted($healthyNodes),
            self::STRATEGY_HASH        => $this->pickRoundRobin($healthyNodes),
            default                    => $this->pickRoundRobin($healthyNodes),
        };

        $node['connections']++;
        return $node['client'];
    }

    private function pickRoundRobin(array $nodes): array
    {
        $values = array_values($nodes);
        $picked = $values[$this->currentIndex % count($values)];
        $this->currentIndex++;
        return $picked;
    }

    private function pickRandom(array $nodes): array
    {
        $values = array_values($nodes);
        return $values[array_rand($values)];
    }

    private function pickLeastConnections(array $nodes): array
    {
        $min = PHP_INT_MAX;
        $picked = null;
        foreach ($nodes as $node) {
            if ($node['connections'] < $min) {
                $min = $node['connections'];
                $picked = $node;
            }
        }
        return $picked ?? array_values($nodes)[0];
    }

    private function pickWeighted(array $nodes): array
    {
        $totalWeight = array_sum(array_map(fn(array $n) => $n['weight'], $nodes));
        $random = mt_rand(1, max(1, $totalWeight));

        $cumulative = 0;
        foreach ($nodes as $node) {
            $cumulative += $node['weight'];
            if ($random <= $cumulative) {
                return $node;
            }
        }

        return array_values($nodes)[0];
    }

    /**
     * Release a connection on a node.
     */
    public function releaseNode(VedaClient $client): void
    {
        foreach ($this->nodes as &$node) {
            if (spl_object_id($node['client']) === spl_object_id($client)) {
                $node['connections'] = max(0, $node['connections'] - 1);
                return;
            }
        }
    }

    /**
     * Execute a callback on a selected node.
     *
     * @template T
     * @param callable(VedaClient): T $fn
     * @return T
     */
    public function execute(callable $fn): mixed
    {
        $node = $this->nextNode();
        try {
            return $fn($node);
        } finally {
            $this->releaseNode($node);
        }
    }

    /**
     * Run health checks if interval has elapsed.
     */
    public function maybeHealthCheck(): void
    {
        if ($this->lastHealthCheck === null) {
            $this->healthCheck();
            return;
        }

        $elapsed = (microtime(true) * 1000) - $this->lastHealthCheck;
        if ($elapsed >= $this->healthCheckIntervalMs) {
            $this->healthCheck();
        }
    }

    /**
     * Run health checks on all nodes.
     *
     * @return list<array{node_index: int, healthy: bool}>
     */
    public function healthCheck(): array
    {
        $results = [];
        foreach ($this->nodes as $i => &$node) {
            try {
                $healthy = $node['client']->ping();
            } catch (\Throwable) {
                $healthy = false;
            }
            $node['healthy'] = $healthy;
            $results[] = ['node_index' => $i, 'healthy' => $healthy];
        }

        $this->lastHealthCheck = microtime(true) * 1000;
        return $results;
    }

    /**
     * Get all healthy nodes.
     *
     * @return list<VedaClient>
     */
    public function getHealthyNodes(): array
    {
        return array_values(array_filter(
            array_map(fn(array $n) => $n['healthy'] ? $n['client'] : null, $this->nodes),
        ));
    }

    /**
     * Get node count.
     */
    public function getNodeCount(): int
    {
        return count($this->nodes);
    }

    /**
     * Get healthy node count.
     */
    public function getHealthyCount(): int
    {
        return count(array_filter($this->nodes, fn(array $n) => $n['healthy']));
    }

    /**
     * Get node metrics.
     */
    public function getMetrics(): array
    {
        $nodes = [];
        foreach ($this->nodes as $i => $node) {
            $nodes[] = [
                'index'       => $i,
                'weight'      => $node['weight'],
                'healthy'     => $node['healthy'],
                'connections' => $node['connections'],
            ];
        }

        return [
            'strategy'        => $this->strategy,
            'total_nodes'     => count($this->nodes),
            'healthy_nodes'   => $this->getHealthyCount(),
            'nodes'           => $nodes,
        ];
    }
}
