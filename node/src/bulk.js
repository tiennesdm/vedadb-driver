/**
 * VedaDB Node.js Driver - Bulk Inserter + Pipeline
 *
 * High-performance batch insertions with automatic batching,
 * pipeline execution, and progress tracking.
 */

'use strict';

const { EventEmitter } = require('events');
const { BulkError } = require('./errors');

/**
 * Escape a value for SQL.
 * @param {*} v
 * @returns {string}
 */
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return String(v);
}

/**
 * Bulk inserter for efficient batch INSERT operations.
 * Accumulates rows and flushes when batch size is reached.
 */
class BulkInserter extends EventEmitter {
  /**
   * @param {Object} client - VedaDB client
   * @param {string} table - Target table name
   * @param {number} [batchSize=1000] - Rows per batch
   * @param {Object} [options]
   * @param {boolean} [options.usePipeline=true] - Use pipeline for batches
   * @param {boolean} [options.ignoreDuplicates=false] - Use INSERT IGNORE
   * @param {number} [options.flushIntervalMs=0] - Auto-flush interval (0 = disabled)
   */
  constructor(client, table, batchSize = 1000, options = {}) {
    super();
    this._client = client;
    this._table = table;
    this._batchSize = batchSize;
    this._usePipeline = options.usePipeline !== false;
    this._ignoreDuplicates = options.ignoreDuplicates || false;
    this._flushIntervalMs = options.flushIntervalMs || 0;
    this._rows = [];
    this._total = 0;
    this._flushed = 0;
    this._columns = null;
    this._timer = null;

    if (this._flushIntervalMs > 0) {
      this._timer = setInterval(() => {
        if (this._rows.length > 0) this.flush().catch(() => {});
      }, this._flushIntervalMs);
    }
  }

  /** Number of rows currently buffered. */
  get buffered() {
    return this._rows.length;
  }

  /** Total rows inserted so far. */
  get totalInserted() {
    return this._flushed;
  }

  /** Stats snapshot. */
  get stats() {
    return {
      table: this._table,
      buffered: this._rows.length,
      batchSize: this._batchSize,
      totalInserted: this._flushed,
      pending: this._total - this._flushed,
    };
  }

  /**
   * Add a row to the buffer.
   * Flushes automatically when batch size is reached.
   *
   * @param {Object} row - { column: value }
   * @returns {Promise<number|undefined>} Rows flushed if batch was full
   */
  async add(row) {
    if (!this._columns && row) {
      this._columns = Object.keys(row);
    }

    this._rows.push(row);
    this._total++;

    if (this._rows.length >= this._batchSize) {
      return this.flush();
    }
  }

  /**
   * Add multiple rows at once.
   * @param {Object[]} rows
   * @returns {Promise<number>} Total rows flushed
   */
  async addMany(rows) {
    let flushed = 0;
    for (const row of rows) {
      const result = await this.add(row);
      if (result) flushed += result;
    }
    return flushed;
  }

  /**
   * Manually flush the current buffer.
   * @returns {Promise<number>} Number of rows flushed
   */
  async flush() {
    if (this._rows.length === 0) return 0;

    const batch = this._rows.splice(0, this._rows.length);
    const start = Date.now();

    try {
      let inserted;
      if (this._usePipeline && batch.length > 1) {
        inserted = await this._pipelineInsert(batch);
      } else {
        inserted = await this._singleInsert(batch);
      }

      this._flushed += inserted;
      this.emit('flush', { rows: inserted, duration: Date.now() - start, table: this._table });
      return inserted;
    } catch (err) {
      this.emit('error', { error: err, batchSize: batch.length });
      throw new BulkError(`Bulk insert failed for ${this._table}: ${err.message}`,
        batch.map((_, i) => ({ index: i, error: err })));
    }
  }

