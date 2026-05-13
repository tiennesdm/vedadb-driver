using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using System;
using System.Diagnostics;
using System.Threading.Tasks;

namespace VedaDB
{
    public class VedaDBMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<VedaDBMiddleware> _logger;

        public VedaDBMiddleware(RequestDelegate next, ILogger<VedaDBMiddleware> logger)
        {
            _next = next ?? throw new ArgumentNullException(nameof(next));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        public async Task InvokeAsync(HttpContext context, VedaClient vedaClient, VedaPool pool)
        {
            var stopwatch = Stopwatch.StartNew();
            var requestId = context.TraceIdentifier ?? Guid.NewGuid().ToString("N");

            try
            {
                context.Items["VedaDB"] = vedaClient;
                context.Items["VedaPool"] = pool;

                if (!vedaClient.Ping())
                {
                    _logger.LogWarning("VedaDB health check failed for request {RequestId}", requestId);
                    context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                    await context.Response.WriteAsync("VedaDB unavailable");
                    return;
                }

                await _next(context);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Request {RequestId} failed with VedaDB error", requestId);
                try { vedaClient.Rollback(); } catch { }
                throw;
            }
            finally
            {
                stopwatch.Stop();
                _logger.LogDebug("Request {RequestId} completed in {ElapsedMs}ms - {Method} {Path}",
                    requestId, stopwatch.ElapsedMilliseconds, context.Request.Method, context.Request.Path);
            }
        }
    }
}
