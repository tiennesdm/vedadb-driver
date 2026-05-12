<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Retry policy with configurable backoff strategies.
 */
class VedaRetryPolicy
{
    private int $maxRetries;
    private float $baseDelayMs;
    private float $maxDelayMs;
    private float $multiplier;
    private string $strategy; // 'fixed', 'linear', 'exponential', 'jitter'

    /** @var list<class-string<\Throwable>> */
    private array $retryableExceptions;

    /**
     * @param list<class-string<\Throwable>> $retryableExceptions
     */
    public function __construct(
        int $maxRetries = 3,
        float $baseDelayMs = 100.0,
        float $maxDelayMs = 10000.0,
        float $multiplier = 2.0,
        string $strategy = 'exponential',
        array $retryableExceptions = [ConnectionException::class, TimeoutException::class]
    ) {
        $this->maxRetries            = max(0, $maxRetries);
        $this->baseDelayMs           = max(1.0, $baseDelayMs);
        $this->maxDelayMs            = max($this->baseDelayMs, $maxDelayMs);
        $this->multiplier            = max(1.0, $multiplier);
        $this->strategy              = $strategy;
        $this->retryableExceptions   = $retryableExceptions;
    }

    /**
     * Execute a callback with retry logic.
     *
     * @template T
     * @param callable(): T $operation
     * @return T
     */
    public function execute(callable $operation): mixed
    {
        $lastException = null;

        for ($attempt = 0; $attempt <= $this->maxRetries; $attempt++) {
            try {
                return $operation();
            } catch (\Throwable $e) {
                $lastException = $e;

                if (!$this->isRetryable($e) || $attempt >= $this->maxRetries) {
                    throw $e;
                }

                $delay = $this->calculateDelay($attempt);
                usleep((int) ($delay * 1000));
            }
        }

        throw $lastException ?? new VedaException('Retry exhausted');
    }

    /**
     * Check if an exception is retryable.
     */
    public function isRetryable(\Throwable $e): bool
    {
        foreach ($this->retryableExceptions as $class) {
            if ($e instanceof $class) {
                return true;
            }
        }
        return false;
    }

    /**
     * Calculate the delay for a given attempt number.
     */
    public function calculateDelay(int $attempt): float
    {
        $delay = match ($this->strategy) {
            'fixed'        => $this->baseDelayMs,
            'linear'       => $this->baseDelayMs * ($attempt + 1),
            'exponential'  => $this->baseDelayMs * ($this->multiplier ** $attempt),
            'jitter'       => $this->baseDelayMs * ($this->multiplier ** $attempt) * (mt_rand() / mt_getrandmax()),
            default        => $this->baseDelayMs,
        };

        return min($delay, $this->maxDelayMs);
    }

    /**
     * Create a default retry policy.
     */
    public static function default(): self
    {
        return new self();
    }

    /**
     * Create an aggressive retry policy.
     */
    public static function aggressive(): self
    {
        return new self(maxRetries: 5, baseDelayMs: 50, strategy: 'jitter');
    }

    /**
     * Create a conservative retry policy.
     */
    public static function conservative(): self
    {
        return new self(maxRetries: 2, baseDelayMs: 500, multiplier: 2.0, strategy: 'exponential');
    }

    public function getMaxRetries(): int
    {
        return $this->maxRetries;
    }

    public function getBaseDelayMs(): float
    {
        return $this->baseDelayMs;
    }

    public function getMaxDelayMs(): float
    {
        return $this->maxDelayMs;
    }
}
