using System;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;

namespace VedaDB;

/// <summary>
/// Low-level wire protocol handler for VedaDB communication.
/// Manages the TCP connection, TLS upgrade, and message framing.
/// </summary>
public class VedaProtocol : IDisposable, IAsyncDisposable
{
    private TcpClient? _tcp;
    private StreamReader? _reader;
    private StreamWriter? _writer;
    private Stream? _stream;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private bool _disposed;
    private bool _isAuthenticated;

    /// <summary>
    /// Server hostname or IP address.
    /// </summary>
    public string Host { get; }

    /// <summary>
    /// Server TCP port.
    /// </summary>
    public int Port { get; }

    /// <summary>
    /// Connection timeout in milliseconds.
    /// </summary>
    public int TimeoutMs { get; }

    /// <summary>
    /// Whether the connection uses TLS encryption.
    /// </summary>
    public bool IsTls { get; private set; }

    /// <summary>
    /// Whether the connection is currently active.
    /// </summary>
    public bool IsConnected => _tcp?.Connected ?? false;

    /// <summary>
    /// Whether the connection is authenticated.
    /// </summary>
    public bool IsAuthenticated => _isAuthenticated;

    /// <summary>
    /// Event raised when a message is sent.
    /// </summary>
    public event EventHandler<string>? MessageSent;

    /// <summary>
    /// Event raised when a message is received.
    /// </summary>
    public event EventHandler<string>? MessageReceived;

    /// <summary>
    /// Create a new protocol handler.
    /// </summary>
    public VedaProtocol(string host, int port, int timeoutMs = 30000)
    {
        Host = host;
        Port = port;
        TimeoutMs = timeoutMs;
    }

    /// <summary>
    /// Connect to the server.
    /// </summary>
    public async Task ConnectAsync(CancellationToken ct = default)
    {
        _tcp = new TcpClient();
        _tcp.SendTimeout = TimeoutMs;
        _tcp.ReceiveTimeout = TimeoutMs;
        _tcp.NoDelay = true;

        await _tcp.ConnectAsync(Host, Port);

        _stream = _tcp.GetStream();
        _reader = new StreamReader(_stream, Encoding.UTF8);
        _writer = new StreamWriter(_stream, Encoding.UTF8) { AutoFlush = true };

        // Read and discard welcome banner
        var welcome = await _reader.ReadLineAsync();
        if (welcome == null)
            throw new VedaConnectionException("Connection closed before welcome banner");
    }

    /// <summary>
    /// Connect synchronously.
    /// </summary>
    public void Connect()
    {
        _tcp = new TcpClient();
        _tcp.SendTimeout = TimeoutMs;
        _tcp.ReceiveTimeout = TimeoutMs;
        _tcp.NoDelay = true;

        _tcp.Connect(Host, Port);

        _stream = _tcp.GetStream();
        _reader = new StreamReader(_stream, Encoding.UTF8);
        _writer = new StreamWriter(_stream, Encoding.UTF8) { AutoFlush = true };

        var welcome = _reader.ReadLine();
        if (welcome == null)
            throw new VedaConnectionException("Connection closed before welcome banner");
    }

    /// <summary>
    /// Perform STARTTLS handshake and upgrade the connection to TLS.
    /// </summary>
    public async Task UpgradeToTlsAsync(string host, bool validateCertificate = true, CancellationToken ct = default)
    {
        if (_writer == null || _reader == null)
            throw new VedaConnectionException("Not connected");

        await _writer.WriteLineAsync("STARTTLS");

        var response = await _reader.ReadLineAsync() ?? throw new VedaConnectionException("Connection closed during STARTTLS");

        if (response.Contains("\"error\""))
            throw new VedaConnectionException($"STARTTLS failed: {response}");

        var sslStream = CreateSslStream(_tcp!.GetStream(), validateCertificate);
        await sslStream.AuthenticateAsClientAsync(new SslClientAuthenticationOptions
        {
            TargetHost = host,
            RemoteCertificateValidationCallback = validateCertificate ? null : (sender, cert, chain, errors) => true
        }, ct);

        _stream = sslStream;
        _reader = new StreamReader(_stream, Encoding.UTF8);
        _writer = new StreamWriter(_stream, Encoding.UTF8) { AutoFlush = true };
        IsTls = true;
    }

