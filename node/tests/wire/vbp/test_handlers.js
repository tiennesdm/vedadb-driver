'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  HANDLERS, assertAllMandatoryHandlersRegistered,
  errFrame, dataChunkInt, rowsFinished, commandComplete,
} = require('../../../src/wire/vbp/handlers');
const {
  MANDATORY_OPCODES,
  OP_CLIENT_HELLO, OP_QUERY, OP_PING, OP_PONG, OP_AUTH_OK, OP_AUTH_RESPONSE,
  OP_BEGIN, OP_COMMIT, OP_ROLLBACK, OP_CLOSE, OP_ERROR, OP_DATA_CHUNK,
  OP_ROWS_FINISHED, OP_COMMAND_COMPLETE, OP_EXT_QUERY, OP_COPY_IN,
} = require('../../../src/wire/vbp/opcodes');

test('handlers: all 23 mandatory opcodes have a handler', () => {
  assertAllMandatoryHandlersRegistered();
  for (const op of MANDATORY_OPCODES) {
    assert.ok(typeof HANDLERS[op] === 'function', `missing handler for 0x${op.toString(16)}`);
  }
});

test('handlers: client_hello returns SERVER_READY + AUTH_OK', () => {
  const replies = HANDLERS[OP_CLIENT_HELLO](null, Buffer.alloc(0));
  assert.strictEqual(replies.length, 2);
  assert.strictEqual(replies[0].op, 0x02);
  assert.strictEqual(replies[1].op, 0x05);
});

test('handlers: query stub returns 1-row DATA_CHUNK + ROWS_FINISHED + COMMAND_COMPLETE', () => {
  const replies = HANDLERS[OP_QUERY](null, Buffer.alloc(0));
  assert.strictEqual(replies.length, 3);
  assert.strictEqual(replies[0].op, 0x0A);
  assert.strictEqual(replies[1].op, 0x0B);
  assert.strictEqual(replies[2].op, 0x0C);
});

test('handlers: ping echoes nonce in PONG', () => {
  const nonce = Buffer.from('12345678', 'hex');
  const replies = HANDLERS[OP_PING](null, nonce);
  assert.strictEqual(replies.length, 1);
  assert.strictEqual(replies[0].op, 0x17);
  assert.deepStrictEqual(replies[0].body, nonce);
});

test('handlers: close returns empty list', () => {
  const replies = HANDLERS[OP_CLOSE](null, Buffer.alloc(0));
  assert.strictEqual(replies.length, 0);
});

test('handlers: begin returns COMMAND_COMPLETE with in_txn=1', () => {
  const replies = HANDLERS[OP_BEGIN](null, Buffer.alloc(0));
  assert.strictEqual(replies.length, 1);
  assert.strictEqual(replies[0].op, 0x0C);
  assert.strictEqual(replies[0].body[0], 1);
});

test('handlers: commit/rollback return COMMAND_COMPLETE with in_txn=0', () => {
  for (const op of [OP_COMMIT, OP_ROLLBACK]) {
    const replies = HANDLERS[op](null, Buffer.alloc(0));
    assert.strictEqual(replies[0].op, 0x0C);
    assert.strictEqual(replies[0].body[0], 0);
  }
});

test('handlers: ext_query is stubbed (0A000)', () => {
  const replies = HANDLERS[OP_EXT_QUERY](null, Buffer.alloc(0));
  assert.strictEqual(replies.length, 1);
  assert.strictEqual(replies[0].op, 0x0D);
  // sqlstate = '0A000'
  assert.strictEqual(replies[0].body.subarray(0, 5).toString('ascii'), '0A000');
});

test('handlers: copy_in is stubbed (0A000)', () => {
  const replies = HANDLERS[OP_COPY_IN](null, Buffer.alloc(0));
  assert.strictEqual(replies.length, 1);
  assert.strictEqual(replies[0].op, 0x0D);
});

test('handlers: server-to-client opcodes reject', () => {
  for (const op of [OP_DATA_CHUNK, OP_ROWS_FINISHED, OP_COMMAND_COMPLETE, OP_ERROR, OP_PONG]) {
    const replies = HANDLERS[op](null, Buffer.alloc(0));
    assert.strictEqual(replies.length, 1);
    assert.strictEqual(replies[0].op, 0x0D);
  }
});

test('handlers: errFrame builder', () => {
  const f = errFrame(0x01, '08P01', 'oops');
  assert.strictEqual(f.op, 0x0D);
  assert.strictEqual(f.seq, 0x01);
  assert.strictEqual(f.body.subarray(0, 5).toString('ascii'), '08P01');
});

test('handlers: dataChunkInt builder shape', () => {
  const f = dataChunkInt(0x01, 42);
  assert.strictEqual(f.op, 0x0A);
  // chunk_id(4) + row_count(4) + col_count(2) + type_id(2) + bitmap(1) + value(4) = 17
  assert.strictEqual(f.body.length, 17);
  assert.strictEqual(f.body.readInt32LE(13), 42);
});

test('handlers: rowsFinished builder', () => {
  const f = rowsFinished(0x01, 7, 'SELECT 1');
  assert.strictEqual(f.op, 0x0B);
  assert.strictEqual(Number(f.body.readBigUInt64LE(0)), 7);
});

test('handlers: commandComplete builder', () => {
  const f = commandComplete(0x01, 0);
  assert.strictEqual(f.op, 0x0C);
  assert.strictEqual(f.body[0], 0);
});
