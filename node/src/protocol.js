/**
 * VedaDB Node.js Driver - Wire Protocol Handler
 *
 * Handles the newline-delimited JSON (NDJSON) wire protocol.
 * Frames messages, parses responses, and manages the request/response queue.
 */

'use strict';

const { EventEmitter } = require('events');
const { ProtocolError, TimeoutError, ConnectionError } = require('./errors');

/**
 * Protocol version constants.
 */
const PROTOCOL_VERSION = '1.0';
const SUPPORTED_VERSIONS = ['1.0', '0.9'];

/**
 * Frame types in the VedaDB wire protocol.
 */
const FrameType = {
  REQUEST: 'REQUEST',
  RESPONSE: 'RESPONSE',
  ERROR: 'ERROR',
  EVENT: 'EVENT',
  PING: 'PING',
  PONG: 'PONG',
};

/**
 * Result wrapper for query responses.
 */
class Result {
  /**
   * @param {Object} data - Raw parsed JSON response
   */
  constructor(data) {
    this.columns = data.columns || [];
    this.rows = data.rows || [];
    this.rowCount = data.row_count || data.rowCount || 0;
    this.message = data.message || '';
    this.status = data.status || 'ok';
    this.duration = data.duration || 0;
    this.command = data.command || '';
  }

  /**
   * Convert rows to array of plain objects keyed by column name.
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

/**
 * Wire protocol handler for VedaDB.
 * Manages socket I/O, message framing, and response demuxing.
 */
class ProtocolHandler extends EventEmitter {
  /**
   * @param {Object} options
   * @param {number} [options.timeout=30000] - Default query timeout in ms
   * @param {number} [options.maxQueueSize=1000] - Max pending requests
   */
  constructor(options = {}) {
    super();
    this.timeout = options.timeout || 30000;
    this.maxQueueSize = options.maxQueueSize || 1000;
    this._buffer = '';
    this._queue = [];
    this._socket = null;
    this._connected = false;
    this._commandId = 0;
  }

  /**
   * Bind to a socket and begin processing data.
   * @param {net.Socket|tls.TLSSocket} socket
   */
  attach(socket) {
    this._socket = socket;
    this._connected = true;

    socket.on('data', (chunk) => {
      this._buffer += chunk;
      this._drainBuffer();
    });

    socket.on('close', () => {
      this._connected = false;
      this._rejectAll(new ConnectionError('Connection closed'));
      this.emit('disconnect');
    });

    socket.on('error', (err) => {
      this.emit('error', err);
    });

    socket.on('timeout', () => {
      this._rejectAll(new TimeoutError('Socket timeout'));
      this.emit('timeout');
    });
  }

  /**
   * Send a command and wait for its response.
   * @param {string} command - Raw command string
   * @param {Object} [options]
   * @param {number} [options.timeout] - Per-command timeout override
   * @returns {Promise<Result>}
   */
  send(command, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this._connected || !this._socket) {
        return reject(new ConnectionError('Not connected'));
      }
      if (this._queue.length >= this.maxQueueSize) {
        return reject(new ProtocolError('Request queue full'));
      }

      const cmdTimeout = options.timeout || this.timeout;
      const id = ++this._commandId;
      let timer = null;

      if (cmdTimeout > 0) {
        timer = setTimeout(() => {
          const idx = this._queue.findIndex(p => p.id === id);
          if (idx !== -1) {
            this._queue.splice(idx, 1);
            reject(new TimeoutError(`Command timed out after ${cmdTimeout}ms`, { command }));
          }
        }, cmdTimeout);
      }

      this._queue.push({ id, resolve, reject, timer, command });
      this._socket.write(command + '\n');
    });
  }

  /**
   * Send multiple commands as a pipeline batch.
   * @param {string[]} commands
   * @param {Object} [options]
   * @returns {Promise<Result[]>}
   */
  pipeline(commands, options = {}) {
    if (!this._connected || !this._socket) {
      return Promise.reject(new ConnectionError('Not connected'));
    }
    if (!commands || commands.length === 0) {
      return Promise.resolve([]);
    }
    if (this._queue.length + commands.length > this.maxQueueSize) {
      return Promise.reject(new ProtocolError('Request queue would exceed max size'));
    }

    const cmdTimeout = options.timeout || this.timeout;
    const promises = [];
    let batch = '';

    for (const cmd of commands) {
      const id = ++this._commandId;
      batch += cmd.trim().replace(/\n/g, ' ') + '\n';

      promises.push(new Promise((resolve, reject) => {
        let timer = null;
        if (cmdTimeout > 0) {
          timer = setTimeout(() => {
            const idx = this._queue.findIndex(p => p.id === id);
            if (idx !== -1) this._queue.splice(idx, 1);
            reject(new TimeoutError(`Pipeline command timed out after ${cmdTimeout}ms`));
          }, cmdTimeout);
        }
        this._queue.push({ id, resolve, reject, timer });
      }));
    }

    this._socket.write(batch);
    return Promise.all(promises);
  }

  /**
   * Send a PING frame.
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      await this.send('PING');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gracefully close the protocol handler.
   */
  close() {
    this._connected = false;
    this._rejectAll(new ConnectionError('Protocol handler closed'));
    this._buffer = '';
  }

  /** Whether the handler is connected. */
  get connected() {
    return this._connected;
  }

  /** Number of pending requests. */
  get pending() {
    return this._queue.length;
  }

  // -- internal -------------------------------------------------------------

  /** Process buffered data looking for complete newline-delimited responses. */
  _drainBuffer() {
    let idx;
    while ((idx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.substring(0, idx).trim();
      this._buffer = this._buffer.substring(idx + 1);

      if (!line) continue;
      if (this._queue.length === 0) {
        // Could be an unsolicited event
        this._handleUnsolicited(line);
        continue;
      }

      const pending = this._queue.shift();
      if (pending.timer) clearTimeout(pending.timer);

      try {
        const parsed = JSON.parse(line);
        if (parsed.error) {
          pending.reject(new QueryError(parsed.error, parsed));
        } else if (parsed.type === FrameType.EVENT) {
          this.emit('event', parsed);
          // Re-queue this pending since it wasn't our response
          this._queue.unshift(pending);
        } else {
          pending.resolve(new Result(parsed));
        }
      } catch (_e) {
        pending.resolve(new Result({ message: line }));
      }
    }
  }

  /** Handle unsolicited messages (events, welcome banner). */
  _handleUnsolicited(line) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === FrameType.EVENT) {
        this.emit('event', parsed);
      } else {
        this.emit('message', parsed);
      }
    } catch (_e) {
      this.emit('message', { message: line });
    }
  }

  /** Reject all pending promises. */
  _rejectAll(err) {
    while (this._queue.length > 0) {
      const pending = this._queue.shift();
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(err);
    }
  }
}

module.exports = {
  ProtocolHandler,
  Result,
  FrameType,
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
};
