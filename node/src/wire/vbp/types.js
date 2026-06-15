/**
 * VBP type codecs — encode/decode JS values to/from the wire
 * representations defined in VBP_SPEC.md §5.
 *
 * The v1 type set is 36 IDs. Every type has a *fixed-width* binary
 * representation (e.g. T_INT4 is a 4-byte little-endian signed int)
 * or a *length-prefixed* representation (e.g. T_TEXT is u32 length
 * + UTF-8 bytes).
 *
 * All functions return/accept Buffer and operate incrementally. They
 * are pure — no I/O.
 *
 * Note: the spec's §5 narrative says "27" but the actual table has
 * 36 IDs. We implement the 36 per §5.10 (and per the Go engine's
 * vbp_engine_types.go registry).
 */
'use strict';

const {
  T_BOOL, T_INT2, T_INT4, T_INT8,
  T_FLOAT4, T_FLOAT8,
  T_TEXT, T_VARCHAR, T_BYTEA, T_UUID,
  T_DATE, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_INTERVAL,
  T_NUMERIC, T_MONEY,
  T_JSON, T_JSONB, T_ARRAY,
  T_INET, T_MACADDR, T_CIDR,
  T_VECTOR, T_TSVECTOR,
  T_DOCUMENT,
  T_TS_POINT,
  T_GEO_POINT,
} = require('./opcodes');

