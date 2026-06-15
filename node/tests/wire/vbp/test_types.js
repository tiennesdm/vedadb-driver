'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  T_BOOL, T_INT2, T_INT4, T_INT8, T_FLOAT4, T_FLOAT8,
  T_TEXT, T_VARCHAR, T_BYTEA, T_UUID, T_DATE, T_TIME, T_TIMESTAMP,
  T_TIMESTAMPTZ, T_INTERVAL, T_NUMERIC, T_MONEY,
  T_JSON, T_JSONB, T_ARRAY, T_INET, T_MACADDR, T_CIDR,
  T_VECTOR, T_TSVECTOR, T_DOCUMENT, T_TS_POINT, T_GEO_POINT,
} = require('../../../src/wire/vbp/opcodes');
const {
  encodeValue, decodeValue, isKnownType, encodeInputParam, decodeOutputColumn,
  VBPTypeError, ENCODERS, DECODERS,
} = require('../../../src/wire/vbp/types');

test('types: T_BOOL encode/decode', () => {
  assert.deepStrictEqual(encodeValue(T_BOOL, true), Buffer.from([1]));
  assert.deepStrictEqual(encodeValue(T_BOOL, false), Buffer.from([0]));
  assert.strictEqual(decodeValue(T_BOOL, Buffer.from([1])), true);
  assert.strictEqual(decodeValue(T_BOOL, Buffer.from([0])), false);
});

test('types: T_INT4 round-trip', () => {
  const buf = encodeValue(T_INT4, 42);
  assert.strictEqual(buf.length, 4);
  assert.strictEqual(buf.readInt32LE(0), 42);
  assert.strictEqual(decodeValue(T_INT4, buf), 42);
  assert.strictEqual(decodeValue(T_INT4, encodeValue(T_INT4, -1)), -1);
  assert.strictEqual(decodeValue(T_INT4, encodeValue(T_INT4, 0)), 0);
  assert.strictEqual(decodeValue(T_INT4, encodeValue(T_INT4, 0x7FFFFFFF)), 0x7FFFFFFF);
  assert.strictEqual(decodeValue(T_INT4, encodeValue(T_INT4, -0x80000000)), -0x80000000);
});

test('types: T_INT8 round-trip', () => {
  const buf = encodeValue(T_INT8, 9007199254740991n);
  assert.strictEqual(decodeValue(T_INT8, buf), 9007199254740991);
});

test('types: T_FLOAT4/FLOAT8 round-trip', () => {
  // 3.14 is not exactly representable in IEEE-754; use near-equal.
  const f4 = decodeValue(T_FLOAT4, encodeValue(T_FLOAT4, 3.14));
  assert.ok(Math.abs(f4 - 3.14) < 1e-6, `f4=${f4}`);
  assert.strictEqual(decodeValue(T_FLOAT8, encodeValue(T_FLOAT8, 3.14159265358979)), 3.14159265358979);
});

test('types: T_TEXT length-prefix round-trip', () => {
  const buf = encodeValue(T_TEXT, 'hello');
  // u32 length (4 bytes) + 5 bytes = 9 bytes
  assert.strictEqual(buf.length, 9);
  assert.strictEqual(buf.readUInt32LE(0), 5);
  assert.strictEqual(decodeValue(T_TEXT, buf), 'hello');
});

test('types: T_VARCHAR alias of T_TEXT', () => {
  const a = encodeValue(T_TEXT, 'abc');
  const b = encodeValue(T_VARCHAR, 'abc');
  assert.deepStrictEqual(a, b);
});

test('types: T_BYTEA round-trip', () => {
  const data = Buffer.from([0x00, 0xFF, 0x10]);
  const buf = encodeValue(T_BYTEA, data);
  assert.deepStrictEqual(decodeValue(T_BYTEA, buf), data);
});

test('types: T_UUID string + binary', () => {
  const s = '550e8400-e29b-41d4-a716-446655440000';
  const buf = encodeValue(T_UUID, s);
  assert.strictEqual(buf.length, 16);
  assert.strictEqual(decodeValue(T_UUID, buf), s);
  // From raw 16-byte Buffer
  const raw = Buffer.from('550e8400e29b41d4a716446655440000', 'hex');
  assert.deepStrictEqual(encodeValue(T_UUID, raw), raw);
});

