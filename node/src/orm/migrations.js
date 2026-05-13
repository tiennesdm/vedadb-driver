/**
 * VedaDB ORM Migration Runner
 *
 * Manages database schema migrations with up/down support.
 *
 * @example
 * const { MigrationRunner } = require('vedadb/orm/migrations');
 *
 * const runner = new MigrationRunner(client, './migrations');
 * await runner.up();        // Run all pending migrations
 * await runner.down(1);     // Rollback 1 migration
 * await runner.status();    // Show migration status
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Represents a single migration.
 */
class Migration {
  constructor(version, name, upFn, downFn) {
    this.version = version;
    this.name = name;
    this.up = upFn;
    this.down = downFn;
  }
}

/**
 * Migration runner that manages schema changes.
 */
class MigrationRunner {
  constructor(client, migrationsDir) {
    this.client = client;
    this.migrationsDir = migrationsDir;
    this.migrations = [];
  }

  /**
   * Initialize the migrations tracking table.
   */
  async init() {
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /**
   * Load migrations from the migrations directory.
   */
  loadMigrations() {
    if (!fs.existsSync(this.migrationsDir)) {
      return;
    }
    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.js'))
      .sort();

    for (const file of files) {
      const filepath = path.join(this.migrationsDir, file);
      const mod = require(filepath);
      const version = file.split('_')[0];
      const name = file.replace(/\.js$/, '');
      this.migrations.push(new Migration(
        version,
        name,
        mod.up || (async () => {}),
        mod.down || (async () => {})
      ));
    }
  }

  /**
   * Get list of already applied migrations.
   */
  async appliedMigrations() {
    await this.init();
    const result = await this.client.query(
      'SELECT version FROM _schema_migrations ORDER BY version;'
    );
    return new Set(result.rows.map(r => r[0]));
  }

  /**
   * Run all pending migrations.
   */
  async up() {
    this.loadMigrations();
    const applied = await this.appliedMigrations();
    const pending = this.migrations.filter(m => !applied.has(m.version));

    for (const migration of pending) {
      console.log(`Applying migration: ${migration.name}`);
      await this.client.begin();
      try {
        await migration.up(this.client);
        await this.client.query(
          'INSERT INTO _schema_migrations (version, name) VALUES ($1, $2);',
          [migration.version, migration.name]
        );
        await this.client.commit();
        console.log(`Applied: ${migration.name}`);
      } catch (err) {
        await this.client.rollback();
        throw new Error(`Migration ${migration.name} failed: ${err.message}`);
      }
    }
    return pending.length;
  }

  /**
   * Rollback the last N migrations.
   */
  async down(count = 1) {
    this.loadMigrations();
    const result = await this.client.query(
      'SELECT version, name FROM _schema_migrations ORDER BY version DESC LIMIT $1;',
      [count]
    );
    const toRollback = result.rows.map(r => ({
      version: r[0],
      name: r[1],
    }));

    for (const row of toRollback) {
      const migration = this.migrations.find(m => m.version === row.version);
      if (!migration) {
        console.warn(`Migration ${row.version} not found for rollback`);
        continue;
      }
      console.log(`Rolling back: ${migration.name}`);
      await this.client.begin();
      try {
        await migration.down(this.client);
        await this.client.query(
          'DELETE FROM _schema_migrations WHERE version = $1;',
          [migration.version]
        );
        await this.client.commit();
        console.log(`Rolled back: ${migration.name}`);
      } catch (err) {
        await this.client.rollback();
        throw new Error(`Rollback ${migration.name} failed: ${err.message}`);
      }
    }
    return toRollback.length;
  }

  /**
   * Show migration status.
   */
  async status() {
    this.loadMigrations();
    const applied = await this.appliedMigrations();
    return this.migrations.map(m => ({
      version: m.version,
      name: m.name,
      applied: applied.has(m.version),
    }));
  }

  /**
   * Create a new migration file.
   */
  createMigration(name) {
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const filename = `${timestamp}_${name}.js`;
    const filepath = path.join(this.migrationsDir, filename);

    const template = `'use strict';

/**
 * Migration: ${name}
 */

module.exports = {
  async up(client) {
    // Write your "up" migration here
    // Example:
    // await client.execute(
    //   'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);'
    // );
  },

  async down(client) {
    // Write your "down" migration here
    // Example:
    // await client.execute('DROP TABLE IF EXISTS users;');
  },
};
`;
    fs.writeFileSync(filepath, template);
    return filepath;
  }
}

module.exports = { MigrationRunner, Migration };