class VBPTypeError extends Error {
  constructor(msg) { super(msg); this.name = 'VBPTypeError'; }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal helpers — we use a list-of-buffers pattern (Buffer[]) and concat
// at the end. This avoids the "write at growing offset" anti-pattern that
// would otherwise need dynamic reallocation.
// ---------------------------------------------------------------------------

function writeU8(buf, v) {
  if (!Number.isInteger(v) || v < 0 || v > 0xFF) {
    throw new VBPTypeError(`u8 out of range: ${v}`);
  }
  const tmp = Buffer.alloc(1);
  tmp.writeUInt8(v & 0xFF, 0);
  buf.push(tmp);
}

function writeU16LE(buf, v) {
  if (!Number.isInteger(v) || v < 0 || v > 0xFFFF) {
    throw new VBPTypeError(`u16 out of range: ${v}`);
  }
  const tmp = Buffer.alloc(2);
  tmp.writeUInt16LE(v & 0xFFFF, 0);
  buf.push(tmp);
}

function writeU32LE(buf, v) {
  if (!Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF) {
    throw new VBPTypeError(`u32 out of range: ${v}`);
  }
  const tmp = Buffer.alloc(4);
  tmp.writeUInt32LE(v >>> 0, 0);
  buf.push(tmp);
}

function writeI16LE(buf, v) {
  if (!Number.isInteger(v) || v < -0x8000 || v > 0x7FFF) {
    throw new VBPTypeError(`i16 out of range: ${v}`);
  }
  const tmp = Buffer.alloc(2);
  tmp.writeInt16LE(v, 0);
  buf.push(tmp);
}

function writeI32LE(buf, v) {
  if (!Number.isInteger(v) || v < -0x80000000 || v > 0x7FFFFFFF) {
    throw new VBPTypeError(`i32 out of range: ${v}`);
  }
  const tmp = Buffer.alloc(4);
  tmp.writeInt32LE(v, 0);
  buf.push(tmp);
}

function writeI64LE(buf, v) {
  if (typeof v === 'bigint') {
    const tmp = Buffer.alloc(8);
    tmp.writeBigInt64LE(v, 0);
    buf.push(tmp);
    return;
  }
  if (!Number.isInteger(v) || v < Number.MIN_SAFE_INTEGER || v > Number.MAX_SAFE_INTEGER) {
    throw new VBPTypeError(`i64 out of range: ${v}`);
  }
  const tmp = Buffer.alloc(8);
  tmp.writeBigInt64LE(BigInt(v), 0);
  buf.push(tmp);
}

function writeF32LE(buf, v) {
  const tmp = Buffer.alloc(4);
  tmp.writeFloatLE(v, 0);
  buf.push(tmp);
}

function writeF64LE(buf, v) {
  const tmp = Buffer.alloc(8);
  tmp.writeDoubleLE(v, 0);
  buf.push(tmp);
}

function lp(data) {
  const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const out = Buffer.alloc(4 + dataBuf.length);
  out.writeUInt32LE(dataBuf.length, 0);
  dataBuf.copy(out, 4);
  return out;
}

// ---------------------------------------------------------------------------
// Encoders (each returns a Buffer holding the body bytes)
// ---------------------------------------------------------------------------

function encodeBool(v) {
  const buf = [];
  writeU8(buf, v ? 1 : 0);
  return Buffer.concat(buf);
}

function encodeInt2(v) {
  const buf = [];
  writeI16LE(buf, v);
  return Buffer.concat(buf);
}

function encodeInt4(v) {
  const buf = [];
  writeI32LE(buf, v);
  return Buffer.concat(buf);
}

function encodeInt8(v) {
  const buf = [];
  writeI64LE(buf, v);
  return Buffer.concat(buf);
}

function encodeFloat4(v) {
  const buf = [];
  writeF32LE(buf, v);
  return Buffer.concat(buf);
}

function encodeFloat8(v) {
  const buf = [];
  writeF64LE(buf, v);
  return Buffer.concat(buf);
}

function encodeText(v) {
  return lp(Buffer.from(String(v), 'utf-8'));
}

function encodeVarchar(v) {
  return encodeText(v);
}

function encodeBytea(v) {
  return lp(Buffer.isBuffer(v) ? v : Buffer.from(v));
}

function encodeUUID(v) {
  let bytes;
  if (typeof v === 'string') {
    const s = v.replace(/-/g, '');
    if (s.length !== 32) throw new VBPTypeError(`invalid uuid: ${v}`);
    bytes = Buffer.from(s, 'hex');
  } else if (Buffer.isBuffer(v) && v.length === 16) {
    bytes = v;
  } else if (v && v.bytes && Buffer.isBuffer(v.bytes) && v.bytes.length === 16) {
    bytes = v.bytes;
  } else {
    throw new VBPTypeError(`cannot encode uuid from ${typeof v}`);
  }
  return Buffer.from(bytes);
}

function encodeDate(v) {
  let days;
  if (typeof v === 'number') {
    days = v;
  } else if (typeof v === 'string') {
    days = Math.floor(Date.parse(v + 'T00:00:00Z') / 86400000);
  } else if (v instanceof Date) {
    days = Math.floor(v.getTime() / 86400000);
  } else {
    throw new VBPTypeError(`cannot encode date from ${typeof v}`);
  }
  const buf = [];
  writeI32LE(buf, days);
  return Buffer.concat(buf);
}

function encodeTime(v) {
  let micros;
  if (typeof v === 'number') {
    micros = v;
  } else if (typeof v === 'string') {
    const m = v.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
    if (!m) throw new VBPTypeError(`invalid time: ${v}`);
    const h = parseInt(m[1], 10), mn = parseInt(m[2], 10), s = parseInt(m[3], 10);
    const frac = m[4] ? parseInt(m[4].padEnd(6, '0').slice(0, 6), 10) : 0;
    micros = h * 3600_000_000 + mn * 60_000_000 + s * 1_000_000 + frac;
  } else {
    throw new VBPTypeError(`cannot encode time from ${typeof v}`);
  }
  const buf = [];
  writeI64LE(buf, micros);
  return Buffer.concat(buf);
}

function encodeTimestamp(v) {
  let micros;
  if (typeof v === 'number') {
    micros = v;
  } else if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) throw new VBPTypeError(`invalid timestamp: ${v}`);
    micros = Math.floor(ms * 1000);
  } else if (v instanceof Date) {
    micros = v.getTime() * 1000;
  } else {
    throw new VBPTypeError(`cannot encode timestamp from ${typeof v}`);
  }
  const buf = [];
  writeI64LE(buf, micros);
  return Buffer.concat(buf);
}

