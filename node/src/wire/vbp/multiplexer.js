/**
 * VBP multiplexed connection — single TCP connection carrying many
 * concurrent in-flight requests keyed by 1-byte sequence id.
 *
 * Wire constraints (VBP_SPEC.md §2):
 *  * seq is 1 byte, wraps at 256.
 *  * Responses arrive in the same connection, addressed by their seq.
 *  * The driver MUST NOT issue a new request with a given seq while a
 *    previous request with that seq is still in flight.
 *
 * In Node, this is single-threaded: we don't need locks. We use a
 * `Map<seq, { frames: Frame[], event: () => void, error: Error|null }>`
 * and the `net.Socket` 'data' event drives the reader.
 *
 * Public API:
 *   call(op, body, opts) -> Promise<Frame[]>
 *   send(op, body) -> seq
 *   start()
 *   close()
 */
'use strict';

const net = require('node:net');
const {
  Frame, VBPBadMagic, VBPConnectionClosed, VBPFrameTooShort, VBPFrameTooLarge,
  VBPProtocolError, tryDecodeFrame, feedBytes, resetState,
} = require('./frame');
const { OP_ERROR, opcodeName } = require('./opcodes');

class VBPError extends Error {
  constructor(sqlstate, message, detail = '', hint = '') {
    super(`[${sqlstate}] ${message}`);
    this.name = 'VBPError';
    this.sqlstate = sqlstate;
    this.message = message;
    this.detail = detail;
    this.hint = hint;
  }
}

class Multiplexer {
  constructor(socket) {
    if (!socket || typeof socket.on !== 'function' || typeof socket.write !== 'function') {
      throw new TypeError('Multiplexer requires a socket-like object with on() and write()');
    }
    this._socket = socket;
    this._closing = false;
    this._closed = false;
    this._state = { buf: Buffer.alloc(0), offset: 0 };
    // Per-seq in-flight state.
    this._inflight = new Map(); // seq -> { frames: Frame[], done: boolean, error: Error|null, callbacks: Function[] }
    this._nextSeq = 1; // 0 is reserved
    this._readLoopAttached = false;
    this._onClose = null;
    // Track the seq of the most-recent call() (used to route
    // unsolicited seq=0 frames, e.g. server-emitted AUTH_OK after
    // CLIENT_HELLO in dev mode).
    this._lastCallSeq = 0;
  }

