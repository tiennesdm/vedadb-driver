<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Prometheus-compatible metrics collector for VedaDB operations.
 */
class VedaMetrics
{
    private string $namespace;

    /** @var array<string, array{value: float, labels: array<string, string>, timestamp: float}[]> */
    private array $gauges = [];

    /** @var array<string, array{count: float, sum: float, labels: array<string, string>}> */
    private array $histograms = [];

    /** @var array<string, float> */
    private array $counters = [];

    private float $startTime;

    /** @var array<string, array{count: int, total_time: float, errors: int}> */
    private array $queryStats = [];

    public function __construct(string $namespace = 'vedadb')
    {
        $this->namespace = $namespace;
        $this->startTime = microtime(true);
    }

    /**
     * Record a query execution.
     */
    public function recordQuery(string $operation, float $durationMs, bool $error = false, array $labels = []): void
    {
        $key = $operation;
        if (!isset($this->queryStats[$key])) {
            $this->queryStats[$key] = [
                'count'      => 0,
                'total_time' => 0.0,
                'errors'     => 0,
            ];
        }

        $this->queryStats[$key]['count']++;
        $this->queryStats[$key]['total_time'] += $durationMs;
        if ($error) {
            $this->queryStats[$key]['errors']++;
        }

        // Counter for total queries
        $counterKey = "{$this->namespace}_queries_total";
        $this->counters[$counterKey] = ($this->counters[$counterKey] ?? 0) + 1;

        // Histogram for duration
        $this->recordHistogram('query_duration_ms', $durationMs, array_merge(
            ['operation' => $operation],
            $labels,
        ));
    }

    /**
     * Record a gauge value.
     */
    public function recordGauge(string $name, float $value, array $labels = []): void
    {
        $key = "{$this->namespace}_{$name}";
        if (!isset($this->gauges[$key])) {
            $this->gauges[$key] = [];
        }

        $labelKey = $this->labelsKey($labels);
        $this->gauges[$key][$labelKey] = [
            'value'     => $value,
            'labels'    => $labels,
            'timestamp' => microtime(true),
        ];
    }

    /**
     * Record a histogram observation.
     */
    public function recordHistogram(string $name, float $value, array $labels = []): void
    {
        $key = "{$this->namespace}_{$name}";
        $labelKey = $this->labelsKey($labels);

        if (!isset($this->histograms[$key][$labelKey])) {
            $this->histograms[$key][$labelKey] = [
                'count'  => 0.0,
                'sum'    => 0.0,
                'labels' => $labels,
            ];
        }

        $this->histograms[$key][$labelKey]['count']++;
        $this->histograms[$key][$labelKey]['sum'] += $value;
    }

    /**
     * Increment a counter.
     */
    public function incrementCounter(string $name, float $amount = 1.0, array $labels = []): void
    {
        $key = "{$this->namespace}_{$name}";
        $labelKey = $this->labelsKey($labels);
        $fullKey = $key . '_' . $labelKey;
        $this->counters[$fullKey] = ($this->counters[$fullKey] ?? 0) + $amount;
    }

    /**
     * Record connection pool metrics.
     */
    public function recordPoolMetrics(int $active, int $idle, int $maxSize): void
    {
        $this->recordGauge('pool_active_connections', (float) $active);
        $this->recordGauge('pool_idle_connections', (float) $idle);
        $this->recordGauge('pool_max_connections', (float) $maxSize);
    }

    /**
     * Record circuit breaker state.
     */
    public function recordCircuitBreaker(string $name, string $state): void
    {
        $this->recordGauge('circuit_breaker_state', match ($state) {
            'closed'     => 0.0,
            'half_open'  => 1.0,
            'open'       => 2.0,
            default      => 3.0,
        }, ['name' => $name]);
    }

    /**
     * Record cache metrics.
     */
    public function recordCacheMetrics(int $hits, int $misses, int $size): void
    {
        $this->recordGauge('cache_hits_total', (float) $hits);
        $this->recordGauge('cache_misses_total', (float) $misses);
        $this->recordGauge('cache_size', (float) $size);

        $total = $hits + $misses;
        if ($total > 0) {
            $this->recordGauge('cache_hit_ratio', round($hits / $total, 4));
        }
    }

    /**
     * Export metrics in Prometheus text format.
     */
    public function exportPrometheus(): string
    {
        $lines = [];
        $lines[] = "# VedaDB PHP Driver Metrics";
        $lines[] = "# HELP {$this->namespace}_info Driver information";
        $lines[] = "# TYPE {$this->namespace}_info gauge";
        $lines[] = "{$this->namespace}_info{version=\"1.0.0\",language=\"php\"} 1";
        $lines[] = "";

        // Counters
        foreach ($this->counters as $key => $value) {
            $parts = explode('_', $key, 2);
            $metricName = $parts[0] . '_' . ($parts[1] ?? 'unknown');
            $lines[] = "# TYPE {$metricName} counter";
            $lines[] = "{$metricName} {$value}";
        }

        // Gauges
        foreach ($this->gauges as $name => $entries) {
            $lines[] = "# TYPE {$name} gauge";
            foreach ($entries as $entry) {
                $labelStr = $this->formatLabels($entry['labels']);
                $lines[] = "{$name}{$labelStr} {$entry['value']}";
            }
        }

        // Histograms
        foreach ($this->histograms as $name => $entries) {
            $lines[] = "# TYPE {$name} summary";
            foreach ($entries as $entry) {
                $labelStr = $this->formatLabels($entry['labels']);
                $lines[] = "{$name}_count{$labelStr} {$entry['count']}";
                $lines[] = "{$name}_sum{$labelStr} {$entry['sum']}";
            }
        }

        // Query stats
        foreach ($this->queryStats as $op => $stats) {
            $labelStr = "{operation=\"{$op}\"}";
            $lines[] = "# TYPE {$this->namespace}_query_total counter";
            $lines[] = "{$this->namespace}_query_total{$labelStr} {$stats['count']}";
            if ($stats['count'] > 0) {
                $avg = round($stats['total_time'] / $stats['count'], 3);
                $lines[] = "{$this->namespace}_query_duration_avg{$labelStr} {$avg}";
            }
            $lines[] = "{$this->namespace}_query_errors_total{$labelStr} {$stats['errors']}";
        }

        return implode("\n", $lines) . "\n";
    }

    /**
     * Get metrics as an array.
     */
    public function getMetrics(): array
    {
        return [
            'uptime_seconds'  => round(microtime(true) - $this->startTime, 3),
            'query_stats'     => $this->queryStats,
            'gauges'          => $this->gauges,
            'histograms'      => $this->histograms,
            'counters'        => $this->counters,
        ];
    }

    /**
     * Reset all metrics.
     */
    public function reset(): void
    {
        $this->gauges     = [];
        $this->histograms = [];
        $this->counters   = [];
        $this->queryStats = [];
    }

    private function labelsKey(array $labels): string
    {
        if (empty($labels)) {
            return '_default';
        }
        ksort($labels);
        return md5(implode(',', array_map(
            fn(string $k, string $v) => "{$k}={$v}",
            array_keys($labels),
            array_values($labels),
        )));
    }

    private function formatLabels(array $labels): string
    {
        if (empty($labels)) {
            return '';
        }
        $pairs = [];
        foreach ($labels as $k => $v) {
            $pairs[] = "{$k}=\"{$v}\"";
        }
        return '{' . implode(',', $pairs) . '}';
    }
}
