<?php
// CircuitBreakerTest.php — Circuit breaker tests for VedaDB PHP driver
use PHPUnit\Framework\TestCase;

class CircuitBreakerTest extends TestCase
{
    private CircuitBreaker $cb;

    protected function setUp(): void
    {
        $this->cb = new CircuitBreaker(failureThreshold: 5, successThreshold: 3, timeout: 30.0);
    }

    // Closed state tests
    public function testInitialState(): void
    {
        $this->assertEquals('closed', $this->cb->getState());
    }

    public function testAllowsWhenClosed(): void
    {
        $this->assertTrue($this->cb->allow());
    }

    public function testExecuteSuccess(): void
    {
        $result = $this->cb->execute(function() { return 'success'; });
        $this->assertEquals('success', $result);
    }

    public function testResetFailureOnSuccess(): void
    {
        $this->cb->recordFailure();
        $this->cb->recordFailure();
        $this->cb->recordSuccess();
        $this->assertEquals('closed', $this->cb->getState());
    }

    // Open state tests
    public function testOpensAfterThreshold(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 3);
        $cb->recordFailure();
        $cb->recordFailure();
        $this->assertEquals('closed', $cb->getState());
        $cb->recordFailure();
        $this->assertEquals('open', $cb->getState());
    }

    public function testRejectsWhenOpen(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 1, timeout: 60.0);
        $cb->recordFailure();
        $this->assertFalse($cb->allow());
    }

    public function testExecuteWhenOpen(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 1, timeout: 60.0);
        $cb->recordFailure();
        $this->expectException(CircuitBreakerOpenError::class);
        $this->expectExceptionMessage('OPEN');
        $cb->execute(function() { return 'no'; });
    }

    public function testExactThreshold(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 3);
        $cb->recordFailure();
        $cb->recordFailure();
        $this->assertEquals('closed', $cb->getState());
        $cb->recordFailure();
        $this->assertEquals('open', $cb->getState());
    }

    // Half-open tests
    public function testHalfOpenAfterTimeout(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 1, timeout: 0.05);
        $cb->recordFailure();
        $this->assertEquals('open', $cb->getState());
        usleep(100000); // 100ms
        $this->assertTrue($cb->allow());
        $this->assertEquals('half_open', $cb->getState());
    }

    public function testClosesAfterHalfOpenSuccess(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 5, successThreshold: 1, timeout: 0.01);
        $cb->recordFailure();
        usleep(20000);
        $cb->allow();
        $cb->recordSuccess();
        $this->assertEquals('closed', $cb->getState());
    }

    public function testReopensAfterHalfOpenFailure(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 5, timeout: 0.01);
        $cb->recordFailure();
        usleep(20000);
        $cb->allow();
        $cb->recordFailure();
        $this->assertEquals('open', $cb->getState());
    }

    // Recovery test
    public function testFullRecovery(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 2, successThreshold: 1, timeout: 0.01);
        $this->assertEquals('closed', $cb->getState());

        $cb->recordFailure();
        $cb->recordFailure();
        $this->assertEquals('open', $cb->getState());

        usleep(20000);
        $this->assertTrue($cb->allow());
        $this->assertEquals('half_open', $cb->getState());

        $cb->recordSuccess();
        $this->assertEquals('closed', $cb->getState());
    }

    // Reset test
    public function testManualReset(): void
    {
        $cb = new CircuitBreaker(failureThreshold: 1);
        $cb->recordFailure();
        $this->assertEquals('open', $cb->getState());
        $cb->reset();
        $this->assertEquals('closed', $cb->getState());
        $this->assertTrue($cb->allow());
    }
}

class CircuitBreaker
{
    private int $failureThreshold;
    private int $successThreshold;
    private float $timeout;
    private string $state = 'closed';
    private int $failureCount = 0;
    private int $successCount = 0;
    private ?float $lastFailureTime = null;
    private int $halfOpenCalls = 0;
    private int $halfOpenMax = 1;

    public function __construct(int $failureThreshold = 5, int $successThreshold = 3, float $timeout = 30.0)
    {
        $this->failureThreshold = $failureThreshold;
        $this->successThreshold = $successThreshold;
        $this->timeout = $timeout;
    }

    public function getState(): string { return $this->state; }

    public function allow(): bool
    {
        switch ($this->state) {
            case 'closed':
                return true;
            case 'open':
                if (microtime(true) - $this->lastFailureTime > $this->timeout) {
                    $this->state = 'half_open';
                    $this->halfOpenCalls = 0;
                    $this->successCount = 0;
                    return true;
                }
                return false;
            case 'half_open':
                if ($this->halfOpenCalls < $this->halfOpenMax) {
                    $this->halfOpenCalls++;
                    return true;
                }
                return false;
        }
        return false;
    }

    public function recordSuccess(): void
    {
        switch ($this->state) {
            case 'half_open':
                $this->successCount++;
                if ($this->successCount >= $this->successThreshold) {
                    $this->state = 'closed';
                    $this->failureCount = 0;
                    $this->halfOpenCalls = 0;
                }
                break;
            case 'closed':
                $this->failureCount = 0;
                break;
        }
    }

    public function recordFailure(): void
    {
        $this->lastFailureTime = microtime(true);
        if ($this->state === 'half_open') {
            $this->state = 'open';
            $this->halfOpenCalls = 0;
            return;
        }
        $this->failureCount++;
        if ($this->failureCount >= $this->failureThreshold) {
            $this->state = 'open';
        }
    }

    public function execute(callable $fn)
    {
        if (!$this->allow()) {
            throw new CircuitBreakerOpenError('Circuit breaker is OPEN');
        }
        try {
            $result = $fn();
            $this->recordSuccess();
            return $result;
        } catch (\Throwable $e) {
            $this->recordFailure();
            throw $e;
        }
    }

    public function reset(): void
    {
        $this->state = 'closed';
        $this->failureCount = 0;
        $this->successCount = 0;
        $this->halfOpenCalls = 0;
    }
}

class CircuitBreakerOpenError extends \Exception {}
