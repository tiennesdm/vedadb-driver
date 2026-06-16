<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

/**
 * Result of a VBP query: rows + columns + command tag.
 *
 * Mirrors the Java VBPResult. For v1, single-statement query returns
 * one Result; multi-statement scripting would yield a list.
 */
final class VBPResult
{
    /**
     * @param string[] $columns column names in column order
     * @param int[]    $colTypes VBP type IDs in column order
     * @param array<int,array<int,mixed>> $rows row data, each row is a list of values
     * @param string   $commandTag e.g. "SELECT 1" or "INSERT 0 1"
     * @param int      $rowsAffected u64 from COMMAND_COMPLETE
     */
    public function __construct(
        public readonly array $columns = [],
        public readonly array $colTypes = [],
        public readonly array $rows = [],
        public readonly string $commandTag = '',
        public readonly int $rowsAffected = 0,
    ) {
    }

    public function rowCount(): int
    {
        return count($this->rows);
    }

    /** Return a single column from a single-row result, or $default. */
    public function scalar(int $columnIndex = 0, mixed $default = null): mixed
    {
        if (count($this->rows) === 0) {
            return $default;
        }
        return $this->rows[0][$columnIndex] ?? $default;
    }
}
