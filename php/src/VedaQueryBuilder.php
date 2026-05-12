<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Fluent query builder for VedaDB.
 */
class VedaQueryBuilder
{
    private VedaClient $client;
    private string $table;

    /** @var list<string> */
    private array $columns = ['*'];

    /** @var list<string> */
    private array $wheres = [];

    /** @var list<string> */
    private array $joins = [];

    /** @var list<string> */
    private array $groupBy = [];

    /** @var list<string> */
    private array $having = [];

    /** @var list<string> */
    private array $orderBy = [];

    private ?int $limit = null;
    private ?int $offset = null;
    private bool $distinct = false;
    private bool $forUpdate = false;

    public function __construct(VedaClient $client, string $table)
    {
        $this->client = $client;
        $this->table  = $table;
    }

    /**
     * Set columns to select.
     *
     * @param string ...$columns
     */
    public function select(string ...$columns): self
    {
        $this->columns = empty($columns) ? ['*'] : $columns;
        return $this;
    }

    /**
     * Enable DISTINCT.
     */
    public function distinct(): self
    {
        $this->distinct = true;
        return $this;
    }

    /**
     * Add a WHERE clause.
     */
    public function where(string $column, string $operator, mixed $value): self
    {
        $this->wheres[] = "{$column} {$operator} " . $this->formatValue($value);
        return $this;
    }

    /**
     * Add a WHERE = clause (shorthand).
     */
    public function whereEqual(string $column, mixed $value): self
    {
        return $this->where($column, '=', $value);
    }

    /**
     * Add a WHERE IN clause.
     *
     * @param list<mixed> $values
     */
    public function whereIn(string $column, array $values): self
    {
        $formatted = implode(', ', array_map([$this, 'formatValue'], $values));
        $this->wheres[] = "{$column} IN ({$formatted})";
        return $this;
    }

    /**
     * Add a WHERE IS NULL clause.
     */
    public function whereNull(string $column): self
    {
        $this->wheres[] = "{$column} IS NULL";
        return $this;
    }

    /**
     * Add a WHERE IS NOT NULL clause.
     */
    public function whereNotNull(string $column): self
    {
        $this->wheres[] = "{$column} IS NOT NULL";
        return $this;
    }

    /**
     * Add a raw WHERE condition.
     */
    public function whereRaw(string $condition): self
    {
        $this->wheres[] = $condition;
        return $this;
    }

    /**
     * Add an INNER JOIN.
     */
    public function join(string $table, string $on, ?string $alias = null): self
    {
        $joinTable = $alias ? "{$table} AS {$alias}" : $table;
        $this->joins[] = "INNER JOIN {$joinTable} ON {$on}";
        return $this;
    }

    /**
     * Add a LEFT JOIN.
     */
    public function leftJoin(string $table, string $on, ?string $alias = null): self
    {
        $joinTable = $alias ? "{$table} AS {$alias}" : $table;
        $this->joins[] = "LEFT JOIN {$joinTable} ON {$on}";
        return $this;
    }

    /**
     * Add GROUP BY.
     *
     * @param string ...$columns
     */
    public function groupBy(string ...$columns): self
    {
        $this->groupBy = array_merge($this->groupBy, $columns);
        return $this;
    }

    /**
     * Add HAVING condition.
     */
    public function having(string $condition): self
    {
        $this->having[] = $condition;
        return $this;
    }

    /**
     * Add ORDER BY.
     *
     * @param string ...$columns
     */
    public function orderBy(string ...$columns): self
    {
        $this->orderBy = array_merge($this->orderBy, $columns);
        return $this;
    }

    /**
     * Set LIMIT.
     */
    public function limit(int $limit): self
    {
        $this->limit = max(0, $limit);
        return $this;
    }

    /**
     * Set OFFSET.
     */
    public function offset(int $offset): self
    {
        $this->offset = max(0, $offset);
        return $this;
    }

    /**
     * Enable FOR UPDATE.
     */
    public function forUpdate(): self
    {
        $this->forUpdate = true;
        return $this;
    }

    // -- Execution ----------------------------------------------------------

    /**
     * Execute the SELECT query and return a VedaResult.
     */
    public function get(): VedaResult
    {
        return $this->client->query($this->toSql());
    }

    /**
     * Execute and return all rows as dicts.
     *
     * @return list<array<string, mixed>>
     */
    public function all(): array
    {
        return $this->get()->toDicts();
    }

    /**
     * Execute and return the first row.
     *
     * @return array<string, mixed>|null
     */
    public function first(): ?array
    {
        $this->limit(1);
        return $this->get()->first();
    }

