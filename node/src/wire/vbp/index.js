/**
 * VedaDB Binary Protocol (VBP) — public API.
 *
 * Mirrors the Python POC's public surface.
 *
 * Pure stdlib: net, crypto, buffer. No third-party deps.
 */
'use strict';

const net = require('node:net');
const {
  DEFAULT_VBP_PORT,
  Frame, VBPProtocolError, VBPBadMagic, VBPFrameTooShort,
  VBPFrameTooLarge, VBPConnectionClosed,
} = require('./frame');
const {
  OP_CLIENT_HELLO, OP_AUTH_OK, OP_QUERY, OP_DATA_CHUNK, OP_ROWS_FINISHED, OP_ERROR,
  AUTH_MECH_PLAIN, AUTH_MECH_NONE, AUTH_MECH_SCRAM_SHA_256, MANDATORY_OPCODES,
  T_BOOL, T_INT2, T_INT4, T_INT8, T_TEXT, T_BYTEA, T_FLOAT8, T_ARRAY,
  typeIdName,
} = require('./opcodes');
const { Multiplexer, VBPError } = require('./multiplexer');
const { performHandshake, VBPAuthError } = require('./auth');
const {
  encodeValue, encodeInputParam, decodeValue, isKnownType, VBPTypeError,
} = require('./types');
const {
  HANDLERS, assertAllMandatoryHandlersRegistered,
} = require('./handlers');

const __version__ = '1.0.0';

function _defaultMechanism() {
  if (process.env.VEDADB_VBP_MECH) return process.env.VEDADB_VBP_MECH.toUpperCase();
  return AUTH_MECH_PLAIN;
}

class VBPConnectionError extends VBPError {
  constructor(msg) {
    super('08006', msg);
    this.name = 'VBPConnectionError';
  }
}

class VBPResult {
  constructor() {
    this.columns = [];
    this.columnTypes = [];
    this.rows = [];
    this.commandTag = '';
    this.rowsAffected = 0;
  }
  toDicts() {
    if (!this.columns.length) return [];
    return this.rows.map((r) => {
      const o = {};
      for (let i = 0; i < this.columns.length; i++) o[this.columns[i]] = r[i];
      return o;
    });
  }
  toString() {
    return `VBPResult(columns=${JSON.stringify(this.columns)}, row_count=${this.rows.length}, command_tag=${this.commandTag})`;
  }
}

function _decodeDataChunk(body) {
  // body: u32 chunk_id, u32 row_count, u16 col_count,
  //       for each col: u16 type_id, u8 null_bitmap_byte_count,
  //                     [null_bitmap bytes],
  //                     row_count × value bytes
  // (VBP_SPEC.md §5.1.b output-column envelope — no col name.)
  const chunkId = body.readUInt32LE(0);
  const rowCount = body.readUInt32LE(4);
  const colCount = body.readUInt16LE(8);
  const colTypes = [];
  const colBlocks = [];
  let off = 10;
  for (let i = 0; i < colCount; i++) {
    const tid = body.readUInt16LE(off); off += 2;
    colTypes.push(tid);
    const bitmapByteCount = body.readUInt8(off); off += 1;
    const bitmap = body.subarray(off, off + bitmapByteCount); off += bitmapByteCount;
    // Value bytes for this column: row_count × fixed-width.
    // (Variable-width types would have u32 length prefix per row; v1
    // dev server only emits T_INT4, so we keep the reader minimal.)
    const w = (tid === T_BOOL) ? 1
            : (tid === T_INT4 || tid === T_FLOAT4) ? 4
            : (tid === T_INT8 || tid === T_FLOAT8 || tid === T_TIMESTAMP) ? 8
            : 4; // fallback
    const values = body.subarray(off, off + rowCount * w); off += rowCount * w;
    colBlocks.push({ tid, bitmap, values });
  }
  // Materialize rows.
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const row = [];
    for (let c = 0; c < colCount; c++) {
      const { tid, bitmap, values } = colBlocks[c];
      // Read the null bit.
      const byte = bitmap.length > 0 ? bitmap[r >> 3] : 0;
      const isNull = bitmap.length > 0 && ((byte >> (r & 7)) & 1) === 1;
      if (isNull) { row.push(null); continue; }
      const w = (tid === T_BOOL) ? 1
              : (tid === T_INT4 || tid === T_FLOAT4) ? 4
              : (tid === T_INT8 || tid === T_FLOAT8 || tid === T_TIMESTAMP) ? 8
              : 4;
      const localOff = r * w;
      if (tid === T_BOOL) row.push(values.readUInt8(localOff) !== 0);
      else if (tid === T_INT4) row.push(values.readInt32LE(localOff));
      else if (tid === T_INT8) row.push(Number(values.readBigInt64LE(localOff)));
      else if (tid === T_FLOAT4) row.push(values.readFloatLE(localOff));
      else if (tid === T_FLOAT8) row.push(values.readDoubleLE(localOff));
      else if (tid === T_TIMESTAMP) row.push(new Date(Number(values.readBigInt64LE(localOff)) / 1000));
      else row.push(null);
    }
    rows.push(row);
  }
  // v1 dev server doesn't emit column names; we synthesise col_N.
  const colNames = colTypes.map((_, i) => `col_${i + 1}`);
  return { colNames, colTypes, rows };
}

