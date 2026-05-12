package io.vedadb;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Multi-node failover manager for VedaDB.
 *
 * <p>Maintains a list of VedaDB nodes in priority order. On failure,
 * automatically fails over to the next available node. Monitors
 * failed nodes and promotes them back when they recover.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaFailover failover = new VedaFailover(node1, node2, node3);
 * failover.setRetryDelayMs(5000);
 * VedaClient client = failover.getActiveClient();
 * VedaResult result = client.query("SELECT * FROM users;");
 * }</pre>
 */
public class VedaFailover {

    /**
     * Represents a node in the failover cluster.
     */
    public static class FailoverNode {
        private final String id;
        private final String host;
        private final int port;
        private final String username;
        private final String password;
        private volatile VedaClient client;
        private volatile boolean healthy = true;
        private volatile long lastFailureTime = 0;
        private final AtomicInteger failureCount = new AtomicInteger(0);

        public FailoverNode(String id, String host, int port,
                            String username, String password) {
            this.id = id;
            this.host = host;
            this.port = port;
            this.username = username;
            this.password = password;
        }

        public FailoverNode(String id, String host, int port) {
            this(id, host, port, null, null);
        }

        public String getId() { return id; }
        public String getHost() { return host; }
        public int getPort() { return port; }
        public boolean isHealthy() { return healthy; }
        public int getFailureCount() { return failureCount.get(); }
        public long getLastFailureTime() { return lastFailureTime; }

        VedaClient getClient() throws IOException, VedaException {
            if (client == null || !healthy) {
                client = new VedaClient(host, port);
            }
            return client;
        }

        void markFailed() {
            healthy = false;
            lastFailureTime = System.currentTimeMillis();
            failureCount.incrementAndGet();
            if (client != null) {
                try { client.close(); } catch (Exception ignored) {}
                client = null;
            }
        }

        void markHealthy() {
            healthy = true;
        }
    }

    private final List<FailoverNode> nodes;
    private final AtomicInteger activeIndex = new AtomicInteger(0);
    private long retryDelayMs = 10000; // 10 seconds before retrying a failed node
    private final AtomicReference<FailoverListener> listener = new AtomicReference<>();

    /**
     * Listener for failover events.
     */
    public interface FailoverListener {
        void onFailover(FailoverNode fromNode, FailoverNode toNode);
        void onNodeRecovered(FailoverNode node);
        void onAllNodesFailed();
    }

    /**
     * Create a failover manager with the given nodes in priority order.
     */
    public VedaFailover(FailoverNode... nodes) {
        if (nodes == null || nodes.length == 0) {
            throw new IllegalArgumentException("At least one node is required");
        }
        this.nodes = new CopyOnWriteArrayList<>(nodes);
    }

    /**
     * Create a failover manager with host:port pairs.
     */
    public VedaFailover(String[][] hostPorts) {
        if (hostPorts == null || hostPorts.length == 0) {
            throw new IllegalArgumentException("At least one node is required");
        }
        List<FailoverNode> nodeList = new ArrayList<>();
        for (int i = 0; i < hostPorts.length; i++) {
            String[] hp = hostPorts[i];
            nodeList.add(new FailoverNode(
                "node-" + i, hp[0], Integer.parseInt(hp[1]));
        }
        this.nodes = new CopyOnWriteArrayList<>(nodeList);
    }

    /**
     * Set the delay before retrying a failed node.
     */
    public void setRetryDelayMs(long retryDelayMs) {
        this.retryDelayMs = retryDelayMs;
    }

    /**
     * Set a failover event listener.
     */
    public void setListener(FailoverListener listener) {
        this.listener.set(listener);
    }

    /**
     * Get the currently active client, failing over if necessary.
     */
    public VedaClient getActiveClient() throws IOException, VedaException {
        // Try active node first
        int startIndex = activeIndex.get();
        for (int i = 0; i < nodes.size(); i++) {
            int idx = (startIndex + i) % nodes.size();
            FailoverNode node = nodes.get(idx);

            // Check if a previously failed node can be retried
            if (!node.isHealthy()) {
                if (System.currentTimeMillis() - node.getLastFailureTime() < retryDelayMs) {
                    continue; // Skip, too soon to retry
                }
            }

            try {
                VedaClient client = node.getClient();
                if (client.ping()) {
                    if (!node.isHealthy()) {
                        // Node recovered
                        node.markHealthy();
                        notifyNodeRecovered(node);
                    }
                    if (idx != activeIndex.get()) {
                        FailoverNode oldNode = nodes.get(activeIndex.get());
                        activeIndex.set(idx);
                        notifyFailover(oldNode, node);
                    }
                    return client;
                } else {
                    node.markFailed();
                }
            } catch (Exception e) {
                node.markFailed();
            }
        }

        notifyAllNodesFailed();
        throw new VedaException("All failover nodes are unavailable");
    }

    /**
     * Execute an operation on the active node with automatic failover.
     */
    public <T> T execute(FailoverOperation<T> op) throws Exception {
        int attempts = nodes.size();
        Exception lastException = null;

        for (int i = 0; i < attempts; i++) {
            try {
                VedaClient client = getActiveClient();
                return op.execute(client);
            } catch (Exception e) {
                lastException = e;
                // Mark current node as failed and try next
                int currentIdx = activeIndex.get();
                if (currentIdx < nodes.size()) {
                    nodes.get(currentIdx).markFailed();
                }
                activeIndex.set((currentIdx + 1) % nodes.size());
            }
        }

        throw lastException != null ? lastException : new VedaException("All failover attempts exhausted");
    }

    /**
     * Get the currently active node index.
     */
    public int getActiveIndex() {
        return activeIndex.get();
    }

    /**
     * Get the active node.
     */
    public FailoverNode getActiveNode() {
        return nodes.get(activeIndex.get());
    }

    /**
     * Get the number of nodes.
     */
    public int getNodeCount() {
        return nodes.size();
    }

    /**
     * Get all nodes.
     */
    public List<FailoverNode> getNodes() {
        return new ArrayList<>(nodes);
    }

    /**
     * Get the number of healthy nodes.
     */
    public int getHealthyCount() {
        int count = 0;
        for (FailoverNode node : nodes) {
            if (node.isHealthy()) count++;
        }
        return count;
    }

    private void notifyFailover(FailoverNode from, FailoverNode to) {
        FailoverListener l = listener.get();
        if (l != null) {
            try {
                l.onFailover(from, to);
            } catch (Exception ignored) {
            }
        }
    }

    private void notifyNodeRecovered(FailoverNode node) {
        FailoverListener l = listener.get();
        if (l != null) {
            try {
                l.onNodeRecovered(node);
            } catch (Exception ignored) {
            }
        }
    }

    private void notifyAllNodesFailed() {
        FailoverListener l = listener.get();
        if (l != null) {
            try {
                l.onAllNodesFailed();
            } catch (Exception ignored) {
            }
        }
    }

    @FunctionalInterface
    public interface FailoverOperation<T> {
        T execute(VedaClient client) throws Exception;
    }
}
