/**
 * VedaDB Node.js Driver - Connection Pool
 *
 * A connection pool with configurable min/max size, idle timeout,
 * health checks, and a wait queue for when all connections are in use.
 * Extends EventEmitter for lifecycle events.
 */

'use strict';

const { EventEmitter } = require('events');
const { VedaClient } = require('./client');
const {
  ConnectionError, PoolExhaustedError, PoolClosedError, TimeoutError,
} = require('./errors');
const { HealthChecker, HealthStatus } = require('./health');

/**
 * Connection pool for VedaDB clients.
 * Emits: acquire, release, error, drain, connect, disconnect, pool_acquire, pool_release
 */
class ConnectionPool extends EventEmitter {
  /**
   * @param {Object} config - Pool configuration
   * @param {string} [config.host='localhost']
   * @param {number} [config.port=6380]
   * @param {number} [config.minSize=2] - Minimum connections to maintain
   * @param {number} [config.maxSize=20] - Maximum connections allowed
   * @param {number} [config.acquireTimeout=10000] - Max wait for acquire (ms)
   * @param {number} [config.idleTimeout=300000] - Close idle connections after (ms)
   * @param {number} [config.healthCheckInterval=10000] - Health check interval (ms)
   * @param {number} [config.timeout=30000] - Socket timeout per connection
   * @param {boolean} [config.tls=false]
   * @param {Object} [config.tlsOptions]
   * @param {string} [config.username]
   * @param {string} [config.password]
   * @param {string} [config.database]
   * @param {boolean} [config.warmup=true] - Pre-create min connections on init
   */
  constructor(config = {}) {
    super();
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 6380,
      minSize: config.minSize || config.min || 2,
      maxSize: config.maxSize || config.max || 20,
      acquireTimeout: config.acquireTimeout || 10000,
      idleTimeout: config.idleTimeout || 300000,
      healthCheckInterval: config.healthCheckInterval || 10000,
      timeout: config.timeout || 30000,
      tls: config.tls || false,
      tlsOptions: config.tlsOptions || {},
      username: config.username || config.user || '',
      password: config.password || '',
      database: config.database || '',
      warmup: config.warmup !== false,
    };

    this._idle = [];        // { client, idleTimer, createdAt }
    this._active = 0;       // Number of checked-out connections
    this._total = 0;        // Total connections (idle + active)
    this._waitQueue = [];   // { resolve, reject, timer }
    this._closed = false;
    this._draining = false;
    this._healthChecker = null;
    this._healthTimer = null;

    if (this.config.warmup) {
      this._warmup().catch(() => {});
    }