function _decodeRowsFinished(body) {
  // u64 rows_affected, u32 tag_len, str tag, u32 exec_time_us
  const rowsAffected = Number(body.readBigUInt64LE(0));
  const tagLen = body.readUInt32LE(8);
  const tag = body.subarray(12, 12 + tagLen).toString('utf-8');
  return { rowsAffected, tag };
}

class VBPConnection {
  constructor(opts = {}) {
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port || DEFAULT_VBP_PORT;
    this.user = opts.user || '';
    this.password = opts.password || '';
    this.db = opts.db || '';
    this.timeout = opts.timeout || 30;
    this.mechanism = (opts.mechanism || _defaultMechanism()).toUpperCase();
    this._socket = null;
    this._mux = null;
    this._connected = false;
    this._closed = false;
  }

  async connect() {
    if (this._connected) return this;
    this._socket = net.createConnection({ host: this.host, port: this.port });
    this._socket.setTimeout(this.timeout * 1000);
    // Attach the mux data/error handlers BEFORE waiting for 'connect',
    // so the server's reply (which can arrive synchronously after
    // 'connect' in a localhost loopback) is not dropped on the floor.
    this._mux = new Multiplexer(this._socket);
    this._mux.start();
    await new Promise((resolve, reject) => {
      const onErr = (e) => { cleanup(); reject(e); };
      const onConn = () => { cleanup(); resolve(); };
      const cleanup = () => {
        this._socket.off('error', onErr);
        this._socket.off('connect', onConn);
      };
      this._socket.once('error', onErr);
      this._socket.once('connect', onConn);
    });

    const helloBody = this._buildHello();
    const replies = await this._mux.call(OP_CLIENT_HELLO, helloBody, { timeout: this.timeout });

    let sawAuthOk = false;
    for (const f of replies) {
      if (f.op === OP_AUTH_OK) sawAuthOk = true;
      else if (f.op === OP_ERROR) {
        const { sqlstate, message } = Multiplexer.parseErrorFrame(f);
        throw new VBPError(sqlstate, message);
      }
    }
    if (!sawAuthOk && this.mechanism !== AUTH_MECH_NONE && this.user) {
      await performHandshake(this._mux, {
        mechanism: this.mechanism,
        username: this.user,
        password: this.password,
        timeout: this.timeout,
      });
    }
    this._connected = true;
    return this;
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    if (this._mux) {
      try { this._mux.close(); } catch (_) { /* ignore */ }
    }
    if (this._socket && !this._socket.destroyed) {
      // Wait for the socket to fully close so the test process can
      // exit. Node's net.Socket returns the socket itself from
      // .end()/.destroy(); use a Promise that resolves on 'close'.
      const sock = this._socket;
      await new Promise((resolve) => {
        if (sock.destroyed) return resolve();
        sock.once('close', resolve);
        try { sock.destroy(); } catch (_) { resolve(); }
        // Safety: if the close event never fires, resolve anyway
        // after 100ms so the test process never hangs.
        setTimeout(resolve, 100).unref();
      });
    }
  }

  async execute(sql, params = []) {
    if (!this._connected) throw new VBPConnectionError('not connected; call connect() first');
    const body = this._buildQuery(sql, params);
    const replies = await this._mux.call(OP_QUERY, body, { timeout: this.timeout });
    return this._parseReplies(replies);
  }

  async ping() {
    if (!this._connected) throw new VBPConnectionError('not connected');
    const nonce = Buffer.alloc(8);
    // Use a monotonic-ish nonce for round-trip.
    nonce.writeBigUInt64LE(BigInt(Date.now()) & 0xFFFFFFFFFFFFFFFFn, 0);
    const replies = await this._mux.call(0x16, nonce, { timeout: this.timeout });
    if (!replies.length || replies[0].op !== 0x17) {
      throw new VBPError('08P01', 'expected PONG');
    }
    return Number(replies[0].body.readBigUInt64LE(0));
  }

