<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Health checker for VedaDB servers with periodic checks.
 */
class VedaHealthChecker
{
    private string $host;
    private int $port;
    private float $checkIntervalMs;
    private float $timeoutMs;
    private int $unhealthyThreshold;

    private bool $healthy = false;
    private int $consecutiveFailures = 0;
    private ?float $lastCheckTime = null;
    private ?string $lastError = null;
    private float $responseTimeMs = 0.0;

    /** @var resource|null */
    private $checkSocket = null;

    /** @var callable|null */
    private $onStateChange = null;

    public function __construct(
        string $host = 'localhost',
        int $port = 6380,
        float $checkIntervalMs = 10000.0,
        float $timeoutMs = 5000.0,
        int $unhealthyThreshold = 3,
    ) {
        $this->host               = $host;
        $this->port               = $port;
        $this->checkIntervalMs    = $checkIntervalMs;
        $this->timeoutMs          = $timeoutMs;
        $this->unhealthyThreshold = max(1, $unhealthyThreshold);
    }

    /**
     * Register a state change callback.
     *
     * @param callable(bool $healthy, string $host, int $port): void $callback
     */
    public function onStateChange(callable $callback): void
    {
        $this->onStateChange = $callback;
    }

    /**
     * Perform a health check.
     */
    public function check(): bool
    {
        $start = microtime(true);

        try {
            $errno  = 0;
            $errstr = '';
            $socket = @stream_socket_client(
                "tcp://{$this->host}:{$this->port}",
                $errno,
                $errstr,
                $this->timeoutMs / 1000,
            );

            if ($socket === false) {
                $this->recordFailure("Connection failed: {$errstr}");
                return false;
            }

            stream_set_timeout($socket, (int) ($this->timeoutMs / 1000));

            // Read welcome banner
            $banner = @fgets($socket);
            if ($banner === false) {
                @fclose($socket);
                $this->recordFailure('No welcome banner received');
                return false;
            }

            // Send ping
            $written = @fwrite($socket, "SHOW TABLES;\n");
            if ($written === false) {
                @fclose($socket);
                $this->recordFailure('Failed to send ping query');
                return false;
            }

            $response = @fgets($socket);
            @fclose($socket);

            if ($response === false) {
                $this->recordFailure('No response to ping');
                return false;
            }

            $data = json_decode(trim($response), true);
            if (!is_array($data)) {
                $this->recordFailure('Invalid JSON response');
                return false;
            }

            $this->responseTimeMs = (microtime(true) - $start) * 1000;
            $this->recordSuccess();
            return true;
        } catch (\Throwable $e) {
            $this->responseTimeMs = (microtime(true) - $start) * 1000;
            $this->recordFailure($e->getMessage());
            return false;
        }
    }

    /**
     * Check if enough time has passed for a new check.
     */
    public function shouldCheck(): bool
    {
        if ($this->lastCheckTime === null) {
            return true;
        }
        $elapsed = (microtime(true) * 1000) - $this->lastCheckTime;
        return $elapsed >= $this->checkIntervalMs;
    }

    /**
     * Perform check only if the interval has elapsed.
     */
    public function checkIfNeeded(): bool
    {
        if (!$this->shouldCheck()) {
            return $this->healthy;
        }
        return $this->check();
    }

    private function recordSuccess(): void
    {
        $wasHealthy    = $this->healthy;
        $this->healthy = true;
        $this->consecutiveFailures = 0;
        $this->lastError = null;
        $this->lastCheckTime = microtime(true) * 1000;

        if (!$wasHealthy && $this->onStateChange !== null) {
            ($this->onStateChange)(true, $this->host, $this->port);
        }
    }

    private function recordFailure(string $error): void
    {
        $wasHealthy = $this->healthy;
        $this->consecutiveFailures++;
        $this->lastError = $error;
        $this->lastCheckTime = microtime(true) * 1000;

        if ($this->consecutiveFailures >= $this->unhealthyThreshold) {
            $this->healthy = false;
            if ($wasHealthy && $this->onStateChange !== null) {
                ($this->onStateChange)(false, $this->host, $this->port);
            }
        }
    }

    public function isHealthy(): bool
    {
        return $this->healthy;
    }

    public function getLastError(): ?string
    {
        return $this->lastError;
    }

    public function getResponseTimeMs(): float
    {
        return $this->responseTimeMs;
    }

    public function getConsecutiveFailures(): int
    {
        return $this->consecutiveFailures;
    }

    public function getMetrics(): array
    {
        return [
            'host'                    => $this->host,
            'port'                    => $this->port,
            'healthy'                 => $this->healthy,
            'response_time_ms'        => round($this->responseTimeMs, 3),
            'consecutive_failures'    => $this->consecutiveFailures,
            'last_error'              => $this->lastError,
            'last_check_time'         => $this->lastCheckTime,
            'check_interval_ms'       => $this->checkIntervalMs,
        ];
    }
}