  start() {
    if (this._readLoopAttached) return;
    this._readLoopAttached = true;
    this._socket.on('data', (chunk) => this._onData(chunk));
    this._socket.on('error', (err) => this._onSocketError(err));
    this._socket.on('close', () => this._onSocketClose());
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  call(op, body, opts = {}) {
    return new Promise((resolve, reject) => {
      const seq = this._alloc();
      const entry = { frames: [], done: false, error: null, callbacks: [] };
      entry.callbacks.push({ resolve, reject });
      this._inflight.set(seq, entry);
      this._lastCallSeq = seq;
      try {
        this._sendFrame(seq, op, 0, body);
      } catch (e) {
        this._inflight.delete(seq);
        reject(e);
        return;
      }
      if (opts.timeout) {
        setTimeout(() => {
          if (!entry.done) {
            entry.done = true;
            this._inflight.delete(seq);
            const err = new Error(`vbp call op=0x${op.toString(16).padStart(2, '0')} seq=${seq} timed out`);
            for (const cb of entry.callbacks) cb.reject(err);
          }
        }, opts.timeout * 1000);
      }
    });
  }

  send(op, body, flags = 0) {
    const seq = this._alloc();
    const entry = { frames: [], done: false, error: null, callbacks: [] };
    this._inflight.set(seq, entry);
    this._sendFrame(seq, op, flags, body);
    return seq;
  }

  close() {
    if (this._closed) return;
    this._closing = true;
    this._closed = true;
    // Wake any waiters with an EOF error.
    for (const [seq, entry] of this._inflight) {
      entry.done = true;
      entry.error = new VBPConnectionClosed('connection closed');
      for (const cb of entry.callbacks) cb.reject(entry.error);
    }
    this._inflight.clear();
    try { this._socket.destroy(); } catch (_) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  _alloc() {
    // Find a free seq, scanning from _nextSeq. Bounded to 256.
    const start = this._nextSeq;
    for (let i = 0; i < 256; i++) {
      const seq = this._nextSeq;
      this._nextSeq = (this._nextSeq + 1) & 0xFF;
      if (seq === 0) continue; // skip reserved
      if (!this._inflight.has(seq)) return seq;
      if (this._nextSeq === start) break;
    }
    throw new VBPProtocolError('all 256 sequence ids are in flight');
  }

  _sendFrame(seq, op, flags, body) {
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
    const payloadLen = 2 + bodyBuf.length;
    const out = Buffer.alloc(8 + 2 + bodyBuf.length);
    out.write('VDB', 0, 3, 'ascii');
    out.writeUInt32LE(payloadLen, 3);
    out[7] = seq & 0xFF;
    out[8] = op & 0xFF;
    out[9] = flags & 0xFF;
    if (bodyBuf.length > 0) bodyBuf.copy(out, 10);
    this._socket.write(out);
  }

  _onData(chunk) {
    if (this._closed) return;
    feedBytes(this._state, chunk);
    // Drain all complete frames.
    let frame;
    try {
      // eslint-disable-next-line no-cond-assign
      while ((frame = tryDecodeFrame(this._state)) !== null) {
        this._dispatchFrame(frame);
      }
    } catch (e) {
      // Protocol error — close and reject all waiters.
      this._failAllWaiters(e);
      this.close();
    }
  }

  _onSocketError(err) {
    this._failAllWaiters(err);
  }

  _onSocketClose() {
    this._failAllWaiters(new VBPConnectionClosed('peer closed'));
  }

  _failAllWaiters(err) {
    for (const [seq, entry] of this._inflight) {
      entry.done = true;
      entry.error = err;
      for (const cb of entry.callbacks) cb.reject(err);
    }
    this._inflight.clear();
  }

  _dispatchFrame(frame) {
    let entry = this._inflight.get(frame.seq);
    if (!entry && frame.seq === 0 && this._lastCallSeq > 0) {
      // Unsolicited seq=0 frame (server-emitted AUTH_OK in dev mode,
      // or any other connection-level frame). Route to the most
      // recent in-flight call so the client gets a complete
      // response. We re-key the entry by lastCallSeq for the
      // dispatch only — we don't change the seq of the frame.
      entry = this._inflight.get(this._lastCallSeq);
    }
    if (!entry) {
      // Truly unsolicited — drop.
      return;
    }
    // Terminating opcodes (the response stream ends after one of these).
    if (frame.op === OP_ERROR) {
      const { sqlstate, message, detail, hint } = Multiplexer.parseErrorFrame(frame);
      entry.error = new VBPError(sqlstate, message, detail, hint);
      entry.done = true;
      for (const cb of entry.callbacks) cb.reject(entry.error);
      this._inflight.delete(this._lastCallSeq || frame.seq);
      return;
    }
    entry.frames.push(frame);
    // Heuristic: AUTH_OK, COMMAND_COMPLETE, PONG mark end of stream.
    // (ROWS_FINISHED is NOT terminal — server emits COMMAND_COMPLETE after it.)
    if (
      frame.op === 0x05 || // OP_AUTH_OK
      frame.op === 0x0C || // OP_COMMAND_COMPLETE
      frame.op === 0x17    // OP_PONG
    ) {
      entry.done = true;
      for (const cb of entry.callbacks) cb.resolve(entry.frames);
      this._inflight.delete(this._lastCallSeq || frame.seq);
    }
  }

  // ------------------------------------------------------------------
  // ERROR frame decoder
  // ------------------------------------------------------------------

  static parseErrorFrame(frame) {
    // body: 5-byte sqlstate, u32 msg_len, msg, u32 detail_len, detail, u32 hint_len, hint, u32 position
    const body = frame.body;
    if (body.length < 9) {
      return { sqlstate: '08P01', message: 'malformed error frame', detail: '', hint: '' };
    }
    const sqlstate = body.subarray(0, 5).toString('ascii');
    const msgLen = body.readUInt32LE(5);
    const message = body.subarray(9, 9 + msgLen).toString('utf-8');
    let off = 9 + msgLen;
    const detailLen = body.readUInt32LE(off); off += 4;
    const detail = body.subarray(off, off + detailLen).toString('utf-8'); off += detailLen;
    const hintLen = body.readUInt32LE(off); off += 4;
    const hint = body.subarray(off, off + hintLen).toString('utf-8');
    return { sqlstate, message, detail, hint };
  }
}

module.exports = { Multiplexer, VBPError };
