<?php
/**
 * VedaDB Change Stream (CDC) for PHP.
 *
 * @example
 * $stream = $client->watch("users", [
 *     "operations" => ["INSERT", "UPDATE"],
 *     "resumeFromLSN" => 12345,
 * ]);
 * foreach ($stream->events() as $event) {
 *     echo $event["operation"] . " on " . $event["table"] . "\n";
 * }
 */

declare(strict_types=1);

namespace VedaDB;

class ChangeStream
{
    private VedaClient $client;
    private ?string $table;
    private array $operations;
    private int $resumeFromLSN;
    private bool $includeBefore;
    private bool $active = false;
    private int $lastLSN = 0;
    private int $pollIntervalMs;

    public function __construct(
        VedaClient $client,
        ?string $table = null,
        array $options = []
    ) {
        $this->client = $client;
        $this->table = $table;
        $this->operations = $options["operations"] ?? [];
        $this->resumeFromLSN = $options["resumeFromLSN"] ?? 0;
        $this->includeBefore = $options["includeBefore"] ?? false;
        $this->pollIntervalMs = $options["pollIntervalMs"] ?? 100;
        $this->lastLSN = $this->resumeFromLSN;
    }

    /**
     * Start consuming change events.
     */
    public function start(): self
    {
        if ($this->active) {
            return $this;
        }
        $this->active = true;
        return $this;
    }

    /**
     * Stop the change stream.
     */
    public function stop(): self
    {
        $this->active = false;
        return $this;
    }

    /**
     * Generator that yields change events.
     */
    public function events(): \Generator
    {
        $this->start();
        while ($this->active) {
            try {
                $sql = $this->buildSQL();
                $result = $this->client->query($sql);
                foreach ($result->toDicts() as $row) {
                    $event = $this->parseRow($row);
                    if ($event === null || !$this->matchesFilter($event)) {
                        continue;
                    }
                    $this->lastLSN = (int) ($event["lsn"] ?? 0);
                    yield $event;
                }
                usleep($this->pollIntervalMs * 1000);
            } catch (\Throwable $e) {
                yield ["error" => true, "message" => $e->getMessage()];
                usleep(1000000); // 1 second retry
            }
        }
    }

    /**
     * Poll for a single event.
     */
    public function poll(int $timeoutMs = 5000): ?array
    {
        $start = hrtime(true);
        foreach ($this->events() as $event) {
            if (isset($event["error"]) && $event["error"]) {
                throw new VedaException("Change stream error: " . $event["message"]);
            }
            return $event;
        }
        $elapsed = (int) ((hrtime(true) - $start) / 1000000);
        if ($elapsed >= $timeoutMs) {
            return null;
        }
        return null;
    }

    public function isActive(): bool
    {
        return $this->active;
    }

    public function getLastLSN(): int
    {
        return $this->lastLSN;
    }

    public function getResumeToken(): string
    {
        return json_encode([
            "lsn" => $this->lastLSN,
            "table" => $this->table,
            "time" => time(),
        ]);
    }

    public function resumeFromToken(string $token): self
    {
        $parsed = json_decode($token, true);
        if (isset($parsed["lsn"])) {
            $this->resumeFromLSN = (int) $parsed["lsn"];
            $this->lastLSN = $this->resumeFromLSN;
        }
        if (isset($parsed["table"])) {
            $this->table = $parsed["table"];
        }
        return $this;
    }

    private function buildSQL(): string
    {
        $sql = "WATCH";
        if ($this->table !== null) {
            $sql .= " \"$this->table\"";
        }
        if ($this->resumeFromLSN > 0) {
            $sql .= " RESUME LSN " . $this->resumeFromLSN;
        }
        if (!empty($this->operations)) {
            $sql .= " FILTER (" . implode(",", $this->operations) . ")";
        }
        $sql .= ";";
        return $sql;
    }

    private function parseRow(array $row): ?array
    {
        if (!isset($row["operation"])) {
            return null;
        }
        return $row;
    }

    private function matchesFilter(array $event): bool
    {
        if (empty($this->operations)) {
            return true;
        }
        $op = strtoupper((string) ($event["operation"] ?? ""));
        return in_array($op, array_map("strtoupper", $this->operations), true);
    }
}
