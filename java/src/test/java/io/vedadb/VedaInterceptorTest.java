package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Tests for VedaInterceptor.
 */
public class VedaInterceptorTest {

    @Test
    public void testCreateChain() {
        VedaClient client = mock(VedaClient.class);
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        assertNotNull(chain);
        assertEquals(0, chain.getInterceptorCount());
    }

    @Test
    public void testAddInterceptor() {
        VedaClient client = mock(VedaClient.class);
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);

        chain.addInterceptor(new VedaInterceptor.Interceptor() {});
        assertEquals(1, chain.getInterceptorCount());
    }

    @Test(expected = NullPointerException.class)
    public void testAddNullInterceptor() {
        VedaClient client = mock(VedaClient.class);
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(null);
    }

    @Test
    public void testRemoveInterceptor() {
        VedaClient client = mock(VedaClient.class);
        VedaInterceptor.Interceptor interceptor = new VedaInterceptor.Interceptor() {};
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);

        chain.addInterceptor(interceptor);
        assertEquals(1, chain.getInterceptorCount());

        chain.removeInterceptor(interceptor);
        assertEquals(0, chain.getInterceptorCount());
    }

    @Test
    public void testQueryPassthrough() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);

        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        VedaResult actual = chain.query("SELECT * FROM users;");

        assertSame(result, actual);
        verify(client).query("SELECT * FROM users;");
    }

    @Test
    public void testBeforeQueryInterceptor() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);

        AtomicReference<String> captured = new AtomicReference<>();
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(new VedaInterceptor.Interceptor() {
            @Override
            public String beforeQuery(String sql) {
                captured.set(sql);
                return sql;
            }
        });

        chain.query("SELECT 1;");
        assertEquals("SELECT 1;", captured.get());
    }

    @Test
    public void testAfterQueryInterceptor() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);

        AtomicBoolean afterCalled = new AtomicBoolean(false);
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(new VedaInterceptor.Interceptor() {
            @Override
            public void afterQuery(String sql, VedaResult result) {
                afterCalled.set(true);
            }
        });

        chain.query("SELECT 1;");
        assertTrue(afterCalled.get());
    }

    @Test
    public void testErrorInterceptor() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.query(anyString())).thenThrow(new IOException("fail"));

        AtomicBoolean errorCalled = new AtomicBoolean(false);
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(new VedaInterceptor.Interceptor() {
            @Override
            public void onError(String sql, Exception exception) {
                errorCalled.set(true);
            }
        });

        try {
            chain.query("SELECT 1;");
            fail("Expected exception");
        } catch (IOException e) {
            assertTrue(errorCalled.get());
        }
    }

    @Test(expected = VedaException.class)
    public void testCancelQuery() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(new VedaInterceptor.Interceptor() {
            @Override
            public String beforeQuery(String sql) {
                return null; // Cancel the query
            }
        });

        chain.query("SELECT 1;");
    }

    @Test
    public void testExec() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);

        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        String msg = chain.exec("UPDATE t SET x = 1;");
        assertNotNull(msg);
    }

    @Test
    public void testLoggingInterceptor() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);

        VedaInterceptor.LoggingInterceptor logging = new VedaInterceptor.LoggingInterceptor();
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(logging);

        // Should not throw
        chain.query("SELECT 1;");
    }

    @Test
    public void testSanitizationInterceptorAllowsSelect() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);

        VedaInterceptor.SanitizationInterceptor sanitizer = new VedaInterceptor.SanitizationInterceptor();
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(sanitizer);

        // SELECT should be allowed
        chain.query("SELECT * FROM users;");
    }

    @Test(expected = SecurityException.class)
    public void testSanitizationInterceptorBlocksDrop() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaInterceptor.SanitizationInterceptor sanitizer = new VedaInterceptor.SanitizationInterceptor();
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(sanitizer);

        chain.query("DROP TABLE users;");
    }

    @Test(expected = SecurityException.class)
    public void testSanitizationInterceptorBlocksTruncate() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaInterceptor.SanitizationInterceptor sanitizer = new VedaInterceptor.SanitizationInterceptor();
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(sanitizer);

        chain.query("TRUNCATE TABLE users;");
    }

    @Test
    public void testSanitizationAllowsWithFlag() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);

        VedaInterceptor.SanitizationInterceptor sanitizer = new VedaInterceptor.SanitizationInterceptor(true, true);
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(sanitizer);

        // With flags enabled, DROP should be allowed
        chain.query("DROP TABLE test;");
    }

    @Test
    public void testMetricsInterceptor() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);

        VedaMetrics metrics = new VedaMetrics("test");
        VedaInterceptor.MetricsInterceptor mi = new VedaInterceptor.MetricsInterceptor(metrics);
        VedaInterceptor.Chain chain = new VedaInterceptor.Chain(client);
        chain.addInterceptor(mi);

        chain.query("SELECT 1;");
        assertEquals(1, metrics.getCounter("queries_success"));
    }
}
