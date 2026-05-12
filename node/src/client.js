/**
 * VedaDB Node.js Driver - Core Client
 *
 * Full-featured TCP client for VedaDB with EventEmitter, connection management,
 * TLS encryption, authentication, prepared statements, and feature factory methods.
 * All async operations return Promises.
 */

'use strict';

const { EventEmitter } = require('events');
const net = require('net');
const tls = require('tls');
const {
  VedaDBError, ConnectionError, QueryError, TimeoutError, AuthError, ProtocolError,
} = require('./errors');
const { ProtocolHandler, Result } = require('./protocol');
const { upgradeToTLS } = require('./tls');
const { InterceptorRegistry, BuiltinInterceptors } = require('./interceptor');

// ---------------------------------------------------------------------------
// SQL value escaping
// ---------------------------------------------------------------------------

/**
 * Escape a JS value for safe inclusion in VedaQL.
 * Uses SQL-standard single-quote doubling — never backslash escaping.
 */
function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return String(v);
}

const escapeValue = escapeSqlValue;

// SECURE: Whitelist for valid SQL identifiers (HIGH-004/HIGH-005/HIGH-006 fix)
const VALID_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate a SQL identifier (table/column name) to prevent injection.
 * @param {string} ident - Identifier to validate
 * @param {string} label - Label for error messages (e.g., 'table', 'column')
 * @throws {Error} If identifier is invalid
 */
function validateIdentifier(ident, label = 'identifier') {
  if (typeof ident !== 'string' || !VALID_IDENTIFIER_RE.test(ident)) {
    throw new Error(`Invalid ${label}: "${ident}". Only alphanumeric and underscores allowed.`);
  }
}

/**
 * Single-pass $N placeholder substitution.
 */
function substitutePlaceholders(template, params) {
  if (!params || params.length === 0) return template;
  return template.replace(/\$(\d+)/g, (match, idxStr) => {
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 1 || idx > params.length) return match;
    return escapeSqlValue(params[idx - 1]);
  });
}

function buildWhereClause(where) {
  if (!where || Object.keys(where).length === 0) return '';
  const conditions = Object.entries(where).map(([k, v]) => {
    // SECURE: Validate column names against injection (HIGH-004 fix)
    validateIdentifier(k, 'WHERE column');
    if (v === null) return `${k} IS NULL`;
    return `${k} = ${escapeValue(v)}`;
  });
  return ' WHERE ' + conditions.join(' AND ');
}

// ---------------------------------------------------------------------------
// VedaClient
// ---------------------------------------------------------------------------

/**
 * VedaDB client with EventEmitter support.
 * Emits: connect, disconnect, error, query, pool_acquire, pool_release
 */
class VedaClient extends EventEmitter {
  /**
   * @param {Object} config
   * @param {string} [config.host='localhost']
   * @param {number} [config.port=6380]
   * @param {string} [config.username] - Auth username
   * @param {string} [config.password] - Auth password
   * @param {string} [config.database] - Default database
   * @param {number} [config.timeout=30000] - Socket timeout in ms
   * @param {boolean} [config.tls=false] - Enable TLS
   * @param {Object} [config.tlsOptions] - TLS connection options
   * @param {Object} [config.retry] - Retry configuration
   * @param {Object} [config.pool] - Pool configuration
   * @param {boolean} [config.autoReconnect=true] - Auto-reconnect on disconnect
   */
  constructor(config = {}) {
    super();
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 6380,
      username: config.username || config.user || '',
      password: config.password || '',
      database: config.database || '',
      timeout: config.timeout !== undefined ? config.timeout : 30000,
      // SECURE: TLS enabled by default (HIGH-010 fix)
      tls: config.tls !== undefined ? config.tls : true,
      tlsOptions: config.tlsOptions || {},
      retry: config.retry || {},
      pool: config.pool || null,
      autoReconnect: config.autoReconnect !== false,
      ...config,
    };

