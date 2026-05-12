<?php
// ClientTest.php — Core driver tests for VedaDB PHP driver
use PHPUnit\Framework\TestCase;

class ClientTest extends TestCase
{
    private MockServer $mockServer;
    private VedaClient $client;

    protected function setUp(): void
    {
        $this->mockServer = new MockServer();
        $this->client = new VedaClient('http://localhost:8080', [
            'transport' => [$this->mockServer, 'handleRequest']
        ]);
    }

    protected function tearDown(): void
    {
        if ($this->client) {
            $this->client->close();
        }
    }

    // Connection tests
    public function testConnectSuccess(): void
    {
        $this->client->connect();
        $this->assertTrue($this->client->isHealthy());
    }

    public function testConfigureWithOptions(): void
    {
        $client = new VedaClient('http://db:9999', [
            'timeout' => 5,
            'max_retries' => 5,
            'retry_delay' => 0.5
        ]);
        $this->assertEquals('http://db:9999', $client->getEndpoint());
        $this->assertEquals(5, $client->getTimeout());
        $this->assertEquals(5, $client->getMaxRetries());
    }

    public function testConnectWithAuth(): void
    {
        $client = new VedaClient('http://localhost:8080', [
            'auth_token' => 'test-token-123'
        ]);
        $this->assertEquals('test-token-123', $client->getAuthToken());
    }

    // Query tests
    public function testQuerySingleRow(): void
    {
        $this->mockServer->addResponse(200, ['result' => [['id' => 1, 'name' => 'Alice']]]);
        $result = $this->client->query('SELECT * FROM users WHERE id = ?', 1);
        $this->assertCount(1, $result);
        $this->assertEquals('Alice', $result[0]['name']);
    }

    public function testQueryMultipleRows(): void
    {
        $this->mockServer->addResponse(200, ['result' => [
            ['id' => 1, 'name' => 'Alice'],
            ['id' => 2, 'name' => 'Bob'],
            ['id' => 3, 'name' => 'Charlie']
        ]]);
        $result = $this->client->query('SELECT * FROM users');
        $this->assertCount(3, $result);
    }

    public function testQueryEmptyResult(): void
    {
        $this->mockServer->addResponse(200, ['result' => []]);
        $result = $this->client->query('SELECT * FROM empty_table');
        $this->assertEmpty($result);
    }

    public function testQueryServerError(): void
    {
        $this->mockServer->addResponse(500, ['error' => 'database error']);
        $this->expectException(VedaClientException::class);
        $this->client->query('SELECT * FROM users');
    }

    public function testQueryApplicationError(): void
    {
        $this->mockServer->addResponse(200, ['error' => 'syntax error at position 14']);
        $this->expectException(VedaClientException::class);
        $this->expectExceptionMessage('syntax error');
        $this->client->query('INVALID SQL');
    }

    // Execute tests
    public function testExecuteInsert(): void
    {
        $this->mockServer->addResponse(200, ['result' => ['rowsAffected' => 1, 'lastInsertId' => 42]]);
        $result = $this->client->execute('INSERT INTO users (name) VALUES (?)', 'Alice');
        $this->assertEquals(1, $result->getRowsAffected());
        $this->assertEquals(42, $result->getLastInsertId());
    }

    public function testExecuteUpdate(): void
    {
        $this->mockServer->addResponse(200, ['result' => ['rowsAffected' => 5]]);
        $result = $this->client->execute('UPDATE users SET active = false');
        $this->assertEquals(5, $result->getRowsAffected());
    }

    public function testExecuteDelete(): void
    {
        $this->mockServer->addResponse(200, ['result' => ['rowsAffected' => 1]]);
        $result = $this->client->execute('DELETE FROM users WHERE id = ?', 99);
        $this->assertEquals(1, $result->getRowsAffected());
    }

    // Close tests
    public function testClose(): void
    {
        $this->client->close();
        $this->assertTrue($this->client->isClosed());
    }

    public function testCloseIsIdempotent(): void
    {
        $this->client->close();
        $this->assertDoesNotThrow(fn() => $this->client->close());
    }

    public function testQueryAfterClose(): void
    {
        $this->client->close();
        $this->expectException(VedaClientException::class);
        $this->expectExceptionMessage('closed');
        $this->client->query('SELECT 1');
    }