  // ------------------------------------------------------------------
  // Frame builders
  // ------------------------------------------------------------------

  _buildHello() {
    const userBuf = Buffer.from(this.user, 'utf-8');
    const dbBuf = Buffer.from(this.db, 'utf-8');
    // u16 proto, u16 client_flags, u32 user_len, user, u32 db_len, db, u8 actor_kind, u32 actor_id_len, actor_id
    const body = Buffer.alloc(2 + 2 + 4 + userBuf.length + 4 + dbBuf.length + 1 + 4 + userBuf.length);
    let off = 0;
    body.writeUInt16LE(1, off); off += 2;     // protocol_version
    body.writeUInt16LE(0, off); off += 2;     // client_flags
    body.writeUInt32LE(userBuf.length, off); off += 4;
    userBuf.copy(body, off); off += userBuf.length;
    body.writeUInt32LE(dbBuf.length, off); off += 4;
    dbBuf.copy(body, off); off += dbBuf.length;
    body.writeUInt8(0, off); off += 1;        // actor_kind = 0 (user)
    body.writeUInt32LE(userBuf.length, off); off += 4;
    userBuf.copy(body, off);
    return body;
  }

  _buildQuery(sql, params) {
    const sqlBuf = Buffer.from(sql, 'utf-8');
    // u32 query_id, u32 sql_len, sql, u16 param_count, [u16 type_id, u32 body_len, body] * count
    let paramBytes = Buffer.alloc(0);
    if (params && params.length) {
      const parts = [];
      for (const p of params) {
        let tid, val;
        if (p === null || p === undefined) { tid = T_INT4; val = null; }
        else if (typeof p === 'boolean') { tid = T_BOOL; val = p; }
        else if (typeof p === 'bigint') { tid = T_INT8; val = p; }
        else if (typeof p === 'number' && Number.isInteger(p)) { tid = T_INT4; val = p; }
        else if (typeof p === 'number') { tid = T_FLOAT8; val = p; }
        else if (Buffer.isBuffer(p)) { tid = T_BYTEA; val = p; }
        else if (Array.isArray(p)) { tid = T_ARRAY; val = p; }
        else { tid = T_TEXT; val = String(p); }
        const body = encodeInputParam(tid, val);
        parts.push(body);
      }
      paramBytes = Buffer.concat(parts);
    }
    const head = Buffer.alloc(4 + 4 + sqlBuf.length + 2);
    let off = 0;
    head.writeUInt32LE(0, off); off += 4;     // query_id
    head.writeUInt32LE(sqlBuf.length, off); off += 4;
    sqlBuf.copy(head, off); off += sqlBuf.length;
    head.writeUInt16LE(params ? params.length : 0, off);
    return Buffer.concat([head, paramBytes]);
  }

  _parseReplies(replies) {
    const result = new VBPResult();
    for (const f of replies) {
      if (f.op === OP_DATA_CHUNK) {
        const dc = _decodeDataChunk(f.body);
        result.columns = dc.colNames;
        result.columnTypes = dc.colTypes;
        result.rows = dc.rows;
      } else if (f.op === OP_ROWS_FINISHED) {
        const rf = _decodeRowsFinished(f.body);
        result.rowsAffected = rf.rowsAffected;
        result.commandTag = rf.tag;
      } else if (f.op === 0x0C) {
        // COMMAND_COMPLETE — nothing to extract for v1.
      } else if (f.op === OP_ERROR) {
        const { sqlstate, message } = Multiplexer.parseErrorFrame(f);
        throw new VBPError(sqlstate, message);
      }
    }
    return result;
  }
}

module.exports = {
  // Connection
  VBPConnection,
  VBPConnectionError,
  VBPError,
  VBPResult,
  // Wire helpers
  Frame,
  Multiplexer,
  HANDLERS,
  assertAllMandatoryHandlersRegistered,
  // Wire-level exceptions
  VBPProtocolError,
  VBPBadMagic,
  VBPFrameTooShort,
  VBPFrameTooLarge,
  VBPConnectionClosed,
  // Constants
  DEFAULT_VBP_PORT,
  MANDATORY_OPCODES,
  // Auth
  AUTH_MECH_PLAIN,
  AUTH_MECH_SCRAM_SHA_256,
  AUTH_MECH_NONE,
  VBPAuthError,
  performHandshake,
  // Encoders
  encodeValue, encodeInputParam, decodeValue, isKnownType,
  VBPTypeError,
  // Version
  __version__,
};
