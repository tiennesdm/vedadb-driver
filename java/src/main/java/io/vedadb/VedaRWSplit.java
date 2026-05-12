package io.vedadb;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Read/Write splitting for VedaDB connections.
 *
 * <p>Routes write operations (INSERT, UPDATE, DELETE) to the primary node
 * and read operations (SELECT) to replica nodes. If no replicas are
 * available, reads fall back to the primary.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaRWSplit split = new VedaRWSplit(primaryClient);
 * split.addReplica(replicaClient1);
 * split.addReplica(replicaClient2);
 *
 * // Write goes to primary
 * VedaResult r = split.write(client -> client.exec("INSERT INTO ..."));
 *
 * // Read goes to a replica
 * VedaResult r = split.read(client -> client.query("SELECT * FROM ..."));
 * }</pre>
 */
public class VedaRWSplit {

    /**
     * Functional interface for read operations.
     */
    @FunctionalInterface
    public interface ReadOperation<T> {
        T execute(VedaClient client) throws IOException, VedaException;
    }

    /**
     * Functional interface for write operations.
     */
    @FunctionalInterface
    public interface WriteOperation<T> {
        T execute(VedaClient client) throws IOException, VedaException;
    }

    private final VedaClient primary;
    private final List<VedaClient> replicas = new CopyOnWriteArrayList<>();
    private final AtomicInteger roundRobinIndex = new AtomicInteger(0);

    /**
     * Create a read/write splitter with a primary node.
     */
    public VedaRWSplit(VedaClient primary) {
        this.primary = Objects.requireNonNull(primary, "primary cannot be null");
    }

    /**
     * Add a replica node for read operations.
     */
    public void addReplica(VedaClient replica) {
        if (replica != null) {
            replicas.add(replica);
        }
    }

    /**
     * Remove a replica node.
     */
    public void removeReplica(VedaClient replica) {
        replicas.remove(replica);
    }

    /**
     * Execute a read operation on a replica (or primary if no replicas).
     */
    public <T> T read(ReadOperation<T> op) throws IOException, VedaException {
        VedaClient client = pickReplica();
        return op.execute(client);
    }

    /**
     * Execute a write operation on the primary node.
     */
    public <T> T write(WriteOperation<T> op) throws IOException, VedaException {
        return op.execute(primary);
    }

    /**
     * Execute a query (read) with automatic routing.
     */
    public VedaResult query(String sql) throws IOException, VedaException {
        return read(client -> client.query(sql));
    }

    /**
     * Execute a command (write) on the primary.
     */
    public String exec(String sql) throws IOException, VedaException {
        return write(client -> client.exec(sql));
    }

    /**
     * Pick a replica using round-robin. Falls back to primary if no replicas.
     */
    private VedaClient pickReplica() {
        if (replicas.isEmpty()) {
            return primary;
        }

        // Round-robin selection
        int index = roundRobinIndex.getAndUpdate(i -> (i + 1) % replicas.size());
        VedaClient replica = replicas.get(index % replicas.size());

        // Health check: try to ping, fall back if unhealthy
        try {
            if (replica.ping()) {
                return replica;
            }
        } catch (Exception e) {
            // Replica unhealthy, try next
        }

        // Try other replicas
        for (VedaClient r : replicas) {
            if (r != replica) {
                try {
                    if (r.ping()) {
                        return r;
                    }
                } catch (Exception e) {
                    // Skip unhealthy replica
                }
            }
        }

        // All replicas down, fall back to primary
        return primary;
    }

    /**
     * Pick a replica using random selection.
     */
    public VedaClient pickRandomReplica() {
        if (replicas.isEmpty()) {
            return primary;
        }
        return replicas.get(ThreadLocalRandom.current().nextInt(replicas.size()));
    }

    /**
     * Get the primary client.
     */
    public VedaClient getPrimary() {
        return primary;
    }

    /**
     * Get all replica clients.
     */
    public List<VedaClient> getReplicas() {
        return new ArrayList<>(replicas);
    }

    /**
     * Get the number of replica nodes.
     */
    public int getReplicaCount() {
        return replicas.size();
    }

    /**
     * Check if any replicas are registered.
     */
    public boolean hasReplicas() {
        return !replicas.isEmpty();
    }
}
