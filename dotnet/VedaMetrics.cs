using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System;

namespace VedaDB;

/// <summary>
/// Metrics collector for VedaDB driver operations.
/// Emits Prometheus-compatible text format for scraping.
/// </summary>
public static class VedaMetrics
{
    private static readonly ConcurrentDictionary<string, long> _counters = new();
    private static readonly ConcurrentDictionary<string, double> _gauges = new();
    private static readonly ConcurrentDictionary<string, List<double>> _histograms = new();
    private static readonly ConcurrentDictionary<string, Stopwatch> _timers = new();

    /// <summary>
    /// Whether metrics collection is enabled.
    /// </summary>
    public static bool Enabled { get; set; } = true;

    /// <summary>
    /// Increment a counter metric.
    /// </summary>
    public static void Increment(string name, long value = 1, Dictionary<string, string>? labels = null)
    {
        if (!Enabled) return;
        var key = FormatKey(name, labels);
        _counters.AddOrUpdate(key, value, (_, existing) => existing + value);
    }

    /// <summary>
    /// Set a gauge metric.
    /// </summary>
    public static void Gauge(string name, double value, Dictionary<string, string>? labels = null)
    {
        if (!Enabled) return;
        var key = FormatKey(name, labels);
        _gauges[key] = value;
    }

    /// <summary>
    /// Record a value in a histogram.
    /// </summary>
    public static void Histogram(string name, double value, Dictionary<string, string>? labels = null)
    {
        if (!Enabled) return;
        var key = FormatKey(name, labels);
        _histograms.AddOrUpdate(key, _ => new List<double> { value }, (_, list) =>
        {
            lock (list) { list.Add(value); }
            return list;
        });
    }

    /// <summary>
    /// Start a timer for an operation.
    /// </summary>
    public static void TimerStart(string name)
    {
        if (!Enabled) return;
        _timers[name] = Stopwatch.StartNew();
    }

    /// <summary>
    /// Stop a timer and record the duration in seconds.
    /// </summary>
    public static double TimerStop(string name)
    {
        if (!Enabled || !_timers.TryRemove(name, out var sw)) return 0;
        sw.Stop();
        var seconds = sw.Elapsed.TotalSeconds;
        Histogram($"{name}_duration_seconds", seconds);
        return seconds;
    }

    /// <summary>
    /// Get all counter values.
    /// </summary>
    public static IReadOnlyDictionary<string, long> Counters => _counters;

    /// <summary>
    /// Get all gauge values.
    /// </summary>
    public static IReadOnlyDictionary<string, double> Gauges => _gauges;

    /// <summary>
    /// Reset all metrics.
    /// </summary>
    public static void Reset()
    {
        _counters.Clear();
        _gauges.Clear();
        _histograms.Clear();
        _timers.Clear();
    }

    /// <summary>
    /// Export metrics in Prometheus text format.
    /// </summary>
    public static string ExportPrometheus()
    {
        var sb = new StringBuilder();

        foreach (var (key, value) in _counters)
        {
            var (name, labels) = ParseKey(key);
            sb.AppendLine($"# TYPE {name} counter");
            if (labels != null)
                sb.AppendLine($"{name}{{{labels}}} {value}");
            else
                sb.AppendLine($"{name} {value}");
        }

        foreach (var (key, value) in _gauges)
        {
            var (name, labels) = ParseKey(key);
            sb.AppendLine($"# TYPE {name} gauge");
            if (labels != null)
                sb.AppendLine($"{name}{{{labels}}} {value}");
            else
                sb.AppendLine($"{name} {value}");
        }

        foreach (var (key, values) in _histograms)
        {
            var (name, labels) = ParseKey(key);
            sb.AppendLine($"# TYPE {name} histogram");
            double[] snapshot;
            lock (values) { snapshot = values.ToArray(); }

            var buckets = new[] { 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0 };
            foreach (var bucket in buckets)
            {
                var count = snapshot.Count(v => v <= bucket);
                var bucketLabel = labels != null
                    ? $"le=\"{bucket}\",{labels.TrimStart('}').TrimEnd('}')}"
                    : $"le=\"{bucket}\"";
                sb.AppendLine($"{name}_bucket{{{bucketLabel}}} {count}");
            }
            sb.AppendLine($"{name}_count {snapshot.Length}");
            if (snapshot.Length > 0)
                sb.AppendLine($"{name}_sum {snapshot.Sum()}");
        }

        return sb.ToString();
    }

    private static string FormatKey(string name, Dictionary<string, string>? labels)
    {
        if (labels == null || labels.Count == 0) return name;
        var labelStr = string.Join(",", labels.Select(kv => $"{kv.Key}=\"{kv.Value}\""));
        return $"{name}{{{labelStr}}}";
    }

    private static (string Name, string? Labels) ParseKey(string key)
    {
        var braceIdx = key.IndexOf('{');
        if (braceIdx < 0) return (key, null);
        return (key.Substring(0, braceIdx), key.Substring(braceIdx + 1, key.Length - braceIdx - 2));
    }
}
