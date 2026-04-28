/**
 * VedaDB ORM Model
 *
 * The Model class provides CRUD operations, hooks, relationships,
 * and proxy access to cache, search, vector, graph, and document sub-APIs.
 */

import { FieldType, DriverResult, castValue } from './types';
import { SchemaDefinition, FieldDefinition, toCreateSQL } from './schema';
import { HookRegistry, HookType, HookContext, TimestampHook, SoftDeleteHook, ValidationHook } from './hooks';
import { RelationshipDefinition } from './relationships';
import { QueryBuilder } from './query-builder';
import { AggregationBuilder } from './aggregation';
import { CacheProxy } from './cache';
import { SearchProxy } from './search';
import { VectorProxy } from './vector';
import { GraphProxy } from './graph';
import { DocumentProxy } from './document';
import { PopulationContext, eagerLoad } from './population';
import { escapeIdentifier, escapeValue, buildSetClause } from './utils';
import { QueryError, ValidationError } from './errors';

// ---------------------------------------------------------------------------
// Model class
// ---------------------------------------------------------------------------

export class Model<T = any> {
  readonly schema: SchemaDefinition<T>;
  private executor: (sql: string) => Promise<DriverResult>;
  private hooks: HookRegistry<T>;
  private relationships: Record<string, RelationshipDefinition> = {};
  private populationCtx: PopulationContext | null = null;

  // Proxies (lazy-initialized)
  private _cache: CacheProxy<T> | null = null;
  private _search: SearchProxy<T> | null = null;
  private _vector: VectorProxy<T> | null = null;
  private _graph: GraphProxy<T> | null = null;
  private _document: DocumentProxy<T> | null = null;

  constructor(
    schema: SchemaDefinition<T>,
    executor: (sql: string) => Promise<DriverResult>
  ) {
    this.schema = schema;
    this.executor = executor;
    this.hooks = new HookRegistry<T>();

    // Register built-in hooks
    if (schema.options.timestamps) {
      const ts = TimestampHook<T>();
      this.hooks.register(HookType.BEFORE_CREATE, ts.beforeCreate);
      this.hooks.register(HookType.BEFORE_UPDATE, ts.beforeUpdate);
    }

    if (schema.options.softDelete) {
      const sd = SoftDeleteHook<T>();
      this.hooks.register(HookType.BEFORE_DELETE, sd.beforeDelete);
    }

    // Register validation hook
    const fieldsWithValidators: Record<string, { validators?: any[] }> = {};
    for (const [name, def] of Object.entries(schema.fields)) {
      if (def.validators && def.validators.length > 0) {
        fieldsWithValidators[name] = def;
      }
    }
    if (Object.keys(fieldsWithValidators).length > 0) {
      const vh = ValidationHook<T>(fieldsWithValidators);
      this.hooks.register(HookType.BEFORE_CREATE, vh.beforeCreate);
      this.hooks.register(HookType.BEFORE_UPDATE, vh.beforeUpdate);
    }
  }

  // ---- Population context (set by ORM) -----------------------------------

  setPopulationContext(ctx: PopulationContext): void {
    this.populationCtx = ctx;
  }

  // ---- Relationship registration -----------------------------------------

  addRelationship(name: string, def: RelationshipDefinition): void {
    this.relationships[name] = def;
  }

  getRelationships(): Record<string, RelationshipDefinition> {
    return { ...this.relationships };
  }

  // ---- Hook registration -------------------------------------------------

  hook(event: HookType, fn: (ctx: HookContext<T>) => Promise<void> | void): void {
    this.hooks.register(event, fn);
  }

  // ---- Hydration ---------------------------------------------------------

  /**
   * Hydrate model instances from a raw driver Result.
   */
  _fromResult(result: DriverResult): T[] {
    return result.toObjects().map((row) => this._fromRow(result.columns, row));
  }