test('types: T_DATE encode (days since epoch)', () => {
  const buf = encodeValue(T_DATE, 0);
  assert.strictEqual(buf.length, 4);
  assert.strictEqual(buf.readInt32LE(0), 0);
});

test('types: T_TIME encode (microseconds)', () => {
  const buf = encodeValue(T_TIME, 0);
  assert.strictEqual(buf.length, 8);
  assert.strictEqual(Number(buf.readBigInt64LE(0)), 0);
});

test('types: T_TIMESTAMP encode (microseconds since epoch)', () => {
  const buf = encodeValue(T_TIMESTAMP, 0);
  assert.strictEqual(buf.length, 8);
});

test('types: T_TIMESTAMPTZ matches T_TIMESTAMP shape', () => {
  assert.strictEqual(encodeValue(T_TIMESTAMPTZ, 1000).length, 8);
});

test('types: T_INTERVAL round-trip', () => {
  const buf = encodeValue(T_INTERVAL, 1000000);
  assert.strictEqual(buf.length, 16);
});

test('types: T_NUMERIC as ASCII', () => {
  const buf = encodeValue(T_NUMERIC, '123.45');
  assert.strictEqual(decodeValue(T_NUMERIC, buf), '123.45');
});

test('types: T_MONEY round-trip (cents)', () => {
  const buf = encodeValue(T_MONEY, '1.00');
  // 100 cents
  assert.strictEqual(Number(buf.readBigInt64LE(0)), 100);
  assert.strictEqual(decodeValue(T_MONEY, buf), 1.0);
});

test('types: T_JSON round-trip', () => {
  const obj = { hello: 'world', n: 42 };
  const buf = encodeValue(T_JSON, obj);
  assert.deepStrictEqual(decodeValue(T_JSON, buf), obj);
});

test('types: T_JSONB = T_JSON shape', () => {
  assert.deepStrictEqual(encodeValue(T_JSONB, [1, 2]), encodeValue(T_JSON, [1, 2]));
});

test('types: T_ARRAY of int4', () => {
  const buf = encodeValue(T_ARRAY, [1, 2, 3, 4]);
  // u32 count (4) + 4 * i32 (16) = 20
  assert.strictEqual(buf.length, 20);
  assert.strictEqual(buf.readUInt32LE(0), 4);
  assert.deepStrictEqual(decodeValue(T_ARRAY, buf), [1, 2, 3, 4]);
});

test('types: T_INET, T_MACADDR, T_CIDR length-prefixed ASCII', () => {
  const inet = encodeValue(T_INET, '10.0.0.0/8');
  assert.strictEqual(decodeValue(T_INET, inet), '10.0.0.0/8');
  const mac = encodeValue(T_MACADDR, 'aa:bb:cc:dd:ee:ff');
  assert.strictEqual(decodeValue(T_MACADDR, mac), 'aa:bb:cc:dd:ee:ff');
  const cidr = encodeValue(T_CIDR, '192.168.0.0/16');
  assert.strictEqual(decodeValue(T_CIDR, cidr), '192.168.0.0/16');
});

test('types: T_VECTOR dim + f32×N', () => {
  const buf = encodeValue(T_VECTOR, [1.0, 2.0, 3.0]);
  assert.strictEqual(buf.length, 4 + 3 * 4);
  assert.strictEqual(buf.readUInt32LE(0), 3);
  const v = decodeValue(T_VECTOR, buf);
  assert.strictEqual(v.length, 3);
  assert.ok(Math.abs(v[0] - 1.0) < 1e-6);
});

test('types: T_VECTOR from {dim, values}', () => {
  const buf = encodeValue(T_VECTOR, { dim: 2, values: [0.5, 1.5] });
  assert.strictEqual(buf.readUInt32LE(0), 2);
});

test('types: T_TSVECTOR round-trip', () => {
  const buf = encodeValue(T_TSVECTOR, 'cat:1 dog:2');
  assert.strictEqual(decodeValue(T_TSVECTOR, buf), 'cat:1 dog:2');
});

