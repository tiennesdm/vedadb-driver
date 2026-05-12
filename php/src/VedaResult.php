<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Represents a query result from VedaDB.
 */
class VedaResult
{
    /** @var list<string>|null */
    public ?array $columns;

    /** @var list<list<mixed>>|null */
    public ?array $rows;

    public int $rowCount;

    public ?string $message;

    /** @var array<string, mixed>|null */
    public ?array $metadata;

    public function __construct(
        ?array $columns,
        ?array $rows,
        int $rowCount,
        ?string $message,
        ?array $metadata = null
    ) {
        $this->columns  = $columns;
        $this->rows     = $rows;
        $this->rowCount = $rowCount;
        $this->message  = $message;
        $this->metadata = $metadata;
    }

    /**
     * Convert rows to associative arrays keyed by column name.
     *
     * @return list<array<string, mixed>>
     */
    public function toDicts(): array
    {
        if ($this->columns === null || $this->rows === null) {
            return [];
        }

        $result = [];
        foreach ($this->rows as $row) {
            $dict = [];
            foreach ($this->columns as $i => $col) {
                $dict[$col] = $row[$i] ?? null;
            }
            $result[] = $dict;
        }
        return $result;
    }

    /**
     * Get the first row as an associative array.
     *
     * @return array<string, mixed>|null
     */
    public function first(): ?array
    {
        $dicts = $this->toDicts();
        return $dicts[0] ?? null;
    }

    /**
     * Extract values from a single column.
     *
     * @return list<mixed>
     */
    public function pluck(string $column): array
    {
        if ($this->columns === null || $this->rows === null) {
            return [];
        }

        $idx = array_search($column, $this->columns, true);
        if ($idx === false) {
            return [];
        }

        return array_map(fn(array $row) => $row[$idx] ?? null, $this->rows);
    }

    /**
     * Get a column value from the first row.
     */
    public function value(string $column): mixed
    {
        $dict = $this->first();
        return $dict[$column] ?? null;
    }

    /**
     * Get all values from the first column.
     *
     * @return list<mixed>
     */
    public function column(): array
    {
        if ($this->rows === null || $this->columns === null) {
            return [];
        }
        return array_map(fn(array $row) => $row[0] ?? null, $this->rows);
    }

    /**
     * Check if the result is empty (no rows).
     */
    public function isEmpty(): bool
    {
        return $this->rowCount === 0;
    }

    /**
     * Return the number of rows.
     */
    public function count(): int
    {
        return $this->rowCount;
    }

    /**
     * Return a scalar value (single row, single column).
     */
    public function scalar(): mixed
    {
        if ($this->rows === null || empty($this->rows)) {
            return null;
        }
        return $this->rows[0][0] ?? null;
    }

    /**
     * Get a result set iterator.
     */
    public function getIterator(): VedaResultSet
    {
        return new VedaResultSet($this);
    }

    /**
     * Apply a callback to each row and return transformed results.
     *
     * @template T
     * @param callable(array<string, mixed>): T $callback
     * @return list<T>
     */
    public function map(callable $callback): array
    {
        return array_map($callback, $this->toDicts());
    }

    /**
     * Filter rows by a predicate.
     *
     * @param callable(array<string, mixed>): bool $predicate
     * @return list<array<string, mixed>>
     */
    public function filter(callable $predicate): array
    {
        return array_values(array_filter($this->toDicts(), $predicate));
    }

    /**
     * Parse a JSON response from VedaDB.
     */
    public static function parse(string $json): self
    {
        try {
            $data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new VedaException('Failed to parse response: ' . $e->getMessage());
        }

        if (!is_array($data)) {
            throw new VedaException('Response is not a valid JSON object');
        }

        if (isset($data['error'])) {
            throw new QueryException(
                (string) $data['error'],
                isset($data['code']) ? (int) $data['code'] : null,
                $data['sqlstate'] ?? null,
            );
        }

        return new self(
            $data['columns'] ?? null,
            $data['rows'] ?? null,
            (int) ($data['row_count'] ?? 0),
            $data['message'] ?? null,
            $data['metadata'] ?? null,
        );
    }
}
