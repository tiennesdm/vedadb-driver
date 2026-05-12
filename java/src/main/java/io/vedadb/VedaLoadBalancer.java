package io.vedadb;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Load balancer for VedaDB connections across multiple nodes.
 *
 * <p>Supports multiple load balancing strategies:
 * <ul>
 *   <li>{@link Strategy#ROUND_ROBIN} - Distribute evenly in sequence</li>
 *   <li>{@link Strategy#RANDOM}     - Random selection</li>
 *   <li>{@link Strategy#LEAST_CONN} - Node with fewest active connections</li>
 *   <li>{@link Strategy#WEIGHTED}   - Weighted round-robin</li>
 * </ul>
 *
 * <p>Usage:
 * <pre>{@code
 * VedaLoadBalancer lb = new VedaLoadBalancer(Strategy.ROUND_ROBIN);
 * lb.addNode("node1", client1, 1);
 * lb.addNode("node2", client2, 2); // higher weight
 * VedaClient client = lb.acquire();
 * try {
 *     VedaResult r = client.query("SELECT * FROM users;");
 * } finally {
 *     lb.release(client);
 * }
 * }</pre>
 */
public class VedaLoadBalancer {

    public enum Strategy { ROUND_ROBIN, RANDOM, LEAST_CONN, WEIGHTED }

    /**
     * Represents a node in the load-balanced cluster.
     */
    public static class Node {
        private final String id;
        private final VedaClient client;
        private final int weight;
        private final AtomicInteger activeConnections = new AtomicInteger(0);
        private volatile boolean healthy = true;

        Node(String id, VedaClient client, int weight) {
            this.id = id;
            this.client = client;
            this.weight = weight;
        }

        public String getId() { return id; }
        public VedaClient getClient() { return client; }
        public int getWeight() { return weight; }
        public int getActiveConnections() { return activeConnections.get(); }
        public boolean isHealthy() { return healthy; }

        void incrementConnections() { activeConnections.incrementAndGet(); }
        void decrementConnections() { activeConnections.decrementAndGet(); }
        void setHealthy(boolean h) { this.healthy = h; }
    }

    private final Strategy strategy;
    private final List<Node> nodes = new CopyOnWriteArrayList<>();
    private final AtomicInteger roundRobinIndex = new AtomicInteger(0);

    /**
     * Create a load balancer with a given strategy.
     */
    public VedaLoadBalancer(Strategy strategy) {
        this.strategy = Objects.requireNonNull(strategy, "strategy cannot be null");
    }

    /**
     * Create with default ROUND_ROBIN strategy.
     */
    public VedaLoadBalancer() {
        this(Strategy.ROUND_ROBIN);
    }

    /**
     * Add a node to the cluster.
     *
     * @param id     unique node identifier
     * @param client the VedaClient for this node
     * @param weight weight for weighted strategies (1 = default)
     */
    public void addNode(String id, VedaClient client, int weight) {
        if (weight <= 0) throw new IllegalArgumentException("weight must be > 0");
        nodes.add(new Node(id, client, weight));
    }

    /**
     * Add a node with default weight of 1.
     */
    public void addNode(String id, VedaClient client) {
        addNode(id, client, 1);
    }

    /**
     * Remove a node from the cluster.
     */
    public void removeNode(String id) {
        nodes.removeIf(n -> n.getId().equals(id));
    }

    /**
     * Acquire a client from the load-balanced pool.
     */
    public VedaClient acquire() {
        Node node = pickNode();
        if (node == null) {
            throw new IllegalStateException("No healthy nodes available");
        }
        node.incrementConnections();
        return node.getClient();
    }

    /**
     * Release a client back to the pool.
     */
    public void release(VedaClient client) {
        for (Node node : nodes) {
            if (node.getClient() == client) {
                node.decrementConnections();
                return;
            }
        }
    }

    /**
     * Execute an operation on a selected node.
     */
    public <T> T execute(NodeOperation<T> op) throws IOException, VedaException {
        Node node = pickNode();
        if (node == null) {
            throw new VedaException("No healthy nodes available");
        }
        node.incrementConnections();
        try {
            return op.execute(node.getClient());
        } finally {
            node.decrementConnections();
        }
    }

    /**
     * Run a health check on all nodes and mark unhealthy ones.
     */
    public void healthCheck() {
        for (Node node : nodes) {
            try {
                boolean ok = node.getClient().ping();
                node.setHealthy(ok);
            } catch (Exception e) {
                node.setHealthy(false);
            }
        }
    }

    /**
     * Get a snapshot of healthy nodes.
     */
    public List<Node> getHealthyNodes() {
        List<Node> healthy = new ArrayList<>();
        for (Node node : nodes) {
            if (node.isHealthy()) {
                healthy.add(node);
            }
        }
        return healthy;
    }

    /**
     * Get the total number of active connections across all nodes.
     */
    public int getTotalActiveConnections() {
        int total = 0;
        for (Node node : nodes) {
            total += node.getActiveConnections();
        }
        return total;
    }

    /**
     * Get the number of registered nodes.
     */
    public int getNodeCount() {
        return nodes.size();
    }

    private Node pickNode() {
        List<Node> healthy = getHealthyNodes();
        if (healthy.isEmpty()) {
            return null;
        }

        switch (strategy) {
            case RANDOM:
                return healthy.get(ThreadLocalRandom.current().nextInt(healthy.size()));

            case LEAST_CONN:
                Node least = healthy.get(0);
                for (int i = 1; i < healthy.size(); i++) {
                    if (healthy.get(i).getActiveConnections() < least.getActiveConnections()) {
                        least = healthy.get(i);
                    }
                }
                return least;

            case WEIGHTED:
                return pickWeighted(healthy);

            case ROUND_ROBIN:
            default:
                int idx = roundRobinIndex.getAndIncrement() % healthy.size();
                return healthy.get(Math.abs(idx));
        }
    }

    private Node pickWeighted(List<Node> healthy) {
        int totalWeight = 0;
        for (Node node : healthy) {
            totalWeight += node.getWeight();
        }
        int randomWeight = ThreadLocalRandom.current().nextInt(totalWeight);
        int currentWeight = 0;
        for (Node node : healthy) {
            currentWeight += node.getWeight();
            if (randomWeight < currentWeight) {
                return node;
            }
        }
        return healthy.get(healthy.size() - 1);
    }

    @FunctionalInterface
    public interface NodeOperation<T> {
        T execute(VedaClient client) throws IOException, VedaException;
    }
}
