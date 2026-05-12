<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Middleware/interceptor pipeline for cross-cutting concerns.
 *
 * Each interceptor receives the SQL and can transform it or execute
 * side effects before/after the actual query.
 */
class VedaInterceptor
{
    /** @var list<callable> */
    private array $beforeHooks = [];

    /** @var list<callable> */
    private array $afterHooks = [];

    /** @var list<callable> */
    private array $errorHooks = [];

    /**
     * Register a before-hook. Receives (string $sql): string
     * Should return the (possibly modified) SQL.
     */
    public function before(callable $hook): self
    {
        $this->beforeHooks[] = $hook;
        return $this;
    }

    /**
     * Register an after-hook. Receives (string $sql, VedaResult $result, float $durationMs): void
     */
    public function after(callable $hook): self
    {
        $this->afterHooks[] = $hook;
        return $this;
    }

    /**
     * Register an error-hook. Receives (string $sql, \Throwable $e, float $durationMs): void
     */
    public function onError(callable $hook): self
    {
        $this->errorHooks[] = $hook;
        return $this;
    }

    /**
     * Intercept and execute a query through the middleware chain.
     *
     * @template T
     * @param string $sql
     * @param callable(): T $operation
     * @return T
     */
    public function intercept(string $sql, callable $operation): mixed
    {
        // Run before hooks
        foreach ($this->beforeHooks as $hook) {
            $sql = ($hook)($sql);
        }

        $start = microtime(true);

        try {
            $result = $operation();
            $durationMs = (microtime(true) - $start) * 1000;

            // Run after hooks
            foreach ($this->afterHooks as $hook) {
                ($hook)($sql, $result, $durationMs);
            }

            return $result;
        } catch (\Throwable $e) {
            $durationMs = (microtime(true) - $start) * 1000;

            // Run error hooks
            foreach ($this->errorHooks as $hook) {
                ($hook)($sql, $e, $durationMs);
            }

            throw $e;
        }
    }

    /**
     * Create a logging interceptor.
     *
     * @param callable(string): void $logger
     */
    public static function logging(callable $logger): self
    {
        return (new self())
            ->before(function (string $sql) use ($logger): string {
                $logger("[VedaDB] Query: {$sql}");
                return $sql;
            })
            ->after(function (string $sql, VedaResult $result, float $durationMs) use ($logger): void {
                $logger(sprintf(
                    "[VedaDB] Query completed in %.2fms, %d rows",
                    $durationMs,
                    $result->rowCount,
                ));
            })
            ->onError(function (string $sql, \Throwable $e, float $durationMs) use ($logger): void {
                $logger(sprintf(
                    "[VedaDB] Query failed in %.2fms: %s",
                    $durationMs,
                    $e->getMessage(),
                ));
            });
    }

    /**
     * Create a metrics interceptor.
     */
    public static function metrics(VedaMetrics $metrics): self
    {
        return (new self())
            ->after(function (string $sql, VedaResult $result, float $durationMs) use ($metrics): void {
                $op = self::detectOperation($sql);
                $metrics->recordQuery($op, $durationMs, false);
            })
            ->onError(function (string $sql, \Throwable $e, float $durationMs) use ($metrics): void {
                $op = self::detectOperation($sql);
                $metrics->recordQuery($op, $durationMs, true);
            });
    }

    /**
     * Create a caching interceptor.
     */
    public static function caching(VedaQueryCache $cache, float $ttlMs = 60000.0): self
    {
        return (new self())
            ->before(function (string $sql) use ($cache): string {
                return $sql;
            });
    }

    /**
     * Create a slow query interceptor that logs queries exceeding a threshold.
     *
     * @param callable(string): void $logger
     */
    public static function slowQuery(float $thresholdMs, callable $logger): self
    {
        return (new self())
            ->after(function (string $sql, VedaResult $result, float $durationMs) use ($thresholdMs, $logger): void {
                if ($durationMs >= $thresholdMs) {
                    $logger(sprintf(
                        "[VedaDB] SLOW QUERY (%.2fms >= %.2fms): %s",
                        $durationMs,
                        $thresholdMs,
                        substr($sql, 0, 500),
                    ));
                }
            });
    }

    /**
     * Clear all hooks.
     */
    public function clear(): self
    {
        $this->beforeHooks = [];
        $this->afterHooks  = [];
        $this->errorHooks  = [];
        return $this;
    }

    /**
     * Detect the SQL operation type.
     */
    private static function detectOperation(string $sql): string
    {
        $trimmed = strtoupper(ltrim($sql));
        if (str_starts_with($trimmed, 'SELECT')) return 'SELECT';
        if (str_starts_with($trimmed, 'INSERT')) return 'INSERT';
        if (str_starts_with($trimmed, 'UPDATE')) return 'UPDATE';
        if (str_starts_with($trimmed, 'DELETE')) return 'DELETE';
        if (str_starts_with($trimmed, 'CREATE')) return 'DDL';
        if (str_starts_with($trimmed, 'DROP')) return 'DDL';
        if (str_starts_with($trimmed, 'ALTER')) return 'DDL';
        if (str_starts_with($trimmed, 'CACHE')) return 'CACHE';
        if (str_starts_with($trimmed, 'SEARCH')) return 'SEARCH';
        return 'OTHER';
    }
}