  /**
   * Hydrate a single model instance from a row object.
   */
  _fromRow(columns: string[], row: Record<string, any>): T {
    const instance: Record<string, any> = {};

    for (const col of columns) {
      const fieldDef = this.schema.fields[col];
      if (fieldDef) {
        instance[col] = castValue(row[col], fieldDef.type);
      } else {
        // Extra columns (e.g. _distance from vector search)
        instance[col] = row[col];
      }
    }

    // Attach instance methods
    const self = this;
    const pk = this.schema.primaryKeyField;
    const pkValue = instance[pk];

    Object.defineProperty(instance, 'save', {
      enumerable: false,
      value: async function () {
        const data = { ...this };
        delete data[pk];
        // Remove non-enumerable methods
        for (const key of Object.keys(data)) {
          if (typeof data[key] === 'function') delete data[key];
        }
        await self.updateOne({ [pk]: pkValue } as any, data);
        return this;
      },
    });

    Object.defineProperty(instance, 'delete', {
      enumerable: false,
      value: async function () {
        await self.deleteOne({ [pk]: pkValue } as any);
      },
    });

    Object.defineProperty(instance, 'reload', {
      enumerable: false,
      value: async function () {
        const fresh = await self.findById(pkValue);
        if (fresh) {
          Object.assign(this, fresh);
        }
        return this;
      },
    });

    Object.defineProperty(instance, 'toJSON', {
      enumerable: false,
      value: function () {
        const obj: Record<string, any> = {};
        for (const key of Object.keys(this)) {
          if (typeof this[key] !== 'function') {
            obj[key] = this[key];
          }
        }
        return obj;
      },
    });

    return instance as T;
  }

  // ---- CREATE ------------------------------------------------------------

  async create(data: Partial<T>): Promise<T> {
    const ctx: HookContext<T> = { instance: { ...data }, operation: HookType.BEFORE_CREATE };
    await this.hooks.execute(HookType.BEFORE_VALIDATE, ctx);
    await this.hooks.execute(HookType.BEFORE_CREATE, ctx);

    const instance = ctx.instance;
    const fields = Object.keys(instance).filter((k) => instance[k as keyof typeof instance] !== undefined);
    const cols = fields.map(escapeIdentifier).join(', ');
    const vals = fields.map((f) => {
      const fieldDef = this.schema.fields[f];
      const value = instance[f as keyof typeof instance];
      return fieldDef ? escapeValue(value) : escapeValue(value);
    }).join(', ');

    const sql = `INSERT INTO ${escapeIdentifier(this.schema.tableName)} (${cols}) VALUES (${vals});`;
    await this.executor(sql);

    // After-create hook
    const afterCtx: HookContext<T> = { instance: ctx.instance, operation: HookType.AFTER_CREATE };
    await this.hooks.execute(HookType.AFTER_CREATE, afterCtx);

    // Return the created instance; try to reload by PK if available
    const pk = this.schema.primaryKeyField;
    const pkVal = ctx.instance[pk as keyof typeof ctx.instance];
    if (pkVal !== undefined) {
      const found = await this.findById(pkVal);
      if (found) return found;
    }

    return this._fromRow(fields, ctx.instance as Record<string, any>);
  }

  async createMany(items: Partial<T>[]): Promise<T[]> {
    const results: T[] = [];
    for (const item of items) {
      results.push(await this.create(item));
    }
    return results;
  }

  // ---- READ --------------------------------------------------------------

  async findById(id: any): Promise<T | null> {
    const pk = escapeIdentifier(this.schema.primaryKeyField);
    const table = escapeIdentifier(this.schema.tableName);
    let sql = `SELECT * FROM ${table} WHERE ${pk} = ${escapeValue(id)}`;
    if (this.schema.options.softDelete) {
      sql += ` AND ${escapeIdentifier('deleted_at')} IS NULL`;
    }
    sql += ' LIMIT 1;';

    const result = await this.executor(sql);
    const items = this._fromResult(result);
    return items.length > 0 ? items[0] : null;
  }

  async findOne(where: Partial<T>): Promise<T | null> {
    const qb = this.where(where as any);
    return qb.first();
  }

  async findMany(where?: Partial<T>): Promise<T[]> {
    if (where) {
      return this.where(where as any).all();
    }
    return this.where({} as any).all();
  }

  // ---- UPDATE ------------------------------------------------------------

  async updateOne(where: Partial<T>, data: Partial<T>): Promise<void> {
    const ctx: HookContext<T> = { instance: { ...data }, operation: HookType.BEFORE_UPDATE };
    await this.hooks.execute(HookType.BEFORE_VALIDATE, ctx);
    await this.hooks.execute(HookType.BEFORE_UPDATE, ctx);

    const setFields = Object.entries(ctx.instance)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${escapeIdentifier(k)} = ${escapeValue(v)}`)
      .join(', ');

    if (!setFields) return;

    const whereClause = Object.entries(where)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${escapeIdentifier(k)} = ${escapeValue(v)}`)
      .join(' AND ');