    this._socket = null;
    this._protocol = null;
    this._connected = false;
    this._connecting = false;
    this._interceptor = new InterceptorRegistry();
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectDelayMs = 1000;
    this._commandHistory = [];
    this._historyMax = 100;
  }

  /** Whether the client is connected. */
  get connected() {
    return this._connected;
  }

  /** Connection host. */
  get host() {
    return this.config.host;
  }

  /** Connection port. */
  get port() {
    return this.config.port;
  }

  /** Interceptor registry for middleware. */
  get interceptors() {
    return this._interceptor;
  }

  /**
   * Connect to the VedaDB server.
   * @returns {Promise<VedaClient>} Resolves with this client for chaining
   */
  async connect() {
    if (this._connected) return this;
    if (this._connecting) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (this._connected) return resolve(this);
          if (!this._connecting) return reject(new ConnectionError('Connection attempt failed'));
          setTimeout(check, 10);
        };
        setTimeout(check, 10);
      });
    }
    this._connecting = true;

    try {
      const socket = new net.Socket();
      socket.setEncoding('utf-8');
      socket.setTimeout(this.config.timeout);

      await new Promise((resolve, reject) => {
        socket.connect(this.config.port, this.config.host, resolve);
        socket.once('error', reject);
      });

      this._socket = socket;
      this._protocol = new ProtocolHandler({ timeout: this.config.timeout });
      this._protocol.attach(socket);
      this._protocol.on('disconnect', () => this._handleDisconnect());
      this._protocol.on('error', (err) => this.emit('error', err));

      // TLS upgrade
      if (this.config.tls) {
        const tlsSocket = await upgradeToTLS(socket, {
          ...this.config.tlsOptions,
          host: this.config.host,
          timeout: this.config.timeout,
        });
        this._socket = tlsSocket;
        this._protocol = new ProtocolHandler({ timeout: this.config.timeout });
        this._protocol.attach(tlsSocket);
        this._protocol.on('disconnect', () => this._handleDisconnect());
      }

      // SECURE: Enforce TLS when authentication is used (HIGH-008 fix)
      if (this.config.username && !this.config.tls) {
        throw new ConnectionError('Authentication requires TLS. Set tls: true or provide credentials over a TLS connection.');
      }

      // Authentication
      if (this.config.username) {
        await this._authenticate(this.config.username, this.config.password);
      }

      // Database selection
      if (this.config.database) {
        await this.query(`USE ${this.config.database};`);
      }

      this._connected = true;
      this._connecting = false;
      this._reconnectAttempts = 0;
      this.emit('connect', { host: this.config.host, port: this.config.port });
      return this;
    } catch (err) {
      this._connecting = false;
      throw new ConnectionError(`Failed to connect: ${err.message}`, { cause: err });
    }
  }

  /**
   * Execute a query and return a Result.
   * @param {string} sql - SQL query
   * @param {Array} [params] - Parameter values for $N placeholders
   * @returns {Promise<Result>}
   */
  async query(sql, params) {
    if (!this._connected) {
      throw new ConnectionError('Not connected. Call connect() first.');
    }

    const start = Date.now();
    const ctx = await this._interceptor.runPre({
      type: 'query',
      sql,
      params,
      meta: {},
    });

    try {
      const finalSql = ctx.params ? substitutePlaceholders(ctx.sql, ctx.params) : ctx.sql;
      const result = await this._protocol.send(finalSql);

      this._history(finalSql);
      this.emit('query', { sql: finalSql, duration: Date.now() - start });

      const postCtx = await this._interceptor.runPost({
        type: 'query',
        sql: finalSql,
        params: ctx.params,
        result,
        duration: Date.now() - start,
      });

      return postCtx.result || result;
    } catch (err) {
      await this._interceptor.runError({
        type: 'query',
        sql,
        params,
        error: err,
        duration: Date.now() - start,
      }).catch(() => {});
      throw err;
    }
  }

  /**
   * Execute a statement that does not return rows.
   * @param {string} sql
   * @param {Array} [params]
   * @returns {Promise<string>} Server message
   */
  async execute(sql, params) {
    const ctx = await this._interceptor.runPre({
      type: 'execute',
      sql,
      params,
      meta: {},
    });

    const result = await this.query(ctx.sql, ctx.params);
    return result.message || `${result.rowCount} rows affected`;
  }

  /**
   * Execute a parameterized query with placeholder substitution.
   * @param {string} template - SQL with $1, $2 placeholders
   * @param {Array} [params]
   * @returns {Promise<Result>}
   */
  async prepared(template, params = []) {
    return this.query(substitutePlaceholders(template, params));
  }

  /**
   * Ping the server.
   * @returns {Promise<boolean>}
   */
  async ping() {
    if (!this._connected || !this._protocol) return false;
    return this._protocol.ping();
  }

  /**
   * Close the connection gracefully.
   * @returns {Promise<void>}
   */
  async close() {
    this._connected = false;
    this._connecting = false;

    if (this._socket) {
      try { this._socket.write('QUIT\n'); } catch (_e) { /* ignore */ }
      this._socket.destroy();
      this._socket = null;
    }

    if (this._protocol) {
      this._protocol.close();
      this._protocol = null;
    }

    this.emit('disconnect', { host: this.config.host, port: this.config.port });
  }

  // -- Factory Methods ------------------------------------------------------

  /**
   * Create a pipeline for batch operations.
   * @returns {import('./bulk').Pipeline}
   */
  pipeline() {
    const { Pipeline } = require('./bulk');
    return new Pipeline(this);
  }

  /**
   * Create a bulk inserter for a table.
   * @param {string} table - Table name
   * @param {number} [batchSize=1000]
   * @returns {import('./bulk').BulkInserter}
   */
  newBulkInserter(table, batchSize = 1000) {
    const { BulkInserter } = require('./bulk');
    return new BulkInserter(this, table, batchSize);
  }

  /**
   * Create a streaming cursor.
   * @param {string} sql - Query
   * @param {Array} [params]
   * @returns {import('./cursor').Cursor}
   */
  cursor(sql, params) {
    const { Cursor } = require('./cursor');
    return new Cursor(this, sql, params);
  }

  /**
   * Create a Pub/Sub messaging interface.
   * @returns {import('./pubsub').PubSub}
   */
  pubsub() {
    const { PubSub } = require('./pubsub');
    return new PubSub(this);
  }

  /**
   * Create a change stream for a table.
   * @param {string} table - Table to watch
   * @returns {import('./streams').ChangeStream}
   */
  watch(table) {
    const { ChangeStream } = require('./streams');
    return new ChangeStream(this, table);
  }

  /**
   * Create a fluent query builder for a table.
   * @param {string} name - Table name
   * @returns {import('./query_builder').QueryBuilder}
   */
  table(name) {
    const { QueryBuilder } = require('./query_builder');
    return new QueryBuilder(this, name);
  }

  // -- Static Factory Methods -----------------------------------------------

  /**
   * Connect using a connection URI.
   * @param {string} uri - vedadb://user:pass@host:port/db
   * @returns {Promise<VedaClient>}
   */
  static async connect(uri) {
    const { parseURI } = require('./uri');
    const config = parseURI(uri);
    const client = new VedaClient(config);
    await client.connect();
    return client;
  }

  /**
   * Create a client from a URI without connecting.
   * @param {string} uri
   * @returns {VedaClient}
   */
  static fromURI(uri) {
    const { parseURI } = require('./uri');
    const config = parseURI(uri);
    return new VedaClient(config);
  }

  // -- CRUD Helpers ---------------------------------------------------------

  /**
   * SELECT helper.
   * @param {string} table
   * @param {Object} [options]
   * @returns {Promise<Result>}
   */
  async select(table, options = {}) {
    // SECURE: Validate identifiers to prevent SQL injection (HIGH-004 fix)
    validateIdentifier(table, 'table');
    if (options.columns) {
      options.columns.forEach(c => validateIdentifier(c, 'column'));
    }
    const cols = options.columns ? options.columns.join(', ') : '*';
    let sql = `SELECT ${cols} FROM ${table}`;
    sql += buildWhereClause(options.where);
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
      if (options.desc) sql += ' DESC';
    }
    if (options.limit != null) sql += ` LIMIT ${options.limit}`;
    if (options.offset != null) sql += ` OFFSET ${options.offset}`;
    sql += ';';
    return this.query(sql);
  }

  /**
   * INSERT helper.
   * @param {string} table
   * @param {Object} data
   * @returns {Promise<string>}
   */
  async insert(table, data) {
    // SECURE: Validate table and column names to prevent SQL injection (HIGH-004 fix)
    validateIdentifier(table, 'table');
    Object.keys(data).forEach(k => validateIdentifier(k, 'column'));
    const cols = Object.keys(data).join(', ');
    const vals = Object.values(data).map(escapeValue).join(', ');
    return this.execute(`INSERT INTO ${table} (${cols}) VALUES (${vals});`);
  }

  /**
   * INSERT multiple rows.
   * @param {string} table
   * @param {Object[]} rows
   * @returns {Promise<string>}
   */
  async insertMany(table, rows) {
    if (!rows || rows.length === 0) return '0 rows affected';
    // SECURE: Validate table and column names to prevent SQL injection (HIGH-004 fix)
    validateIdentifier(table, 'table');
    Object.keys(rows[0]).forEach(k => validateIdentifier(k, 'column'));
    const cols = Object.keys(rows[0]).join(', ');
    const values = rows
      .map(row => '(' + Object.values(row).map(escapeValue).join(', ') + ')')
      .join(', ');
    return this.execute(`INSERT INTO ${table} (${cols}) VALUES ${values};`);
  }

  /**
   * UPDATE helper.
   * @param {string} table
   * @param {Object} set - Columns to update
   * @param {Object} [where] - WHERE conditions
   * @returns {Promise<string>}
   */
  async update(table, set, where) {
    // SECURE: Validate table and column names to prevent SQL injection (HIGH-004 fix)
    validateIdentifier(table, 'table');
    Object.keys(set).forEach(k => validateIdentifier(k, 'column'));
    const setClause = Object.entries(set)
      .map(([k, v]) => `${k} = ${escapeValue(v)}`)
      .join(', ');
    let sql = `UPDATE ${table} SET ${setClause}`;
    sql += buildWhereClause(where);
    sql += ';';
    return this.execute(sql);
  }

  /**
   * DELETE helper.
   * @param {string} table
   * @param {Object} [where]
   * @returns {Promise<string>}
   */
  async delete(table, where) {
    // SECURE: Validate table name to prevent SQL injection (HIGH-004 fix)
    validateIdentifier(table, 'table');
    let sql = `DELETE FROM ${table}`;
    sql += buildWhereClause(where);
    sql += ';';
    return this.execute(sql);
  }

  // -- Transaction Helpers --------------------------------------------------

  /**
   * Begin a transaction.
   * @returns {Promise<string>}
   */
  async begin() {
    return this.execute('BEGIN;');
  }

  /**
   * Commit the current transaction.
   * @returns {Promise<string>}
   */
  async commit() {
    return this.execute('COMMIT;');
  }

  /**
   * Rollback the current transaction.
   * @returns {Promise<string>}
   */
  async rollback() {
    return this.execute('ROLLBACK;');
  }

  /**
   * Execute a function within a transaction.
   * Auto-commits on success, rolls back on error.
   * @param {function(VedaClient): Promise<T>} fn
   * @returns {Promise<T>}
   * @template T
   */
  async transaction(fn) {
    await this.begin();
    try {
      const result = await fn(this);
      await this.commit();
      return result;
    } catch (err) {
      await this.rollback().catch(() => {});
      throw err;
    }
  }

  // -- Pipeline API ---------------------------------------------------------

  /**
   * Send multiple queries in a single TCP write.
   * @param {string[]} queries
   * @returns {Promise<Result[]>}
   */
  async pipelineQueries(queries) {
    if (!this._connected || !this._protocol) {
      return Promise.reject(new ConnectionError('Not connected'));
    }
    return this._protocol.pipeline(queries);
  }

  // -- Cache Sub-API --------------------------------------------------------

  /**
   * Get the cache sub-API.
   * @returns {Object} Cache operations
   */
  get cache() {
    return {
      set: (key, value, ttl) => {
        const safeKey = key.replace(/'/g, "''");
        const val = typeof value === 'object' ? JSON.stringify(value) : `'${value}'`;
        let sql = `CACHE SET '${safeKey}' ${val}`;
        if (ttl) sql += ` TTL ${ttl}`;
        return this.query(sql + ';');
      },
      get: (key) => this.query(`CACHE GET '${key.replace(/'/g, "''")}';`),
      del: (key) => this.query(`CACHE DEL '${key.replace(/'/g, "''")}';`),
      incr: (key) => this.query(`CACHE INCR '${key.replace(/'/g, "''")}';`),
      keys: (pattern) => this.query(`CACHE KEYS '${pattern.replace(/'/g, "''")}';`),
      flush: () => this.query('CACHE FLUSH;'),
      stats: () => this.query('CACHE STATS;'),
    };
  }

  // -- Graph API ------------------------------------------------------------

  /**
   * Add a graph node.
   * @param {string} id
   * @param {string} label
   * @param {Object} [props]
   * @returns {Promise<Result>}
   */
  async graphAddNode(id, label, props = {}) {
    const propsJson = JSON.stringify(props).replace(/'/g, "''");
    return this.query(`GRAPH ADD NODE '${id}' LABEL '${label}' PROPERTIES '${propsJson}'`);
  }

  /**
   * Add a graph edge.
   * @param {string} from
   * @param {string} to
   * @param {string} relation
   * @param {Object} [props]
   * @returns {Promise<Result>}
   */
  async graphAddEdge(from, to, relation, props = {}) {
    const propsJson = JSON.stringify(props).replace(/'/g, "''");
    return this.query(`GRAPH ADD EDGE '${from}' -> '${to}' LABEL '${relation}' PROPERTIES '${propsJson}'`);
  }

  /**
   * BFS traversal.
   * @param {string} start
   * @param {number} [depth=3]
   * @returns {Promise<Result>}
   */
  async graphBFS(start, depth = 3) {
    return this.query(`GRAPH BFS '${start}' DEPTH ${depth}`);
  }

  // -- Search API -----------------------------------------------------------

  /**
   * Full-text search.
   * @param {string} table
   * @param {string} queryStr
   * @param {number} [fuzzy=0]
   * @returns {Promise<Result>}
   */
  async search(table, queryStr, fuzzy = 0) {
    const escaped = queryStr.replace(/'/g, "''");
    let sql = `SEARCH ${table} MATCH(*) AGAINST('${escaped}')`;
    if (fuzzy > 0) sql += ` FUZZY ${fuzzy}`;
    return this.query(sql);
  }

  // -- Server-side Prepared Statements --------------------------------------

  /**
   * Prepare a statement on the server.
   * @param {string} name
   * @param {string} query
   * @returns {Promise<Result>}
   */
  async prepare(name, query) {
    return this.query(`PREPARE ${name} AS ${query}`);
  }

  /**
   * Execute a prepared statement.
   * @param {string} name
   * @param {...*} args
   * @returns {Promise<Result>}
   */
  async executePrepared(name, ...args) {
    const paramList = args.map(a => escapeSqlValue(a)).join(', ');
    return this.query(`EXECUTE ${name} (${paramList})`);
  }

  /**
   * Deallocate a prepared statement.
   * @param {string} name
   * @returns {Promise<Result>}
   */
  async deallocate(name) {
    return this.query(`DEALLOCATE ${name}`);
  }

  // -- Prepared Pipeline ----------------------------------------------------

  /**
   * Pipeline version of prepared: same template, multiple param sets.
   * @param {string} template
   * @param {Array[]} paramSets
   * @returns {Promise<Result[]>}
   */
  async preparedPipeline(template, paramSets) {
    const queries = paramSets.map(params => substitutePlaceholders(template, params));
    return this.pipelineQueries(queries);
  }

  // -- Auto-Reconnect -------------------------------------------------------

  /**
   * Disconnect and reconnect with exponential backoff.
   * @param {number} [maxRetries=3]
   * @returns {Promise<void>}
   */
  async reconnect(maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.close();
        await this.connect();
        return;
      } catch (e) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new ConnectionError(`Reconnect failed after ${maxRetries} attempts`);
  }

  // -- Internal -------------------------------------------------------------

  /**
   * Authenticate with the server.
   * @private
   */
  async _authenticate(user, password) {
    const result = await this.query(`AUTH ${user} ${password || ''}`);
    if (result.status === 'error' || (result.message && result.message.toLowerCase().includes('fail'))) {
      throw new AuthError(`Authentication failed for user: ${user}`);
    }
  }

  /**
   * Handle unexpected disconnect.
   * @private
   */
  _handleDisconnect() {
    this._connected = false;
    this.emit('disconnect', { host: this.config.host, port: this.config.port });

    if (this.config.autoReconnect && this._reconnectAttempts < this._maxReconnectAttempts) {
      this._reconnectAttempts++;
      const delay = Math.min(this._reconnectDelayMs * Math.pow(2, this._reconnectAttempts - 1), 30000);
      setTimeout(() => {
        this.connect().catch(() => {});
      }, delay);
    }
  }

  /**
   * Record command in history.
   * @private
   */
  _history(sql) {
    this._commandHistory.push({ sql, time: Date.now() });
    if (this._commandHistory.length > this._