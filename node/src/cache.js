/**
 * VedaDB Node.js Driver - Query Cache
 *
 * Client-side query result caching with TTL support,
 * LRU eviction, and cache invalidation strategies.
 */

'use strict';

const { EventEmitter } = require('events');

/**
 * Cache entry with metadata.
 */
class CacheEntry {
  /**
   * @param {*} value - Cached value
   * @param {number} ttlMs - Time-to-live in milliseconds
   */
  constructor(value, ttlMs) {
    this.value = value;
    this.created = Date.now();
    this.expires = ttlMs > 0 ? this.created + ttlMs : Infinity;
    this.hits = 0;
  }

  /** Whether this entry has expired. */
  get isExpired() {
    return Date.now() > this.expires;
  }
}

/**
 * LRU query cache for VedaDB results.
 */
class QueryCache extends EventEmitter {
  /**
   * @param {Object} options
   * @param {number} [options.maxSize=1000] - Maximum number of entries
   * @param {number} [options.defaultTTLMs=60000] - Default TTL in milliseconds (0 = no expiry)
   * @param {number} [options.checkIntervalMs=60000] - Cleanup interval for expired entries
   */
  constructor(options = {}) {
    super();
    this.maxSize = options.maxSize || 1000;
    this.defaultTTLMs = options.defaultTTLMs || 60000;
    this._cache = new Map();
    this._accessOrder = []; // LRU tracking
    this._hits = 0;
    this._misses = 0;
    this._cleanTimer = null;

    if (options.checkIntervalMs > 0) {
      this._cleanTimer = setInterval(() => this.cleanup(), options.checkIntervalMs);
    }
  }

  /** Number of cached entries. */
  get size() {
    return this._cache.size;
  }

  /** Cache hit rate (0-1). */
  get hitRate() {
    const total = this._hits + this._misses;
    return total > 0 ? this._hits / total : 0;
  }

  /** Stats snapshot. */
  get stats() {
    return {
      size: this._cache.size,
      maxSize: this.maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: this.hitRate,
    };
  }

  /**
   * Build a cache key from a query and parameters.
   *
   * @param {string} sql
   * @param {Array} [params]
   * @returns {string}
   */
  key(sql, params) {
    if (!params || params.length === 0) return sql;
    return `${sql}::${JSON.stringify(params)}`;
  }

  /**
   * Get a cached value.
   *
   * @param {string} sql
   * @param {Array} [params]
   * @returns {*} Cached value or undefined
   */
  get(sql, params) {
    const key = this.key(sql, params);
    const entry = this._cache.get(key);

    if (!entry) {
      this._misses++;
      return undefined;
    }

    if (entry.isExpired) {
      this._cache.delete(key);
      this._removeFromOrder(key);
      this._misses++;
      this.emit('expire', { key, sql });
      return undefined;
    }

    entry.hits++;
    this._hits++;
    this._touch(key);
    this.emit('hit', { key, sql, age: Date.now() - entry.created });
    return entry.value;
  }

  /**
   * Set a cached value.
   *
   * @param {string} sql
   * @param {Array} [params]
   * @param {*} value - Value to cache
   * @param {number} [ttlMs] - Override default TTL
   */
  set(sql, params, value, ttlMs) {
    const key = this.key(sql, params);

    // Evict oldest if at capacity
    if (this._cache.size >= this.maxSize && !this._cache.has(key)) {
      this._evictLRU();
    }

    this._cache.set(key, new CacheEntry(value, ttlMs !== undefined ? ttlMs : this.defaultTTLMs));
    this._touch(key);
    this.emit('set', { key, sql });
  }

  /**
   * Check if a query result is cached and not expired.
   *
   * @param {string} sql
   * @param {Array} [params]
   * @returns {boolean}
   */
  has(sql, params) {
    const key = this.key(sql, params);
    const entry = this._cache.get(key);
    if (!entry) return false;
    if (entry.isExpired) {
      this._cache.delete(key);
      this._removeFromOrder(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a cached entry.
   *
   * @param {string} sql
   * @param {Array} [params]
   * @returns {boolean} Whether an entry was deleted
   */
  delete(sql, params) {
    const key = this.key(sql, params);
    const had = this._cache.delete(key);
    if (had) this._removeFromOrder(key);
    return had;
  }

  /**
   * Invalidate all entries matching a pattern.
   *
   * @param {RegExp|string} pattern
   * @returns {number} Number of entries invalidated
   */
  invalidate(pattern) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    let count = 0;
    for (const key of this._cache.keys()) {
      if (regex.test(key)) {
        this._cache.delete(key);
        this._removeFromOrder(key);
        count++;
      }
    }
    this.emit('invalidate', { pattern: pattern.toString(), count });
    return count;
  }

  /**
   * Invalidate cache entries for a specific table.
   *
   * @param {string} tableName
   * @returns {number}
   */
  invalidateTable(tableName) {
    return this.invalidate(new RegExp(`\\b${tableName}\\b`, 'i'));
  }

  /** Clear all entries. */
  clear() {
    this._cache.clear();
    this._accessOrder = [];
    this._hits = 0;
    this._misses = 0;
    this.emit('clear');
  }

  /** Remove expired entries. */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this._cache) {
      if (entry.expires <= now) {
        this._cache.delete(key);
        this._removeFromOrder(key);
        removed++;
      }
    }
    if (removed > 0) {
      this.emit('cleanup', { removed });
    }
  }

  /** Destroy the cache. */
  destroy() {
    if (this._cleanTimer) {
      clearInterval(this._cleanTimer);
      this._cleanTimer = null;
    }
    this.clear();
    this.removeAllListeners();
  }

  // -- internal -------------------------------------------------------------

  _touch(key) {
    const idx = this._accessOrder.indexOf(key);
    if (idx !== -1) this._accessOrder.splice(idx, 1);
    this._accessOrder.push(key);
  }

  _removeFromOrder(key) {
    const idx = this._accessOrder.indexOf(key);
    if (idx !== -1) this._accessOrder.splice(idx, 1);
  }

  _evictLRU() {
    if (this._accessOrder.length === 0) return;
    const oldest = this._accessOrder.shift();
    this._cache.delete(oldest);
    this.emit('evict', { key: oldest });
  }
}

module.exports = { QueryCache };
