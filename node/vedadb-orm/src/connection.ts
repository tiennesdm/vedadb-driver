/**
 * VedaDB ORM Connection (VedaORM class)
 *
 * Main entry point for the ORM. Manages the driver connection,
 * model registry, sessions, and transactions.
 */

import { DriverClient, DriverPool, DriverResult } from './types';
import { SchemaDefinition } from './schema';
import { Model } from './model';
import { Session } from './session';
import { RelationshipDefinition } from './relationships';
import { PopulationContext } from './population';
import { MigrationRunner } from './migration';
import { ConnectionError } from './errors';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface VedaORMOptions {
  /** A pre-created VedaDB client instance. */
  client?: DriverClient;
  /** A pre-created VedaPool instance. */
  pool?: DriverPool;
  /** Connection config for creating a client on the fly. */
  connection?: {
    host?: string;
    port?: number;
    timeout?: number;
    tls?: boolean;
    user?: string;
    password?: string;
  };
  /** Whether to use the pool for queries (default: true if pool is provided). */
  usePool?: boolean;
}

// ---------------------------------------------------------------------------
// VedaORM
// ---------------------------------------------------------------------------

export class VedaORM {
  private client: DriverClient | null = null;
  private pool: DriverPool | null = null;
  private options: VedaORMOptions;
  private _connected: boolean = false;
  private _models: Map<string, Model<any>> = new Map();
  private _schemas: Map<string, SchemaDefinition<any>> = new Map();
  private _relationships: Map<string, Record<string, RelationshipDefinition>> = new Map();
  private _migrationRunner: MigrationRunner | null = null;

  constructor(options: VedaORMOptions) {
    this.options = options;
    if (options.client) this.client = options.client;
    if (options.pool) this.pool = options.pool;
  }

  /**
   * Whether the ORM is connected.
   */
  get connected(): boolean {
    return this._connected;
  }

  /**
   * Map of registered models keyed by schema name.
   */
  get models(): Map<string, Model<any>> {
    return this._models;
  }

  // ---- Connection lifecycle -----------------------------------------------

  async connect(): Promise<void> {
    if (this._connected) return;

    if (this.pool) {
      // Pool-based: test connectivity by running a lightweight query
      try {
        await this.pool.query('SHOW TABLES;');
      } catch (err: any) {
        throw new ConnectionError(`Pool connection test failed: ${err.message}`);
      }
      this._connected = true;
      return;
    }

    if (this.client) {
      if (!this.client.connected) {
        await this.client.connect();
      }
      this._connected = true;
      return;
    }

    // Auto-create a client from connection options
    if (this.options.connection) {
      try {
        // Dynamic import of the vedadb driver
        const vedadb = require('vedadb');
        this.client = new vedadb.VedaDB(this.options.connection);
        await this.client!.connect();
        this._connected = true;
      } catch (err: any) {
        throw new ConnectionError(`Failed to connect: ${err.message}`);
      }
      return;
    }

    throw new ConnectionError('No client, pool, or connection options provided');
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      this.pool.close();
    } else if (this.client) {
      this.client.close();
    }
    this._connected = false;
  }

  // ---- Query execution (routes through pool or client) --------------------

  async query(sql: string): Promise<DriverResult> {
    if (!this._connected) {
      throw new ConnectionError('Not connected. Call connect() first.');
    }
    if (this.pool) {
      return this.pool.query(sql);
    }
    return this.client!.query(sql);
  }

  // ---- Model registration -------------------------------------------------

  register<T = any>(schema: SchemaDefinition<T>): Model<T> {
    const model = new Model<T>(schema, (sql) => this.query(sql));

    // Store schema and relationships
    this._schemas.set(schema.name, schema);
    if (!this._relationships.has(schema.name)) {
      this._relationships.set(schema.name, {});
    }

    // Set up population context for eager loading
    const populationCtx: PopulationContext = {
      executor: (sql) => this.query(sql),
      getSchema: (name) => this._schemas.get(name),
      getRelationships: (name) => this._relationships.get(name) || {},
      hydrateRows: (schemaName, result) => {
        const m = this._models.get(schemaName);
        return m ? m._fromResult(result) : result.toObjects();
      },
    };
    model.setPopulationContext(populationCtx);

    this._models.set(schema.name, model);
    return model;
  }

  /**
   * Get a registered model by schema name.
   */
  model<T = any>(name: string): Model<T> {
    const m = this._models.get(name);
    if (!m) throw new Error(`Model '${name}' is not registered`);
    return m as Model<T>;
  }

  // ---- Relationship wiring ------------------------------------------------

  /**
   * Define a relationship between two registered models.
   */
  defineRelationship(
    modelName: string,
    relationName: string,
    def: RelationshipDefinition
  ): void {
    const rels = this._relationships.get(modelName) || {};
    rels[relationName] = def;
    this._relationships.set(modelName, rels);

    const model = this._models.get(modelName);
    if (model) {
      model.addRelationship(relationName, def);
    }
  }

  // ---- Session / Transaction ----------------------------------------------

  async session(): Promise<Session> {
    if (this.pool) {
      return Session.create(() => this.pool!.acquire());
    }
    if (this.client) {
      // For single-client, wrap it
      return Session.create(() => Promise.resolve(this.client!));
    }
    throw new ConnectionError('No client or pool available for sessions');
  }

  async transaction<R>(fn: (session: Session) => Promise<R>): Promise<R> {
    if (this.pool) {
      return Session.transaction(() => this.pool!.acquire(), fn);
    }
    if (this.client) {
      return Session.transaction(() => Promise.resolve(this.client!), fn);
    }
    throw new ConnectionError('No client or pool available for transactions');
  }

  // ---- Migration runner ---------------------------------------------------

  migrations(): MigrationRunner {
    if (!this._migrationRunner) {
      this._migrationRunner = new MigrationRunner((sql) => this.query(sql));
    }
    return this._migrationRunner;
  }

  // ---- Sync all models to database ----------------------------------------

  async syncAll(): Promise<void> {
    for (const model of this._models.values()) {
      await model.sync();
    }
  }
}
