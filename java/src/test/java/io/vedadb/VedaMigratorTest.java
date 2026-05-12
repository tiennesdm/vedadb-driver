package io.vedadb;

import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import java.util.List;

/**
 * Tests for VedaMigrator.
 */
public class VedaMigratorTest {

    @Test(expected = NullPointerException.class)
    public void testNullClient() {
        new VedaMigrator(null);
    }

    @Test
    public void testCreate() {
        VedaClient client = mock(VedaClient.class);
        VedaMigrator migrator = new VedaMigrator(client);
        assertNotNull(migrator);
    }

    @Test
    public void testAddMigration() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");
        when(client.query(anyString())).thenReturn(new VedaResult());

        VedaMigrator migrator = new VedaMigrator(client)
            .addMigration(1, "Create users", "CREATE TABLE users (id INT);");

        List<VedaMigrator.MigrationResult> results = migrator.migrate();
        assertEquals(1, results.size());
        assertEquals(VedaMigrator.Status.APPLIED, results.get(0).getStatus());
    }

    @Test
    public void testAddMigrationChaining() {
        VedaClient client = mock(VedaClient.class);
        VedaMigrator migrator = new VedaMigrator(client)
            .addMigration(1, "M1", "SQL1", "DOWN1")
            .addMigration(2, "M2", "SQL2");

        assertNotNull(migrator);
    }

    @Test
    public void testMigrationToString() {
        VedaMigrator.Migration migration = new VedaMigrator.Migration(
            1, "Create users", "CREATE TABLE users (id INT);", "DROP TABLE users;");
        assertTrue(migration.toString().contains("Create users"));
        assertEquals(1, migration.getVersion());
        assertEquals("Create users", migration.getName());
        assertEquals("CREATE TABLE users (id INT);", migration.getUpSql());
        assertEquals("DROP TABLE users;", migration.getDownSql());
    }

    @Test
    public void testMigrationWithoutRollback() {
        VedaMigrator.Migration migration = new VedaMigrator.Migration(
            1, "M1", "SQL1");
        assertNull(migration.getDownSql());
    }

    @Test
    public void testMigrationResult() {
        VedaMigrator.Migration migration = new VedaMigrator.Migration(1, "M1", "SQL1");
        VedaMigrator.MigrationResult result = new VedaMigrator.MigrationResult(
            migration, VedaMigrator.Status.APPLIED, "Success");

        assertSame(migration, result.getMigration());
        assertEquals(VedaMigrator.Status.APPLIED, result.getStatus());
        assertEquals("Success", result.getMessage());
        assertTrue(result.toString().contains("APPLIED"));
    }

    @Test
    public void testInitCreatesTable() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");

        VedaMigrator migrator = new VedaMigrator(client);
        migrator.init();

        verify(client).exec(contains("__migrations"));
    }

    @Test
    public void testStatus() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");
        when(client.query(anyString())).thenReturn(new VedaResult());

        VedaMigrator migrator = new VedaMigrator(client)
            .addMigration(1, "M1", "SQL1");

        List<VedaMigrator.MigrationResult> status = migrator.getStatus();
        assertEquals(1, status.size());
    }

    @Test
    public void testReset() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");

        VedaMigrator migrator = new VedaMigrator(client);
        migrator.reset();

        verify(client).exec(contains("DROP TABLE"));
    }

    @Test
    public void testGetCurrentVersion() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");

        VedaResult result = new VedaResult();
        result = spy(result);

        VedaMigrator migrator = new VedaMigrator(client);
        int version = migrator.getCurrentVersion();
        assertEquals(0, version);
    }

    @Test
    public void testRollback() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");
        when(client.query(anyString())).thenReturn(new VedaResult());

        VedaMigrator migrator = new VedaMigrator(client)
            .addMigration(1, "Create users", "CREATE TABLE users (id INT);", "DROP TABLE users;");

        migrator.migrate();
        VedaMigrator.MigrationResult rollback = migrator.rollback();
        assertNotNull(rollback);
    }

    @Test
    public void testRollbackNoMigrations() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");
        when(client.query(anyString())).thenReturn(new VedaResult());

        VedaMigrator migrator = new VedaMigrator(client);
        VedaMigrator.MigrationResult result = migrator.rollback();
        assertEquals(VedaMigrator.Status.PENDING, result.getStatus());
    }

    @Test
    public void testRollbackNoDownSql() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");
        when(client.query(anyString())).thenReturn(new VedaResult());

        VedaMigrator migrator = new VedaMigrator(client)
            .addMigration(1, "M1", "SQL1"); // No down SQL

        migrator.migrate();
        VedaMigrator.MigrationResult result = migrator.rollback();
        assertEquals(VedaMigrator.Status.FAILED, result.getStatus());
    }

    @Test
    public void testDuplicateMigrate() throws Exception {
        VedaClient client = mock(VedaClient.class);
        when(client.exec(anyString())).thenReturn("OK");
        when(client.query(anyString())).thenReturn(new VedaResult());

        VedaMigrator migrator = new VedaMigrator(client)
            .addMigration(1, "M1", "SQL1");

        List<VedaMigrator.MigrationResult> first = migrator.migrate();
        assertEquals(VedaMigrator.Status.APPLIED, first.get(0).getStatus());

        // Second time should show as already applied
        List<VedaMigrator.MigrationResult> second = migrator.migrate();
        assertEquals(VedaMigrator.Status.APPLIED, second.get(0).getStatus());
        assertTrue(second.get(0).getMessage().contains("Already"));
    }

    @Test
    public void testEnumValues() {
        assertEquals(4, VedaMigrator.Status.values().length);
        assertEquals(VedaMigrator.Status.PENDING, VedaMigrator.Status.valueOf("PENDING"));
        assertEquals(VedaMigrator.Status.APPLIED, VedaMigrator.Status.valueOf("APPLIED"));
        assertEquals(VedaMigrator.Status.FAILED, VedaMigrator.Status.valueOf("FAILED"));
        assertEquals(VedaMigrator.Status.ROLLED_BACK, VedaMigrator.Status.valueOf("ROLLED_BACK"));
    }
}
