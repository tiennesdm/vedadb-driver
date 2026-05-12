using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

namespace VedaDB;

/// <summary>
/// Configuration for the VedaDB client.
/// </summary>
public class VedaConfig
{
    /// <summary>
    /// Server hostname. Default is "localhost".
    /// </summary>
    public string Host { get; set; } = "localhost";

    /// <summary>
    /// Server port. Default is 6380.
    /// </summary>
    public int Port { get; set; } = 6380;

    /// <summary>
    /// Connection timeout in milliseconds. Default is 30000.
    /// </summary>
    public int TimeoutMs { get; set; } = 30000;

    /// <summary>
    /// Username for authentication.
    /// </summary>
    public string? Username { get; set; }

    /// <summary>
    /// Password for authentication.
    /// </summary>
    public string? Password { get; set; }

    /// <summary>
    /// TLS configuration.
    /// </summary>
    public VedaTlsConfig? Tls { get; set; }

    /// <summary>
    /// Database name.
    /// </summary>
    public string? Database { get; set; }

    /// <summary>
    /// Connection pool minimum size. Default is 2.
    /// </summary>
    public int PoolMinSize { get; set; } = 2;

    /// <summary>
    /// Connection pool maximum size. Default is 20.
    /// </summary>
    public int PoolMaxSize { get; set; } = 20;

    /// <summary>
    /// Connection pool acquire timeout. Default is 10 seconds.
    /// </summary>
    public TimeSpan PoolAcquireTimeout { get; set; } = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Connection pool max idle time. Default is 5 minutes.
    /// </summary>
    public TimeSpan PoolMaxIdleTime { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Retry policy configuration. Null means no retries.
    /// </summary>
    public VedaRetryConfig? Retry { get; set; }

    /// <summary>
    /// Circuit breaker configuration. Null means no circuit breaker.
    /// </summary>
    public VedaCircuitBreakerConfig? CircuitBreaker { get; set; }

    /// <summary>
    /// Query cache configuration. Null means no caching.
    /// </summary>
    public VedaQueryCacheConfig? Cache { get; set; }

    /// <summary>
    /// Additional connection options.
    /// </summary>
    public Dictionary<string, string> Options { get; set; } = new();
}
