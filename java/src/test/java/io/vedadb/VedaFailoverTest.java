package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Tests for VedaFailover.
 */
public class VedaFailoverTest {

    @Test(expected = IllegalArgumentException.class)
    public void testNoNodes() {
        new VedaFailover();
    }

    @Test(expected = IllegalArgumentException.class)
    public void testNullNodes() {
        new VedaFailover((VedaFailover.FailoverNode[]) null);
    }

    @Test(expected = IllegalArgumentException.class)
    public void testEmptyHostPorts() {
        new VedaFailover(new String[0][]);
    }

    @Test
    public void testCreateWithNodes() {
        VedaFailover.FailoverNode node1 = new VedaFailover.FailoverNode("n1", "host1", 7480);
        VedaFailover.FailoverNode node2 = new VedaFailover.FailoverNode("n2", "host2", 7480);
        VedaFailover failover = new VedaFailover(node1, node2);

        assertEquals(2, failover.getNodeCount());
        assertEquals(0, failover.getActiveIndex());
    }

    @Test
    public void testCreateWithHostPorts() {
        VedaFailover failover = new VedaFailover(new String[][]{
            {"host1", "7480"},
            {"host2", "7480"}
        });
        assertEquals(2, failover.getNodeCount());
    }

    @Test
    public void testNodeGetters() {
        VedaFailover.FailoverNode node = new VedaFailover.FailoverNode("n1", "host1", 7480, "user", "pass");
        assertEquals("n1", node.getId());
        assertEquals("host1", node.getHost());
        assertEquals(7480, node.getPort());
        assertTrue(node.isHealthy());
        assertEquals(0, node.getFailureCount());
        assertEquals(0, node.getLastFailureTime());
    }

    @Test
    public void testNodeMarkFailed() {
        VedaFailover.FailoverNode node = new VedaFailover.FailoverNode("n1", "host1", 7480);
        assertTrue(node.isHealthy());
        node.markFailed();
        assertFalse(node.isHealthy());
        assertEquals(1, node.getFailureCount());
        assertTrue(node.getLastFailureTime() > 0);
    }

    @Test
    public void testNodeMarkHealthy() {
        VedaFailover.FailoverNode node = new VedaFailover.FailoverNode("n1", "host1", 7480);
        node.markFailed();
        assertFalse(node.isHealthy());
        node.markHealthy();
        assertTrue(node.isHealthy());
    }

    @Test
    public void testSetRetryDelay() {
        VedaFailover.FailoverNode node = new VedaFailover.FailoverNode("n1", "host1", 7480);
        VedaFailover failover = new VedaFailover(node);
        failover.setRetryDelayMs(5000);
    }

    @Test
    public void testGetNodes() {
        VedaFailover.FailoverNode node1 = new VedaFailover.FailoverNode("n1", "host1", 7480);
        VedaFailover.FailoverNode node2 = new VedaFailover.FailoverNode("n2", "host2", 7480);
        VedaFailover failover = new VedaFailover(node1, node2);

        List<VedaFailover.FailoverNode> nodes = failover.getNodes();
        assertEquals(2, nodes.size());
    }

    @Test
    public void testGetHealthyCount() {
        VedaFailover.FailoverNode node1 = new VedaFailover.FailoverNode("n1", "host1", 7480);
        VedaFailover.FailoverNode node2 = new VedaFailover.FailoverNode("n2", "host2", 7480);
        VedaFailover failover = new VedaFailover(node1, node2);

        assertEquals(2, failover.getHealthyCount());

        node1.markFailed();
        assertEquals(1, failover.getHealthyCount());
    }

    @Test
    public void testListener() {
        VedaFailover.FailoverNode node1 = new VedaFailover.FailoverNode("n1", "host1", 7480);
        VedaFailover failover = new VedaFailover(node1);

        AtomicBoolean called = new AtomicBoolean(false);
        failover.setListener(new VedaFailover.FailoverListener() {
            @Override
            public void onFailover(VedaFailover.FailoverNode from, VedaFailover.FailoverNode to) {
                called.set(true);
            }
            @Override
            public void onNodeRecovered(VedaFailover.FailoverNode node) {
            }
            @Override
            public void onAllNodesFailed() {
            }
        });
    }

    @Test
    public void testAllNodesUnavailable() {
        VedaFailover.FailoverNode node1 = new VedaFailover.FailoverNode("n1", "invalid_host_xyz", 1);
        VedaFailover failover = new VedaFailover(node1);

        try {
            failover.getActiveClient();
            fail("Expected exception");
        } catch (Exception e) {
            // expected - cannot connect
        }
    }

    @Test
    public void testActiveNode() {
        VedaFailover.FailoverNode node1 = new VedaFailover.FailoverNode("n1", "host1", 7480);
        VedaFailover.FailoverNode node2 = new VedaFailover.FailoverNode("n2", "host2", 7480);
        VedaFailover failover = new VedaFailover(node1, node2);

        assertSame(node1, failover.getActiveNode());
    }
}
