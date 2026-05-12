<?php
// RetryTest.php — Retry policy tests for VedaDB PHP driver
use PHPUnit\Framework\TestCase;

class RetryTest extends TestCase
{
    private RetryPolicy $policy;

    protected function setUp(): void
    {
        $this->policy = new RetryPolicy(maxRetries: 3, baseDelay: 0.001, maxDelay: 1.0);
    }

    public function testImmediateSuccess(): void
    {
        $callCount = 0;
        $result = $this->policy->execute(function() use (&$callCount) {
            $callCount++;
            return 'success';
        });
        $this->assertEquals('success', $result);
        $this->assertEquals(1, $callCount);
    }

    public function testSuccessAfterRetries(): void
    {
        $policy = new RetryPolicy(maxRetries: 5, baseDelay: 0.0001);
        $callCount = 0;
        $result = $policy->execute(function() use (&$callCount) {
            $callCount++;
            if ($callCount < 3) {
                throw new VedaConnectionError('temporary');
            }
            return 'success';
        });
        $this->assertEquals('success', $result);
        $this->assertEquals(3, $callCount);
    }

    public function testAllAttemptsFail(): void
    {
        $policy = new RetryPolicy(maxRetries: 2, baseDelay: 0.0001);
        $callCount = 0;
        $this->expectException(RetryExhaustedError::class);
        $this->expectExceptionMessage('exhausted');
        $policy->execute(function() use (&$callCount) {
            $callCount++;
            throw new VedaConnectionError('persistent');
        });
        $this->assertEquals(3, $callCount);
    }

    public function testNonRetryableError(): void
    {
        $policy = new RetryPolicy(maxRetries: 5, baseDelay: 0.0001);
        $callCount = 0;
        $this->expectException(\InvalidArgumentException::class);
        $policy->execute(function() use (&$callCount) {
            $callCount++;
            throw new \InvalidArgumentException('fatal');
        });
        $this->assertEquals(1, $callCount);
    }

    public function testZeroRetries(): void
    {
        $policy = new RetryPolicy(maxRetries: 0, baseDelay: 0.0001);
        $callCount = 0;
        $result = $policy->execute(function() use (&$callCount) {
            $callCount++;
            return 'ok';
        });
        $this->assertEquals('ok', $result);
        $this->assertEquals(1, $callCount);
    }

    public function testZeroRetriesFail(): void
    {
        $policy = new RetryPolicy(maxRetries: 0, baseDelay: 0.0001);
        $this->expectException(RetryExhaustedError::class);
        $policy->execute(function() {
            throw new VedaConnectionError('fail');
        });
    }

    public function testTimeoutErrorIsRetryable(): void
    {
        $policy = new RetryPolicy(maxRetries: 3, baseDelay: 0.0001);
        $callCount = 0;
        $result = $policy->execute(function() use (&$callCount) {
            $callCount++;
            if ($callCount < 2) {
                throw new VedaTimeoutError('timeout');
            }
            return 'success';
        });
        $this->assertEquals('success', $result);
        $this->assertEquals(2, $callCount);
    }
}

class RetryPolicy
{
    private int $maxRetries;
    private float $baseDelay;
    private float $maxDelay;
    private float $multiplier;
    private array $retryableExceptions;

    public function __construct(int $maxRetries = 3, float $baseDelay = 0.1, float $maxDelay = 5.0, float $multiplier = 2.0)
    {
        $this->maxRetries = $maxRetries;
        $this->baseDelay = $baseDelay;
        $this->maxDelay = $maxDelay;
        $this->multiplier = $multiplier;
        $this->retryableExceptions = [VedaConnectionError::class, VedaTimeoutError::class];
    }

    public function execute(callable $fn)
    {
        $delay = $this->baseDelay;
        $lastError = null;

        for ($attempt = 0; $attempt <= $this->maxRetries; $attempt++) {
            if ($attempt > 0) {
                usleep((int)($delay * 1000000));
                $delay = min($delay * $this->multiplier, $this->maxDelay);
            }

            try {
                return $fn();
            } catch (\Throwable $e) {
                $lastError = $e;
                if (!$this->isRetryable($e)) {
                    throw $e;
                }
            }
        }

        throw new RetryExhaustedError("Retry exhausted after {$this->maxRetries} attempts: " . ($lastError ? $lastError->getMessage() : ''));
    }

    private function isRetryable(\Throwable $error): bool
    {
        foreach ($this->retryableExceptions as $class) {
            if ($error instanceof $class) return true;
        }
        return false;
    }
}

class RetryExhaustedError extends \Exception {}
class VedaConnectionError extends \Exception {}
class VedaTimeoutError extends \Exception {}