    /// <summary>
    /// Upgrade to TLS synchronously.
    /// </summary>
    public void UpgradeToTls(string host, bool validateCertificate = true)
    {
        if (_writer == null || _reader == null)
            throw new VedaConnectionException("Not connected");

        _writer.WriteLine("STARTTLS");

        var response = _reader.ReadLine()
            ?? throw new VedaConnectionException("Connection closed during STARTTLS");

        if (response.Contains("\"error\""))
            throw new VedaConnectionException($"STARTTLS failed: {response}");

        var sslStream = CreateSslStream(_tcp!.GetStream(), validateCertificate);
        sslStream.AuthenticateAsClient(host);

        _stream = sslStream;
        _reader = new StreamReader(_stream, Encoding.UTF8);
        _writer = new StreamWriter(_stream, Encoding.UTF8) { AutoFlush = true };
        IsTls = true;
    }

    private static SslStream CreateSslStream(Stream innerStream, bool validateCertificate)
    {
        RemoteCertificateValidationCallback? callback = null;
        if (!validateCertificate)
            callback = (sender, certificate, chain, sslPolicyErrors) => true;

        return new SslStream(innerStream, leaveInnerStreamOpen: false, callback);
    }

    /// <summary>
    /// Authenticate with the server using AUTH command.
    /// </summary>
    public async Task AuthenticateAsync(string username, string? password, CancellationToken ct = default)
    {
        if (_writer == null || _reader == null)
            throw new VedaConnectionException("Not connected");

        await _writer.WriteLineAsync($"AUTH {username} {password ?? ""}");

        var response = await _reader.ReadLineAsync() ?? throw new VedaConnectionException("Connection closed during AUTH");

        if (response.Contains("\"error\""))
            throw new VedaConnectionException($"Authentication failed: {response}");

        _isAuthenticated = true;
    }

    /// <summary>
    /// Authenticate synchronously.
    /// </summary>
    public void Authenticate(string username, string? password)
    {
        if (_writer == null || _reader == null)
            throw new VedaConnectionException("Not connected");

        _writer.WriteLine($"AUTH {username} {password ?? ""}");

        var response = _reader.ReadLine()
            ?? throw new VedaConnectionException("Connection closed during AUTH");

        if (response.Contains("\"error\""))
            throw new VedaConnectionException($"Authentication failed: {response}");

        _isAuthenticated = true;
    }

    /// <summary>
    /// Send a command and receive the response.
    /// </summary>
    public async Task<VedaResult> SendAsync(string command, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (_writer == null || _reader == null)
                throw new VedaConnectionException("Not connected");

            await _writer.WriteLineAsync(command);
            MessageSent?.Invoke(this, command);

            var response = await _reader.ReadLineAsync()
                ?? throw new VedaConnectionException("Connection closed");

            MessageReceived?.Invoke(this, response);

            return VedaResult.Parse(response);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Send a command synchronously.
    /// </summary>
    public VedaResult Send(string command)
    {
        _lock.Wait();
        try
        {
            if (_writer == null || _reader == null)
                throw new VedaConnectionException("Not connected");

            _writer.WriteLine(command);
            MessageSent?.Invoke(this, command);

            var response = _reader.ReadLine()
                ?? throw new VedaConnectionException("Connection closed");

            MessageReceived?.Invoke(this, response);

            return VedaResult.Parse(response);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Send a raw line without parsing.
    /// </summary>
    public async Task<string> SendRawAsync(string command, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (_writer == null || _reader == null)
                throw new VedaConnectionException("Not connected");

            await _writer.WriteLineAsync(command);
            MessageSent?.Invoke(this, command);

            var response = await _reader.ReadLineAsync()
                ?? throw new VedaConnectionException("Connection closed");

            MessageReceived?.Invoke(this, response);
            return response;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Reconnect to the server.
    /// </summary>
    public async Task ReconnectAsync(CancellationToken ct = default)
    {
        DisposeInternal();
        await ConnectAsync(ct);
    }

    /// <summary>
    /// Send a QUIT command and close the underlying connection.
    /// </summary>
    public async Task CloseAsync()
    {
        try
        {
            if (_writer != null)
                await _writer.WriteLineAsync("QUIT");
        }
        catch { /* Best effort */ }
        DisposeInternal();
    }

    private void DisposeInternal()
    {
        try { _reader?.Dispose(); } catch { }
        try { _writer?.Dispose(); } catch { }
        try { _tcp?.Dispose(); } catch { }
        _reader = null;
        _writer = null;
        _tcp = null;
        _stream = null;
        IsTls = false;
        _isAuthenticated = false;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        DisposeInternal();
        _lock.Dispose();
        GC.SuppressFinalize(this);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        DisposeInternal();
        _lock.Dispose();
        GC.SuppressFinalize(this);
    }
}
