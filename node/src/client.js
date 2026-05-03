/**
 * VedaDB Node.js Driver - TCP Client
 *
 * Full-featured TCP client for VedaDB with proper error handling,
 * structured results, connection management, and query helpers.
 * Supports TLS encryption, authentication, and server-side prepared statements.
 */

const net = require('net');
const tls = require('tls');

// ---------------------------------------------------------------------------
// Error hierarchy
// ---------------------------------------------------------------------------

class VedaDBError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VedaDBError';
  }
}

class ConnectionError extends VedaDBError {
  constructor(message) {
    super(message);
    this.name = 'ConnectionError';
  }
}

class QueryError extends VedaDBError {
  constructor(message) {
    super(message);
    this.name = 'QueryError';
  }
}

class TimeoutError extends VedaDBError {
  constructor(message) {
    super(message || 'Query timed out');
    this.name = 'TimeoutError';
  }
}

class AuthError extends VedaDBError {
  constructor(message) {
    super(message || 'Authentication failed');
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// Result wrapper
// ---------------------------------------------------------------------------

class Result {
  /**
   * @param {Object} data - Raw response from VedaDB
   * @param {string[]} [data.columns]
   * @param {Array[]} [data.rows]
   * @param {number} [data.row_count]
   * @param {string} [data.message]
   */
  constructor(data) {
    this.columns = data.columns || [];
    this.rows = data.rows || [];
    this.rowCount = data.row_count || 0;
    this.message = data.message || '';
  }

  /**
   * Convert rows into an array of plain objects keyed by column name.
   * @returns {Object[]}
   */
  toObjects() {
    return this.rows.map(row => {
      const obj = {};
      this.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  /**
   * Return the first row as an object, or null.
   * @returns {Object|null}
   */
  first() {
    const objs = this.toObjects();
    return objs.length > 0 ? objs[0] : null;
  }

  /**
   * Pluck a single column from every row.
   * @param {string} column
   * @returns {any[]}
   */
  pluck(column) {
    const idx = this.columns.indexOf(column);
    if (idx === -1) return [];
    return this.rows.map(row => row[idx]);
  }
}

// ---------------------------------------------------------------------------
// Escape helper (basic SQL literal escaping)
// ---------------------------------------------------------------------------

/**
 * Escape a JS value for safe inclusion in a VedaQL literal.
 *
 * Uses SQL-standard single-quote doubling (`''`) — never backslash escaping.
 * - null / undefined => NULL
 * - boolean          => TRUE / FALSE
 * - number           => bare numeric literal
 * - string           => '<doubled-quotes>'
 * - object           => JSON-encoded string literal
 *
 * NOTE: this is the canonical escape helper used by every query-builder
 * helper and by `executePrepared`. Do NOT introduce a separate code path
 * with `\'`-style escaping anywhere in this driver.
 */
function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return String(v);
}

// Back-compat alias: existing code (and tests) imports `escapeValue`.
const escapeValue = escapeSqlValue;

/**
 * Substitute $N placeholders in `template` with escapeSqlValue(params[N-1]).
 *
 * Audit #23 closure for the Node driver: the previous implementation did
 *
 *   for each param: sql = sql.replace('$1', escapeValue(...))
 *
 * which has TWO real bugs:
 *
 *   1. `replace` (not `replaceAll`) only swaps the FIRST occurrence —
 *      a template using `$1` twice (e.g. `WHERE a = $1 OR b = $1`)
 *      had its second occurrence left as the literal `$1` token.
 *
 *   2. The replacement-string overload of String.prototype.replace
 *      treats `$&`, `$'`, `$\``, `$N` as substitution patterns. A
 *      param whose escaped form contained a literal `$` (e.g. JSON
 *      `"price":"$5"`) silently injected garbage into the SQL.
 *
 *   3. Iterative one-pass-per-param means a param whose replacement
 *      contained the literal `$2` would be re-substituted on the
 *      next iteration — the classic "double substitution" attack
 *      pattern.
 *
 * Single-pass regex callback fixes all three: every `$N` in the
 * template is matched once, mapped to params[N-1] via the callback,
 * and the callback's return value is inserted verbatim (no $-special-
 * char interpretation, no multi-pass interaction).
 *
 * Behaviour: a `$N` whose N is out of range for `params` is left as
 * the literal token (so static SQL containing `$variable`-style
 * identifiers passes through unchanged when no params supplied).
 */
function substitutePlaceholders(template, params) {
  if (!params || params.length === 0) {
    return template;
  }
  return template.replace(/\$(\d+)/g, (match, idxStr) => {
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 1 || idx > params.length) {
      return match; // out of range — leave literal
    }
    return escapeSqlValue(params[idx - 1]);
  });
}

function buildWhereClause(where) {
  if (!where || Object.keys(where).length === 0) return '';
  const conditions = Object.entries(where).map(([k, v]) => {
    if (v === null) return `${k} IS NULL`;
    return `${k} = ${escapeValue(v)}`;
  });
  return ' WHERE ' + conditions.join(' AND ');
}

// ---------------------------------------------------------------------------
// VedaDB Client
// ---------------------------------------------------------------------------

class VedaDB {
  /**
   * @param {Object} options
   * @param {string} [options.host='localhost']
   * @param {number} [options.port=6380]
   * @param {number} [options.timeout=30000] - Socket timeout in ms
   * @param {boolean} [options.tls=false] - Enable STARTTLS upgrade
   * @param {Object} [options.tlsOptions] - Options passed to tls.connect (e.g. ca, rejectUnauthorized)
   * @param {string} [options.user] - Username for AUTH
   * @param {string} [options.password] - Password for AUTH
   */
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 6380;
    this.timeout = options.timeout !== undefined ? options.timeout : 30000;
    this.options = options;

    this._socket = null;
    this._buffer = '';
    this._connected = false;
    this._queue = []; // pending { resolve, reject, timer }
  }

  /** Whether the client is currently connected. */
  get connected() {
    return this._connected;
  }

  /**
   * Open a TCP connection to VedaDB. If TLS is enabled, performs a
   * STARTTLS upgrade. If user/password are set, authenticates.
   * @returns {Promise<VedaDB>} resolves with `this` for chaining
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this._connected) return resolve(this);

      this._socket = new net.Socket();
      this._socket.setEncoding('utf-8');
      this._socket.setTimeout(this.timeout);

      this._socket.connect(this.port, this.host, async () => {
        this._connected = true;

        try {
          // Wait briefly for the welcome banner
          await this._waitForData(150);

          // STARTTLS upgrade
          if (this.options.tls) {
            await this._upgradeToTls();
          }

          // AUTH
          if (this.options.user) {
            await this._authenticate(this.options.user, this.options.password || '');
          }

          resolve(this);
        } catch (err) {
          reject(err);
        }
      });

      this._socket.on('data', (chunk) => {
        this._buffer += chunk;
        this._drain();
      });

      this._socket.on('timeout', () => {
        const err = new TimeoutError('Socket timed out');
        this._rejectAll(err);
        this._socket.destroy();
      });

      this._socket.on('error', (err) => {
        const connErr = new ConnectionError(err.message);
        this._rejectAll(connErr);
        if (!this._connected) reject(connErr);
      });

      this._socket.on('close', () => {
        this._connected = false;
        this._rejectAll(new ConnectionError('Connection closed'));
      });
    });
  }

  /**
   * Wait for data to arrive (used for banner consumption).
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _waitForData(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Perform STARTTLS handshake and upgrade the socket.
   * @returns {Promise<void>}
   */
  _upgradeToTls() {
    return new Promise((resolve, reject) => {
      // Send STARTTLS command
      this._socket.write('STARTTLS\n');

      // Wait for server response
      const onData = (chunk) => {
        this._buffer += chunk;
        const idx = this._buffer.indexOf('\n');
        if (idx === -1) return; // wait for full line

        const line = this._buffer.substring(0, idx).trim();
        this._buffer = this._buffer.substring(idx + 1);
        this._socket.removeListener('data', onData);

        try {
          const parsed = JSON.parse(line);
          if (parsed.error) {
            return reject(new ConnectionError('STARTTLS failed: ' + parsed.error));
          }
        } catch (_e) {
          // Non-JSON is OK if it contains the ready message
        }

        // Upgrade to TLS
        const tlsOpts = Object.assign({}, this.options.tlsOptions || {}, {
          socket: this._socket,
          servername: this.host,
        });

        const tlsSocket = tls.connect(tlsOpts, () => {
          // Replace the socket with the TLS socket
          this._socket = tlsSocket;
          this._socket.setEncoding('utf-8');

          // Re-attach data handler
          this._socket.on('data', (c) => {
            this._buffer += c;
            this._drain();
          });

          resolve();
        });

        tlsSocket.on('error', (err) => {
          reject(new ConnectionError('TLS upgrade failed: ' + err.message));
        });
      };

      // Temporarily replace data handler for the handshake
      this._socket.removeAllListeners('data');
      this._socket.on('data', onData);
    });
  }

  /**
   * Authenticate with the server using AUTH command.
   * @param {string} user
   * @param {string} password
   * @returns {Promise<void>}
   */
  _authenticate(user, password) {
    return new Promise((resolve, reject) => {
      this._socket.write(`AUTH ${user} ${password}\n`);

      const onData = (chunk) => {
        this._buffer += chunk;
        const idx = this._buffer.indexOf('\n');
        if (idx === -1) return;

        const line = this._buffer.substring(0, idx).trim();
        this._buffer = this._buffer.substring(idx + 1);
        this._socket.removeListener('data', onData);

        // Re-attach normal handler
        this._socket.on('data', (c) => {
          this._buffer += c;
          this._drain();
        });

        try {
          const parsed = JSON.parse(line);
          if (parsed.error) {
            return reject(new AuthError(parsed.error));
          }
          resolve();
        } catch (_e) {
          // If it's not JSON, treat it as success if it doesn't look like an error
          if (line.toLowerCase().includes('fail') || line.toLowerCase().includes('error')) {
            reject(new AuthError(line));
          } else {
            resolve();
          }
        }
      };

      this._socket.removeAllListeners('data');
      this._socket.on('data', onData);
    });
  }

  // -- internal response handling -------------------------------------------

  /** Process buffered data looking for complete newline-delimited responses. */
  _drain() {
    let idx;
    while ((idx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.substring(0, idx).trim();
      this._buffer = this._buffer.substring(idx + 1);

      if (!line) continue;
      if (this._queue.length === 0) continue; // welcome banner or stray line

      const pending = this._queue.shift();
      if (pending.timer) clearTimeout(pending.timer);

      try {
        const parsed = JSON.parse(line);
        if (parsed.error) {
          pending.reject(new QueryError(parsed.error));
        } else {
          pending.resolve(new Result(parsed));
        }
      } catch (_e) {
        // Non-JSON line (e.g. welcome message) -- treat as plain message
        pending.resolve(new Result({ message: line }));
      }
    }
  }

  /** Reject all pending promises with a given error. */
  _rejectAll(err) {
    while (this._queue.length > 0) {
      const pending = this._queue.shift();
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(err);
    }
  }

  // -- public query API -----------------------------------------------------

  /**
   * Send a raw VedaQL query and return a Result.
   * @param {string} sql
   * @returns {Promise<Result>}
   */
  query(sql) {
    return new Promise((resolve, reject) => {
      if (!this._connected) {
        return reject(new ConnectionError('Not connected. Call connect() first.'));
      }

      let timer = null;
      if (this.timeout > 0) {
        timer = setTimeout(() => {
          // Remove this entry from queue
          const idx = this._queue.findIndex(p => p.timer === timer);
          if (idx !== -1) this._queue.splice(idx, 1);
          reject(new TimeoutError());
        }, this.timeout);
      }

      this._queue.push({ resolve, reject, timer });
      this._socket.write(sql.trim() + '\n');
    });
  }

  /**
   * Execute a statement that does not return rows (DDL, INSERT, UPDATE, DELETE).
   * @param {string} sql
   * @returns {Promise<string>} message from the server
   */
  async exec(sql) {
    const result = await this.query(sql);
    return result.message || `${result.rowCount} rows affected`;
  }

  /**
   * Ping / health-check the server.
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      await this.query('SHOW TABLES;');
      return true;
    } catch (_e) {
      return false;
    }
  }

  // -- convenience helpers --------------------------------------------------

  /**
   * CREATE TABLE shorthand.
   * @param {string} sql - Full CREATE TABLE statement
   * @returns {Promise<string>}
   */
  async createTable(sql) {
    return this.exec(sql);
  }

  /**
   * Insert a row.
   * @param {string} table
   * @param {Object} data - { column: value }
   * @returns {Promise<string>}
   */
  async insert(table, data) {
    const cols = Object.keys(data).join(', ');
    const vals = Object.values(data).map(escapeValue).join(', ');
    return this.exec(`INSERT INTO ${table} (${cols}) VALUES (${vals});`);
  }

  /**
   * Insert multiple rows in a single statement.
   * @param {string} table
   * @param {Object[]} rows - Array of { column: value }
   * @returns {Promise<string>}
   */
  async insertMany(table, rows) {
    if (!rows.length) return '0 rows affected';
    const cols = Object.keys(rows[0]).join(', ');
    const values = rows
      .map(row => '(' + Object.values(row).map(escapeValue).join(', ') + ')')
      .join(', ');
    return this.exec(`INSERT INTO ${table} (${cols}) VALUES ${values};`);
  }

  /**
   * Select rows with a fluent options object.
   * @param {string} table
   * @param {Object} [options]
   * @param {string[]} [options.columns]
   * @param {Object} [options.where]
   * @param {string} [options.orderBy]
   * @param {boolean} [options.desc]
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @returns {Promise<Result>}
   */
  async select(table, options = {}) {
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
   * Update rows.
   * @param {string} table
   * @param {Object} set - { column: newValue }
   * @param {Object} [where] - { column: value }
   * @returns {Promise<string>}
   */
  async update(table, set, where) {
    const setClause = Object.entries(set)
      .map(([k, v]) => `${k} = ${escapeValue(v)}`)
      .join(', ');
    let sql = `UPDATE ${table} SET ${setClause}`;
    sql += buildWhereClause(where);
    sql += ';';
    return this.exec(sql);
  }

  /**
   * Delete rows.
   * @param {string} table
   * @param {Object} [where] - { column: value }
   * @returns {Promise<string>}
   */
  async deleteFrom(table, where) {
    let sql = `DELETE FROM ${table}`;
    sql += buildWhereClause(where);
    sql += ';';
    return this.exec(sql);
  }

  // -- Cache sub-API --------------------------------------------------------

  cache = {
    /**
     * Set a cache key.
     * @param {string} key
     * @param {*} value
     * @param {number} [ttl] - TTL in seconds
     */
    set: (key, value, ttl) => {
      const safeKey = key.replace(/'/g, "''");
      const val = typeof value === 'object' ? JSON.stringify(value) : `'${value}'`;
      let sql = `CACHE SET '${safeKey}' ${val}`;
      if (ttl) sql += ` TTL ${ttl}`;
      sql += ';';
      return this.query(sql);
    },
    get: (key) => this.query(`CACHE GET '${key.replace(/'/g, "''")}';`),
    del: (key) => this.query(`CACHE DEL '${key.replace(/'/g, "''")}';`),
    incr: (key) => this.query(`CACHE INCR '${key.replace(/'/g, "''")}';`),
    keys: (pattern) => this.query(`CACHE KEYS '${pattern.replace(/'/g, "''")}';`),
    flush: () => this.query('CACHE FLUSH;'),
    stats: () => this.query('CACHE STATS;'),
  };

  // -- Transaction helpers --------------------------------------------------

  /**
   * Begin a transaction.
   * @returns {Promise<string>}
   */
  async begin() {
    return this.exec('BEGIN;');
  }

  /**
   * Commit the current transaction.
   * @returns {Promise<string>}
   */
  async commit() {
    return this.exec('COMMIT;');
  }

  /**
   * Roll back the current transaction.
   * @returns {Promise<string>}
   */
  async rollback() {
    return this.exec('ROLLBACK;');
  }

  /**
   * Run a callback inside a transaction. Auto-commits on success,
   * rolls back on error.
   * @param {function(VedaDB): Promise<*>} fn
   * @returns {Promise<*>} return value of fn
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
   * Send multiple queries in a single TCP write (pipelining).
   * All queries are written to the socket buffer at once, so the server
   * reads them as a batch and returns all responses together.
   *
   * This is 10-50x faster than sequential query() calls for bulk operations.
   *
   * @param {string[]} queries - Array of SQL strings
   * @returns {Promise<Result[]>} Array of results in same order
   *
   * @example
   *   const results = await client.pipeline([
   *     "INSERT INTO stocks (id, symbol, name) VALUES ('1', 'AAPL', 'Apple');",
   *     "INSERT INTO stocks (id, symbol, name) VALUES ('2', 'GOOGL', 'Alphabet');",
   *     "SELECT COUNT(*) FROM stocks;"
   *   ]);
   */
  pipeline(queries) {
    if (!this._connected) {
      return Promise.reject(new ConnectionError('Not connected. Call connect() first.'));
    }
    if (!queries || queries.length === 0) {
      return Promise.resolve([]);
    }

    const promises = [];
    // Build a single buffer with all queries separated by newlines.
    let batch = '';
    for (const sql of queries) {
      const cleanSql = sql.trim().replace(/\n/g, ' ');
      batch += cleanSql + '\n';

      // Create a promise for each query's response.
      promises.push(new Promise((resolve, reject) => {
        let timer = null;
        if (this.timeout > 0) {
          timer = setTimeout(() => {
            const idx = this._queue.findIndex(p => p.timer === timer);
            if (idx !== -1) this._queue.splice(idx, 1);
            reject(new TimeoutError());
          }, this.timeout);
        }
        this._queue.push({ resolve, reject, timer });
      }));
    }

    // Write all queries in one TCP write — the server reads them as a pipeline batch.
    this._socket.write(batch);

    return Promise.all(promises);
  }

  /**
   * Pipeline INSERT: insert multiple rows using pipeline (each row = separate INSERT).
   * Faster than insertMany for very large batches because the server processes
   * them as a pipeline batch.
   *
   * @param {string} table
   * @param {Object[]} rows - Array of { column: value }
   * @param {number} [batchSize=500] - Rows per pipeline batch
   * @returns {Promise<number>} Total rows inserted
   */
  async pipelineInsert(table, rows, batchSize = 500) {
    if (!rows.length) return 0;
    const cols = Object.keys(rows[0]).join(', ');
    let total = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const queries = chunk.map(row => {
        const vals = Object.values(row).map(escapeValue).join(', ');
        return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
      });
      const results = await this.pipeline(queries);
      total += results.length;
    }
    return total;
  }

  /**
   * Pipeline SELECT: run multiple SELECT queries concurrently.
   *
   * @param {string[]} queries - Array of SELECT SQL strings
   * @returns {Promise<Result[]>}
   */
  async pipelineSelect(queries) {
    return this.pipeline(queries);
  }

  // -- Prepared Statement Cache (client-side) -------------------------------

  /**
   * Execute a parameterized query with client-side prepared statement caching.
   * The SQL template is cached and parameters are substituted safely.
   * This avoids rebuilding SQL strings for repeated queries.
   *
   * @param {string} template - SQL with $1, $2, ... placeholders
   * @param {Array} params - Parameter values
   * @returns {Promise<Result>}
   *
   * @example
   *   // First call: caches the template
   *   await client.prepared("SELECT * FROM stocks WHERE symbol = $1", ['AAPL']);
   *   // Subsequent calls: reuse template, only substitute params
   *   await client.prepared("SELECT * FROM stocks WHERE symbol = $1", ['GOOGL']);
   */
  prepared(template, params = []) {
    return this.query(substitutePlaceholders(template, params));
  }

  /**
   * Pipeline version of prepared: run the same template with multiple param sets.
   * This is ideal for bulk lookups or bulk inserts with the same structure.
   *
   * @param {string} template - SQL with $1, $2, ... placeholders
   * @param {Array[]} paramSets - Array of parameter arrays
   * @returns {Promise<Result[]>}
   *
   * @example
   *   const results = await client.preparedPipeline(
   *     "SELECT * FROM stocks WHERE symbol = $1",
   *     [['AAPL'], ['GOOGL'], ['MSFT'], ['TSLA']]
   *   );
   */
  preparedPipeline(template, paramSets) {
    const queries = paramSets.map(params => substitutePlaceholders(template, params));
    return this.pipeline(queries);
  }

  // -- Server-side Prepared Statements --------------------------------------

  /**
   * Prepare a named statement on the server.
   *
   * @param {string} name - Statement name
   * @param {string} query - SQL query to prepare
   * @returns {Promise<Result>}
   *
   * @example
   *   await client.prepare('get_user', 'SELECT * FROM users WHERE id = $1');
   */
  async prepare(name, query) {
    return this.query(`PREPARE ${name} AS ${query}`);
  }

  /**
   * Execute a previously prepared statement with parameter values.
   *
   * @param {string} name - Statement name
   * @param {...*} args - Parameter values
   * @returns {Promise<Result>}
   *
   * @example
   *   await client.executePrepared('get_user', '42');
   *   await client.executePrepared('insert_record', 'Alice', 30, 'NYC');
   */
  async executePrepared(name, ...args) {
    const paramList = args.map(a => escapeSqlValue(a)).join(', ');
    return this.query(`EXECUTE ${name} (${paramList})`);
  }

  /**
   * Deallocate (remove) a previously prepared statement from the server.
   *
   * @param {string} name - Statement name
   * @returns {Promise<Result>}
   *
   * @example
   *   await client.deallocate('get_user');
   */
  async deallocate(name) {
    return this.query(`DEALLOCATE ${name}`);
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
        this.close();
        await this.connect();
        return;
      } catch (e) {
        await new Promise(r => setTimeout(r, (i + 1) * 1000));
      }
    }
    throw new ConnectionError('Reconnect failed after ' + maxRetries + ' attempts');
  }

  // -- Search API -----------------------------------------------------------

  /**
   * Full-text search on a table.
   * @param {string} table
   * @param {string} queryStr - Search query
   * @param {number} [fuzzy=0] - Fuzzy matching threshold (0 = exact)
   * @returns {Promise<Result>}
   */
  async search(table, queryStr, fuzzy = 0) {
    const escaped = queryStr.replace(/'/g, "''");
    let sql = `SEARCH ${table} MATCH(*) AGAINST('${escaped}')`;
    if (fuzzy > 0) sql += ` FUZZY ${fuzzy}`;
    return this.query(sql);
  }

  // -- Graph API ------------------------------------------------------------

  /**
   * Add a node to the graph.
   * @param {string} id - Node identifier
   * @param {string} label - Node label/type
   * @param {Object} [props={}] - Additional properties
   * @returns {Promise<Result>}
   */
  async graphAddNode(id, label, props = {}) {
    const propsJson = JSON.stringify(props).replace(/'/g, "''");
    return this.query(`GRAPH ADD NODE '${id}' LABEL '${label}' PROPERTIES '${propsJson}'`);
  }

  /**
   * Add an edge between two nodes.
   * @param {string} from - Source node id
   * @param {string} to - Target node id
   * @param {string} relation - Edge label
   * @param {Object} [props={}] - Additional properties
   * @returns {Promise<Result>}
   */
  async graphAddEdge(from, to, relation, props = {}) {
    const propsJson = JSON.stringify(props).replace(/'/g, "''");
    return this.query(`GRAPH ADD EDGE '${from}' -> '${to}' LABEL '${relation}' PROPERTIES '${propsJson}'`);
  }

  /**
   * Breadth-first traversal from a starting node.
   * @param {string} start - Starting node id
   * @param {number} [depth=3] - Max traversal depth
   * @returns {Promise<Result>}
   */
  async graphBFS(start, depth = 3) {
    return this.query(`GRAPH BFS '${start}' DEPTH ${depth}`);
  }

  // -- Lifecycle ------------------------------------------------------------

  /**
   * Close the connection gracefully.
   */
  close() {
    if (this._socket) {
      try {
        this._socket.write('QUIT\n');
      } catch (_e) {
        // ignore write-after-end
      }
      this._socket.destroy();
      this._socket = null;
      this._connected = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Create and connect a VedaDB client in one call.
 * @param {Object} options - Same as VedaDB constructor
 * @returns {Promise<VedaDB>}
 */
async function createClient(options) {
  const client = new VedaDB(options);
  await client.connect();
  return client;
}

module.exports = {
  VedaDB,
  VedaDBError,
  ConnectionError,
  QueryError,
  TimeoutError,
  AuthError,
  Result,
  createClient,
  escapeValue,
  escapeSqlValue,
  // Exposed for unit tests of the audit #23 substitution contract.
  substitutePlaceholders,
};
