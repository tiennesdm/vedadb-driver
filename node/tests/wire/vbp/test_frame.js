'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  Frame, frameBytes, writeFrame, tryDecodeFrame, feedBytes, resetState,
  VBPProtocolError, VBPBadMagic, VBPFrameTooShort, VBPFrameTooLarge,
  VBPConnectionClosed, MAGIC, HDR_LEN, OPFLAGS_LEN, MAX_FRAME_LEN, DEFAULT_VBP_PORT,
} = require('../../../src/wire/vbp/frame');

function makeState() { return { buf: Buffer.alloc(0), offset: 0 }; }

test('frame: encode/decode round-trip', () => {
  const body = Buffer.from('hello world');
  const bytes = frameBytes(0x42, 0x06, 0x00, body);
  // 3 + 4 + 1 + 1 + 1 + 11 = 21
  assert.strictEqual(bytes.length, 21);
  assert.deepStrictEqual(bytes.subarray(0, 3), MAGIC);
  assert.strictEqual(bytes.readUInt32LE(3), 2 + body.length);
  assert.strictEqual(bytes[7], 0x42);
  assert.strictEqual(bytes[8], 0x06);
  assert.strictEqual(bytes[9], 0x00);
  assert.deepStrictEqual(bytes.subarray(10), body);

  const state = makeState();
  feedBytes(state, bytes);
  const f = tryDecodeFrame(state);
  assert.ok(f instanceof Frame);
  assert.strictEqual(f.seq, 0x42);
  assert.strictEqual(f.op, 0x06);
  assert.strictEqual(f.flags, 0);
  assert.deepStrictEqual(f.body, body);
});

test('frame: empty body', () => {
  const bytes = frameBytes(0x01, 0x0C, 0x00, Buffer.alloc(0));
  assert.strictEqual(bytes.length, 10);
  const state = makeState();
  feedBytes(state, bytes);
  const f = tryDecodeFrame(state);
  assert.strictEqual(f.body.length, 0);
  assert.strictEqual(f.op, 0x0C);
});

test('frame: seq 0 boundary', () => {
  const f = new Frame(0, 0x01, 0, Buffer.alloc(0));
  assert.strictEqual(f.seq, 0);
});

test('frame: out-of-range seq throws', () => {
  assert.throws(() => new Frame(-1, 0x01, 0, Buffer.alloc(0)), RangeError);
  assert.throws(() => new Frame(256, 0x01, 0, Buffer.alloc(0)), RangeError);
});

test('frame: out-of-range op throws', () => {
  assert.throws(() => new Frame(1, 256, 0, Buffer.alloc(0)), RangeError);
  assert.throws(() => new Frame(1, -1, 0, Buffer.alloc(0)), RangeError);
});

test('frame: out-of-range flags throws', () => {
  assert.throws(() => new Frame(1, 0x01, 256, Buffer.alloc(0)), RangeError);
  assert.throws(() => new Frame(1, 0x01, -1, Buffer.alloc(0)), RangeError);
});

test('frame: bad magic throws VBPBadMagic', () => {
  const state = makeState();
  const bytes = Buffer.from('XYZ\x05\x00\x00\x00\x01\x02\x03');
  feedBytes(state, bytes);
  assert.throws(() => tryDecodeFrame(state), VBPBadMagic);
});

test('frame: payload too short throws VBPFrameTooShort', () => {
  const state = makeState();
  const bytes = Buffer.concat([MAGIC, Buffer.from([0x01, 0x00, 0x00, 0x00]), Buffer.from([0x01, 0x02, 0x03])]);
  feedBytes(state, bytes);
  // payload_len = 1, < 2 (OPFLAGS_LEN)
  assert.throws(() => tryDecodeFrame(state), VBPFrameTooShort);
});

test('frame: payload too large throws VBPFrameTooLarge', () => {
  const state = makeState();
  const tooBig = Buffer.alloc(8);
  MAGIC.copy(tooBig, 0);
  tooBig.writeUInt32LE(MAX_FRAME_LEN + 1, 3);
  tooBig[7] = 0x01;
  feedBytes(state, tooBig);
  assert.throws(() => tryDecodeFrame(state), VBPFrameTooLarge);
});

test('frame: incomplete frame returns null (no throw)', () => {
  const state = makeState();
  const bytes = frameBytes(0x05, 0x06, 0, Buffer.from('abc'));
  // Feed only half.
  feedBytes(state, bytes.subarray(0, 12));
  assert.strictEqual(tryDecodeFrame(state), null);
  // Feed the rest.
  feedBytes(state, bytes.subarray(12));
  const f = tryDecodeFrame(state);
  assert.ok(f);
  assert.strictEqual(f.seq, 0x05);
});

test('frame: multiple frames in one chunk', () => {
  const a = frameBytes(0x01, 0x06, 0, Buffer.from('hello'));
  const b = frameBytes(0x02, 0x07, 0, Buffer.from('world'));
  const state = makeState();
  feedBytes(state, Buffer.concat([a, b]));
  const fa = tryDecodeFrame(state);
  const fb = tryDecodeFrame(state);
  assert.strictEqual(fa.seq, 0x01);
  assert.strictEqual(fb.seq, 0x02);
  assert.deepStrictEqual(fa.body, Buffer.from('hello'));
  assert.deepStrictEqual(fb.body, Buffer.from('world'));
});

test('frame: writeFrame appends to a sink', () => {
  const sink = [];
  const buf = frameBytes(0x03, 0x08, 0, Buffer.from('xyz'));
  sink.push(buf);
  // Re-encode through the writer.
  const out = Buffer.concat(sink);
  const state = makeState();
  feedBytes(state, out);
  const f = tryDecodeFrame(state);
  assert.strictEqual(f.op, 0x08);
  assert.deepStrictEqual(f.body, Buffer.from('xyz'));
});

test('frame: 64-byte payload boundary', () => {
  const body = Buffer.alloc(64, 0xAA);
  const bytes = frameBytes(0x10, 0x06, 0, body);
  const state = makeState();
  feedBytes(state, bytes);
  const f = tryDecodeFrame(state);
  assert.strictEqual(f.body.length, 64);
});

test('frame: default VBP port is 6380', () => {
  assert.strictEqual(DEFAULT_VBP_PORT, 6380);
});

test('frame: max frame is 64 MiB', () => {
  assert.strictEqual(MAX_FRAME_LEN, 64 * 1024 * 1024);
});

test('frame: HDR_LEN is 8 (3 magic + 4 len + 1 seq)', () => {
  assert.strictEqual(HDR_LEN, 8);
});

test('frame: OPFLAGS_LEN is 2 (op + flags)', () => {
  assert.strictEqual(OPFLAGS_LEN, 2);
});
