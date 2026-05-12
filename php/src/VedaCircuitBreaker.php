<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Circuit breaker pattern implementation.
 *
 * States: CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery).
 */
class VedaCircuitBreaker
{
    private const STATE_CLOSED     = 'closed';
    private const STATE_OPEN       = 'open';
    private const STATE_HALF_OPEN  = 'half_open';

    private int $failureThreshold;
    private int $successThreshold;
    private float $timeoutMs;
    private string $state;
    private int $failureCount;
    private int $successCount;
    private ?float $lastFailureTime;
    private ?string $name;

    public function __construct(
        int $failureThreshold = 5,
        int $successThreshold = 3,
        float $timeoutMs = 30000.0,
        ?string $name = null
    ) {
        $this->failureThreshold = max(1, $failureThreshold);
        $this->successThreshold = max(1, $successThreshold);
        $this->timeoutMs        = max(1000.0, $timeoutMs);
        $this->name             = $name;
        $this->reset();
    }

    /**
     * Reset the circuit breaker to initial state.
     */
    public function reset(): void
    {
        $this->state           = self::STATE_CLOSED;
        $this->failureCount    = 0;
        $this->successCount    = 0;
        $this->lastFailureTime = null;
    }

    /**
     * Check if the circuit allows requests through.
     */
    public function canPass(): bool
    {
        return match ($this->state) {
            self::STATE_CLOSED     => true,
            self::STATE_OPEN       => $this->shouldAttemptReset(),
            self::STATE_HALF_OPEN  => true,
            default                => true,
        };
    }

    /**
     * Check if the timeout has elapsed to attempt a reset.
     */
    private function shouldAttemptReset(): bool
    {
        if ($this->lastFailureTime === null) {
            return true;
        }

        $elapsed = (microtime(true) * 1000) - $this->lastFailureTime;
        if ($elapsed >= $this->timeoutMs) {
            $this->state        = self::STATE_HALF_OPEN;
            $this->successCount = 0;
            return true;
        }

        return false;
    }

    /**
     * Record a successful call.
     */
    public function recordSuccess(): void
    {
        if ($this->state === self::STATE_HALF_OPEN) {
            $this->successCount++;
            if ($this->successCount >= $this->successThreshold) {
                $this->reset();
            }
        } else {
            $this->failureCount = 0;
        }
    }

    /**
     * Record a failed call.
     */
    public function recordFailure(): void
    {
        $this->failureCount++;
        $this->lastFailureTime = microtime(true) * 1000;

        if ($this->state === self::STATE_HALF_OPEN) {
            $this->state = self::STATE_OPEN;
            return;
        }

        if ($this->failureCount >= $this->failureThreshold) {
            $this->state = self::STATE_OPEN;
        }
    }

    /**
     * Execute a callback under circuit breaker protection.
     *
     * @template T
     * @param callable(): T $operation
     * @return T
     */
    public function call(callable $operation): mixed
    {
        if (!$this->canPass()) {
            throw new CircuitOpenException(
                $this->name
                    ? "Circuit breaker '{$this->name}' is OPEN"
                    : 'Circuit breaker is OPEN',
            );
        }

        try {
            $result = $operation();
            $this->recordSuccess();
            return $result;
        } catch (\Throwable $e) {
            $this->recordFailure();
            throw $e;
        }
    }

    /**
     * Get current state name.
     */
    public function getState(): string
    {
        return $this->state;
    }

    /**
     * Check if the circuit is closed (healthy).
     */
    public function isClosed(): bool
    {
        return $this->state === self::STATE_CLOSED;
    }

    /**
     * Check if the circuit is open (failing).
     */
    public function isOpen(): bool
    {
        return $this->state === self::STATE_OPEN;
    }

    /**
     * Check if the circuit is half-open (testing).
     */
    public function isHalfOpen(): bool
    {
        return $this->state === self::STATE_HALF_OPEN;
    }

    public function getFailureCount(): int
    {
        return $this->failureCount;
    }

    public function getSuccessCount(): int
    {
        return $this->successCount;
    }

    public function getMetrics(): array
    {
        return [
            'name'              => $this->name,
            'state'             => $this->state,
            'failure_count'     => $this->failureCount,
            'success_count'     => $this->successCount,
            'failure_threshold' => $this->failureThreshold,
            'success_threshold' => $this->successThreshold,
            'timeout_ms'        => $this->timeoutMs,
            'last_failure_time' => $this->lastFailureTime,
        ];
    }
}
