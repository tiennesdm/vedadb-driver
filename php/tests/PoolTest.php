<?php
// PoolTest.php — Connection pool tests for VedaDB PHP driver
use PHPUnit\Framework\TestCase;

class PoolTest extends TestCase
{
    private function createFactory(): \Closure
    {
        return fn() => new MockPoolConnection();
    }

    public function testAcquireNew(): void
    {
        $pool = new ConnectionPool($this->createFactory(), 5, 5, 1.0);
        $conn = $pool->acquire();
        $this->assertNotNull($conn);
        $this->assertTrue($conn->inUse);
        $conn->release();
        $pool->close();
    }

    public function testReuseConnection(): void
    {
        $pool = new ConnectionPool($this->createFactory(), 5, 5, 1.0);
        $conn1 = $pool->acquire();
        $id1 = $conn1->id;
        $conn1->release();
        $conn2 = $pool->acquire();
        $this->assertEquals($id1, $conn2->id);
        $conn2->release();
        $pool->close();
    }

    public function testPoolExhaustion(): void
    {
        $pool = new ConnectionPool($this->createFactory(), 1, 1, 0.05);
        $conn = $pool->acquire();
        $this->expectException(\RuntimeException::class);
        $pool->acquire();
        $conn->release();
        $pool->close();
    }

    public function testClosePool(): void
    {
        $pool = new ConnectionPool($this->createFactory(), 5, 5, 1.0);
        $pool->close();
        $this->assertTrue($pool->isClosed());
    }

    public function testTotalCreated(): void
    {
        $pool = new ConnectionPool($this->createFactory(), 5, 5, 1.0);
        $this->assertEquals(0, $pool->getTotalCreated());
        $conn = $pool->acquire();
        $this->assertEquals(1, $pool->getTotalCreated());
        $conn->release();
        $pool->close();
    }
}

class MockPoolConnection
{
    private bool $closed = false;
    public function close(): void { $this->closed = true; }
    public function isClosed(): bool { return $this->closed; }
}

class PooledConnection
{
    public int $id;
    public MockPoolConnection $connection;
    public ConnectionPool $pool;
    public bool $inUse = false;

    public function __construct(MockPoolConnection $connection, int $id, ConnectionPool $pool)
    {
        $this->connection = $connection;
        $this->id = $id;
        $this->pool = $pool;
    }

    public function release(): void
    {
        $this->pool->release($this);
    }

    public function isValid(): bool
    {
        return !$this->connection->isClosed();
    }
}

class ConnectionPool
{
    private \Closure $factory;
    private int $maxSize;
    private float $waitTimeout;
    private array $available = [];
    private array $allConnections = [];
    private int $totalCreated = 0;
    private bool $closed = false;

    public function __construct(\Closure $factory, int $maxSize, int $maxIdle, float $waitTimeout)
    {
        $this->factory = $factory;
        $this->maxSize = $maxSize;
        $this->waitTimeout = $waitTimeout;
    }

    public function acquire(): PooledConnection
    {
        if ($this->closed) throw new \RuntimeException('Pool is closed');
        if (!empty($this->available)) {
            $conn = array_pop($this->available);
            $conn->inUse = true;
            return $conn;
        }
        if ($this->totalCreated < $this->maxSize) {
            $this->totalCreated++;
            $raw = ($this->factory)();
            $conn = new PooledConnection($raw, $this->totalCreated, $this);
            $conn->inUse = true;
            $this->allConnections[] = $conn;
            return $conn;
        }
        throw new \RuntimeException('Pool exhausted: wait timeout');
    }

    public function release(PooledConnection $conn): void
    {
        $conn->inUse = false;
        $this->available[] = $conn;
    }

    public function getTotalCreated(): int { return $this->totalCreated; }
    public function isClosed(): bool { return $this->closed; }

    public function close(): void
    {
        $this->closed = true;
        $this->available = [];
    }
}
