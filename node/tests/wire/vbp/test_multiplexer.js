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
  for (let i = 1; i < 256; i++) m._inflight.set(i, { frames: [], done: false, error: null, terminal: false, delivered: false, callbacks: [] });
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

// ---------------------------------------------------------------------------
// Streaming-fix tests (the team-engine's v2 multichunk backport)
//
// A VBP response is a *stream* of frames, not a single frame:
//   [DATA_CHUNK, DATA_CHUNK, ..., ROWS_FINISHED, COMMAND_COMPLETE]
//
// The original v1 Node multiplexer had a heuristic that only treated
// AUTH_OK / COMMAND_COMPLETE / PONG as terminal. That meant:
//   - A response ending with ROWS_FINISHED alone (empty result) would
//     NEVER resolve.
//   - SERVER_READY and CLOSE were not terminal, so handshake + close
//     would either hang or leak the slot.
//   - A multi-chunk response was accidentally correct because
//     COMMAND_COMPLETE happened to be the last frame in the common
//     case, but a server that emits ROWS_FINISHED + ERROR would have
//     the ERROR get appended after the slot was already released.
//
// The fix is the explicit TERMINAL_OPCODES set in opcodes.js.
// ---------------------------------------------------------------------------

// Build a single VBP frame's wire bytes using frame.js.
const { frameBytes: _frameBytes } = require('../../../src/wire/vbp/frame');

function buildQueryReply(seq, chunks) {
  // chunks: array of { op, body } — op is the opcode byte.
  const parts = chunks.map((c) => _frameBytes(seq, c.op, 0, c.body));
  return Buffer.concat(parts);
}

test('multiplexer [streaming fix]: single DATA_CHUNK alone is not terminal', async () => {
  // DATA_CHUNK is a stream frame, not the end of a stream. A response
  // that contains only DATA_CHUNK and never a terminal frame must
  // time out — NOT deliver the chunk as if it were the whole reply.
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  // IMPORTANT: call() first to register the in-flight slot, THEN
  // feed the data. Otherwise the data arrives before the slot exists
  // and gets dropped as "truly unsolicited".
  const p = m.call(0x06, Buffer.alloc(0), { timeout: 0.1 });
  m._onData(_frameBytes(0x01, 0x0A, 0, Buffer.from('only-chunk')));
  await assert.rejects(p, /timed out/);
});

test('multiplexer [streaming fix]: multi-chunk QUERY accumulates then resolves on COMMAND_COMPLETE', async () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  const reply = buildQueryReply(0x01, [
    { op: 0x0A, body: Buffer.from('chunk1') }, // DATA_CHUNK
    { op: 0x0A, body: Buffer.from('chunk2') }, // DATA_CHUNK
    { op: 0x0A, body: Buffer.from('chunk3') }, // DATA_CHUNK
    { op: 0x0B, body: Buffer.from('rows-finished') }, // ROWS_FINISHED (terminal)
  ]);
  const p = m.call(0x06, Buffer.alloc(0), { timeout: 1 });
  // Feed all 4 frames in one chunk (mimics a single TCP flush).
  m._onData(reply);
  const frames = await p;
  assert.strictEqual(frames.length, 4);
  assert.strictEqual(frames[0].op, 0x0A); // DATA_CHUNK
  assert.strictEqual(frames[1].op, 0x0A);
  assert.strictEqual(frames[2].op, 0x0A);
  assert.strictEqual(frames[3].op, 0x0B); // ROWS_FINISHED terminal
});

test('multiplexer [streaming fix]: PING/PONG round-trip works (PONG is terminal)', async () => {
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  const p = m.call(0x16, Buffer.alloc(0), { timeout: 1 }); // PING
  m._onData(_frameBytes(0x01, 0x17, 0, Buffer.from('pong-body'))); // PONG
  const frames = await p;
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].op, 0x17);
});

test('multiplexer [streaming fix]: ROWS_FINISHED alone (no COMMAND_COMPLETE) resolves the call', async () => {
  // The exact case the v1 heuristic broke: empty result sets emit
  // [ROWS_FINISHED] and the old code would hang waiting forever.
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  const p = m.call(0x06, Buffer.alloc(0), { timeout: 1 });
  m._onData(_frameBytes(0x01, 0x0B, 0, Buffer.from('rows-finished'))); // ROWS_FINISHED only
  const frames = await p;
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].op, 0x0B);
});

test('multiplexer [streaming fix]: CLOSE frame ends the stream and resolves the call', async () => {
  // The server may emit a CLOSE mid-stream (graceful shutdown). The
  // old code would leave the slot dangling.
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  const p = m.call(0x06, Buffer.alloc(0), { timeout: 1 });
  m._onData(_frameBytes(0x01, 0x18, 0, Buffer.from('goodbye'))); // CLOSE
  const frames = await p;
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].op, 0x18);
});

test('multiplexer [streaming fix]: ERROR after DATA_CHUNKs surfaces VBPError', async () => {
  // The v1 code accumulated DATA_CHUNKs then on ERROR rejected — but
  // it ALSO deleted the slot keyed by _lastCallSeq || frame.seq, so
  // the partial frames were lost on the reject path. Verify both
  // (a) VBPError is thrown and (b) the error sqlstate is propagated.
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  const errBody = Buffer.concat([
    Buffer.from('42601', 'ascii'),
    Buffer.from([7, 0, 0, 0]),
    Buffer.from('bad sql'),
    Buffer.from([0, 0, 0, 0]), // detail
    Buffer.from([0, 0, 0, 0]), // hint
  ]);
  const p = m.call(0x06, Buffer.alloc(0), { timeout: 1 });
  m._onData(Buffer.concat([
    _frameBytes(0x01, 0x0A, 0, Buffer.from('chunk1')),
    _frameBytes(0x01, 0x0A, 0, Buffer.from('chunk2')),
    _frameBytes(0x01, 0x0D, 0, errBody), // ERROR
  ]));
  try {
    await p;
    assert.fail('expected call() to reject');
  } catch (err) {
    assert.ok(err instanceof VBPError, `expected VBPError, got ${err && err.constructor.name}: ${err && err.message}`);
    assert.strictEqual(err.sqlstate, '42601');
    assert.strictEqual(err.message, 'bad sql');
  }
});

test('multiplexer [streaming fix]: 50 multi-chunk calls do not leak seq slots', async () => {
  // The seq id MUST be released after a multi-chunk call resolves,
  // otherwise after 256 calls the multiplexer throws AllSeqsBusy.
  const s = makeFakeSocket();
  const m = new Multiplexer(s);
  m.start();
  for (let i = 0; i < 50; i++) {
    const seq = (i + 1) & 0xFF;
    const reply = buildQueryReply(seq, [
      { op: 0x0A, body: Buffer.from('c') },
      { op: 0x0A, body: Buffer.from('c') },
      { op: 0x0B, body: Buffer.from('r') },
      { op: 0x0C, body: Buffer.from('cc') },
    ]);
    const p = m.call(0x06, Buffer.alloc(0), { timeout: 1 });
    m._onData(reply);
    const frames = await p;
    assert.strictEqual(frames.length, 4);
    assert.strictEqual(frames[3].op, 0x0C); // COMMAND_COMPLETE
  }
  // After 50 multi-chunk calls, the inflight map must be empty.
  assert.strictEqual(m._inflight.size, 0, 'inflight map must be empty after all calls resolved');
});

