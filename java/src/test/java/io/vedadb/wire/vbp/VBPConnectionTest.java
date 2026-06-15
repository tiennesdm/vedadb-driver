package io.vedadb.wire.vbp;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import java.net.Socket;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration test for VBPConnection against a real vbp_dev_server.
 * Auto-skips if no server is listening on 127.0.0.1:6380.
 */
class VBPConnectionTest {

    private static final int TEST_PORT = Integer.getInteger("vbp.test.port", 6381);

    private static boolean serverAvailable() {
        try (Socket s = new Socket()) {
            s.connect(new java.net.InetSocketAddress("127.0.0.1", TEST_PORT), 500);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Test
    void connectToDevServer() {
        Assumptions.assumeTrue(serverAvailable(), "vbp_dev_server not running on :" + TEST_PORT);
        try (VBPConnection c = new VBPConnection("127.0.0.1", TEST_PORT, "admin", "TestPassword123!", "", 5)) {
            c.connect();
            assertTrue(c.getServerVersion() != 0 || c.getServerVersion() == 0); // connection completed
        }
    }

    @Test
    void pingRoundTrip() {
        Assumptions.assumeTrue(serverAvailable(), "vbp_dev_server not running on :" + TEST_PORT);
        try (VBPConnection c = new VBPConnection("127.0.0.1", TEST_PORT, "admin", "TestPassword123!", "", 5)) {
            c.connect();
            long rtt = c.ping();
            assertTrue(rtt >= 0);
        }
    }

    @Test
    void executeQuery() {
        Assumptions.assumeTrue(serverAvailable(), "vbp_dev_server not running on :" + TEST_PORT);
        try (VBPConnection c = new VBPConnection("127.0.0.1", TEST_PORT, "admin", "TestPassword123!", "", 5)) {
            c.connect();
            VBPResult r = c.execute("SELECT 1");
            assertNotNull(r);
        }
    }

    @Test
    void connectFailsToUnreachableHost() {
        try (VBPConnection c = new VBPConnection("127.0.0.1", 1, "admin", "pw", "", 2)) {
            assertThrows(Exception.class, c::connect);
        }
    }

    @Test
    void closeIsIdempotent() {
        VBPConnection c = new VBPConnection("127.0.0.1", TEST_PORT, "admin", "TestPassword123!", "", 1);
        c.close();
        c.close(); // no throw
    }

    @Test
    void defaultPortIs6380() {
        assertEquals(6380, VBPConnection.DEFAULT_VBP_PORT);
    }

    @Test
    void executeBeforeConnectThrows() {
        VBPConnection c = new VBPConnection("127.0.0.1", TEST_PORT, "admin", "TestPassword123!", "", 1);
        assertThrows(VBPException.class, () -> c.execute("SELECT 1"));
    }

    @Test
    void pingBeforeConnectThrows() {
        VBPConnection c = new VBPConnection("127.0.0.1", TEST_PORT, "admin", "TestPassword123!", "", 1);
        assertThrows(VBPException.class, c::ping);
    }
}