    // Start health checks
    this._startHealthChecks();
  }

  /** Total connections (active + idle). */
  get total() {
    return this._total;
  }

  /** Number of idle connections. */
  get available() {
    return this._idle.length;
  }

  /** Number of connections in use. */
  get inUse() {
    return this._active;
  }

  /** Number of callers waiting. */
  get waiting() {
    return this._waitQueue.length;
  }

  /** Pool statistics. */
  get stats() {
    return {
      total: this._total,
      available: this._idle.length,
      inUse: this._active,
      waiting: this._waitQueue.length,
      maxSize: this.config.maxSize,
      minSize: this.config.minSize,
      closed: this._closed,
    };
  }

  // -- Connection Management ------------------------------------------------

  /**
   * Acquire a connection from the pool.
   * Waits up to acquireTimeout if pool is exhausted.
   * @returns {Promise<VedaClient>}
   * @throws {PoolClosedError} If pool is closed
   * @throws {PoolExhaustedError} If acquire times out
   */
  async acquire() {
    if (this._closed) {
      throw new PoolClosedError();
    }
    if (this._draining) {
      throw new PoolClosedError('Pool is draining');
    }

    this.emit('pool_acquire', this.stats);

    // 1. Try to grab an idle connection
    while (this._idle.length > 0) {
      const entry = this._idle.pop();
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      if (!entry.client.connected) {
        this._destroyClient(entry.client);
        continue;
      }
      this._active++;
      this.emit('acquire', { client: entry.client });
      return entry.client;
    }

    // 2. If room, create a new connection
    if (this._total < this.config.maxSize) {
      this._total++;
      this._active++;
      try {
        const client = await this._createConnection();
        this.emit('acquire', { client });
        return client;
      } catch (err) {
        this._total--;
        this._active--;
        throw err;
      }
    }

    // 3. Wait for a connection to be released
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waitQueue.findIndex(w => w.timer === timer);
        if (idx !== -1) this._waitQueue.splice(idx, 1);
        reject(new PoolExhaustedError(
          `Acquire timeout: could not get a connection within ${this.config.acquireTimeout}ms`
        ));
      }, this.config.acquireTimeout);

      this._waitQueue.push({ resolve, reject, timer });
    });
  }

  /**
   * Release a connection back to the pool.
   * @param {VedaClient} client
   */
  release(client) {
    if (!client) return;

    this._active--;
    this.emit('pool_release', this.stats);

    if (this._closed || this._draining || !client.connected) {
      this._destroyClient(client);

      // If draining and no more active connections, signal completion
      if (this._draining && this._active === 0) {
        this.emit('drained');
      }
      return;
    }

    // If someone is waiting, hand it directly
    if (this._waitQueue.length > 0) {
      const waiter = this._waitQueue.shift();
      clearTimeout(waiter.timer);
      this._active++;
      waiter.resolve(client);
      this.emit('release', { client, toWaiter: true });
      return;
    }

    // Otherwise return to idle pool
    this._putIdle(client);
    this.emit('release', { client, toWaiter: false });
  }

  /**
   * Execute a function with an auto-released connection.
   * @template T
   * @param {function(VedaClient): Promise<T>} fn
   * @returns {Promise<T>}
   */
  async withConnection(fn) {
    const client = await this.acquire();
    try {
      return await fn(client);
    } finally {
      this.release(client);
    }
  }

  // -- Query Delegation -----------------------------------------------------

  /**
   * Execute a query using a pooled connection.
   * @param {string} sql
   * @param {Array} [params]
   * @returns {Promise<import('./protocol').Result>}
   */
  async query(sql, params) {
    return this.withConnection(client => client.query(sql, params));
  }

  /**
   * Execute a statement using a pooled connection.
   * @param {string} sql
   * @returns {Promise<string>}
   */
  async execute(sql) {
    return this.withConnection(client => client.execute(sql));
  }

  /**
   * Pipeline queries using a pooled connection.
   * @param {string[]} queries
   * @returns {Promise<import('./protocol').Result[]>}
   */
  async pipeline(queries) {
    return this.withConnection(client => client.pipelineQueries(queries));
  }

  /**
   * Execute a parameterized query.
   * @param {string} template
   * @param {Array} [params]
   * @returns {Promise<import('./protocol').Result>}
   */
  async prepared(template, params = []) {
    return this.withConnection(client => client.prepared(template, params));
  }

  /**
   * Ping the pool (uses an idle connection or creates one).
   * @returns {Promise<boolean>}
   */
  async ping() {
    return this.withConnection(client => client.ping());
  }

  // -- Lifecycle ------------------------------------------------------------

  /**
   * Warm the pool by pre-creating min connections.
   * @returns {Promise<void>}
   */
  async warmup() {
    return this._warmup();
  }

  /**
   * Drain the pool: close idle connections and wait for active ones.
   * @returns {Promise<void>}
   */
  async drain() {
    if (this._draining) return;
    this._draining = true;
    this.emit('drain', { active: this._active, idle: this._idle.length });

    // Stop health checks
    this._stopHealthChecks();

    // Close all idle connections
    for (const entry of this._idle) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      try { entry.client.close(); } catch (_e) {}
    }
    this._total -= this._idle.length;
    this._idle = [];

    // Reject all waiters
    for (const waiter of this._waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new PoolClosedError('Pool is draining'));
    }
    this._waitQueue = [];

    // Wait for active connections to be released
    if (this._active > 0) {
      await new Promise((resolve) => {
        const check = () => {
          if (this._active <= 0) {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    }

    this._draining = false;
    this._closed = true;
    this.emit('drained');
  }

  /**
   * Close the pool immediately (reject waiters, destroy connections).
   */
  close() {
    this._closed = true;
    this._stopHealthChecks();

    // Reject all waiters
    for (const waiter of this._waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new PoolClosedError());
    }
    this._waitQueue = [];

    // Close all idle connections
    for (const entry of this._idle) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      try { entry.client.close(); } catch (_e) {}
    }
    this._total -= this._idle.length;
    this._idle = [];

    this.emit('close');
  }

  // -- Internal -------------------------------------------------------------

  async _warmup() {
    const needed = Math.min(this.config.minSize, this.config.maxSize);
    const promises = [];
    for (let i = this._total; i < needed; i++) {
      promises.push(this._createConnection().then(client => {
        this._putIdle(client);
      }).catch(() => {}));
    }
    await Promise.all(promises);
  }

  async _createConnection() {
    const client = new VedaClient({
      host: this.config.host,
      port: this.config.port,
      timeout: this.config.timeout,
      tls: this.config.tls,
      tlsOptions: this.config.tlsOptions,
      username: this.config.username,
      password: this.config.password,
      database: this.config.database,
      autoReconnect: false,
    });
    await client.connect();
    this.emit('connect', { client });
    return client;
  }

  _putIdle(client) {
    let idleTimer = null;

    if (this.config.idleTimeout > 0 && this._idle.length >= this.config.minSize) {
      idleTimer = setTimeout(() => {
        const idx = this._idle.findIndex(e => e.client === client);
        if (idx !== -1) {
          this._idle.splice(idx, 1);
          this._destroyClient(client);
        }
      }, this.config.idleTimeout);
    }

    this._idle.push({ client, idleTimer, createdAt: Date.now() });
  }

  _destroyClient(client) {
    this._total--;
    try { client.close(); } catch (_e) {}
    this.emit('disconnect', { stats: this.stats });
  }

  _startHealthChecks() {
    if (this.config.healthCheckInterval <= 0) return;
    this._healthTimer = setInterval(async () => {
      // Remove dead connections from idle pool
      const dead = [];
      for (let i = this._idle.length - 1; i >= 0; i--) {
        const entry = this._idle[i];
        if (!entry.client.connected) {
          dead.push(i);
        }
      }
      for (const idx of dead) {
        const entry = this._idle.splice(idx, 1)[0];
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        this._destroyClient(entry.client);
      }

      // Replenish if below min
      if (!this._closed && !this._draining && this._total < this.config.minSize) {
        this._warmup().catch(() => {});
      }
    }, this.config.healthCheckInterval);
  }

  _stopHealthChecks() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }
}

module.exports = { ConnectionPool };
