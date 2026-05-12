using System;

namespace VedaDB;

/// <summary>
/// Parsed VedaDB connection URI.
/// </summary>
public class VedaUri
{
    /// <summary>
    /// Server host.
    /// </summary>
    public string Host { get; set; } = "localhost";

    /// <summary>
    /// Server port.
    /// </summary>
    public int Port { get; set; } = 6380;

    /// <summary>
    /// Username for authentication.
    /// </summary>
    public string? Username { get; set; }

    /// <summary>
    /// Password for authentication.
    /// </summary>
    public string? Password { get; set; }

    /// <summary>
    /// Database name.
    /// </summary>
    public string? Database { get; set; }

    /// <summary>
    /// Whether to use TLS.
    /// </summary>
    public bool UseTls { get; set; }

    /// <summary>
    /// Connection timeout in milliseconds.
    /// </summary>
    public int TimeoutMs { get; set; } = 30000;

    /// <summary>
    /// Connection pool minimum size.
    /// </summary>
    public int PoolMinSize { get; set; } = 2;

    /// <summary>
    /// Connection pool maximum size.
    /// </summary>
    public int PoolMaxSize { get; set; } = 20;

    /// <summary>
    /// Additional query parameters.
    /// </summary>
    public Dictionary<string, string> Options { get; set; } = new();
}

/// <summary>
/// Parses VedaDB connection URIs.
/// Format: vedadb://[user:pass@]host[:port][/database][?option=value&amp;...]
/// </summary>
public static class VedaUriParser
{
    /// <summary>
    /// Parse a VedaDB connection URI.
    /// </summary>
    /// <param name="uri">Connection URI string.</param>
    /// <returns>Parsed VedaUri object.</returns>
    /// <exception cref="VedaUriParseException">Thrown when the URI is invalid.</exception>
    public static VedaUri Parse(string uri)
    {
        if (string.IsNullOrWhiteSpace(uri))
            throw new VedaUriParseException("URI cannot be null or empty");

        var result = new VedaUri();

        var uriObj = new Uri(uri);

        // Scheme validation
        if (uriObj.Scheme != "vedadb" && uriObj.Scheme != "vedadbs")
            throw new VedaUriParseException($"Invalid scheme '{uriObj.Scheme}'. Expected 'vedadb' or 'vedadbs'");

        result.UseTls = uriObj.Scheme == "vedadbs";
        result.Host = uriObj.Host;
        if (uriObj.Port > 0)
            result.Port = uriObj.Port;

        // Parse credentials
        if (!string.IsNullOrEmpty(uriObj.UserInfo))
        {
            var parts = uriObj.UserInfo.Split(':', 2);
            result.Username = Uri.UnescapeDataString(parts[0]);
            if (parts.Length > 1)
                result.Password = Uri.UnescapeDataString(parts[1]);
        }

        // Parse database
        if (!string.IsNullOrEmpty(uriObj.AbsolutePath) && uriObj.AbsolutePath != "/")
            result.Database = uriObj.AbsolutePath.TrimStart('/');

        // Parse query parameters
        if (!string.IsNullOrEmpty(uriObj.Query))
        {
            var query = uriObj.Query.TrimStart('?');
            var pairs = query.Split('&');
            foreach (var pair in pairs)
            {
                var kv = pair.Split('=', 2);
                if (kv.Length != 2) continue;
                var key = Uri.UnescapeDataString(kv[0]).ToLowerInvariant();
                var value = Uri.UnescapeDataString(kv[1]);

                switch (key)
                {
                    case "timeout":
                        if (int.TryParse(value, out var timeout))
                            result.TimeoutMs = timeout;
                        break;
                    case "pool_min":
                        if (int.TryParse(value, out var poolMin))
                            result.PoolMinSize = poolMin;
                        break;
                    case "pool_max":
                        if (int.TryParse(value, out var poolMax))
                            result.PoolMaxSize = poolMax;
                        break;
                    default:
                        result.Options[key] = value;
                        break;
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Build a VedaConfig from a parsed URI.
    /// </summary>
    public static VedaConfig ToConfig(VedaUri uri)
    {
        var config = new VedaConfig
        {
            Host = uri.Host,
            Port = uri.Port,
            Username = uri.Username,
            Password = uri.Password,
            TimeoutMs = uri.TimeoutMs,
            Database = uri.Database,
            Tls = uri.UseTls ? VedaTlsConfig.EnabledConfig() : VedaTlsConfig.DisabledConfig(),
            PoolMinSize = uri.PoolMinSize,
            PoolMaxSize = uri.PoolMaxSize
        };

        foreach (var (key, value) in uri.Options)
        {
            config.Options[key] = value;
        }

        return config;
    }

    /// <summary>
    /// Parse a URI directly to a VedaConfig.
    /// </summary>
    public static VedaConfig ParseToConfig(string uri)
    {
        return ToConfig(Parse(uri));
    }
}
