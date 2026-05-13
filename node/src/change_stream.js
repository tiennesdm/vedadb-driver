/**
 * VedaDB Change Stream (CDC) for Node.js
 *
 * @example
 * const stream = client.watch('users', {
 *   operations: ['INSERT', 'UPDATE'],
 *   resumeFromLSN: 12345,
 * });
 * stream.on('data', (event) => console.log(event.operation));
 * stream.on('error', (err) => console.error(err));
 */

'use strict';

const { EventEmitter } = require('events');

class ChangeStream extends EventEmitter {
  constructor(client, table, options = {}) {
    super();
    this.client = client;
    this.table = table;
    this.operations = options.operations || [];
    this.resumeFromLSN = options.resumeFromLSN || 0;
    this.includeBefore = options.includeBefore || false;
    this.active = false;
    this.lastLSN = this.resumeFromLSN;
    this._pollInterval = options.pollInterval || 100;
    this._timer = null;
  }

  start() {
    if (this.active) return this;
    this.active = true;
    this._poll();
    return this;
  }

  stop() {
    this.active = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.emit('close');
    return this;
  }

  async _poll() {
    while (this.active) {
      try {
        const sql = this._buildSQL();
        const result = await this.client.query(sql);
        for (const row of result.rows || []) {
          const event = this._parseRow(row, result.columns);
          if (!event || !this._matchesFilter(event)) continue;
          this.lastLSN = event.lsn;
          this.emit('data', event);
        }
        await this._sleep(this._pollInterval);
      } catch (err) {
        this.emit('error', err);
        await this._sleep(1000);
      }
    }
  }

  _buildSQL() {
    let sql = 'WATCH';
    if (this.table) sql += ` "${this.table}"`;
    if (this.resumeFromLSN > 0) sql += ` RESUME LSN ${this.resumeFromLSN}`;
    if (this.operations.length > 0) {
      sql += ` FILTER (${this.operations.join(',')})`;
    }
    sql += ';';
    return sql;
  }

  _parseRow(row, columns) {
    const event = {};
    columns.forEach((col, i) => {
      event[col] = row[i];
    });
    if (!event.operation) return null;
    return event;
  }

  _matchesFilter(event) {
    if (this.operations.length === 0) return true;
    return this.operations.some(op => op.toUpperCase() === String(event.operation).toUpperCase());
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getResumeToken() {
    return JSON.stringify({ lsn: this.lastLSN, table: this.table, time: Date.now() });
  }

  resumeFromToken(token) {
    const parsed = JSON.parse(token);
    if (parsed.lsn) this.resumeFromLSN = parsed.lsn;
    if (parsed.table) this.table = parsed.table;
    return this;
  }
}

module.exports = { ChangeStream };
