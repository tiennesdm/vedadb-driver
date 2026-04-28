<?php

declare(strict_types=1);

namespace VedaDB;

class VedaResult
{
    /** @var list<string>|null */
    public ?array $columns;

    /** @var list<list<mixed>>|null */
    public ?array $rows;

    public int $rowCount;

    public ?string $message;

    public function __construct(?array $columns, ?array $rows, int $rowCount, ?string $message)
    {
        $this->columns = $columns;
        $this->rows = $rows;
        $this->rowCount = $rowCount;
        $this->message = $message;
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
     * Parse a JSON response from VedaDB.
     *
     * @throws QueryException
     */
    public static function parse(string $json): self
    {
        $data = json_decode($json, true);
        if (!is_array($data)) {
            throw new VedaException('Failed to parse response');
        }

        if (isset($data['error'])) {
            throw new QueryException((string)$data['error']);
        }

        return new self(
            $data['columns'] ?? null,
            $data['rows'] ?? null,
            (int)($data['row_count'] ?? 0),
            $data['message'] ?? null,
        );
    }
}
