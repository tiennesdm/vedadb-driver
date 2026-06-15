'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { Multiplexer, VBPError } = require('../../../src/wire/vbp/multiplexer');
const { Frame, frameBytes, tryDecodeFrame, feedBytes } = require('../../../src/wire/vbp/frame');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeSocket() {
  const listeners = {};
  return {
    listeners,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return this; },
    once(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return this; },
    off(ev, fn) {
      const arr = listeners[ev] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
      return this;
    },
    write(data) { fakeSocketWrites.push(Buffer.from(data)); return true; },
    destroy() { (listeners.close || []).forEach((f) => f()); },
  };
}
const fakeSocketWrites = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('multiplexer: seq allocation starts at 1 (skipping 0)', () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  fakeSocketWrites.length = 0;
  const seq1 = m.send(0x01, Buffer.alloc(0));
  const seq2 = m.send(0x01, Buffer.alloc(0));
  const seq3 = m.send(0x01, Buffer.alloc(0));
  assert.strictEqual(seq1, 1);
  assert.strictEqual(seq2, 2);
  assert.strictEqual(seq3, 3);
});

test('multiplexer: send writes a valid frame', () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  fakeSocketWrites.length = 0;
  m.send(0x06, Buffer.from('SQL'));
  const frame = fakeSocketWrites[0];
  assert.strictEqual(frame[0], 0x56); // 'V'
  assert.strictEqual(frame[1], 0x44); // 'D'
  assert.strictEqual(frame[2], 0x42); // 'B'
  assert.strictEqual(frame[7], 1);    // seq
  assert.strictEqual(frame[8], 0x06); // op
  assert.strictEqual(frame[9], 0x00); // flags
  assert.strictEqual(frame.readUInt32LE(3), 2 + 3); // payload_len
});

test('multiplexer: dispatch routes matching seq', () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  // Use m._onData directly
  const reply = frameBytes(0x01, 0x0C, 0, Buffer.alloc(0));
  const p = m.call(0x01, Buffer.alloc(0), { timeout: 1 });
  // Feed reply
  m._onData(reply);
  return p.then((replies) => {
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(replies[0].op, 0x0C);
  });
});

test('multiplexer: unsolicited seq=0 routes to last call', () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  const p = m.call(0x01, Buffer.alloc(0), { timeout: 1 });
  // Send an unsolicited AUTH_OK with seq=0 (server-emitted in dev mode)
  const reply = frameBytes(0x00, 0x05, 0, Buffer.alloc(0));
  m._onData(reply);
  return p.then((replies) => {
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(replies[0].op, 0x05);
  });
});

test('multiplexer: ERROR frame rejects with VBPError', () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  const p = m.call(0x01, Buffer.alloc(0), { timeout: 1 });
  // Build an ERROR frame: 5-byte sqlstate + u32 msg_len + msg
  const errBody = Buffer.concat([
    Buffer.from('08P01', 'ascii'),
    Buffer.from([4, 0, 0, 0]),
    Buffer.from('boom'),
    Buffer.from([0, 0, 0, 0]),  // detail len
    Buffer.from([0, 0, 0, 0]),  // hint len
  ]);
  const err = frameBytes(0x01, 0x0D, 0, errBody);
  m._onData(err);
  return p.then(() => assert.fail('expected reject'),
    (e) => {
      assert.ok(e instanceof VBPError, `got ${e.constructor.name}: ${e.message}`);
      assert.strictEqual(e.sqlstate, '08P01');
      assert.strictEqual(e.message, 'boom');
    });
});

test('multiplexer: parseErrorFrame helper', () => {
  const errBody = Buffer.concat([
    Buffer.from('42601', 'ascii'),
    Buffer.from([5, 0, 0, 0]),
    Buffer.from('hello'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([0, 0, 0, 0]),
  ]);
  const f = new Frame(0x01, 0x0D, 0, errBody);
  const parsed = Multiplexer.parseErrorFrame(f);
  assert.strictEqual(parsed.sqlstate, '42601');
  assert.strictEqual(parsed.message, 'hello');
});

test('multiplexer: timeout rejects', async () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  try {
    await assert.rejects(
      m.call(0x01, Buffer.alloc(0), { timeout: 0.05 }),
      /timed out/
    );
  } finally {
    // Clean up so the test's pending promise references don't leak.
    m.close();
  }
});

test('multiplexer: close rejects all in-flight', async () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  const p = m.call(0x01, Buffer.alloc(0), { timeout: 5 });
  // Schedule the close AFTER the next tick so the call() promise
  // is registered before we try to reject it.
  setImmediate(() => m.close());
  await assert.rejects(p, /closed/i);
});

test('multiplexer: _alloc throws after all 256 seqs are in flight', () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  // Saturate the inflight map directly (without going through send(),
  // which would create 255 hanging promises). We just need to verify
  // that _alloc refuses to allocate when no seq is free.
  for (let i = 1; i < 256; i++) m._inflight.set(i, { frames: [], done: false, error: null, callbacks: [] });
  let threw = false;
  let err = null;
  try { m._alloc(); } catch (e) { threw = true; err = e; }
  assert.ok(threw, 'expected all-256-in-flight to throw');
  assert.ok(err && /sequence ids/i.test(err.message), `unexpected error: ${err && err.message}`);
  // Clean up to avoid leaking state into subsequent tests.
  m._inflight.clear();
  m.close();
});

test('multiplexer: requires socket-like object', () => {
  assert.throws(() => new Multiplexer({}), TypeError);
  assert.throws(() => new Multiplexer(null), TypeError);
});
