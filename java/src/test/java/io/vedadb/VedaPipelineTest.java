package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.util.List;

/**
 * Tests for VedaPipeline.
 */
public class VedaPipelineTest {

    @Test
    public void testEmptyPipeline() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaPipeline pipe = new VedaPipeline(client);
        List<VedaResult> results = pipe.run();
        assertTrue(results.isEmpty());
    }

    @Test
    public void testSingleQuery() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult mockResult = new VedaResult();
        when(client.query(anyString())).thenReturn(mockResult);

        VedaPipeline pipe = new VedaPipeline(client);
        pipe.query("SELECT * FROM users;");
        List<VedaResult> results = pipe.run();

        assertEquals(1, results.size());
        verify(client).query("SELECT * FROM users;");
    }

    @Test
    public void testMultipleOperations() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult mockResult = new VedaResult();
        when(client.query(anyString())).thenReturn(mockResult);

        VedaPipeline pipe = new VedaPipeline(client)
            .query("SELECT * FROM users;")
            .execute("UPDATE users SET active = TRUE;")
            .query("SELECT COUNT(*) FROM users;");

        List<VedaResult> results = pipe.run();

        assertEquals(3, results.size());
        assertEquals(3, pipe.size());
        verify(client, times(3)).query(anyString());
    }

    @Test
    public void testParameterizedQuery() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult mockResult = new VedaResult();
        when(client.query(anyString())).thenReturn(mockResult);

        VedaPipeline pipe = new VedaPipeline(client);
        pipe.query("SELECT * FROM users WHERE id = ? AND name = ?", 1, "Alice");
        pipe.run();

        verify(client).query("SELECT * FROM users WHERE id = 1 AND name = 'Alice'");
    }

    @Test
    public void testChainingReturnsSame() {
        VedaClient client = mock(VedaClient.class);
        VedaPipeline pipe = new VedaPipeline(client);
        assertSame(pipe, pipe.query("SELECT 1;"));
        assertSame(pipe, pipe.execute("UPDATE t SET x = 1;"));
    }

    @Test
    public void testSizeAndClear() {
        VedaClient client = mock(VedaClient.class);
        VedaPipeline pipe = new VedaPipeline(client)
            .query("SELECT 1;")
            .query("SELECT 2;");

        assertEquals(2, pipe.size());
        assertFalse(pipe.isEmpty());

        pipe.clear();
        assertEquals(0, pipe.size());
        assertTrue(pipe.isEmpty());
    }

    @Test
    public void testNullParams() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult mockResult = new VedaResult();
        when(client.query(anyString())).thenReturn(mockResult);

        VedaPipeline pipe = new VedaPipeline(client);
        pipe.query("SELECT * FROM users WHERE name = ?", (Object) null);
        pipe.run();

        verify(client).query("SELECT * FROM users WHERE name = NULL");
    }
}