  /**
   * Flush remaining rows and close the inserter.
   * @returns {Promise<number>} Total rows flushed in final batch
   */
  async close() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    const result = await this.flush();
    this.emit('close', { totalInserted: this._flushed });
    return result;
  }

  /** Destroy without flushing. */
  destroy() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._rows = [];
    this.emit('destroy');
  }

  // -- internal -------------------------------------------------------------

  async _singleInsert(rows) {
    if (!this._columns) return 0;
    const cols = this._columns.join(', ');
    const values = rows.map(row =>
      '(' + this._columns.map(c => esc(row[c])).join(', ') + ')'
    ).join(', ');
    const ignore = this._ignoreDuplicates ? ' IGNORE' : '';
    const sql = `INSERT${ignore} INTO ${this._table} (${cols}) VALUES ${values};`;
    const result = await this._client.query(sql);
    return result.rowCount || rows.length;
  }

  async _pipelineInsert(rows) {
    if (!this._columns) return 0;
    const cols = this._columns.join(', ');
    const ignore = this._ignoreDuplicates ? ' IGNORE' : '';
    const queries = rows.map(row => {
      const vals = this._columns.map(c => esc(row[c])).join(', ');
      return `INSERT${ignore} INTO ${this._table} (${cols}) VALUES (${vals});`;
    });

    const results = await this._client.pipeline(queries);
    return results.length;
  }
}

/**
 * Pipeline builder for batching multiple operations.
 */
class Pipeline extends EventEmitter {
  /**
   * @param {Object} client - VedaDB client
   */
  constructor(client) {
    super();
    this._client = client;
    this._queries = [];
  }

  /** Number of queued queries. */
  get length() {
    return this._queries.length;
  }

  /**
   * Add a query to the pipeline.
   * @param {string} sql
   * @returns {Pipeline}
   */
  query(sql) {
    this._queries.push(sql);
    return this;
  }

  /**
   * Add an INSERT to the pipeline.
   * @param {string} table
   * @param {Object} data
   * @returns {Pipeline}
   */
  insert(table, data) {
    const cols = Object.keys(data);
    const vals = cols.map(c => esc(data[c])).join(', ');
    this._queries.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals});`);
    return this;
  }

  /**
   * Add an UPDATE to the pipeline.
   * @param {string} table
   * @param {Object} data - { column: value }
   * @param {Object} where - { column: value }
   * @returns {Pipeline}
   */
  update(table, data, where) {
    const setClause = Object.entries(data)
      .map(([k, v]) => `${k} = ${esc(v)}`)
      .join(', ');
    const whereClause = Object.entries(where || {})
      .map(([k, v]) => {
        if (v === null) return `${k} IS NULL`;
        return `${k} = ${esc(v)}`;
      })
      .join(' AND ');
    let sql = `UPDATE ${table} SET ${setClause}`;
    if (whereClause) sql += ` WHERE ${whereClause}`;
    sql += ';';
    this._queries.push(sql);
    return this;
  }

  /**
   * Add a DELETE to the pipeline.
   * @param {string} table
   * @param {Object} where
   * @returns {Pipeline}
   */
  delete(table, where) {
    const whereClause = Object.entries(where || {})
      .map(([k, v]) => {
        if (v === null) return `${k} IS NULL`;
        return `${k} = ${esc(v)}`;
      })
      .join(' AND ');
    let sql = `DELETE FROM ${table}`;
    if (whereClause) sql += ` WHERE ${whereClause}`;
    sql += ';';
    this._queries.push(sql);
    return this;
  }

  /**
   * Execute all queued queries as a pipeline.
   * @returns {Promise<Result[]>}
   */
  async execute() {
    if (this._queries.length === 0) return [];
    const start = Date.now();
    const queries = this._queries.splice(0);
    const results = await this._client.pipeline(queries);
    this.emit('execute', { count: queries.length, duration: Date.now() - start });
    return results;
  }

  /** Clear queued queries without executing. */
  clear() {
    this._queries = [];
  }
}

module.exports = { BulkInserter, Pipeline, esc };
