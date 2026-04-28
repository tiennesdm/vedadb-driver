/**
 * VedaDB ORM Migration System
 */

import { DriverResult } from './types';
import { MigrationError } from './errors';
import { escapeIdentifier, escapeValue } from './utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationAction {
  up: string;
  down: string;
}

export interface MigrationDefinition {
  version: string;
  name: string;
  timestamp: number;
  actions: MigrationAction[];
}

export interface MigrationRecord {
  version: string;
  name: string;
  applied_at: string;
}

// ---------------------------------------------------------------------------
// Migration Runner
// ---------------------------------------------------------------------------

export class MigrationRunner {
  private executor: (sql: string) => Promise<DriverResult>;
  private migrations: MigrationDefinition[] = [];
  private tableName: string;

  constructor(executor: (sql: string) => Promise<DriverResult>, tableName: string = '_veda_migrations') {
    this.executor = executor;
    this.tableName = tableName;
  }

  /**
   * Register a migration.
   */
  add(migration: MigrationDefinition): void {
    this.migrations.push(migration);
    // Keep sorted by timestamp
    this.migrations.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Ensure the migrations tracking table exists.
   */
  async init(): Promise<void> {
    const table = escapeIdentifier(this.tableName);
    await this.executor(
      `CREATE TABLE IF NOT EXISTS ${table} (` +
      `  "version" TEXT PRIMARY KEY,` +
      `  "name" TEXT NOT NULL,` +
      `  "applied_at" TIMESTAMP NOT NULL` +
      `);`
    );
  }

  /**
   * Get all applied migrations.
   */
  async applied(): Promise<MigrationRecord[]> {
    await this.init();
    const table = escapeIdentifier(this.tableName);
    const result = await this.executor(`SELECT * FROM ${table} ORDER BY "version" ASC;`);
    return result.toObjects() as MigrationRecord[];
  }

  /**
   * Get pending migrations (registered but not yet applied).
   */
  async pending(): Promise<MigrationDefinition[]> {
    const appliedVersions = new Set((await this.applied()).map((r) => r.version));
    return this.migrations.filter((m) => !appliedVersions.has(m.version));
  }

  /**
   * Run all pending migrations (up).
   */
  async up(): Promise<string[]> {
    const pendingMigrations = await this.pending();
    const applied: string[] = [];

    for (const migration of pendingMigrations) {
      try {
        // Run inside a transaction
        await this.executor('BEGIN;');

        for (const action of migration.actions) {
          await this.executor(action.up);
        }

        // Record migration
        const table = escapeIdentifier(this.tableName);
        await this.executor(
          `INSERT INTO ${table} ("version", "name", "applied_at") VALUES (${escapeValue(migration.version)}, ${escapeValue(migration.name)}, ${escapeValue(new Date().toISOString())});`
        );

        await this.executor('COMMIT;');
        applied.push(migration.version);
      } catch (err: any) {
        await this.executor('ROLLBACK;').catch(() => {});
        throw new MigrationError(`Migration '${migration.version}' (${migration.name}) failed: ${err.message}`);
      }
    }

    return applied;
  }

  /**
   * Rollback the last applied migration (down).
   */
  async down(): Promise<string | null> {
    const appliedList = await this.applied();
    if (appliedList.length === 0) return null;

    const lastApplied = appliedList[appliedList.length - 1];
    const migration = this.migrations.find((m) => m.version === lastApplied.version);
    if (!migration) {
      throw new MigrationError(`Migration '${lastApplied.version}' not found in registered migrations`);
    }

    try {
      await this.executor('BEGIN;');

      // Run down actions in reverse order
      for (let i = migration.actions.length - 1; i >= 0; i--) {
        await this.executor(migration.actions[i].down);
      }

      // Remove migration record
      const table = escapeIdentifier(this.tableName);
      await this.executor(`DELETE FROM ${table} WHERE "version" = ${escapeValue(migration.version)};`);

      await this.executor('COMMIT;');
      return migration.version;
    } catch (err: any) {
      await this.executor('ROLLBACK;').catch(() => {});
      throw new MigrationError(`Rollback of '${migration.version}' failed: ${err.message}`);
    }
  }

  /**
   * Rollback all applied migrations.
   */
  async reset(): Promise<string[]> {
    const rolledBack: string[] = [];
    let version = await this.down();
    while (version) {
      rolledBack.push(version);
      version = await this.down();
    }
    return rolledBack;
  }

  /**
   * Get migration status.
   */
  async status(): Promise<{ applied: MigrationRecord[]; pending: MigrationDefinition[] }> {
    return {
      applied: await this.applied(),
      pending: await this.pending(),
    };
  }
}

// ---------------------------------------------------------------------------
// Migration definition helper
// ---------------------------------------------------------------------------

export function defineMigration(
  version: string,
  name: string,
  actions: MigrationAction[]
): MigrationDefinition {
  return {
    version,
    name,
    timestamp: Date.now(),
    actions,
  };
}
