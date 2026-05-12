package io.vedadb;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/**
 * Schema migration manager for VedaDB.
 *
 * <p>Manages database schema migrations with versioning, tracking
 * applied migrations, and rollback support. Migrations are executed
 * in order and their status is persisted.
 *
 * <p>Usage:
 * <pre>{@code
 * VedaMigrator migrator = new VedaMigrator(client);
 * migrator.addMigration(1, "Create users table",
 *     "CREATE TABLE users (id INT PRIMARY KEY, name TEXT);",
 *     "DROP TABLE users;");
 * migrator.addMigration(2, "Add email column",
 *     "ALTER TABLE users ADD COLUMN email TEXT;",
 *     "ALTER TABLE users DROP COLUMN email;");
 * migrator.migrate(); // Applies pending migrations
 * </pre>
 */
public class VedaMigrator {

    /**
     * Represents a single schema migration.
     */
    public static class Migration {
        private final int version;
        private final String name;
        private final String upSql;
        private final String downSql;

        public Migration(int version, String name, String upSql, String downSql) {
            this.version = version;
            this.name = name;
            this.upSql = upSql;
            this.downSql = downSql;
        }

        public int getVersion() { return version; }
        public String getName() { return name; }
        public String getUpSql() { return upSql; }
        public String getDownSql() { return downSql; }

        @Override
        public String toString() {
            return "Migration{v=" + version + ", name='" + name + "'}";
        }
    }

    /**
     * Status of a migration.
     */
    public enum Status { PENDING, APPLIED, FAILED, ROLLED_BACK }

    /**
     * Result of applying a migration.
     */
    public static class MigrationResult {
        private final Migration migration;
        private final Status status;
        private final String message;

        MigrationResult(Migration migration, Status status, String message) {
            this.migration = migration;
            this.status = status;
            this.message = message;
        }

        public Migration getMigration() { return migration; }
        public Status getStatus() { return status; }
        public String getMessage() { return message; }

        @Override
        public String toString() {
            return migration + " -> " + status + ": " + message;
        }
    }

    private static final String MIGRATIONS_TABLE = "__migrations";

    private final VedaClient client;
    private final List<Migration> migrations = new ArrayList<>();
    private final Object lock = new Object();

    /**
     * Create a migrator bound to a client.
     */
    public VedaMigrator(VedaClient client) {
        this.client = Objects.requireNonNull(client, "client cannot be null");
    }

    /**
     * Add a migration.
     *
     * @param version migration version (must be unique and increasing)
     * @param name    human-readable name
     * @param upSql   SQL to apply the migration
     * @param downSql SQL to rollback the migration (can be null)
     */
    public VedaMigrator addMigration(int version, String name, String upSql, String downSql) {
        migrations.add(new Migration(version, name, upSql, downSql));
        return this;
    }

    /**
     * Add a migration without rollback.
     */
    public VedaMigrator addMigration(int version, String name, String upSql) {
        return addMigration(version, name, upSql, null);
    }

    /**
     * Create the migrations tracking table if it doesn't exist.
     */
    public void init() throws IOException, VedaException {
        client.exec("CREATE TABLE IF NOT EXISTS " + MIGRATIONS_TABLE + " (" +
            "version INT PRIMARY KEY, " +
            "name TEXT, " +
            "applied_at BIGINT, " +
            "status TEXT" +
            ");");
    }

    /**
     * Apply all pending migrations in order.
     *
     * @return list of results for each migration
     * @throws VedaException if a migration fails
     */
    public List<MigrationResult> migrate() throws IOException, VedaException {
        init();

        synchronized (lock) {
            // Sort migrations by version
            List<Migration> sorted = new ArrayList<>(migrations);
            sorted.sort(Comparator.comparingInt(Migration::getVersion));

            List<MigrationResult> results = new ArrayList<>();
            for (Migration migration : sorted) {
                if (isApplied(migration.getVersion())) {
                    results.add(new MigrationResult(migration, Status.APPLIED, "Already applied"));
                    continue;
                }

                try {
                    client.exec(migration.getUpSql());
                    recordMigration(migration, Status.APPLIED);
                    results.add(new MigrationResult(migration, Status.APPLIED, "Applied successfully"));
                } catch (IOException | VedaException e) {
                    recordMigration(migration, Status.FAILED);
                    results.add(new MigrationResult(migration, Status.FAILED, e.getMessage()));
                    throw new VedaException("Migration " + migration.getVersion() +
                        " failed: " + e.getMessage());
                }
            }
            return results;
        }
    }