function encodeTimestamptz(v) {
  return encodeTimestamp(v);
}

function encodeInterval(v) {
  let micros;
  if (typeof v === 'number') micros = v;
  else if (typeof v === 'string') micros = Math.floor(parseFloat(v) * 1_000_000);
  else if (typeof v === 'bigint') micros = Number(v);
  else throw new VBPTypeError(`cannot encode interval from ${typeof v}`);
  const buf = [];
  writeI64LE(buf, micros);
  const days = Buffer.alloc(4); days.writeInt32LE(0, 0);
  const months = Buffer.alloc(4); months.writeInt32LE(0, 0);
  return Buffer.concat([...buf, days, months]);
}

function encodeNumeric(v) {
  return lp(Buffer.from(String(v), 'ascii'));
}

function encodeMoney(v) {
  const cents = Math.round(parseFloat(v) * 100);
  const buf = [];
  writeI64LE(buf, cents);
  return Buffer.concat(buf);
}

function encodeJson(v) {
  return lp(Buffer.from(JSON.stringify(v)));
}

function encodeJsonb(v) {
  return encodeJson(v);
}

function encodeArray(v) {
  if (!Array.isArray(v)) {
    throw new VBPTypeError(`cannot encode array from ${typeof v}`);
  }
  const buf = [];
  writeU32LE(buf, v.length);
  for (const e of v) {
    writeI32LE(buf, Number(e) | 0);
  }
  return Buffer.concat(buf);
}

function encodeInet(v) {
  return lp(Buffer.from(String(v), 'ascii'));
}

function encodeMacaddr(v) {
  return lp(Buffer.from(String(v), 'ascii'));
}

function encodeCidr(v) {
  return lp(Buffer.from(String(v), 'ascii'));
}

function encodeVector(v) {
  let dim, values;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    dim = Number(v.dim);
    values = v.values;
  } else if (Array.isArray(v)) {
    dim = v.length;
    values = v;
  } else {
    throw new VBPTypeError(`cannot encode vector from ${typeof v}`);
  }
  const buf = [];
  writeU32LE(buf, dim);
  for (let i = 0; i < dim; i++) {
    writeF32LE(buf, parseFloat(values[i]));
  }
  return Buffer.concat(buf);
}

function encodeTsvector(v) {
  return lp(Buffer.from(String(v), 'utf-8'));
}

function encodeDocument(v) {
  return lp(Buffer.from(JSON.stringify(v)));
}

function encodeTsPoint(v) {
  let ts_us, val;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    ts_us = Number(v[0]);
    val = parseFloat(v[1]);
  } else if (v && typeof v === 'object') {
    ts_us = Number(v.ts ?? v[0]);
    val = parseFloat(v.value ?? v[1]);
  } else {
    throw new VBPTypeError(`cannot encode ts_point from ${typeof v}`);
  }
  const buf = [];
  writeI64LE(buf, ts_us);
  writeF64LE(buf, val);
  return Buffer.concat(buf);
}

function encodeGeoPoint(v) {
  let lat_e7, lon_e7;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    lat_e7 = Number(v[0]) | 0;
    lon_e7 = Number(v[1]) | 0;
  } else if (v && typeof v === 'object') {
    lat_e7 = (v.lat_e7 ?? Math.round(parseFloat(v.lat) * 1e7)) | 0;
    lon_e7 = (v.lon_e7 ?? Math.round(parseFloat(v.lon) * 1e7)) | 0;
  } else {
    throw new VBPTypeError(`cannot encode geo_point from ${typeof v}`);
  }
  const buf = [];
  const lat = Buffer.alloc(4); lat.writeInt32LE(lat_e7, 0);
  const lon = Buffer.alloc(4); lon.writeInt32LE(lon_e7, 0);
  buf.push(lat, lon);
  return Buffer.concat(buf);
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

