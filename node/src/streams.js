/**
 * VedaDB Node.js Driver - Change Streams (CDC)
 *
 * Real-time change data capture streaming from VedaDB.
 * Watches tables for INSERT, UPDATE, DELETE changes and emits events.
 */

'use strict';

const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { ConnectionError } = require('./errors');

/**
 * Change operation types.
 */
const ChangeType = {
  INSERT: 'insert',
  UPDATE: 'update',
  DELETE: 'delete',
  DDL: 'ddl',
  ALL: 'all',
};

/**
 * Represents a single change event.
 */
class ChangeEvent {
  /**
   * @param {Object} data
   * @param {string} data.type - Change type
   * @param {string} data.table - Table name
   * @param {Object} [data.before] - Row before change (updates/deletes)
   * @param {Object} [data.after] - Row after change (inserts/updates)
   * @param {string} [data.timestamp] - ISO timestamp
   * @param {number} [data.lsn] - Log sequence number
   */
  constructor(data) {
    this.type = data.type;
    this.table = data.table;
    this.before = data.before || null;
    this.after = data.after || null;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.lsn = data.lsn || 0;
  }
}

/**
 * Change stream for watching VedaDB table changes.
 */
class ChangeStream extends EventEmitter {
  /**
   * @param {Object} client - VedaDB client
   * @param {string} table - Table to watch (or '*' for all tables)
   * @param {Object} [options]
   * @param {string[]} [options.operations] - Filter by operation types
   * @param {boolean} [options.includeBefore=false] - Include before image
   * @param {number} [options.pollIntervalMs=1000] - Polling interval
   * @param {number} [options.resumeLSN=0] - Log sequence number to resume from
   */
  constructor(client, table, options = {}) {
    super();
    this._client = client;
    this._table = table;
    this._operations = options.operations || Object.values(ChangeType);
    this._includeBefore = options.includeBefore || false;
    this._pollIntervalMs = options.pollIntervalMs || 1000;
    this._resumeLSN = options.resumeLSN || 0;
    this._running = false;
    this._timer = null;
    this._lastLSN = this._resumeLSN;
    this._changeBuffer = [];
    this._listeners = 0;
  }

  /** Whether the stream is active. */
  get isRunning() {
    return this._running;
  }

  /** Current log sequence number. */
  get lsn() {
    return this._lastLSN;
  }

  /** Stream statistics. */
  get stats() {
    return {
      table: this._table,
      running: this._running,
      lastLSN: this._lastLSN,
      buffered: this._changeBuffer.length,
      operations: this._operations,
    };
  }

  /**
   * Start watching for changes.
   * @returns {ChangeStream}
   */
  watch() {
    if (this._running) return this;
    this._running = true;

    this._poll();
    this._timer = setInterval(() => this._poll(), this._pollIntervalMs);

    this.emit('start', { table: this._table, lsn: this._lastLSN });
    return this;
  }

  /**
   * Stop watching.
   * @returns {ChangeStream}
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.emit('stop', { lastLSN: this._lastLSN });
    return this;
  }

  /**
   * Read the next change event.
   * @returns {Promise<ChangeEvent|null>}
   */
  async next() {
    if (this._changeBuffer.length > 0) {
      return this._changeBuffer.shift();
    }
    if (!this._running) return null;

    // Wait for next poll to populate buffer
    await this._wait(this._pollIntervalMs);
    return this._changeBuffer.shift() || null;
  }

  /**
   * Get all buffered changes (non-blocking).
   * @returns {ChangeEvent[]}
   */
  getBuffered() {
    return this._changeBuffer.splice(0);
  }

  /**
   * Create a Readable stream of changes.
   * @returns {Readable}
   */
  toStream() {
    const stream = this;

    return new Readable({
      objectMode: true,
      read() {
        stream.next().then(event => {
          this.push(event || null);
        }).catch(err => {
          this.destroy(err);
        });
      },
      destroy() {
        stream.stop();
      },
    });
  }

  /**
   * Async iterator over changes.
   * @returns {AsyncGenerator<ChangeEvent>}
   */
  async *[Symbol.asyncIterator]() {
    while (this._running) {
      const event = await this.next();
      if (event === null) {
        if (!this._running) break;
        continue;
      }
      yield event;
    }
  }

  /** Destroy the change stream. */
  destroy() {
    this.stop();
    this._changeBuffer = [];
    this.removeAllListeners();
  }

  // -- internal -------------------------------------------------------------

  async _poll() {
    if (!this._running || !this._client.connected) return;

    try {
      const ops = this._operations.join(',');
      const beforeOpt = this._includeBefore ? ' WITH BEFORE' : '';
      const sql = `WATCH ${this._table} SINCE ${this._lastLSN} TYPES ${ops}${beforeOpt};`;

      const result = await this._client.query(sql);

      if (result.rows && result.rows.length > 0) {
        for (const row of result.toObjects()) {
          const event = new ChangeEvent({
            type: row.type || row.operation,
            table: row.table || this._table,
            before: row.before ? JSON.parse(row.before) : null,
            after: row.after ? JSON.parse(row.after) : null,
            timestamp: row.timestamp || new Date().toISOString(),
            lsn: parseInt(row.lsn, 10) || ++this._lastLSN,
          });

          this._lastLSN = event.lsn;
          this._changeBuffer.push(event);
          this.emit('change', event);

          // Emit typed events
          this.emit(event.type, event);
        }
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = {
  ChangeStream,
  ChangeEvent,
  ChangeType,
};
