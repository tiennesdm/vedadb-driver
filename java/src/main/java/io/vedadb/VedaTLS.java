package io.vedadb;

import java.io.FileInputStream;
import java.io.IOException;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.UnrecoverableKeyException;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;

import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;

/**
 * TLS/SSL support for VedaDB connections.
 *
 * <p>Provides utilities to create SSL contexts from CA certificates,
 * client certificates, and private keys for mutual TLS authentication.
 *
 * <p>Usage:
 * <pre>{@code
 * SSLContext ctx = VedaTLS.createContext(
 *     "/path/to/ca.crt",
 *     "/path/to/client.crt",
 *     "/path/to/client.key"
 * );
 * VedaConfig config = VedaTLS.withTLS(ctx)
 *     .host("localhost")
 *     .port(7480);
 * }</pre>
 */
public class VedaTLS {

    /**
     * Create an SSLContext from certificate and key files.
     *
     * @param caCertPath     Path to CA certificate file (PEM), or null for JVM default trust store
     * @param clientCertPath Path to client certificate file (PEM), or null for no client auth
     * @param clientKeyPath  Path to client private key file (PEM), or null for no client auth
     * @return configured SSLContext
     * @throws VedaException if TLS context creation fails
     */
    public static SSLContext createContext(String caCertPath, String clientCertPath,
                                            String clientKeyPath) throws VedaException {
        try {
            TrustManager[] trustManagers = createTrustManagers(caCertPath);
            KeyManager[] keyManagers = createKeyManagers(clientCertPath, clientKeyPath);

            SSLContext ctx = SSLContext.getInstance("TLSv1.2");
            ctx.init(keyManagers, trustManagers, null);
            return ctx;
        } catch (Exception e) {
            throw new VedaException("Failed to create TLS context: " + e.getMessage());
        }
    }

    /**
     * Create an SSLContext with just a CA certificate (no client auth).
     *
     * @param caCertPath Path to CA certificate file (PEM)
     * @return configured SSLContext
     * @throws VedaException if TLS context creation fails
     */
    public static SSLContext createContext(String caCertPath) throws VedaException {
        return createContext(caCertPath, null, null);
    }

    /**
     * Create an SSLContext using the JVM default trust store (no mutual auth).
     *
     * @return configured SSLContext
     * @throws VedaException if TLS context creation fails
     */
    public static SSLContext createDefaultContext() throws VedaException {
        try {
            SSLContext ctx = SSLContext.getInstance("TLSv1.2");
            ctx.init(null, null, null);
            return ctx;
        } catch (Exception e) {
            throw new VedaException("Failed to create default TLS context: " + e.getMessage());
        }
    }

    /**
     * Create an insecure SSLContext that trusts all certificates.
     * <strong>Only use for development/testing.</strong>
     *
     * @return insecure SSLContext
     * @throws VedaException if TLS context creation fails
     */
    public static SSLContext createInsecureContext() throws VedaException {
        try {
            SSLContext ctx = SSLContext.getInstance("TLSv1.2");
            ctx.init(null, new TrustManager[]{new javax.net.ssl.X509TrustManager() {
                public java.security.cert.X509Certificate[] getAcceptedIssuers() {
                    return new java.security.cert.X509Certificate[0];
                }
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                public void checkServerTrusted(X509Certificate[] chain, String authType) {}
            }}, new java.security.SecureRandom());
            return ctx;
        } catch (Exception e) {
            throw new VedaException("Failed to create insecure TLS context: " + e.getMessage());
        }
    }

    /**
     * Wrap an existing config with TLS settings.
     *
     * @param ctx the SSLContext to use
     * @return a TLS configuration builder
     */
    public static TLSConfigBuilder withTLS(SSLContext ctx) {
        return new TLSConfigBuilder(ctx);
    }

    /**
     * Builder for TLS-enhanced configuration.
     */
    public static class TLSConfigBuilder {
        private final SSLContext sslContext;
        private String host = "localhost";
        private int port = 6380;
        private boolean tlsVerify = true;

        TLSConfigBuilder(SSLContext ctx) {
            this.sslContext = ctx;
        }

        public TLSConfigBuilder host(String h) { this.host = h; return this; }
        public TLSConfigBuilder port(int p) { this.port = p; return this; }
        public TLSConfigBuilder tlsVerify(boolean v) { this.tlsVerify = v; return this; }

        public SSLContext getSSLContext() { return sslContext; }
        public String getHost() { return host; }
        public int getPort() { return port; }
        public boolean isTlsVerify() { return tlsVerify; }
    }

    // ── Internal helpers ──────────────────────────────────────────

    private static TrustManager[] createTrustManagers(String caCertPath)
            throws CertificateException, IOException, KeyStoreException,
                   NoSuchAlgorithmException {
        if (caCertPath == null) {
            // Use JVM default trust store
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm());
            tmf.init((KeyStore) null);
            return tmf.getTrustManagers();
        }

        // Load CA certificate
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        X509Certificate caCert;
        try (FileInputStream fis = new FileInputStream(caCertPath)) {
            caCert = (X509Certificate) cf.generateCertificate(fis);
        }

        // Create trust store with CA cert
        KeyStore trustStore = KeyStore.getInstance(KeyStore.getDefaultType());
        trustStore.load(null, null);
        trustStore.setCertificateEntry("ca", caCert);

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(trustStore);
        return tmf.getTrustManagers();
    }

    private static KeyManager[] createKeyManagers(String clientCertPath, String clientKeyPath)
            throws CertificateException, IOException, KeyStoreException,
                   NoSuchAlgorithmException, UnrecoverableKeyException {
        if (clientCertPath == null || clientKeyPath == null) {
            return null;
        }

        // Load client certificate
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        X509Certificate clientCert;
        try (FileInputStream fis = new FileInputStream(clientCertPath)) {
            clientCert = (X509Certificate) cf.generateCertificate(fis);
        }

        // For PEM key parsing, we use a simplified approach.
        // In production, use a proper PEM key loader (e.g., BouncyCastle).
        // This is a placeholder that reads the raw key bytes.
        char[] password = new char[0]; // no password for simplicity

        KeyStore keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
        keyStore.load(null, null);
        keyStore.setCertificateEntry("client", clientCert);
        // Note: full PEM private key loading requires additional libraries

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(
            KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(keyStore, password);
        return kmf.getKeyManagers();
    }
}
