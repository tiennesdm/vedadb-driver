<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Bulk insert operations with batching support.
 */
class VedaBulkInserter
{
    private VedaClient $client;
    private string $table;
    private int $batchSize;

    /** @var list<array<string, mixed>> */
    private array $buffer = [];

    private int $totalInserted = 0;
    private int $totalFlushed  = 0;
    private bool $closed = false;

    public function __construct(VedaClient $client, string $table, int $batchSize = 1000)
    {
        $this->client    = $client;
        $this->table     = $table;
        $this->batchSize = max(1, $batchSize);
    }

    /**
     * Add a row to the buffer.
     *
     * @param array<string, mixed> $row
     */
    public function add(array $row): self
    {
        if ($this->closed) {
            throw new VedaException('BulkInserter is closed');
        }

        $this->buffer[] = $row;

        if (count($this->buffer) >= $this->batchSize) {
            $this->flush();
        }

        return $this;
    }

    /**
     * Add multiple rows.
     *
     * @param list<array<string, mixed>> $rows
     */
    public function addMany(array $rows): self
    {
        foreach ($rows as $row) {
            $this->add($row);
        }
        return $this;
    }

    /**
     * Flush pending rows to the database.
     */
    public function flush(): int
    {
        if (empty($this->buffer)) {
            return 0;
        }

        $count = count($this->buffer);
        $cols  = implode(', ', array_keys($this->buffer[0]));

        $values = [];
        foreach ($this->buffer as $row) {
            $escaped = array_map(
                fn(mixed $v) => $this->formatValue($v),
                array_values($row),
            );
            $values[] = '(' . implode(', ', $escaped) . ')';
        }

        $sql = "INSERT INTO {$this->table} ({$cols}) VALUES "
             . implode(', ', $values) . ';';

        $result = $this->client->execute($sql);
        $this->totalInserted += $count;
        $this->totalFlushed++;
        $this->buffer = [];

        return $count;
    }

    /**
     * Close the inserter, flushing any remaining rows.
     */
    public function close(): void
    {
        if (!$this->closed) {
            $this->flush();
            $this->closed = true;
        }
    }

    /**
     * Get the number of pending rows.
     */
    public function pendingCount(): int
    {
        return count($this->buffer);
    }

    public function getTotalInserted(): int
    {
        return $this->totalInserted;
    }

    public function getTotalFlushed(): int
    {
        return $this->totalFlushed;
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

    public function __destruct()
    {
        $this->close();
    }
}
