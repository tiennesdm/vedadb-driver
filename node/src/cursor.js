/**
 * VedaDB Node.js Driver - Streaming Cursor
 *
 * Read large result sets as a Node.js stream with backpressure support.
 * Implements both async iterator and Readable stream interfaces.
 */

'use strict';

const { Readable } = require('stream');
const { EventEmitter } = require('events');
const { ConnectionError, QueryError } = require('./errors');

/**
 * Streaming cursor for iterating over large query results.
 * Supports async iteration and Node.js streams.
 */
class Cursor extends EventEmitter {
  /**
   * @param {Object} client - VedaDB client
   * @param {string} sql - Query SQL
   * @param {Array} [params] - Query parameters
   * @param {Object} [options]
   * @param {number} [options.batchSize=1000] - Rows per fetch
   * @param {number} [options.prefetch=1] - Number of batches to prefetch
   */
  constructor(client, sql, params, options = {}) {
    super();
    this._client = client;
    this._sql = sql;
    this._params = params || [];
    this._batchSize = options.batchSize || 1000;
    this._prefetch = options.prefetch || 1;
    this._offset = 0;
    this._buffer = [];
    this._columns = [];
    this._done = false;
    this._closed = false;
    this._reading = false;
    this._totalRows = 0;
  }

  /** Whether the cursor has been closed. */
  get closed() {
    return this._closed;
  }

  /** Total rows fetched so far. */
  get totalRows() {
    return this._totalRows;
  }

  /** Whether there are more rows to fetch. */
  get isDone() {
    return this._done && this._buffer.length === 0;
  }

  /**
   * Read the next row as an object.
   * @returns {Promise<Object|null>} Next row or null if exhausted
   */
  async next() {
    if (this._closed) return null;

    // Fill buffer if needed
    if (this._buffer.length === 0 && !this._done) {
      await this._fetchBatch();
    }

    if (this._buffer.length === 0) {
      this._done = true;
      return null;
    }

    this._totalRows++;
    const row = this._buffer.shift();

    // Eager fetch next batch
    if (this._buffer.length === 0 && !this._done) {
      this._fetchBatch().catch(() => {});
    }

    return this._toObject(row);
  }

  /**
   * Read all remaining rows.
   * @returns {Promise<Object[]>}
   */
  async readAll() {
    const rows = [];
    let row;
    while ((row = await this.next()) !== null) {
      rows.push(row);
    }
    return rows;
  }

  /**
   * Close the cursor and release resources.
   */
  close() {
    this._closed = true;
    this._done = true;
    this._buffer = [];
    this.emit('close');
  }

  /**
   * Create a Node.js Readable stream from this cursor.
   * @param {Object} [options] - stream.Readable options
   * @returns {stream.Readable}
   */
  toStream(options = {}) {
    const cursor = this;
    let columnsSet = false;

    return new Readable({
      objectMode: true,
      ...options,
      async read() {
        try {
          const row = await cursor.next();
          if (row === null) {
            this.push(null);
          } else {
            this.push(row);
          }
        } catch (err) {
          this.destroy(err);
        }
      },
      destroy(err, callback) {
        cursor.close();
        callback(err);
      },
    });
  }

  /**
   * Create an async iterator for the cursor.
   * @returns {AsyncGenerator<Object>}
   */
  async *[Symbol.asyncIterator]() {
    let row;
    while ((row = await this.next()) !== null) {
      yield row;
    }
  }

  // -- internal -------------------------------------------------------------

  async _fetchBatch() {
    if (this._reading || this._done || this._closed) return;
    this._reading = true;

    try {
      const paginated = this._addPagination(this._sql);
      const result = await this._client.query(paginated);

      if (result.columns && result.columns.length > 0) {
        this._columns = result.columns;
      }

      if (result.rows && result.rows.length > 0) {
        this._buffer.push(...result.rows);
        this._offset += result.rows.length;

        if (result.rows.length < this._batchSize) {
          this._done = true;
        }
      } else {
        this._done = true;
      }

      this.emit('batch', { fetched: result.rows?.length || 0, total: this._totalRows });
    } catch (err) {
      this._done = true;
      this.emit('error', err);
      throw err;
    } finally {
      this._reading = false;
    }
  }

  _addPagination(sql) {
    // Remove trailing semicolon for appending
    let clean = sql.trim().replace(/;$/, '');

    // Only add LIMIT/OFFSET if not already present
    if (!/\bLIMIT\s+\d+/i.test(clean)) {
      clean += ` LIMIT ${this._batchSize}`;
    }
    if (!/\bOFFSET\s+\d+/i.test(clean)) {
      clean += ` OFFSET ${this._offset}`;
    }
    return clean + ';';
  }

  _toObject(row) {
    if (!this._columns || this._columns.length === 0) return row;
    if (Array.isArray(row)) {
      const obj = {};
      this._columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    }
    return row;
  }
}

module.exports = { Cursor };
