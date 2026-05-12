<?php

declare(strict_types=1);

namespace VedaDB;

use Iterator;
use Countable;

/**
 * Streaming cursor for large result sets using generators.
 *
 * @implements Iterator<int, array<string, mixed>>
 */
class VedaCursor implements Iterator, Countable
{
    private VedaClient $client;
    private string $sql;
    private ?array $params;
    private int $fetchSize;

    /** @var list<array<string, mixed>> */
    private array $buffer = [];
    private int $position = 0;
    private int $bufferOffset = 0;
    private int $totalFetched = 0;
    private bool $exhausted = false;
    private bool $closed = false;
    private ?VedaResult $lastResult = null;

    public function __construct(
        VedaClient $client,
        string $sql,
        ?array $params = null,
        int $fetchSize = 100,
    ) {
        $this->client    = $client;
        $this->sql       = $sql;
        $this->params    = $params;
        $this->fetchSize = max(1, $fetchSize);
    }

    /**
     * Open the cursor and fetch the first batch.
     */
    public function open(): void
    {
        $this->fetchBatch();
    }

    /**
     * Fetch the next batch of rows.
     */
    private function fetchBatch(): void
    {
        if ($this->exhausted) {
            return;
        }

        $offset = $this->bufferOffset + count($this->buffer);
        $sql    = $this->sql;

        // Append LIMIT/OFFSET if not present
        if (!preg_match('/\bLIMIT\s+\d+/i', $sql)) {
            $sql .= " LIMIT {$this->fetchSize} OFFSET {$offset}";
        }

        try {
            $result = $this->client->query($sql);
            $this->lastResult = $result;
            $rows = $result->toDicts();

            if (empty($rows)) {
                $this->exhausted = true;
                return;
            }

            $this->buffer = $rows;
            $this->bufferOffset = $offset;
            $this->totalFetched += count($rows);

            if (count($rows) < $this->fetchSize) {
                $this->exhausted = true;
            }
        } catch (\Throwable $e) {
            $this->exhausted = true;
            throw $e;
        }
    }

    /**
     * Generator for iterating rows with yield.
     *
     * @return \Generator<int, array<string, mixed>>
     */
    public function iterate(): \Generator
    {
        $this->rewind();
        while ($this->valid()) {
            yield $this->key() => $this->current();
            $this->next();
        }
    }

    /**
     * Get all remaining rows as an array.
     *
     * @return list<array<string, mixed>>
     */
    public function toArray(): array
    {
        $all = [];
        foreach ($this->iterate() as $row) {
            $all[] = $row;
        }
        return $all;
    }

    /**
     * Get the first row without consuming the cursor.
     *
     * @return array<string, mixed>|null
     */
    public function first(): ?array
    {
        $this->rewind();
        return $this->valid() ? $this->current() : null;
    }

    /**
     * Close the cursor.
     */
    public function close(): void
    {
        $this->closed = true;
        $this->exhausted = true;
        $this->buffer = [];
    }

    // -- Iterator interface -------------------------------------------------

    public function rewind(): void
    {
        if ($this->bufferOffset > 0 || $this->position > 0) {
            // Cursor can only be rewound if at start
            $this->position = 0;
        }
        if (empty($this->buffer) && !$this->exhausted) {
            $this->fetchBatch();
        }
        $this->position = 0;
    }

    /**
     * @return array<string, mixed>
     */
    public function current(): array
    {
        return $this->buffer[$this->position] ?? [];
    }

    public function key(): int
    {
        return $this->bufferOffset + $this->position;
    }

    public function next(): void
    {
        ++$this->position;

        if ($this->position >= count($this->buffer) && !$this->exhausted) {
            $this->fetchBatch();
            $this->position = 0;
        }
    }

    public function valid(): bool
    {
        return isset($this->buffer[$this->position]) && !$this->closed;
    }

    // -- Countable interface ------------------------------------------------

    /**
     * Return the total fetched count (may not reflect all rows).
     */
    public function count(): int
    {
        return $this->totalFetched;
    }

    // -- Metadata -----------------------------------------------------------

    public function isClosed(): bool
    {
        return $this->closed;
    }

    public function isExhausted(): bool
    {
        return $this->exhausted;
    }

    public function getTotalFetched(): int
    {
        return $this->totalFetched;
    }

    public function getFetchSize(): int
    {
        return $this->fetchSize;
    }

    public function __destruct()
    {
        $this->close();
    }
}
