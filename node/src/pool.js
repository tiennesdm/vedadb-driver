/**
 * VedaDB Node.js Driver - Connection Pool
 *
 * A connection pool with configurable min/max size, idle timeout,
 * and a wait queue for when all connections are in use.
 */

const { VedaDB, ConnectionError } = require('./client');

class VedaPool {
  /**
   * @param {Object} options
   * @param {string} [options.host='localhost']
   * @param {number} [options.port=6380]
   * @param {number} [options.min=0] - Minimum idle connections to keep
   * @param {number} [options.max=10] - Maximum total connections
   * @param {number} [options.timeout=30000] - Per-connection socket timeout
   * @param {number} [options.idleTimeout=60000] - Close idle connections after ms (0 = never)
   * @param {number} [options.acquireTimeout=10000] - Max wait time for acquire()
   */
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 6380;
    this.min = options.min || 0;
    this.max = options.max || 10;
    this.timeout = options.timeout || 30000;
    this.idleTimeout = options.idleTimeout != null ? options.idleTimeout : 60000;
    this.acquireTimeout = options.acquireTimeout || 10000;

    this._idle = [];        // { client, idleTimer }
    this._active = 0;       // number of checked-out connections
    this._total = 0;        // idle + active
    this._waitQueue = [];   // { resolve, reject, timer }
    this._closed = false;
    this._warmupDone = false;
  }

  /** Total connections (active + idle). */
  get size() {
    return this._total;
  }

  /** Number of idle connections available. */
  get idleCount() {
    return this._idle.length;
  }

  /** Number of connections currently checked out. */
  get activeCount() {
    return this._active;
  }

  /** Number of callers waiting for a connection. */
  get waitingCount() {
    return this._waitQueue.length;
  }

  /**
   * Warm the pool by pre-creating `min` connections.
   * Optional -- acquire() works without calling this.
   * @returns {Promise<void>}
   */
  async warmup() {
    if (this._warmupDone) return;
    const promises = [];
    for (let i = 0; i < this.min; i++) {
      promises.push(this._createConnection().then(client => {
        this._putIdle(client);
      }));
    }
    await Promise.all(promises);
    this._warmupDone = true;
  }

  /**
   * Acquire a connected client from the pool.
   * Waits up to `acquireTimeout` if the pool is exhausted.
   * @returns {Promise<VedaDB>}
   */
  acquire() {
    if (this._closed) {
      return Promise.reject(new ConnectionError('Pool is closed'));
    }

    // 1. Try to grab an idle connection
    while (this._idle.length > 0) {
      const entry = this._idle.pop();
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      if (!entry.client.connected) {
        this._destroyClient(entry.client);
        continue;
      }
      this._active++;
      return Promise.resolve(entry.client);
    }

    // 2. If room, create a new connection
    if (this._total < this.max) {
      this._total++;
      this._active++;
      return this._createConnection().catch(err => {
        this._total--;
        this._active--;
        throw err;
      });
    }

    // 3. Wait for one to be released
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waitQueue.findIndex(w => w.timer === timer);
        if (idx !== -1) this._waitQueue.splice(idx, 1);
        reject(new ConnectionError(
          `Acquire timeout: could not get a connection within ${this.acquireTimeout}ms`
        ));
      }, this.acquireTimeout);

      this._waitQueue.push({ resolve, reject, timer });
    });
  }

  /**
   * Return a client to the pool. If the pool is closed or the
   * connection is broken, the client is destroyed instead.
   * @param {VedaDB} client
   */
  release(client) {
    if (this._closed || !client.connected) {
      this._destroyClient(client);
      return;
    }

    this._active--;

    // If someone is waiting, hand it directly
    if (this._waitQueue.length > 0) {
      const waiter = this._waitQueue.shift();
      clearTimeout(waiter.timer);
      this._active++;
      waiter.resolve(client);
      return;
    }

    // Otherwise return to idle pool
    this._putIdle(client);
  }

  /**
   * Execute a query using a pooled connection. Automatically
   * acquires and releases.
   * @param {string} sql
   * @returns {Promise<Result>}
   */
  async query(sql) {
    const client = await this.acquire();
    try {
      const result = await client.query(sql);
      return result;
    } finally {
      this.release(client);
    }
  }

  /**
   * Execute a non-row statement using a pooled connection.
   * @param {string} sql
   * @returns {Promise<string>}
   */
  async exec(sql) {
    const client = await this.acquire();
    try {
      const result = await client.exec(sql);
      return result;
    } finally {
      this.release(client);
    }
  }

  /**
   * Execute multiple queries as a pipeline batch using a pooled connection.
   * All queries are written in one TCP write and responses read together.
   * 10-50x faster than sequential query() calls for bulk operations.
   *
   * @param {string[]} queries - Array of SQL strings
   * @returns {Promise<Result[]>}
   */
  async pipeline(queries) {
    const client = await this.acquire();
    try {
      return await client.pipeline(queries);
    } finally {
      this.release(client);
    }
  }

  /**
   * Execute a parameterized query with prepared statement caching.
   * @param {string} template - SQL with $1, $2, ... placeholders
   * @param {Array} params - Parameter values
   * @returns {Promise<Result>}
   */
  async prepared(template, params = []) {
    const client = await this.acquire();
    try {
      return await client.prepared(template, params);
    } finally {
      this.release(client);
    }
  }

  /**
   * Pipeline version of prepared: same template, multiple param sets.
   * @param {string} template - SQL with $1, $2, ... placeholders
   * @param {Array[]} paramSets - Array of parameter arrays
   * @returns {Promise<Result[]>}
   */
  async preparedPipeline(template, paramSets) {
    const client = await this.acquire();
    try {
      return await client.preparedPipeline(template, paramSets);
    } finally {
      this.release(client);
    }
  }

  /**
   * Close all idle connections and reject any pending waiters.
   * Active connections will be destroyed when released.
   */
  close() {
    this._closed = true;

    // Reject all waiters
    for (const waiter of this._waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new ConnectionError('Pool is closed'));
    }
    this._waitQueue = [];

    // Close all idle connections
    for (const entry of this._idle) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.client.close();
    }
    this._total -= this._idle.length;
    this._idle = [];
  }

  // -- internal helpers -----------------------------------------------------

  async _createConnection() {
    const client = new VedaDB({
      host: this.host,
      port: this.port,
      timeout: this.timeout,
    });
    await client.connect();
    return client;
  }

  _putIdle(client) {
    let idleTimer = null;

    if (this.idleTimeout > 0 && this._idle.length >= this.min) {
      // If we already have enough idle connections, schedule eviction
      idleTimer = setTimeout(() => {
        const idx = this._idle.findIndex(e => e.client === client);
        if (idx !== -1) {
          this._idle.splice(idx, 1);
          this._destroyClient(client);
        }
      }, this.idleTimeout);
    }

    this._idle.push({ client, idleTimer });
  }

  _destroyClient(client) {
    this._total--;
    try {
      client.close();
    } catch (_e) {
      // ignore
    }
  }
}

module.exports = { VedaPool };
