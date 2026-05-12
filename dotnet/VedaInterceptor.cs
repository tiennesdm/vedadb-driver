using System;
namespace VedaDB;

/// <summary>
/// Context for intercepted operations.
/// </summary>
public class VedaInterceptorContext
{
    /// <summary>
    /// The SQL command being executed.
    /// </summary>
    public string Command { get; set; } = "";

    /// <summary>
    /// Parameters for the command.
    /// </summary>
    public object[] Parameters { get; set; } = Array.Empty<object>();

    /// <summary>
    /// Operation type (query, execute, etc.).
    /// </summary>
    public string Operation { get; set; } = "";

    /// <summary>
    /// Additional context data.
    /// </summary>
    public Dictionary<string, object> Data { get; set; } = new();

    /// <summary>
    /// Whether the operation was handled (skip further processing).
    /// </summary>
    public bool IsHandled { get; set; }

    /// <summary>
    /// Result to return if IsHandled is true.
    /// </summary>
    public VedaResult? HandledResult { get; set; }

    /// <summary>
    /// Exception to throw if IsHandled is true and this is set.
    /// </summary>
    public Exception? HandledException { get; set; }
}

/// <summary>
/// Middleware interceptor for VedaDB operations.
/// Allows cross-cutting concerns like logging, authentication, and rate limiting.
/// </summary>
public interface IVedaInterceptor
{
    /// <summary>
    /// Called before a command is executed.
    /// </summary>
    Task OnBeforeAsync(VedaInterceptorContext context, CancellationToken ct = default);

    /// <summary>
    /// Called after a command is executed.
    /// </summary>
    Task OnAfterAsync(VedaInterceptorContext context, VedaResult? result, TimeSpan duration, CancellationToken ct = default);

    /// <summary>
    /// Called when an exception occurs.
    /// </summary>
    Task OnErrorAsync(VedaInterceptorContext context, Exception exception, CancellationToken ct = default);
}

/// <summary>
/// Pipeline of interceptors that process operations in order.
/// </summary>
public class VedaInterceptorPipeline
{
    private readonly List<IVedaInterceptor> _interceptors = new();

    /// <summary>
    /// Add an interceptor to the pipeline.
    /// </summary>
    public VedaInterceptorPipeline Add(IVedaInterceptor interceptor)
    {
        _interceptors.Add(interceptor);
        return this;
    }

    /// <summary>
    /// Remove an interceptor from the pipeline.
    /// </summary>
    public VedaInterceptorPipeline Remove(IVedaInterceptor interceptor)
    {
        _interceptors.Remove(interceptor);
        return this;
    }

    /// <summary>
    /// Execute an operation through the interceptor pipeline.
    /// </summary>
    public async Task<VedaResult> ExecuteAsync(
        VedaInterceptorContext context,
        Func<CancellationToken, Task<VedaResult>> operation,
        CancellationToken ct = default)
    {
        // OnBefore
        foreach (var interceptor in _interceptors)
        {
            await interceptor.OnBeforeAsync(context, ct);
            if (context.IsHandled)
            {
                if (context.HandledException != null) throw context.HandledException;
                return context.HandledResult ?? throw new VedaInterceptorException("Interceptor set IsHandled but provided no result");
            }
        }

        var sw = System.Diagnostics.Stopwatch.StartNew();
        VedaResult? result = null;
        Exception? error = null;

        try
        {
            result = await operation(ct);
            return result;
        }
        catch (Exception ex)
        {
            error = ex;
            throw;
        }
        finally
        {
            sw.Stop();

            if (error != null)
            {
                foreach (var interceptor in _interceptors)
                {
                    try { await interceptor.OnErrorAsync(context, error, ct); } catch { /* Best effort */ }
                }
            }
            else
            {
                foreach (var interceptor in _interceptors)
                {
                    try { await interceptor.OnAfterAsync(context, result, sw.Elapsed, ct); } catch { /* Best effort */ }
                }
            }
        }
    }

