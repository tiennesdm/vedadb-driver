package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import java.util.List;

/**
 * Tests for VedaLoadBalancer.
 */
public class VedaLoadBalancerTest {

    @Test
    public void testDefaultStrategy() {
        VedaLoadBalancer lb = new VedaLoadBalancer();
        assertNotNull(lb);
    }

    @Test
    public void testAllStrategies() {
        for (VedaLoadBalancer.Strategy strategy : VedaLoadBalancer.Strategy.values()) {
            VedaLoadBalancer lb = new VedaLoadBalancer(strategy);
            assertNotNull(lb);
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void testInvalidWeight() {
        VedaClient client = mock(VedaClient.class);
        VedaLoadBalancer lb = new VedaLoadBalancer();
        lb.addNode("n1", client, 0);
    }

    @Test
    public void testAddRemoveNode() {
        VedaClient client = mock(VedaClient.class);
        VedaLoadBalancer lb = new VedaLoadBalancer();

        lb.addNode("n1", client);
        assertEquals(1, lb.getNodeCount());

        lb.removeNode("n1");
        assertEquals(0, lb.getNodeCount());
    }

    @Test
    public void testDefaultWeight() {
        VedaClient client = mock(VedaClient.class);
        when(client.ping()).thenReturn(true);

        VedaLoadBalancer lb = new VedaLoadBalancer();
        lb.addNode("n1", client);
        // Acquire and release to test basic flow
        VedaClient acquired = lb.acquire();
        assertSame(client, acquired);
        lb.release(client);
    }

    @Test(expected = IllegalStateException.class)
    public void testAcquireNoHealthyNodes() {
        VedaLoadBalancer lb = new VedaLoadBalancer();
        lb.acquire();
    }

    @Test
    public void testHealthCheck() {
        VedaClient client1 = mock(VedaClient.class);
        VedaClient client2 = mock(VedaClient.class);
        when(client1.ping()).thenReturn(true);
        when(client2.ping()).thenReturn(false);

        VedaLoadBalancer lb = new VedaLoadBalancer();
        lb.addNode("n1", client1);
        lb.addNode("n2", client2);

        lb.healthCheck();

        List<VedaLoadBalancer.Node> healthy = lb.getHealthyNodes();
        assertEquals(1, healthy.size());
        assertEquals("n1", healthy.get(0).getId());
    }

    @Test
    public void testTotalActiveConnections() {
        VedaClient client = mock(VedaClient.class);
        VedaLoadBalancer lb = new VedaLoadBalancer();
        lb.addNode("n1", client);

        assertEquals(0, lb.getTotalActiveConnections());

        lb.acquire();
        assertEquals(1, lb.getTotalActiveConnections());

        lb.release(client);
        assertEquals(0, lb.getTotalActiveConnections());
    }

    @Test
    public void testRoundRobinAcquire() {
        VedaClient client1 = mock(VedaClient.class);
        VedaClient client2 = mock(VedaClient.class);
        when(client1.ping()).thenReturn(true);
        when(client2.ping()).thenReturn(true);

        VedaLoadBalancer lb = new VedaLoadBalancer(VedaLoadBalancer.Strategy.ROUND_ROBIN);
        lb.addNode("n1", client1);
        lb.addNode("n2", client2);

        // Both should be acquirable
        VedaClient first = lb.acquire();
        assertNotNull(first);
        lb.release(first);
    }

    @Test
    public void testRandomStrategy() {
        VedaClient client = mock(VedaClient.class);
        when(client.ping()).thenReturn(true);

        VedaLoadBalancer lb = new VedaLoadBalancer(VedaLoadBalancer.Strategy.RANDOM);
        lb.addNode("n1", client);

        VedaClient acquired = lb.acquire();
        assertSame(client, acquired);
        lb.release(client);
    }

    @Test
    public void testLeastConnStrategy() {
        VedaClient client1 = mock(VedaClient.class);
        VedaClient client2 = mock(VedaClient.class);
        when(client1.ping()).thenReturn(true);
        when(client2.ping()).thenReturn(true);

        VedaLoadBalancer lb = new VedaLoadBalancer(VedaLoadBalancer.Strategy.LEAST_CONN);
        lb.addNode("n1", client1);
        lb.addNode("n2", client2);

        VedaClient acquired = lb.acquire();
        assertNotNull(acquired);
        lb.release(acquired);
    }

    @Test
    public void testWeightedStrategy() {
        VedaClient client = mock(VedaClient.class);
        when(client.ping()).thenReturn(true);

        VedaLoadBalancer lb = new VedaLoadBalancer(VedaLoadBalancer.Strategy.WEIGHTED);
        lb.addNode("n1", client, 5);

        VedaClient acquired = lb.acquire();
        assertSame(client, acquired);
        lb.release(client);
    }

    @Test
    public void testExecute() throws Exception {
        VedaClient client = mock(VedaClient.class);
        VedaResult result = new VedaResult();
        when(client.query(anyString())).thenReturn(result);
        when(client.ping()).thenReturn(true);

        VedaLoadBalancer lb = new VedaLoadBalancer();
        lb.addNode("n1", client);

        VedaResult r = lb.execute(c -> c.query("SELECT 1;"));
        assertSame(result, r);
    }

    @Test
    public void testNodeGetters() {
        VedaClient client = mock(VedaClient.class);
        VedaLoadBalancer lb = new VedaLoadBalancer();
        lb.addNode("n1", client, 3);

        VedaLoadBalancer.Node node = lb.getHealthyNodes().get(0);
        assertEquals("n1", node.getId());
        assertSame(client, node.getClient());
        assertEquals(3, node.getWeight());
        assertEquals(0, node.getActiveConnections());
        assertTrue(node.isHealthy());
    }
}
