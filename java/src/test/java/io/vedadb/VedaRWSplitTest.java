package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import java.io.IOException;

/**
 * Tests for VedaRWSplit.
 */
public class VedaRWSplitTest {

    @Test(expected = NullPointerException.class)
    public void testNullPrimary() {
        new VedaRWSplit(null);
    }

    @Test
    public void testCreate() {
        VedaClient primary = mock(VedaClient.class);
        VedaRWSplit split = new VedaRWSplit(primary);
        assertNotNull(split);
        assertSame(primary, split.getPrimary());
        assertEquals(0, split.getReplicaCount());
        assertFalse(split.hasReplicas());
    }

    @Test
    public void testAddRemoveReplica() {
        VedaClient primary = mock(VedaClient.class);
        VedaClient replica = mock(VedaClient.class);

        VedaRWSplit split = new VedaRWSplit(primary);
        split.addReplica(replica);

        assertEquals(1, split.getReplicaCount());
        assertTrue(split.hasReplicas());

        split.removeReplica(replica);
        assertEquals(0, split.getReplicaCount());
        assertFalse(split.hasReplicas());
    }

    @Test
    public void testWriteGoesToPrimary() throws Exception {
        VedaClient primary = mock(VedaClient.class);
        when(primary.exec(anyString())).thenReturn("OK");

        VedaRWSplit split = new VedaRWSplit(primary);
        String result = split.exec("INSERT INTO t VALUES (1);");

        assertEquals("OK", result);
        verify(primary).exec("INSERT INTO t VALUES (1);");
    }

    @Test
    public void testReadWithNoReplicas() throws Exception {
        VedaClient primary = mock(VedaClient.class);
        VedaResult mockResult = new VedaResult();
        when(primary.query(anyString())).thenReturn(mockResult);

        VedaRWSplit split = new VedaRWSplit(primary);
        VedaResult result = split.query("SELECT * FROM t;");

        assertSame(mockResult, result);
        verify(primary).query("SELECT * FROM t;");
    }

    @Test
    public void testReadOperation() throws Exception {
        VedaClient primary = mock(VedaClient.class);
        VedaClient replica = mock(VedaClient.class);
        VedaResult mockResult = new VedaResult();

        when(replica.ping()).thenReturn(true);
        when(replica.query(anyString())).thenReturn(mockResult);

        VedaRWSplit split = new VedaRWSplit(primary);
        split.addReplica(replica);

        VedaResult result = split.read(client -> client.query("SELECT 1;"));
        assertSame(mockResult, result);
    }

    @Test
    public void testWriteOperation() throws Exception {
        VedaClient primary = mock(VedaClient.class);
        when(primary.exec(anyString())).thenReturn("OK");

        VedaRWSplit split = new VedaRWSplit(primary);
        String result = split.write(client -> client.exec("UPDATE t SET x=1;"));
        assertEquals("OK", result);
    }

    @Test
    public void testAddNullReplica() {
        VedaClient primary = mock(VedaClient.class);
        VedaRWSplit split = new VedaRWSplit(primary);
        split.addReplica(null); // should be silently ignored
        assertEquals(0, split.getReplicaCount());
    }

    @Test
    public void testGetReplicas() {
        VedaClient primary = mock(VedaClient.class);
        VedaClient replica = mock(VedaClient.class);
        VedaRWSplit split = new VedaRWSplit(primary);
        split.addReplica(replica);

        assertEquals(1, split.getReplicas().size());
        assertTrue(split.getReplicas().contains(replica));
    }

    @Test
    public void testPickRandomReplica() {
        VedaClient primary = mock(VedaClient.class);
        VedaClient replica = mock(VedaClient.class);
        VedaRWSplit split = new VedaRWSplit(primary);
        split.addReplica(replica);

        // With no replicas healthy, falls back to primary
        assertSame(primary, split.pickRandomReplica());
    }
}