    /**
     * Execute and return a single scalar value.
     */
    public function value(string $column): mixed
    {
        $this->select($column);
        return $this->get()->scalar();
    }

    /**
     * Execute and return a cursor.
     */
    public function cursor(int $fetchSize = 100): VedaCursor
    {
        return $this->client->cursor($this->toSql());
    }

    /**
     * Count rows.
     */
    public function count(): int
    {
        $result = $this->client->query("SELECT COUNT(*) FROM {$this->table}");
        return (int) ($result->scalar() ?? 0);
    }

    /**
     * Check if any rows match.
     */
    public function exists(): bool
    {
        return $this->count() > 0;
    }

    /**
     * Insert a row.
     *
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $cols  = implode(', ', array_keys($data));
        $vals  = implode(', ', array_map([$this, 'formatValue'], array_values($data)));
        $result = $this->client->query("INSERT INTO {$this->table} ({$cols}) VALUES ({$vals});");
        return $result->rowCount;
    }

    /**
     * Insert multiple rows.
     *
     * @param list<array<string, mixed>> $rows
     */
    public function insertMany(array $rows): int
    {
        if (empty($rows)) {
            return 0;
        }
        $cols = implode(', ', array_keys($rows[0]));
        $values = [];
        foreach ($rows as $row) {
            $escaped = array_map([$this, 'formatValue'], array_values($row));
            $values[] = '(' . implode(', ', $escaped) . ')';
        }
        $result = $this->client->query(
            "INSERT INTO {$this->table} ({$cols}) VALUES " . implode(', ', $values) . ';',
        );
        return $result->rowCount;
    }

    /**
     * Update rows.
     *
     * @param array<string, mixed> $data
     */
    public function update(array $data): int
    {
        $setClauses = [];
        foreach ($data as $key => $value) {
            $setClauses[] = "{$key} = " . $this->formatValue($value);
        }
        $sql = "UPDATE {$this->table} SET " . implode(', ', $setClauses);
        if (!empty($this->wheres)) {
            $sql .= ' WHERE ' . implode(' AND ', $this->wheres);
        }
        $result = $this->client->query($sql . ';');
        return $result->rowCount;
    }

    /**
     * Delete rows.
     */
    public function delete(): int
    {
        $sql = "DELETE FROM {$this->table}";
        if (!empty($this->wheres)) {
            $sql .= ' WHERE ' . implode(' AND ', $this->wheres);
        }
        $result = $this->client->query($sql . ';');
        $this->reset();
        return $result->rowCount;
    }

    /**
     * Truncate the table.
     */
    public function truncate(): void
    {
        $this->client->query("TRUNCATE TABLE {$this->table};");
    }

    /**
     * Build the SQL string.
     */
    public function toSql(): string
    {
        $parts = ['SELECT'];

        if ($this->distinct) {
            $parts[] = 'DISTINCT';
        }

        $parts[] = implode(', ', $this->columns);
        $parts[] = "FROM {$this->table}";

        foreach ($this->joins as $join) {
            $parts[] = $join;
        }

        if (!empty($this->wheres)) {
            $parts[] = 'WHERE ' . implode(' AND ', $this->wheres);
        }

        if (!empty($this->groupBy)) {
            $parts[] = 'GROUP BY ' . implode(', ', $this->groupBy);
        }

        if (!empty($this->having)) {
            $parts[] = 'HAVING ' . implode(' AND ', $this->having);
        }

        if (!empty($this->orderBy)) {
            $parts[] = 'ORDER BY ' . implode(', ', $this->orderBy);
        }

        if ($this->limit !== null) {
            $parts[] = "LIMIT {$this->limit}";
        }

        if ($this->offset !== null) {
            $parts[] = "OFFSET {$this->offset}";
        }

        if ($this->forUpdate) {
            $parts[] = 'FOR UPDATE';
        }

        return implode(' ', $parts) . ';';
    }

    /**
     * Reset query state (for reuse).
     */
    public function reset(): self
    {
        $this->columns   = ['*'];
        $this->wheres    = [];
        $this->joins     = [];
        $this->groupBy   = [];
        $this->having    = [];
        $this->orderBy   = [];
        $this->limit     = null;
        $this->offset    = null;
        $this->distinct  = false;
        $this->forUpdate = false;
        return $this;
    }

    private function formatValue(mixed $value): string
    {
        if ($value === null) return 'NULL';
        if (is_bool($value)) return $value ? 'TRUE' : 'FALSE';
        if (is_string($value)) return "'" . str_replace("'", "''", $value) . "'";
        if (is_array($value)) return "'" . str_replace("'", "''", json_encode($value)) . "'";
        return (string) $value;
    }

    public function __toString(): string
    {
        return $this->toSql();
    }
}