    /**
     * Rollback the last applied migration.
     *
     * @return result of the rollback
     */
    public MigrationResult rollback() throws IOException, VedaException {
        init();

        synchronized (lock) {
            // Find the last applied migration
            Migration lastApplied = null;
            List<Migration> sorted = new ArrayList<>(migrations);
            sorted.sort(Comparator.comparingInt(Migration::getVersion));
            Collections.reverse(sorted);

            for (Migration migration : sorted) {
                if (isApplied(migration.getVersion())) {
                    lastApplied = migration;
                    break;
                }
            }

            if (lastApplied == null) {
                return new MigrationResult(null, Status.PENDING, "No migrations to rollback");
            }

            if (lastApplied.getDownSql() == null) {
                return new MigrationResult(lastApplied, Status.FAILED, "No rollback SQL defined");
            }

            try {
                client.exec(lastApplied.getDownSql());
                client.exec("UPDATE " + MIGRATIONS_TABLE +
                    " SET status = 'ROLLED_BACK' WHERE version = " + lastApplied.getVersion());
                return new MigrationResult(lastApplied, Status.ROLLED_BACK, "Rolled back successfully");
            } catch (IOException | VedaException e) {
                return new MigrationResult(lastApplied, Status.FAILED,
                    "Rollback failed: " + e.getMessage());
            }
        }
    }

    /**
     * Get the current schema version (highest applied migration).
     */
    public int getCurrentVersion() throws IOException, VedaException {
        init();
        try {
            VedaResult result = client.query("SELECT MAX(version) FROM " + MIGRATIONS_TABLE +
                " WHERE status = 'APPLIED';");
            if (result.getRows() != null && !result.getRows().isEmpty()) {
                String versionStr = result.getRows().get(0).get(0);
                if (versionStr != null && !versionStr.isEmpty() && !"null".equalsIgnoreCase(versionStr)) {
                    return Integer.parseInt(versionStr);
                }
            }
        } catch (Exception e) {
            // Table might not exist yet
        }
        return 0;
    }

    /**
     * Get the status of all migrations.
     */
    public List<MigrationResult> getStatus() throws IOException, VedaException {
        init();

        List<MigrationResult> results = new ArrayList<>();
        List<Migration> sorted = new ArrayList<>(migrations);
        sorted.sort(Comparator.comparingInt(Migration::getVersion));

        for (Migration migration : sorted) {
            Status status = isApplied(migration.getVersion()) ? Status.APPLIED : Status.PENDING;
            results.add(new MigrationResult(migration, status, ""));
        }
        return results;
    }

    /**
     * Reset all migrations (dangerous - drops tracking table).
     */
    public void reset() throws IOException, VedaException {
        try {
            client.exec("DROP TABLE " + MIGRATIONS_TABLE);
        } catch (Exception e) {
            // Table might not exist
        }
    }

    // ── Internal helpers ──────────────────────────────────────────

    private boolean isApplied(int version) throws IOException, VedaException {
        try {
            VedaResult result = client.query("SELECT status FROM " + MIGRATIONS_TABLE +
                " WHERE version = " + version);
            if (result.getRows() != null && !result.getRows().isEmpty()) {
                String status = result.getRows().get(0).get(0);
                return "APPLIED".equals(status);
            }
        } catch (Exception e) {
            // Table might not exist
        }
        return false;
    }

    private void recordMigration(Migration migration, Status status) throws IOException, VedaException {
        long now = System.currentTimeMillis();
        client.exec("INSERT INTO " + MIGRATIONS_TABLE +
            " (version, name, applied_at, status) VALUES (" +
            migration.getVersion() + ", '" +
            migration.getName().replace("'", "''") + "', " +
            now + ", '" + status.name() + "')");
    }
}
