package io.vedadb;

import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Publish/Subscribe messaging for VedaDB.
 *
 * <p>Implements a simple pub/sub pattern over VedaDB's LISTEN/NOTIFY
 * or channel-based message passing. Messages are delivered to
 * subscribers via blocking queues.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaPubSub pubsub = new VedaPubSub(client);
 * pubsub.publish("orders", "New order #123");
 *
 * BlockingQueue<VedaPubSub.VedaMessage> queue = pubsub.subscribe("orders", "updates");
 * VedaPubSub.VedaMessage msg = queue.take(); // blocking
 * System.out.println(msg.getChannel() + ": " + msg.getPayload());
 * pubsub.unsubscribe("orders");
 * }</pre>
 */
public class VedaPubSub {

    /**
     * Represents a pub/sub message.
     */
    public static class VedaMessage {
        private final String channel;
        private final String payload;
        private final long timestamp;

        public VedaMessage(String channel, String payload) {
            this(channel, payload, System.currentTimeMillis());
        }

        public VedaMessage(String channel, String payload, long timestamp) {
            this.channel = channel;
            this.payload = payload;
            this.timestamp = timestamp;
        }

        public String getChannel() { return channel; }
        public String getPayload() { return payload; }
        public long getTimestamp() { return timestamp; }

        @Override
        public String toString() {
            return "VedaMessage{channel='" + channel + "', payload='" + payload + "'}";
        }
    }

    private final VedaClient client;
    private final Map<String, Set<BlockingQueue<VedaMessage>>> subscriptions = new ConcurrentHashMap<>();
    private final AtomicBoolean closed = new AtomicBoolean(false);

    /**
     * Create a PubSub instance bound to a client.
     */
    public VedaPubSub(VedaClient client) {
        this.client = client;
    }

    /**
     * Publish a message to a channel.
     *
     * @param channel the channel name
     * @param message the message payload
     * @return number of subscribers that received the message
     * @throws IOException   on I/O error
     * @throws VedaException on VedaDB error
     */
    public int publish(String channel, String message) throws IOException, VedaException {
        if (closed.get()) {
            throw new IllegalStateException("PubSub is closed");
        }

        // Send to server
        client.exec("PUBLISH " + channel + " '" + message.replace("'", "''") + "'");

        // Also deliver to local subscribers
        Set<BlockingQueue<VedaMessage>> queues = subscriptions.get(channel);
        int delivered = 0;
        if (queues != null) {
            VedaMessage msg = new VedaMessage(channel, message);
            for (BlockingQueue<VedaMessage> queue : queues) {
                queue.offer(msg);
                delivered++;
            }
        }
        return delivered;
    }

    /**
     * Subscribe to one or more channels.
     *
     * @param channels channel names to subscribe to
     * @return a blocking queue that receives messages from all subscribed channels
     */
    public BlockingQueue<VedaMessage> subscribe(String... channels) {
        if (closed.get()) {
            throw new IllegalStateException("PubSub is closed");
        }
        if (channels == null || channels.length == 0) {
            throw new IllegalArgumentException("At least one channel is required");
        }

        BlockingQueue<VedaMessage> queue = new LinkedBlockingQueue<>();
        for (String channel : channels) {
            subscriptions.computeIfAbsent(channel, k -> ConcurrentHashMap.newKeySet()).add(queue);
        }
        return queue;
    }

    /**
     * Unsubscribe a queue from one or more channels.
     * If no channels specified, unsubscribes from all channels.
     *
     * @param channels channel names to unsubscribe from
     */
    public void unsubscribe(String... channels) {
        if (channels == null || channels.length == 0) {
            // Remove all subscriptions (clear all)
            subscriptions.clear();
            return;
        }
        for (String channel : channels) {
            subscriptions.remove(channel);
        }
    }

    /**
     * Remove a specific queue from subscriptions.
     *
     * @param queue the queue to remove
     */
    public void unsubscribe(BlockingQueue<VedaMessage> queue) {
        for (Set<BlockingQueue<VedaMessage>> queues : subscriptions.values()) {
            queues.remove(queue);
        }
    }

    /**
     * Get all subscribed channel names.
     */
    public Set<String> getChannels() {
        return new HashSet<>(subscriptions.keySet());
    }

    /**
     * Get the number of subscribers for a channel.
     */
    public int getSubscriberCount(String channel) {
        Set<BlockingQueue<VedaMessage>> queues = subscriptions.get(channel);
        return queues != null ? queues.size() : 0;
    }

    /**
     * Close the PubSub instance.
     */
    public void close() {
        closed.set(true);
        subscriptions.clear();
    }

    public boolean isClosed() {
        return closed.get();
    }
}
