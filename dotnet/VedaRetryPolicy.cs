using System;

namespace VedaDB;

/// <summary>
/// Configuration for retry behavior with exponential backoff.
/// </summary>
public class VedaRetryConfig
{
    /// <summary>
    /// Maximum number of retry attempts. Default is 3.
    /// </summary>
    public int MaxRetries { get; set; } = 3;

    /// <summary>
    /// Initial delay between retries in milliseconds. Default is 1000.
    /// </summary>
    public int InitialDelayMs { get; set; } = 1000;

    /// <summary>
    /// Backoff multiplier. Default is 2.0 (exponential).
    /// </summary>
    public double BackoffMultiplier { get; set; } = 2.0;

    /// <summary>
    /// Maximum delay between retries in milliseconds. Default is 30000.
    /// </summary>
    public int MaxDelayMs { get; set; } = 30000;

    /// <summary>
    /// Optional jitter factor (0.0 to 1.0) to randomize delays. Default is 0.1.
    /// </summary>
    public double JitterFactor { get; set; } = 0.1;

    /// <summary>
    /// Exception types that should trigger a retry.
    /// </summary>
    public List<Type> RetryableExceptions { get; set; } = new()
    {
        typeof(VedaConnectionException),
        typeof(TimeoutException),
        typeof(IOException)
    };

    /// <summary>
    /// Custom predicate to determine if an exception is retryable.
    /// </summary>
    public Func<Exception, bool>? IsRetryable { get; set; }
}

/// <summary>
/// Retry policy with exponential backoff for VedaDB operations.
/// </summary>
public class VedaRetryPolicy
{
    private readonly VedaRetryConfig _config;
    private readonly Random _random = new();

    /// <summary>
    /// Create a retry policy with default configuration.
    /// </summary>
    public VedaRetryPolicy() : this(new VedaRetryConfig()) { }

    /// <summary>
    /// Create a retry policy with the specified configuration.
    /// </summary>
    public VedaRetryPolicy(VedaRetryConfig config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
    }

    /// <summary>
    /// Execute an async operation with retry.
    /// </summary>
    public async Task<T> ExecuteAsync<T>(Func<Task<T>> operation, CancellationToken ct = default)
    {
        Exception? lastException = null;

        for (int attempt = 0; attempt <= _config.MaxRetries; attempt++)
        {
            try
            {
                VedaMetrics.TimerStart("vedadb_retry_operation");
                var result = await operation();
                VedaMetrics.TimerStop("vedadb_retry_operation");

                if (attempt > 0)
                    VedaMetrics.Increment("vedadb_retry_success_after_retry", 1, new() { { "attempts", attempt.ToString() } });

                return result;
            }
            catch (Exception ex)
            {
                lastException = ex;
                VedaMetrics.Increment("vedadb_retry_attempt", 1, new() { { "attempt", attempt.ToString() } });

                if (attempt == _config.MaxRetries || !IsRetryable(ex))
                    break;

                var delay = CalculateDelay(attempt);
                await Task.Delay(delay, ct);
            }
        }

        VedaMetrics.Increment("vedadb_retry_exhausted");
        throw new VedaRetryExhaustedException(
            $"Operation failed after {_config.MaxRetries + 1} attempts", lastException!);
    }

    /// <summary>
    /// Execute an async operation without a return value.
    /// </summary>
    public async Task ExecuteAsync(Func<Task> operation, CancellationToken ct = default)
    {
        await ExecuteAsync(async () => { await operation(); return true; }, ct);
    }

    /// <summary>
    /// Execute a sync operation with retry.
    /// </summary>
    public T Execute<T>(Func<T> operation)
    {
        Exception? lastException = null;

        for (int attempt = 0; attempt <= _config.MaxRetries; attempt++)
        {
            try
            {
                return operation();
            }
            catch (Exception ex)
            {
                lastException = ex;
                if (attempt == _config.MaxRetries || !IsRetryable(ex))
                    break;

                var delay = CalculateDelay(attempt);
                Thread.Sleep(delay);
            }
        }

        throw new VedaRetryExhaustedException(
            $"Operation failed after {_config.MaxRetries + 1} attempts", lastException!);
    }

    /// <summary>
    /// Calculate the delay for a given retry attempt.
    /// </summary>
    public TimeSpan CalculateDelay(int attempt)
    {
        var baseDelay = _config.InitialDelayMs * Math.Pow(_config.BackoffMultiplier, attempt);
        var cappedDelay = Math.Min(baseDelay, _config.MaxDelayMs);

        if (_config.JitterFactor > 0)
        {
            var jitter = cappedDelay * _config.JitterFactor * (_random.NextDouble() * 2 - 1);
            cappedDelay = Math.Max(1, cappedDelay + jitter);
        }

        return TimeSpan.FromMilliseconds(cappedDelay);
    }

    /// <summary>
    /// Check if an exception is retryable.
    /// </summary>
    public bool IsRetryable(Exception ex)
    {
        if (_config.IsRetryable != null)
            return _config.IsRetryable(ex);

        return _config.RetryableExceptions.Any(t => t.IsInstanceOfType(ex));
    }

    /// <summary>
    /// Create a default retry policy.
    /// </summary>
    public static VedaRetryPolicy Default => new();

    /// <summary>
    /// Create an aggressive retry policy with more retries and shorter delays.
    /// </summary>
    public static VedaRetryPolicy Aggressive => new(new VedaRetryConfig
    {
        MaxRetries = 5,
        InitialDelayMs = 500,
        BackoffMultiplier = 1.5
    });

    /// <summary>
    /// Create a conservative retry policy with fewer retries and longer delays.
    /// </summary>
    public static VedaRetryPolicy Conservative => new(new VedaRetryConfig
    {
        MaxRetries = 2,
        InitialDelayMs = 2000,
        BackoffMultiplier = 2.0,
        MaxDelayMs = 60000
    });
}
