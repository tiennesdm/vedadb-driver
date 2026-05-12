package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Tests for VedaURI.
 */
public class VedaURITest {

    @Test
    public void testParseFullURI() {
        VedaURI.VedaConfig config = VedaURI.parse("vedadb://admin:pass@localhost:7480/mydb?pool_size=20&timeout=30");

        assertEquals("localhost", config.getHost());
        assertEquals(7480, config.getPort());
        assertEquals("admin", config.getUsername());
        assertEquals("pass", config.getPassword());
        assertEquals("mydb", config.getDatabase());
        assertEquals(20, config.getPoolSize());
        assertEquals(30, config.getTimeoutSec());
        assertFalse(config.isTls());
    }

    @Test
    public void testParseMinimalURI() {
        VedaURI.VedaConfig config = VedaURI.parse("vedadb://localhost:6380");

        assertEquals("localhost", config.getHost());
        assertEquals(6380, config.getPort());
        assertNull(config.getUsername());
        assertNull(config.getPassword());
        assertNull(config.getDatabase());
    }

    @Test
    public void testParseWithSchemeOnly() {
        VedaURI.VedaConfig config = VedaURI.parse("vedadb://myhost");

        assertEquals("myhost", config.getHost());
        assertEquals(6380, config.getPort()); // default
    }

    @Test
    public void testParseWithTLSParams() {
        VedaURI.VedaConfig config = VedaURI.parse("vedadb://host:7480/db?tls=true&tls_insecure=true");

        assertTrue(config.isTls());
        assertTrue(config.isTlsInsecure());
    }

    @Test
    public void testParseRetries() {
        VedaURI.VedaConfig config = VedaURI.parse("vedadb://host:7480/db?retries=5");
        assertEquals(5, config.getMaxRetries());
    }

    @Test
    public void testParseDatabaseOverride() {
        VedaURI.VedaConfig config = VedaURI.parse("vedadb://host:7480/pathdb?database=querydb");
        assertEquals("querydb", config.getDatabase());
    }

    @Test(expected = IllegalArgumentException.class)
    public void testParseNull() {
        VedaURI.parse(null);
    }

    @Test(expected = IllegalArgumentException.class)
    public void testParseEmpty() {
        VedaURI.parse("");
    }

    @Test(expected = IllegalArgumentException.class)
    public void testParseInvalidScheme() {
        VedaURI.parse("http://localhost:7480/db");
    }

    @Test
    public void testParseNoScheme() {
        VedaURI.VedaConfig config = VedaURI.parse("localhost:7480/db");
        assertEquals("localhost", config.getHost());
        assertEquals(7480, config.getPort());
    }

    @Test
    public void testBuildURI() {
        String uri = VedaURI.build("localhost", 7480, "admin", "secret", "mydb");
        assertEquals("vedadb://admin:secret@localhost:7480/mydb", uri);
    }

    @Test
    public void testBuildNoAuth() {
        String uri = VedaURI.build("localhost", 6380, null, null, null);
        assertEquals("vedadb://localhost:6380", uri);
    }

    @Test
    public void testExtraParams() {
        VedaURI.VedaConfig config = VedaURI.parse("vedadb://host:7480/db?custom_key=custom_value");
        assertEquals("custom_value", config.getExtraParams().get("custom_key"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void testInvalidPoolSize() {
        VedaURI.parse("vedadb://host:7480/db?pool_size=not_a_number");
    }

    @Test
    public void testConfigToString() {
        VedaURI.VedaConfig config = VedaURI.parse("vedadb://admin:pass@localhost:7480/db?pool_size=20");
        String str = config.toString();
        assertTrue(str.contains("localhost"));
        assertTrue(str.contains("7480"));
        assertTrue(str.contains("pool=20"));
    }
}