    const table = escapeIdentifier(this.schema.tableName);
    let sql = `UPDATE ${table} SET ${setFields} WHERE ${whereClause}`;
    if (this.schema.options.softDelete) {
      sql += ` AND ${escapeIdentifier('deleted_at')} IS NULL`;
    }
    sql += ';';

    await this.executor(sql);
    await this.hooks.execute(HookType.AFTER_UPDATE, { instance: ctx.instance, operation: HookType.AFTER_UPDATE });
  }

  async updateMany(where: Partial<T>, data: Partial<T>): Promise<void> {
    // Same as updateOne but without LIMIT
    await this.updateOne(where, data);
  }

  // ---- DELETE ------------------------------------------------------------

  async deleteOne(where: Partial<T>): Promise<void> {
    const ctx: HookContext<T> = { instance: { ...where }, operation: HookType.BEFORE_DELETE, meta: {} };
    await this.hooks.execute(HookType.BEFORE_DELETE, ctx);

    const whereClause = Object.entries(where)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${escapeIdentifier(k)} = ${escapeValue(v)}`)
      .join(' AND ');

    const table = escapeIdentifier(this.schema.tableName);

    if (ctx.meta?.['softDelete']) {
      // Soft delete: UPDATE with deleted_at
      const deletedAt = (ctx.instance as any)['deleted_at'] || new Date();
      await this.executor(
        `UPDATE ${table} SET ${escapeIdentifier('deleted_at')} = ${escapeValue(deletedAt)} WHERE ${whereClause};`
      );
    } else {
      await this.executor(`DELETE FROM ${table} WHERE ${whereClause};`);
    }

    await this.hooks.execute(HookType.AFTER_DELETE, { instance: ctx.instance, operation: HookType.AFTER_DELETE });
  }

  async deleteMany(where: Partial<T>): Promise<void> {
    await this.deleteOne(where);
  }

  // ---- COUNT / EXISTS ----------------------------------------------------

  async count(where?: Partial<T>): Promise<number> {
    if (where) {
      return this.where(where as any).count();
    }
    return this.where({} as any).count();
  }

  async exists(where: Partial<T>): Promise<boolean> {
    return this.where(where as any).exists();
  }

  // ---- QueryBuilder entry point ------------------------------------------

  where(conditions: any): QueryBuilder<T> {
    const qb = new QueryBuilder<T>(
      this.schema,
      this.executor,
      (result) => this._fromResult(result),
      this.populationCtx
        ? (items, relations) => eagerLoad(items, relations, this.schema, this.populationCtx!)
        : undefined
    );
    if (conditions && Object.keys(conditions).length > 0) {
      return qb.where(conditions);
    }
    return qb;
  }

  // ---- AggregationBuilder entry point ------------------------------------

  aggregate(): AggregationBuilder<T> {
    return new AggregationBuilder<T>(this.schema, this.executor);
  }

  // ---- Proxy accessors ---------------------------------------------------

  cache(): CacheProxy<T> {
    if (!this._cache) {
      const ttl = this.schema.options.cache?.ttl || 300;
      this._cache = new CacheProxy<T>(this.schema, this.executor, ttl);
    }
    return this._cache;
  }

  search(): SearchProxy<T> {
    if (!this._search) {
      this._search = new SearchProxy<T>(this.schema, this.executor, (r) => this._fromResult(r));
    }
    return this._search;
  }

  vectorSearch(): VectorProxy<T> {
    if (!this._vector) {
      this._vector = new VectorProxy<T>(this.schema, this.executor, (r) => this._fromResult(r));
    }
    return this._vector;
  }

  graph(): GraphProxy<T> {
    if (!this._graph) {
      this._graph = new GraphProxy<T>(this.schema, this.executor, (r) => this._fromResult(r));
    }
    return this._graph;
  }

  doc(): DocumentProxy<T> {
    if (!this._document) {
      this._document = new DocumentProxy<T>(this.schema, this.executor, (r) => this._fromResult(r));
    }
    return this._document;
  }

  // ---- DDL ---------------------------------------------------------------

  /**
   * Sync the schema to the database (create table if not exists).
   */
  async sync(): Promise<void> {
    const sql = toCreateSQL(this.schema);
    // Split on semicolons and execute each statement
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await this.executor(stmt + ';');
    }
  }
}
