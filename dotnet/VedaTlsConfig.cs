using System;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

namespace VedaDB;

/// <summary>
/// TLS/SSL configuration for VedaDB connections.
/// </summary>
public class VedaTlsConfig
{
    /// <summary>
    /// Whether to use TLS encryption.
    /// Default is true for security (HIGH-010 fix).
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Whether to validate the server certificate.
    /// Set to false only for development/testing.
    /// </summary>
    public bool ValidateCertificate { get; set; } = true;

    /// <summary>
    /// Path to a client certificate file (PFX format).
    /// </summary>
    public string? ClientCertificatePath { get; set; }

    /// <summary>
    /// Password for the client certificate.
    /// </summary>
    public string? ClientCertificatePassword { get; set; }

    /// <summary>
    /// Collection of custom root CA certificates for validation.
    /// </summary>
    public List<X509Certificate2> CustomRootCertificates { get; set; } = new();

    /// <summary>
    /// Allowed TLS protocol versions.
    /// </summary>
    public System.Security.Authentication.SslProtocols Protocols { get; set; } =
        System.Security.Authentication.SslProtocols.Tls12 |
        System.Security.Authentication.SslProtocols.Tls13;

    /// <summary>
    /// Cipher suites to allow (if supported by the runtime).
    /// </summary>
    public List<TlsCipherSuite>? CipherSuites { get; set; }

    /// <summary>
    /// Callback for remote certificate validation.
    /// If set, overrides ValidateCertificate.
    /// </summary>
    public RemoteCertificateValidationCallback? CertificateValidationCallback { get; set; }

    /// <summary>
    /// Create a TLS configuration with defaults (enabled with validation).
    /// </summary>
    public static VedaTlsConfig EnabledConfig() => new() { Enabled = true, ValidateCertificate = true };

    /// <summary>
    /// Create a TLS configuration for development (no validation).
    /// </summary>
    public static VedaTlsConfig DevelopmentConfig() => new() { Enabled = true, ValidateCertificate = false };

    /// <summary>
    /// Create a TLS configuration that is disabled.
    /// </summary>
    public static VedaTlsConfig DisabledConfig() => new() { Enabled = false };

    /// <summary>
    /// Load a client certificate from the specified path.
    /// </summary>
    public X509Certificate2? LoadClientCertificate()
    {
        if (string.IsNullOrEmpty(ClientCertificatePath)) return null;
        if (!string.IsNullOrEmpty(ClientCertificatePassword))
            return new X509Certificate2(ClientCertificatePath, ClientCertificatePassword);
        return new X509Certificate2(ClientCertificatePath);
    }
}
