<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Pipeline for batching multiple commands into a single round-trip.
 */
class VedaPipeline
{
    private VedaClient $client;

    /** @var list<array{type: string, sql: string}> */
    private array $commands = [];

    /** @var list<VedaResult> */
    private array $results = [];

    private bool $executed = false;

    public function __construct(VedaClient $client)
    {
        $this->client = $client;
    }

    /**
     * Add a query command to the pipeline.
     */
    public function query(string $sql): self
    {
        $this->commands[] = ['type' => 'query', 'sql' => $sql];
        return $this;
    }

    /**
     * Add an execute command to the pipeline.
     */
    public function execute(string $sql): self
    {
        $this->commands[] = ['type' => 'execute', 'sql' => $sql];
        return $this;
    }

    /**
     * Add an insert command to the pipeline.
     *
     * @param array<string, mixed> $data
     */
    public function insert(string $table, array $data): self
    {
        $cols = implode(', ', array_keys($data));
        $vals = implode(', ', array_map(
            fn(mixed $v) => $this->formatValue($v),
            array_values($data),
        ));
        $sql = "INSERT INTO {$table} ({$cols}) VALUES ({$vals});";
        $this->commands[] = ['type' => 'execute', 'sql' => $sql];
        return $this;
    }

    /**
     * Add an update command to the pipeline.
     *
     * @param array<string, mixed> $set
     */
    public function update(string $table, array $set, ?string $where = null): self
    {
        $setClauses = [];
        foreach ($set as $key => $value) {
            $setClauses[] = "{$key} = " . $this->formatValue($value);
        }
        $sql = "UPDATE {$table} SET " . implode(', ', $setClauses);
        if ($where !== null) {
            $sql .= " WHERE {$where}";
        }
        $this->commands[] = ['type' => 'execute', 'sql' => $sql . ';'];
        return $this;
    }

    /**
     * Add a delete command to the pipeline.
     */
    public function delete(string $table, ?string $where = null): self
    {
        $sql = "DELETE FROM {$table}";
        if ($where !== null) {
            $sql .= " WHERE {$where}";
        }
        $this->commands[] = ['type' => 'execute', 'sql' => $sql . ';'];
        return $this;
    }

    /**
     * Add a raw SQL command.
     */
    public function raw(string $sql): self
    {
        $this->commands[] = ['type' => 'raw', 'sql' => $sql];
        return $this;
    }

    /**
     * Get the number of queued commands.
     */
    public function count(): int
    {
        return count($this->commands);
    }

    /**
     * Check if the pipeline is empty.
     */
    public function isEmpty(): bool
    {
        return empty($this->commands);
    }

    /**
     * Clear all queued commands.
     */
    public function clear(): self
    {
        $this->commands = [];
        $this->results  = [];
        $this->executed = false;
        return $this;
    }

    /**
     * Execute all queued commands and return results.
     *
     * @return list<VedaResult>
     */
    public function run(): array
    {
        if ($this->executed) {
            throw new VedaException('Pipeline has already been executed');
        }

        if (empty($this->commands)) {
            return [];
        }

        $this->executed = true;

        // Use PIPELINE command if supported, otherwise execute sequentially
        $batchSql = 'PIPELINE ' . json_encode(array_map(
            fn(array $cmd) => $cmd['sql'],
            $this->commands,
        ));

        try {
            $result = $this->client->query($batchSql);
            $this->results = $this->parseBatchResult($result);
        } catch (QueryException $e) {
            // Fallback to sequential execution
            $this->results = $this->executeSequential();
        }

        return $this->results;
    }

    /**
     * Execute commands sequentially as fallback.
     *
     * @return list<VedaResult>
     */
    private function executeSequential(): array
    {
        $results = [];
        foreach ($this->commands as $cmd) {
            try {
                $results[] = $this->client->query($cmd['sql']);
            } catch (\Throwable $e) {
                $results[] = new VedaResult(
                    null,
                    null,
                    0,
                    null,
                    ['error' => $e->getMessage()],
                );
            }
        }
        return $results;
    }

    /**
     * Parse a batch result into individual VedaResult objects.
     *
     * @return list<VedaResult>
     */
    private function parseBatchResult(VedaResult $result): array
    {
        // Server returns rows with each result as JSON
        $results = [];
        if ($result->rows !== null) {
            foreach ($result->rows as $row) {
                $raw = $row[0] ?? '{}';
                try {
                    $results[] = VedaResult::parse(is_string($raw) ? $raw : json_encode($raw));
                } catch (\Throwable $e) {
                    $results[] = new VedaResult(
                        null, null, 0, null, ['error' => $e->getMessage()],
                    );
                }
            }
        }

        // If no rows, return single result
        if (empty($results)) {
            $results[] = $result;
        }

        return $results;
    }

    /**
     * Get results after run().
     *
     * @return list<VedaResult>
     */
    public function getResults(): array
    {
        if (!$this->executed) {
            throw new VedaException('Pipeline has not been executed. Call run() first.');
        }
        return $this->results;
    }

    /**
     * Get a result at a specific index.
     */
    public function getResult(int $index): ?VedaResult
    {
        if (!$this->executed) {
            throw new VedaException('Pipeline has not been executed');
        }
        return $this->results[$index] ?? null;
    }

    private function formatValue(mixed $value): string
    {
        if ($value === null) return 'NULL';
        if (is_bool($value)) return $value ? 'TRUE' : 'FALSE';
        if (is_string($value)) return "'" . str_replace("'", "''", $value) . "'";
        return (string) $value;
    }
}