function decodeBool(buf) {
  return buf.readUInt8(0) !== 0;
}
function decodeInt2(buf) { return buf.readInt16LE(0); }
function decodeInt4(buf) { return buf.readInt32LE(0); }
function decodeInt8(buf) { return Number(buf.readBigInt64LE(0)); }
function decodeFloat4(buf) { return buf.readFloatLE(0); }
function decodeFloat8(buf) { return buf.readDoubleLE(0); }
function decodeText(buf) {
  const n = buf.readUInt32LE(0);
  return buf.subarray(4, 4 + n).toString('utf-8');
}
function decodeVarchar(buf) { return decodeText(buf); }
function decodeBytea(buf) {
  const n = buf.readUInt32LE(0);
  return buf.subarray(4, 4 + n);
}
function decodeUUID(buf) {
  const hex = buf.subarray(0, 16).toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
function decodeDate(buf) {
  const days = buf.readInt32LE(0);
  return new Date(days * 86400 * 1000);
}
function decodeTime(buf) {
  const micros = Number(buf.readBigInt64LE(0));
  return micros; // keep as number for v1
}
function decodeTimestamp(buf) {
  const micros = Number(buf.readBigInt64LE(0));
  return new Date(Math.floor(micros / 1000));
}
function decodeTimestamptz(buf) { return decodeTimestamp(buf); }
function decodeInterval(buf) {
  return Number(buf.readBigInt64LE(0));
}
function decodeNumeric(buf) {
  const n = buf.readUInt32LE(0);
  return buf.subarray(4, 4 + n).toString('ascii');
}
function decodeMoney(buf) {
  return Number(buf.readBigInt64LE(0)) / 100;
}
function decodeJson(buf) {
  const n = buf.readUInt32LE(0);
  return JSON.parse(buf.subarray(4, 4 + n).toString('utf-8'));
}
function decodeJsonb(buf) { return decodeJson(buf); }
function decodeArray(buf) {
  const n = buf.readUInt32LE(0);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = buf.readInt32LE(4 + i * 4);
  }
  return out;
}
function decodeInet(buf) {
  const n = buf.readUInt32LE(0);
  return buf.subarray(4, 4 + n).toString('ascii');
}
function decodeMacaddr(buf) {
  const n = buf.readUInt32LE(0);
  return buf.subarray(4, 4 + n).toString('ascii');
}
function decodeCidr(buf) {
  const n = buf.readUInt32LE(0);
  return buf.subarray(4, 4 + n).toString('ascii');
}
function decodeVector(buf) {
  const dim = buf.readUInt32LE(0);
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = buf.readFloatLE(4 + i * 4);
  }
  return out;
}
function decodeTsvector(buf) {
  const n = buf.readUInt32LE(0);
  return buf.subarray(4, 4 + n).toString('utf-8');
}
function decodeDocument(buf) {
  const n = buf.readUInt32LE(0);
  return JSON.parse(buf.subarray(4, 4 + n).toString('utf-8'));
}
function decodeTsPoint(buf) {
  return [Number(buf.readBigInt64LE(0)), buf.readDoubleLE(8)];
}
function decodeGeoPoint(buf) {
  return [buf.readInt32LE(0), buf.readInt32LE(4)];
}

// ---------------------------------------------------------------------------
// Dispatch tables
// ---------------------------------------------------------------------------

const ENCODERS = {
  [T_BOOL]: encodeBool, [T_INT2]: encodeInt2, [T_INT4]: encodeInt4, [T_INT8]: encodeInt8,
  [T_FLOAT4]: encodeFloat4, [T_FLOAT8]: encodeFloat8,
  [T_TEXT]: encodeText, [T_VARCHAR]: encodeVarchar, [T_BYTEA]: encodeBytea, [T_UUID]: encodeUUID,
  [T_DATE]: encodeDate, [T_TIME]: encodeTime, [T_TIMESTAMP]: encodeTimestamp,
  [T_TIMESTAMPTZ]: encodeTimestamptz, [T_INTERVAL]: encodeInterval,
  [T_NUMERIC]: encodeNumeric, [T_MONEY]: encodeMoney,
  [T_JSON]: encodeJson, [T_JSONB]: encodeJsonb, [T_ARRAY]: encodeArray,
  [T_INET]: encodeInet, [T_MACADDR]: encodeMacaddr, [T_CIDR]: encodeCidr,
  [T_VECTOR]: encodeVector, [T_TSVECTOR]: encodeTsvector,
  [T_DOCUMENT]: encodeDocument,
  [T_TS_POINT]: encodeTsPoint,
  [T_GEO_POINT]: encodeGeoPoint,
};

