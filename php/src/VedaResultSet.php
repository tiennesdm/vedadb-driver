<?php

declare(strict_types=1);

namespace VedaDB;

use Iterator;
use Countable;

/**
 * Iterator-based result set for streaming row access.
 *
 * @implements Iterator<int, array<string, mixed>>
 */
class VedaResultSet implements Iterator, Countable
{
    private VedaResult $result;
    private int $position;

    /** @var list<array<string, mixed>> */
    private array $dicts;

    public function __construct(VedaResult $result)
    {
        $this->result   = $result;
        $this->dicts    = $result->toDicts();
        $this->position = 0;
    }

    /**
     * Rewind the iterator.
     */
    public function rewind(): void
    {
        $this->position = 0;
    }

    /**
     * Get the current row.
     *
     * @return array<string, mixed>
     */
    public function current(): array
    {
        return $this->dicts[$this->position] ?? [];
    }

    /**
     * Get the current position.
     */
    public function key(): int
    {
        return $this->position;
    }

    /**
     * Move to the next row.
     */
    public function next(): void
    {
        ++$this->position;
    }

    /**
     * Check if the current position is valid.
     */
    public function valid(): bool
    {
        return isset($this->dicts[$this->position]);
    }

    /**
     * Get the row count.
     */
    public function count(): int
    {
        return count($this->dicts);
    }

    /**
     * Get all rows as associative arrays.
     *
     * @return list<array<string, mixed>>
     */
    public function toArray(): array
    {
        return $this->dicts;
    }

    /**
     * Get the first row.
     *
     * @return array<string, mixed>|null
     */
    public function first(): ?array
    {
        return $this->dicts[0] ?? null;
    }

    /**
     * Get the last row.
     *
     * @return array<string, mixed>|null
     */
    public function last(): ?array
    {
        $count = count($this->dicts);
        return $count > 0 ? $this->dicts[$count - 1] : null;
    }

    /**
     * Get a slice of rows.
     *
     * @return list<array<string, mixed>>
     */
    public function slice(int $offset, ?int $length = null): array
    {
        return array_slice($this->dicts, $offset, $length);
    }

    /**
     * Apply a callback to each row.
     *
     * @template T
     * @param callable(array<string, mixed>): T $callback
     * @return list<T>
     */
    public function map(callable $callback): array
    {
        return array_map($callback, $this->dicts);
    }

    /**
     * Filter rows.
     *
     * @param callable(array<string, mixed>): bool $predicate
     * @return list<array<string, mixed>>
     */
    public function filter(callable $predicate): array
    {
        return array_values(array_filter($this->dicts, $predicate));
    }

    /**
     * Reduce rows to a single value.
     *
     * @template T
     * @param callable(T, array<string, mixed>): T $callback
     * @param T $initial
     * @return T
     */
    public function reduce(callable $callback, mixed $initial = null): mixed
    {
        return array_reduce($this->dicts, $callback, $initial);
    }

    /**
     * Check if any row matches the predicate.
     */
    public function any(callable $predicate): bool
    {
        foreach ($this->dicts as $row) {
            if ($predicate($row)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if all rows match the predicate.
     */
    public function all(callable $predicate): bool
    {
        foreach ($this->dicts as $row) {
            if (!$predicate($row)) {
                return false;
            }
        }
        return true;
    }
}
