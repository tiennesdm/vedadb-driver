<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Change stream for watching database changes (CDC).
 */
class VedaChangeStream
{
    private VedaClient $client;
    private ?string $table;
    private ?string $operation; // INSERT, UPDATE, DELETE, or null for all
    private float $timeoutMs;
    private bool $running = false;

    /** @var callable|null */
    private $handler = null;

    /** @var list<array<string, mixed>> */
    private array $buffer = [];

    private int $maxBufferSize = 1000;

    public function __construct(
        VedaClient $client,
        ?string $table = null,
        ?string $operation = null,
        float $timeoutMs = 30000.0,
    ) {
        $this->client    = $client;
        $this->table     = $table;
        $this->operation = $operation;
        $this->timeoutMs = $timeoutMs;
    }

    /**
     * Start watching for changes.
     *
     * @param callable(array<string, mixed>): void $handler
     */
    public function watch(callable $handler, ?float $timeoutMs = null): void
    {
        $this->handler = $handler;
        $this->running = true;

        $timeout = $timeoutMs ?? $this->timeoutMs;
        $endTime = microtime(true) + ($timeout / 1000);

        // Build WATCH command
        $cmd = 'WATCH';
        if ($this->table !== null) {
            $cmd .= " TABLE '{$this->table}'";
        }
        if ($this->operation !== null) {
            $cmd .= " FOR {$this->operation}";
        }

        $this->client->query($cmd);

        while ($this->running && microtime(true) < $endTime) {
            try {
                $result = $this->client->query('WATCH POLL');
                $change = $result->first();

                if ($change !== null) {
                    $this->buffer[] = $change;
                    if (count($this->buffer) > $this->maxBufferSize) {
                        array_shift($this->buffer);
                    }
                    ($handler)($change);
                }
            } catch (TimeoutException $e) {
                continue;
            } catch (\Throwable $e) {
                $this->running = false;
                throw $e;
            }
        }
    }

    /**
     * Poll for a single change event.
     *
     * @return array<string, mixed>|null
     */
    public function poll(?float $timeoutMs = null): ?array
    {
        $timeout = $timeoutMs ?? $this->timeoutMs;
        $endTime = microtime(true) + ($timeout / 1000);

        $cmd = 'WATCH';
        if ($this->table !== null) {
            $cmd .= " TABLE '{$this->table}'";
        }
        if ($this->operation !== null) {
            $cmd .= " FOR {$this->operation}";
        }

        while (microtime(true) < $endTime) {
            try {
                $result = $this->client->query($cmd . ' POLL');
                $change = $result->first();
                if ($change !== null) {
                    $this->buffer[] = $change;
                    return $change;
                }

                // Small backoff between polls
                usleep(100000); // 100ms
            } catch (TimeoutException $e) {
                return null;
            }
        }

        return null;
    }

    /**
     * Stop the change stream.
     */
    public function stop(): void
    {
        $this->running = false;
        try {
            $this->client->query('WATCH STOP');
        } catch (\Throwable) {
            // Ignore
        }
    }

    /**
     * Get buffered changes.
     *
     * @return list<array<string, mixed>>
     */
    public function getBuffer(): array
    {
        return $this->buffer;
    }

    /**
     * Get the last change.
     *
     * @return array<string, mixed>|null
     */
    public function last(): ?array
    {
        $count = count($this->buffer);
        return $count > 0 ? $this->buffer[$count - 1] : null;
    }

    /**
     * Resume from a resume token.
     */
    public function resume(string $token): void
    {
        $cmd = 'WATCH';
        if ($this->table !== null) {
            $cmd .= " TABLE '{$this->table}'";
        }
        $cmd .= " RESUME '{$token}'";
        $this->client->query($cmd);
    }

    /**
     * Check if the stream is running.
     */
    public function isRunning(): bool
    {
        return $this->running;
    }

    /**
     * Get the table being watched.
     */
    public function getTable(): ?string
    {
        return $this->table;
    }

    /**
     * Get the operation filter.
     */
    public function getOperation(): ?string
    {
        return $this->operation;
    }
}
