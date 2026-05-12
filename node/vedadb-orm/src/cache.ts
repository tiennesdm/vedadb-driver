/**
 * VedaDB ORM CacheProxy
 *
 * Provides model-level caching via the VedaDB CACHE sub-API.
 */

import { DriverClient, DriverResult } from './types';
import { SchemaDefinition } from './schema';
import { escapeValue } from './utils';

export class CacheProxy<T = any> {
  private schema: SchemaDefinition<T>;
  private executor: (sql: string) => Promise<DriverResult>;
  private defaultTTL: number;

  constructor(
    schema: SchemaDefinition<T>,
    executor: (sql: string) => Promise<DriverResult>,
    defaultTTL: number = 300
  ) {
    this.schema = schema;
    this.executor = executor;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Build a cache key for a given model record by its primary key.
   */
  private cacheKey(id: any): string {
    return `${this.schema.tableName}:${id}`;
  }

  /**
   * Store a model instance in cache.
   */
  async set(id: any, data: Partial<T>, ttl?: number): Promise<void> {
    const key = this.cacheKey(id);
    const value = JSON.stringify(data).replace(/'/g, "''");
    const t = ttl ?? this.defaultTTL;
    await this.executor(`CACHE SET '${key}' '${value}' TTL ${t};`);
  }

  /**
   * Retrieve a model instance from cache.
   */
  async get(id: any): Promise<Partial<T> | null> {
    const key = this.cacheKey(id);
    const result = await this.executor(`CACHE GET '${key}';`);
    const obj = result.first();
    if (!obj) return null;
    const raw = obj['value'] || obj[Object.keys(obj)[0]];
    if (!raw) return null;
    try {
      return JSON.parse(String(raw)) as Partial<T>;
    } catch {
      return null;
    }
  }

  /**
   * Delete a model instance from cache.
   */
  async del(id: any): Promise<void> {
    const key = this.cacheKey(id);
    await this.executor(`CACHE DEL '${key}';`);
  }

  /**
   * Invalidate all cache entries for this model.
   */
  async invalidateAll(): Promise<void> {
    const pattern = `${this.schema.tableName}:*`;
    await this.executor(`CACHE DEL '${pattern}';`);
  }

  /**
   * Get-or-set: return cached value or execute finder and cache result.
   */
  async getOrSet(id: any, finder: () => Promise<T | null>, ttl?: number): Promise<T | null> {
    const cached = await this.get(id);
    if (cached) return cached as T;

    const value = await finder();
    if (value) {
      await this.set(id, value as Partial<T>, ttl);
    }
    return value;
  }
}
