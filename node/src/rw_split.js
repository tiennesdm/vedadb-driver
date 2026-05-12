/**
 * VedaDB Node.js Driver - Read/Write Splitting
 *
 * Routes write queries to a primary node and read queries to replicas.
 * Supports configurable routing rules and replica selection strategies.
 */

'use strict';

const { EventEmitter } = require('events');
const { ConnectionError } = require('./errors');

/**
 * Query classifications.
 */
const QueryType = {
  READ: 'read',
  WRITE: 'write',
  UNKNOWN: 'unknown',
};

/**
 * SQL command classification for routing.
 */
const READ_COMMANDS = new Set([
  'SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'CACHE GET',
  'CACHE KEYS', 'CACHE STATS', 'PING', 'SEARCH',
  'GRAPH BFS', 'GRAPH GET',
]);

const WRITE_COMMANDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'CACHE SET', 'CACHE DEL',
  'CACHE INCR', 'CACHE FLUSH', 'GRAPH ADD', 'GRAPH REMOVE',
  'PREPARE', 'EXECUTE', 'DEALLOCATE',
]);

/**
 * Classify a SQL statement as read or write.
 *
 * @param {string} sql
 * @returns {QueryType}
 */
function classifyQuery(sql) {
  if (!sql) return QueryType.UNKNOWN;
  const upper = sql.trim().toUpperCase();
  for (const cmd of READ_COMMANDS) {
    if (upper.startsWith(cmd)) return QueryType.READ;
  }
  for (const cmd of WRITE_COMMANDS) {
    if (upper.startsWith(cmd)) return QueryType.WRITE;
  }
  return QueryType.UNKNOWN;
}

/**
 * Read/Write splitter for VedaDB.
 * Routes queries to primary (writes) or replicas (reads).
 */
class ReadWriteSplitter extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.primary - Primary node config { host, port }
   * @param {Object[]} [options.replicas=[]] - Replica node configs
   * @param {boolean} [options.replicaReads=true] - Enable read splitting
   * @param {string} [options.unknownRouting='primary'] - Where to route unknown queries
   * @param {function(string):QueryType} [options.classifier] - Custom query classifier
   */
  constructor(options = {}) {
    super();
    this.primary = options.primary;
    this.replicas = options.replicas || [];
    this.replicaReads = options.replicaReads !== false;
    this.unknownRouting = options.unknownRouting || 'primary';
    this.classifier = options.classifier || classifyQuery;
    this._replicaIndex = 0;
  }

  /** Select a replica using round-robin. */
  selectReplica() {
    if (this.replicas.length === 0) return null;
    const replica = this.replicas[this._replicaIndex % this.replicas.length];
    this._replicaIndex = (this._replicaIndex + 1) % this.replicas.length;
    return replica;
  }

  /**
   * Route a query to the appropriate node.
   *
   * @param {string} sql
   * @returns {Object} Node config { host, port, role }
   */
  route(sql) {
    const type = this.classifier(sql);

    if (type === QueryType.WRITE) {
      this.emit('route', { sql, type, target: 'primary' });
      return { ...this.primary, role: 'primary' };
    }

    if (type === QueryType.READ && this.replicaReads && this.replicas.length > 0) {
      const replica = this.selectReplica();
      this.emit('route', { sql, type, target: 'replica', ...replica });
      return { ...replica, role: 'replica' };
    }

    // Unknown queries: route based on configuration
    if (type === QueryType.UNKNOWN && this.unknownRouting === 'replica' && this.replicas.length > 0) {
      const replica = this.selectReplica();
      this.emit('route', { sql, type, target: 'replica', ...replica });
      return { ...replica, role: 'replica' };
    }

    this.emit('route', { sql, type, target: 'primary' });
    return { ...this.primary, role: 'primary' };
  }

  /**
   * Get routing statistics.
   * @returns {Object}
   */
  get stats() {
    return {
      primary: this.primary,
      replicaCount: this.replicas.length,
      replicaReads: this.replicaReads,
      unknownRouting: this.unknownRouting,
    };
  }

  /**
   * Add a replica node.
   * @param {Object} config - { host, port }
   */
  addReplica(config) {
    this.replicas.push(config);
    this.emit('replica:add', config);
  }

  /**
   * Remove a replica node.
   * @param {string} host
   * @param {number} port
   */
  removeReplica(host, port) {
    const idx = this.replicas.findIndex(r => r.host === host && r.port === port);
    if (idx !== -1) {
      const removed = this.replicas.splice(idx, 1)[0];
      this.emit('replica:remove', removed);
    }
  }
}

module.exports = {
  ReadWriteSplitter,
  classifyQuery,
  QueryType,
};