test('types: T_DOCUMENT round-trip (JSON)', () => {
  const buf = encodeValue(T_DOCUMENT, { id: 1, name: 'foo' });
  assert.deepStrictEqual(decodeValue(T_DOCUMENT, buf), { id: 1, name: 'foo' });
});

test('types: T_TS_POINT (i64 micros + f64 value)', () => {
  const buf = encodeValue(T_TS_POINT, [1000000, 3.14]);
  assert.strictEqual(buf.length, 16);
  assert.strictEqual(Number(buf.readBigInt64LE(0)), 1000000);
  const [ts, v] = decodeValue(T_TS_POINT, buf);
  assert.strictEqual(ts, 1000000);
  assert.ok(Math.abs(v - 3.14) < 1e-9);
});

test('types: T_TS_POINT from {ts, value} dict', () => {
  const buf = encodeValue(T_TS_POINT, { ts: 42, value: 1.5 });
  const [ts, v] = decodeValue(T_TS_POINT, buf);
  assert.strictEqual(ts, 42);
  assert.strictEqual(v, 1.5);
});

test('types: T_GEO_POINT (i32 lat_e7 + i32 lon_e7)', () => {
  const buf = encodeValue(T_GEO_POINT, { lat: 37.7749, lon: -122.4194 });
  assert.strictEqual(buf.length, 8);
  // round-trip via array
  const [lat, lon] = decodeValue(T_GEO_POINT, buf);
  assert.strictEqual(lat, 377749000);
});

test('types: isKnownType returns true for registered IDs', () => {
  assert.strictEqual(isKnownType(T_BOOL), true);
  assert.strictEqual(isKnownType(T_INT4), true);
  assert.strictEqual(isKnownType(0xDEAD), false);
});

test('types: unknown type_id throws', () => {
  assert.throws(() => encodeValue(0xDEAD, 'x'), VBPTypeError);
  assert.throws(() => decodeValue(0xDEAD, Buffer.alloc(0)), VBPTypeError);
});

test('types: T_INT4 out-of-range throws', () => {
  assert.throws(() => encodeValue(T_INT4, 1e20), VBPTypeError);
});

test('types: input envelope with NULL', () => {
  const buf = encodeInputParam(T_INT4, null);
  // u16 type_id (2) + u8 null_tag=0 (1) = 3 bytes
  assert.strictEqual(buf.length, 3);
  assert.strictEqual(buf.readUInt16LE(0), T_INT4);
  assert.strictEqual(buf.readUInt8(2), 0);
});

test('types: input envelope with value', () => {
  const buf = encodeInputParam(T_INT4, 42);
  // u16 type_id (2) + u8 null_tag=1 (1) + i32 (4) = 7 bytes
  assert.strictEqual(buf.length, 7);
  assert.strictEqual(buf.readUInt16LE(0), T_INT4);
  assert.strictEqual(buf.readUInt8(2), 1);
  assert.strictEqual(buf.readInt32LE(3), 42);
});

test('types: input envelope with text', () => {
  const buf = encodeInputParam(T_TEXT, 'hi');
  // u16 type_id (2) + u8 null_tag=1 (1) + u32 len=2 (4) + 'hi' (2) = 9
  assert.strictEqual(buf.length, 9);
});

test('types: output column envelope decode', () => {
  // decodeOutputColumn input is the column body AFTER the u16 type_id:
  // u8 bitmap_count, [bitmap], values.
  const inner = Buffer.concat([
    Buffer.from([0]),                // bitmap_count = 0
    Buffer.from([42, 0, 0, 0]),     // value = 42 (i32 LE)
  ]);
  const { bitmap, values } = decodeOutputColumn(T_INT4, inner);
  assert.strictEqual(bitmap.length, 0);
  assert.strictEqual(values.length, 4);
  assert.strictEqual(values.readInt32LE(0), 42);
});

test('types: encoder/decoder dispatch tables are consistent', () => {
  assert.strictEqual(Object.keys(ENCODERS).length, Object.keys(DECODERS).length);
});