const DECODERS = {
  [T_BOOL]: decodeBool, [T_INT2]: decodeInt2, [T_INT4]: decodeInt4, [T_INT8]: decodeInt8,
  [T_FLOAT4]: decodeFloat4, [T_FLOAT8]: decodeFloat8,
  [T_TEXT]: decodeText, [T_VARCHAR]: decodeVarchar, [T_BYTEA]: decodeBytea, [T_UUID]: decodeUUID,
  [T_DATE]: decodeDate, [T_TIME]: decodeTime, [T_TIMESTAMP]: decodeTimestamp,
  [T_TIMESTAMPTZ]: decodeTimestamptz, [T_INTERVAL]: decodeInterval,
  [T_NUMERIC]: decodeNumeric, [T_MONEY]: decodeMoney,
  [T_JSON]: decodeJson, [T_JSONB]: decodeJsonb, [T_ARRAY]: decodeArray,
  [T_INET]: decodeInet, [T_MACADDR]: decodeMacaddr, [T_CIDR]: decodeCidr,
  [T_VECTOR]: decodeVector, [T_TSVECTOR]: decodeTsvector,
  [T_DOCUMENT]: decodeDocument,
  [T_TS_POINT]: decodeTsPoint,
  [T_GEO_POINT]: decodeGeoPoint,
};

function encodeValue(typeId, value) {
  const enc = ENCODERS[typeId];
  if (!enc) throw new VBPTypeError(`no encoder for type_id ${typeId}`);
  return enc(value);
}

function decodeValue(typeId, raw) {
  const dec = DECODERS[typeId];
  if (!dec) throw new VBPTypeError(`no decoder for type_id ${typeId}`);
  return dec(raw);
}

function isKnownType(typeId) {
  return Object.prototype.hasOwnProperty.call(ENCODERS, typeId);
}

// ---------------------------------------------------------------------------
// Envelope encoders (VBP_SPEC.md §5.1.a, §5.1.b)
// ---------------------------------------------------------------------------

/**
 * Input-parameter envelope: [u16 type_id][u8 null_tag][body]
 *
 * For NULL values, body is empty (null_tag=0). For present values,
 * body is per the type's wire layout.
 */
function encodeInputParam(typeId, value) {
  if (value === null || value === undefined) {
    const out = Buffer.alloc(3);
    out.writeUInt16LE(typeId, 0);
    out.writeUInt8(0, 2);
    return out;
  }
  const body = encodeValue(typeId, value);
  const out = Buffer.alloc(3 + body.length);
  out.writeUInt16LE(typeId, 0);
  out.writeUInt8(1, 2);
  body.copy(out, 3);
  return out;
}

/**
 * Output-column envelope: [u16 type_id][u8 null_bitmap_byte_count][null_bitmap][row_count × value bytes]
 *
 * v1 client may receive (but not send) this envelope.
 */
function decodeOutputColumn(typeId, raw) {
  // raw: [u8 null_bitmap_byte_count][null_bitmap bytes][row_count × value bytes]
  const bitmapByteCount = raw.readUInt8(0);
  const bitmap = raw.subarray(1, 1 + bitmapByteCount);
  const valuesStart = 1 + bitmapByteCount;
  // For v1 we return: bitmap (Buffer), values (Buffer).
  return { bitmap, values: raw.subarray(valuesStart) };
}

module.exports = {
  VBPTypeError,
  encodeValue, decodeValue, isKnownType,
  encodeInputParam, decodeOutputColumn,
  ENCODERS, DECODERS,
};