    /// <summary>
    /// Number of interceptors in the pipeline.
    /// </summary>
    public int Count => _interceptors.Count;
}

/// <summary>
/// Built-in logging interceptor.
/// </summary>
public class VedaLoggingInterceptor : IVedaInterceptor
{
    private readonly Action<string> _logAction;

    /// <summary>
    /// Create a logging interceptor with the specified log action.
    /// </summary>
    public VedaLoggingInterceptor(Action<string> logAction)
    {
        _logAction = logAction;
    }

    /// <summary>
    /// Create a logging interceptor that writes to Console.
    /// </summary>
    public VedaLoggingInterceptor() : this(msg => Console.WriteLine($"[VedaDB] {msg}")) { }

    public Task OnBeforeAsync(VedaInterceptorContext context, CancellationToken ct = default)
    {
        _logAction($"Executing {context.Operation}: {context.Command}");
        return Task.CompletedTask;
    }

    public Task OnAfterAsync(VedaInterceptorContext context, VedaResult? result, TimeSpan duration, CancellationToken ct = default)
    {
        _logAction($"Completed {context.Operation} in {duration.TotalMilliseconds:F2}ms, rows: {result?.RowCount ?? 0}");
        return Task.CompletedTask;
    }

    public Task OnErrorAsync(VedaInterceptorContext context, Exception exception, CancellationToken ct = default)
    {
        _logAction($"Error in {context.Operation}: {exception.Message}");
        return Task.CompletedTask;
    }
}

/// <summary>
/// Built-in metrics interceptor.
/// </summary>
public class VedaMetricsInterceptor : IVedaInterceptor
{
    public Task OnBeforeAsync(VedaInterceptorContext context, CancellationToken ct = default)
    {
        return Task.CompletedTask;
    }

    public Task OnAfterAsync(VedaInterceptorContext context, VedaResult? result, TimeSpan duration, CancellationToken ct = default)
    {
        VedaMetrics.Histogram("vedadb_query_duration_seconds", duration.TotalSeconds,
            new() { { "operation", context.Operation } });
        VedaMetrics.Increment("vedadb_query_total", 1,
            new() { { "operation", context.Operation } });
        if (result?.RowCount > 0)
        {
            VedaMetrics.Gauge("vedadb_query_rows", result.RowCount,
                new() { { "operation", context.Operation } });
        }
        return Task.CompletedTask;
    }

    public Task OnErrorAsync(VedaInterceptorContext context, Exception exception, CancellationToken ct = default)
    {
        VedaMetrics.Increment("vedadb_query_errors", 1,
            new() { { "operation", context.Operation }, { "error_type", exception.GetType().Name } });
        return Task.CompletedTask;
    }
}

/// <summary>
/// Built-in retry interceptor.
/// </summary>
public class VedaRetryInterceptor : IVedaInterceptor
{
    private readonly VedaRetryPolicy _retryPolicy;

    public VedaRetryInterceptor(VedaRetryPolicy? retryPolicy = null)
    {
        _retryPolicy = retryPolicy ?? VedaRetryPolicy.Default;
    }

    public Task OnBeforeAsync(VedaInterceptorContext context, CancellationToken ct = default)
        => Task.CompletedTask;

    public Task OnAfterAsync(VedaInterceptorContext context, VedaResult? result, TimeSpan duration, CancellationToken ct = default)
        => Task.CompletedTask;

    public Task OnErrorAsync(VedaInterceptorContext context, Exception exception, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Execute with retry through this interceptor.
    /// </summary>
    public async Task<VedaResult> ExecuteWithRetryAsync(
        VedaInterceptorContext context,
        Func<CancellationToken, Task<VedaResult>> operation,
        CancellationToken ct = default)
    {
        return await _retryPolicy.ExecuteAsync(() => operation(ct), ct);
    }
}
