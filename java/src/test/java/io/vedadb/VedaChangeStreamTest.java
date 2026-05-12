package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import java.util.Iterator;

/**
 * Tests for VedaChangeStream.
 */
public class VedaChangeStreamTest {

    @Test
    public void testCreateStream() {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, "users", "orders");
        assertNotNull(stream);
        assertEquals(0, stream.getBufferedCount());
        assertFalse(stream.isClosed());
    }

    @Test
    public void testCreateStreamWithTimeout() {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, 500, "users");
        assertNotNull(stream);
    }

    @Test
    public void testCreateStreamAllTables() {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client);
        assertNotNull(stream);
    }

    @Test
    public void testEmitAndPoll() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, "users");

        VedaChangeStream.VedaChangeEvent event = new VedaChangeStream.VedaChangeEvent(
            "users", VedaChangeStream.VedaChangeEvent.Operation.INSERT,
            null, "{\"id\":1}", System.currentTimeMillis(), 1);

        stream.emit(event);
        assertEquals(1, stream.getBufferedCount());

        VedaChangeStream.VedaChangeEvent polled = stream.poll(100);
        assertNotNull(polled);
        assertEquals("users", polled.getTable());
        assertEquals(VedaChangeStream.VedaChangeEvent.Operation.INSERT, polled.getOperation());
        assertEquals(1, polled.getLsn());

        assertEquals(0, stream.getBufferedCount());
    }

    @Test
    public void testPollTimeout() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, "users");
        VedaChangeStream.VedaChangeEvent result = stream.poll(50);
        assertNull(result);
    }

    @Test
    public void testPollAfterClose() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, "users");
        stream.close();
        assertTrue(stream.isClosed());
        VedaChangeStream.VedaChangeEvent result = stream.poll(100);
        assertNull(result);
    }

    @Test
    public void testClose() {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, "users");
        stream.close();
        assertTrue(stream.isClosed());
    }

    @Test
    public void testDoubleClose() {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, "users");
        stream.close();
        stream.close(); // should not throw
        assertTrue(stream.isClosed());
    }

    @Test
    public void testIterator() {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, "users");
        Iterator<VedaChangeStream.VedaChangeEvent> it = stream.iterator();
        assertSame(stream, it);
    }

    @Test
    public void testChangeEventToString() {
        VedaChangeStream.VedaChangeEvent event = new VedaChangeStream.VedaChangeEvent(
            "users", VedaChangeStream.VedaChangeEvent.Operation.UPDATE,
            "{\"id\":1}", "{\"id\":1,\"name\":\"Alice\"}",
            System.currentTimeMillis(), 42);
        String str = event.toString();
        assertTrue(str.contains("users"));
        assertTrue(str.contains("UPDATE"));
        assertTrue(str.contains("42"));
    }

    @Test
    public void testChangeEventGetters() {
        long ts = System.currentTimeMillis();
        VedaChangeStream.VedaChangeEvent event = new VedaChangeStream.VedaChangeEvent(
            "orders", VedaChangeStream.VedaChangeEvent.Operation.DELETE,
            "{\"id\":1}", null, ts, 99);

        assertEquals("orders", event.getTable());
        assertEquals(VedaChangeStream.VedaChangeEvent.Operation.DELETE, event.getOperation());
        assertEquals("{\"id\":1}", event.getBefore());
        assertNull(event.getAfter());
        assertEquals(ts, event.getTimestamp());
        assertEquals(99, event.getLsn());
    }

    @Test
    public void testEmitMultipleEvents() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaChangeStream stream = new VedaChangeStream(client, "users");

        for (int i = 0; i < 5; i++) {
            stream.emit(new VedaChangeStream.VedaChangeEvent(
                "users", VedaChangeStream.VedaChangeEvent.Operation.INSERT,
                null, "data" + i, System.currentTimeMillis(), i));
        }

        assertEquals(5, stream.getBufferedCount());
    }
}
