package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;

import javax.net.ssl.SSLContext;

/**
 * Tests for VedaTLS.
 */
public class VedaTLSTest {

    @Test
    public void testCreateDefaultContext() throws Exception {
        SSLContext ctx = VedaTLS.createDefaultContext();
        assertNotNull(ctx);
        assertEquals("TLSv1.2", ctx.getProtocol());
    }

    @Test
    public void testCreateInsecureContext() throws Exception {
        SSLContext ctx = VedaTLS.createInsecureContext();
        assertNotNull(ctx);
    }

    @Test(expected = VedaException.class)
    public void testCreateContextWithInvalidCA() throws Exception {
        VedaTLS.createContext("/nonexistent/ca.crt");
    }

    @Test
    public void testTLSConfigBuilder() throws Exception {
        SSLContext ctx = VedaTLS.createDefaultContext();
        VedaTLS.TLSConfigBuilder builder = VedaTLS.withTLS(ctx)
            .host("db.example.com")
            .port(7480)
            .tlsVerify(true);

        assertEquals("db.example.com", builder.getHost());
        assertEquals(7480, builder.getPort());
        assertTrue(builder.isTlsVerify());
        assertSame(ctx, builder.getSSLContext());
    }

    @Test
    public void testTLSConfigBuilderDefaults() throws Exception {
        SSLContext ctx = VedaTLS.createDefaultContext();
        VedaTLS.TLSConfigBuilder builder = VedaTLS.withTLS(ctx);

        assertEquals("localhost", builder.getHost());
        assertEquals(6380, builder.getPort());
        assertTrue(builder.isTlsVerify());
    }

    @Test
    public void testCreateContextNullCA() throws Exception {
        // With null CA cert, should use JVM default trust store
        SSLContext ctx = VedaTLS.createContext(null, null, null);
        assertNotNull(ctx);
    }
}
