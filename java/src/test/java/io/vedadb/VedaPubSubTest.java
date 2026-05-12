package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import java.util.concurrent.BlockingQueue;

/**
 * Tests for VedaPubSub.
 */
public class VedaPubSubTest {

    @Test(expected = IllegalArgumentException.class)
    public void testSubscribeNoChannels() {
        VedaClient client = mock(VedaClient.class);
        VedaPubSub pubsub = new VedaPubSub(client);
        pubsub.subscribe();
    }

    @Test
    public void testSubscribeAndUnsubscribe() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");

        VedaPubSub pubsub = new VedaPubSub(client);
        BlockingQueue<VedaPubSub.VedaMessage> queue = pubsub.subscribe("orders");
        assertNotNull(queue);

        // Publish to local subscribers
        int delivered = pubsub.publish("orders", "New order #123");
        assertEquals(1, delivered);

        VedaPubSub.VedaMessage msg = queue.poll();
        assertNotNull(msg);
        assertEquals("orders", msg.getChannel());
        assertEquals("New order #123", msg.getPayload());
        assertTrue(msg.getTimestamp() > 0);

        pubsub.unsubscribe("orders");
        assertTrue(pubsub.getChannels().isEmpty());
    }

    @Test
    public void testPublishToMultipleSubscribers() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");

        VedaPubSub pubsub = new VedaPubSub(client);
        BlockingQueue<VedaPubSub.VedaMessage> q1 = pubsub.subscribe("ch1");
        BlockingQueue<VedaPubSub.VedaMessage> q2 = pubsub.subscribe("ch1");

        pubsub.publish("ch1", "hello");

        assertEquals("hello", q1.poll().getPayload());
        assertEquals("hello", q2.poll().getPayload());
    }

    @Test
    public void testMultiChannelSubscribe() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaPubSub pubsub = new VedaPubSub(client);
        BlockingQueue<VedaPubSub.VedaMessage> queue = pubsub.subscribe("ch1", "ch2");

        pubsub.publish("ch1", "msg1");
        pubsub.publish("ch2", "msg2");

        assertEquals("msg1", queue.poll().getPayload());
        assertEquals("msg2", queue.poll().getPayload());
    }

    @Test
    public void testPublishNoSubscribers() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");

        VedaPubSub pubsub = new VedaPubSub(client);
        int delivered = pubsub.publish("nobody_listening", "hello");
        assertEquals(0, delivered);
    }

    @Test
    public void testGetChannels() {
        VedaClient client = mock(VedaClient.class);
        VedaPubSub pubsub = new VedaPubSub(client);
        pubsub.subscribe("ch1", "ch2");

        assertEquals(2, pubsub.getChannels().size());
        assertTrue(pubsub.getChannels().contains("ch1"));
        assertTrue(pubsub.getChannels().contains("ch2"));
    }

    @Test
    public void testGetSubscriberCount() {
        VedaClient client = mock(VedaClient.class);
        VedaPubSub pubsub = new VedaPubSub(client);
        assertEquals(0, pubsub.getSubscriberCount("ch1"));

        pubsub.subscribe("ch1");
        assertEquals(1, pubsub.getSubscriberCount("ch1"));

        pubsub.subscribe("ch1");
        assertEquals(2, pubsub.getSubscriberCount("ch1"));
    }

    @Test
    public void testClose() {
        VedaClient client = mock(VedaClient.class);
        VedaPubSub pubsub = new VedaPubSub(client);
        pubsub.subscribe("ch1");
        pubsub.close();
        assertTrue(pubsub.isClosed());
        assertTrue(pubsub.getChannels().isEmpty());
    }

    @Test(expected = IllegalStateException.class)
    public void testPublishAfterClose() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaPubSub pubsub = new VedaPubSub(client);
        pubsub.close();
        pubsub.publish("ch1", "test");
    }

    @Test
    public void testUnsubscribeAll() {
        VedaClient client = mock(VedaClient.class);
        VedaPubSub pubsub = new VedaPubSub(client);
        pubsub.subscribe("ch1");
        pubsub.subscribe("ch2");
        pubsub.unsubscribe(); // no args = clear all
        assertEquals(0, pubsub.getChannels().size());
    }

    @Test
    public void testUnsubscribeQueue() {
        VedaClient client = mock(VedaClient.class);
        VedaPubSub pubsub = new VedaPubSub(client);
        BlockingQueue<VedaPubSub.VedaMessage> queue = pubsub.subscribe("ch1");
        pubsub.unsubscribe(queue);
        assertEquals(0, pubsub.getSubscriberCount("ch1"));
    }

    @Test
    public void testVedaMessageToString() {
        VedaPubSub.VedaMessage msg = new VedaPubSub.VedaMessage("orders", "test");
        assertTrue(msg.toString().contains("orders"));
        assertTrue(msg.toString().contains("test"));
    }

    @Test
    public void testVedaMessageTimestamp() {
        long before = System.currentTimeMillis();
        VedaPubSub.VedaMessage msg = new VedaPubSub.VedaMessage("ch", "payload");
        long after = System.currentTimeMillis();
        assertTrue(msg.getTimestamp() >= before);
        assertTrue(msg.getTimestamp() <= after);
    }
}
