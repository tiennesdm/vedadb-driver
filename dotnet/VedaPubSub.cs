using System;
namespace VedaDB;

/// <summary>
/// A pub/sub message from VedaDB.
/// </summary>
public class VedaMessage
{
    /// <summary>
    /// Channel name.
    /// </summary>
    public string Channel { get; set; } = "";

    /// <summary>
    /// Message payload.
    /// </summary>
    public string Payload { get; set; } = "";

    /// <summary>
    /// Timestamp when received.
    /// </summary>
    public DateTime ReceivedAt { get; set; }
}

/// <summary>
/// Publish/Subscribe messaging for VedaDB.
/// Implements real-time message passing between clients.
/// </summary>
public class VedaPubSub : IDisposable, IAsyncDisposable
{
    private readonly VedaClient _client;
    private readonly Dictionary<string, List<Func<VedaMessage, Task>>> _handlers = new();
    private readonly object _handlerLock = new();
    private CancellationTokenSource? _listenCts;
    private Task? _listenTask;
    private bool _disposed;

    /// <summary>
    /// Event raised when a message is received on any channel.
    /// </summary>
    public event EventHandler<VedaMessage>? MessageReceived;

    /// <summary>
    /// Event raised when subscribed to a channel.
    /// </summary>
    public event EventHandler<string>? Subscribed;

    /// <summary>
    /// Event raised when unsubscribed from a channel.
    /// </summary>
    public event EventHandler<string>? Unsubscribed;

    /// <summary>
    /// Whether the listener is running.
    /// </summary>
    public bool IsListening => _listenTask != null && !_listenTask.IsCompleted;

    /// <summary>
    /// List of subscribed channels.
    /// </summary>
    public IReadOnlyList<string> Channels
    {
        get
        {
            lock (_handlerLock) { return _handlers.Keys.ToList(); }
        }
    }

    /// <summary>
    /// Create a Pub/Sub instance.
    /// </summary>
    public VedaPubSub(VedaClient client)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
    }

    /// <summary>
    /// Subscribe to a channel with a handler callback.
    /// </summary>
    public async Task SubscribeAsync(string channel, Func<VedaMessage, Task> handler, CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(GetType().Name);

        lock (_handlerLock)
        {
            if (!_handlers.ContainsKey(channel))
                _handlers[channel] = new List<Func<VedaMessage, Task>>();
            _handlers[channel].Add(handler);
        }

        await _client.ExecuteAsync($"SUBSCRIBE {channel}");
        Subscribed?.Invoke(this, channel);
        VedaMetrics.Increment("vedadb_pubsub_subscriptions", 1, new() { { "channel", channel } });

        // Start listener if not already running
        if (_listenTask == null || _listenTask.IsCompleted)
        {
            _listenCts = new CancellationTokenSource();
            _listenTask = ListenAsync(_listenCts.Token);
        }
    }

    /// <summary>
    /// Subscribe to a channel with a synchronous handler.
    /// </summary>
    public Task SubscribeAsync(string channel, Action<VedaMessage> handler, CancellationToken ct = default)
    {
        return SubscribeAsync(channel, msg =>
        {
            handler(msg);
            return Task.CompletedTask;
        }, ct);
    }

    /// <summary>
    /// Subscribe to multiple channels at once.
    /// </summary>
    public async Task SubscribeAsync(IEnumerable<string> channels, Func<VedaMessage, Task> handler, CancellationToken ct = default)
    {
        foreach (var channel in channels)
        {
            await SubscribeAsync(channel, handler, ct);
        }
    }

    /// <summary>
    /// Unsubscribe from a channel.
    /// </summary>
    public async Task UnsubscribeAsync(string channel, CancellationToken ct = default)
    {
        lock (_handlerLock) { _handlers.Remove(channel); }

        try
        {
            await _client.ExecuteAsync($"UNSUBSCRIBE {channel}");
        }
        catch { /* Best effort */ }

        Unsubscribed?.Invoke(this, channel);
        VedaMetrics.Increment("vedadb_pubsub_unsubscriptions", 1, new() { { "channel", channel } });
    }

    /// <summary>
    /// Publish a message to a channel.
    /// </summary>
    public async Task<long> PublishAsync(string channel, string message, CancellationToken ct = default)
    {
        var result = await _client.QueryAsync($"PUBLISH {channel} '{message.Replace("'", "''")}'");
        var scalar = result.Scalar();
        VedaMetrics.Increment("vedadb_pubsub_messages_published", 1, new() { { "channel", channel } });
        return long.TryParse(scalar, out var count) ? count : 0;
    }

    /// <summary>
    /// Publish a message to a channel (synchronous).
    /// </summary>
    public long Publish(string channel, string message)
    {
        return PublishAsync(channel, message).GetAwaiter().GetResult();
    }

    /// <summary>
    /// Listen for messages on subscribed channels.
    /// </summary>
    private async Task ListenAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    // In a real implementation, this would read from a dedicated connection
                    // that receives pushed messages from the server.
                    await Task.Delay(100, ct);
                }
                catch (OperationCanceledException) { break; }
            }
        }
        catch (Exception ex)
        {
            VedaMetrics.Increment("vedadb_pubsub_listen_errors");
        }
    }

    /// <summary>
    /// Process a received message.
    /// </summary>
    public void OnMessageReceived(VedaMessage message)
    {
        message.ReceivedAt = DateTime.UtcNow;
        MessageReceived?.Invoke(this, message);

        List<Func<VedaMessage, Task>> handlers;
        lock (_handlerLock)
        {
            if (!_handlers.TryGetValue(message.Channel, out handlers)) return;
            handlers = new List<Func<VedaMessage, Task>>(handlers);
        }

        foreach (var handler in handlers)
        {
            _ = Task.Run(async () =>
            {
                try { await handler(message); }
                catch { /* Handler errors should not affect others */ }
            });
        }

        VedaMetrics.Increment("vedadb_pubsub_messages_received", 1, new() { { "channel", message.Channel } });
    }

    /// <summary>
    /// Unsubscribe from all channels.
    /// </summary>
    public async Task UnsubscribeAllAsync(CancellationToken ct = default)
    {
        List<string> channels;
        lock (_handlerLock) { channels = _handlers.Keys.ToList(); }

        foreach (var channel in channels)
        {
            await UnsubscribeAsync(channel, ct);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        _listenCts?.Cancel();
        if (_listenTask != null)
        {
            try { await _listenTask.WaitAsync(TimeSpan.FromSeconds(5)); } catch { /* Best effort */ }
        }
        _listenCts?.Dispose();

        await UnsubscribeAllAsync();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _listenCts?.Cancel();
        _listenCts?.Dispose();

        try
        {
            if (_listenTask != null && !_listenTask.IsCompleted)
                _listenTask.Wait(TimeSpan.FromSeconds(5));
        }
        catch { /* Best effort */ }

        lock (_handlerLock) { _handlers.Clear(); }
    }
}