    public function testExecuteAfterClose(): void
    {
        $this->client->close();
        $this->expectException(VedaClientException::class);
        $this->expectExceptionMessage('closed');
        $this->client->execute('INSERT INTO t VALUES (1)');
    }

    private function assertDoesNotThrow(callable $fn): void
    {
        try {
            $fn();
        } catch (\Throwable $e) {
            $this->fail('Expected no exception but got: ' . $e->getMessage());
        }
        $this->assertTrue(true);
    }
}

// Mock server for testing
class MockServer
{
    private array $responses = [];
    private int $requestCount = 0;

    public function addResponse(int $statusCode, array $body): void
    {
        $this->responses[] = ['statusCode' => $statusCode, 'body' => $body];
    }

    public function handleRequest(string $method, string $url, ?array $body = null): array
    {
        $this->requestCount++;
        $resp = array_shift($this->responses) ?? ['statusCode' => 200, 'body' => ['result' => null]];

        if ($resp['statusCode'] >= 400) {
            throw new VedaClientException("HTTP {$resp['statusCode']}");
        }

        return $resp['body'];
    }

    public function getRequestCount(): int
    {
        return $this->requestCount;
    }
}

// VedaClient implementation
class VedaClient
{
    private string $endpoint;
    private int $timeout;
    private int $maxRetries;
    private float $retryDelay;
    private ?string $authToken;
    private $transport;
    private bool $closed = false;
    private bool $healthy = false;

    public function __construct(string $endpoint, array $options = [])
    {
        $this->endpoint = rtrim($endpoint, '/');
        $this->timeout = $options['timeout'] ?? 10;
        $this->maxRetries = $options['max_retries'] ?? 3;
        $this->retryDelay = $options['retry_delay'] ?? 0.1;
        $this->authToken = $options['auth_token'] ?? null;
        $this->transport = $options['transport'] ?? null;
    }

    public function connect(): self
    {
        $this->healthy = true;
        return $this;
    }

    public function query(string $sql, ...$params): array
    {
        if ($this->closed) {
            throw new VedaClientException('Client is closed');
        }

        $body = ['sql' => $sql, 'params' => $params];
        $response = $this->sendWithRetry($body);

        if (isset($response['error']) && $response['error']) {
            throw new VedaClientException($response['error']);
        }

        return $response['result'] ?? [];
    }

    public function execute(string $sql, ...$params): ExecuteResult
    {
        if ($this->closed) {
            throw new VedaClientException('Client is closed');
        }

        $body = ['sql' => $sql, 'params' => $params];
        $response = $this->sendWithRetry($body);

        if (isset($response['error']) && $response['error']) {
            throw new VedaClientException($response['error']);
        }

        return new ExecuteResult($response['result'] ?? []);
    }

    public function close(): void
    {
        $this->closed = true;
    }

    public function isHealthy(): bool
    {
        return $this->healthy && !$this->closed;
    }

    public function isClosed(): bool
    {
        return $this->closed;
    }

    public function getEndpoint(): string { return $this->endpoint; }
    public function getTimeout(): int { return $this->timeout; }
    public function getMaxRetries(): int { return $this->maxRetries; }
    public function getAuthToken(): ?string { return $this->authToken; }

    private function sendWithRetry(array $body): array
    {
        $lastError = null;
        $delay = $this->retryDelay;

        for ($i = 0; $i <= $this->maxRetries; $i++) {
            if ($i > 0) {
                usleep((int)($delay * 1000000 * (2 ** ($i - 1))));
            }

            try {
                return ($this->transport)('POST', $this->endpoint . '/query', $body);
            } catch (VedaClientException $e) {
                $lastError = $e;
                continue;
            }
        }

        throw $lastError ?? new VedaClientException('Request failed');
    }
}

class ExecuteResult
{
    private int $rowsAffected;
    private $lastInsertId;

    public function __construct(array $result)
    {
        $this->rowsAffected = $result['rowsAffected'] ?? $result['rows_affected'] ?? 0;
        $this->lastInsertId = $result['lastInsertId'] ?? $result['last_insert_id'] ?? null;
    }

    public function getRowsAffected(): int { return $this->rowsAffected; }
    public function getLastInsertId() { return $this->lastInsertId; }
}

class VedaClientException extends \Exception {}
