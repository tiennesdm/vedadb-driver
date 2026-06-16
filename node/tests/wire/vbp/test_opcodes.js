'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  OP_CLIENT_HELLO, OP_SERVER_READY, OP_AUTH_CHALLENGE, OP_AUTH_RESPONSE, OP_AUTH_OK,
  OP_QUERY, OP_EXT_QUERY, OP_PARSE, OP_BIND, OP_DATA_CHUNK, OP_ROWS_FINISHED,
  OP_COMMAND_COMPLETE, OP_ERROR, OP_BEGIN, OP_COMMIT, OP_ROLLBACK,
  OP_COPY_IN, OP_COPY_DONE, OP_COPY_FAIL, OP_CANCEL_QUERY,
  OP_PING, OP_PONG, OP_CLOSE,
  MANDATORY_OPCODES, TERMINAL_OPCODES, isTerminal, OPCODE_NAMES, opcodeName,
  T_BOOL, T_INT2, T_INT4, T_INT8, T_FLOAT4, T_FLOAT8,
  T_TEXT, T_VARCHAR, T_BYTEA, T_UUID, T_DATE, T_TIME, T_TIMESTAMP,
  T_TIMESTAMPTZ, T_INTERVAL, T_NUMERIC, T_MONEY,
  T_JSON, T_JSONB, T_ARRAY, T_INET, T_MACADDR, T_CIDR,
  T_VECTOR, T_TSVECTOR, T_DOCUMENT,
  T_TS_POINT, T_GEO_POINT,
  TYPE_IDS, TYPE_ID_NAMES, typeIdName,
  AUTH_MECH_NONE, AUTH_MECH_PLAIN, AUTH_MECH_SCRAM_SHA_256,
  SQLSTATE_FEATURE_NOT_SUPPORTED,
} = require('../../../src/wire/vbp/opcodes');

test('opcodes: 23 mandatory opcodes defined', () => {
  assert.strictEqual(MANDATORY_OPCODES.length, 23);
});

test('opcodes: MANDATORY_OPCODES is frozen', () => {
  assert.ok(Object.isFrozen(MANDATORY_OPCODES));
});

test('opcodes: each mandatory opcode has a name', () => {
  for (const op of MANDATORY_OPCODES) {
    assert.ok(OPCODE_NAMES[op], `opcode 0x${op.toString(16)} missing name`);
  }
});

test('opcodes: opcode name lookup', () => {
  assert.strictEqual(opcodeName(OP_CLIENT_HELLO), 'CLIENT_HELLO');
  assert.strictEqual(opcodeName(OP_QUERY), 'QUERY');
  assert.strictEqual(opcodeName(OP_CLOSE), 'CLOSE');
  assert.strictEqual(opcodeName(OP_PING), 'PING');
  assert.strictEqual(opcodeName(OP_PONG), 'PONG');
  assert.strictEqual(opcodeName(0xFE), 'OP_0xfe');
});

test('opcodes: specific opcode values match spec', () => {
  assert.strictEqual(OP_CLIENT_HELLO, 0x01);
  assert.strictEqual(OP_SERVER_READY, 0x02);
  assert.strictEqual(OP_AUTH_CHALLENGE, 0x03);
  assert.strictEqual(OP_AUTH_RESPONSE, 0x04);
  assert.strictEqual(OP_AUTH_OK, 0x05);
  assert.strictEqual(OP_QUERY, 0x06);
  assert.strictEqual(OP_DATA_CHUNK, 0x0A);
  assert.strictEqual(OP_ROWS_FINISHED, 0x0B);
  assert.strictEqual(OP_COMMAND_COMPLETE, 0x0C);
  assert.strictEqual(OP_ERROR, 0x0D);
  assert.strictEqual(OP_PING, 0x16);
  assert.strictEqual(OP_PONG, 0x17);
  assert.strictEqual(OP_CLOSE, 0x18);
});

test('opcodes: type IDs registry has 40 entries (Python POC closed set; spec §5 "27" is a typo)', () => {
  // Note: the spec says "27" in §5 but the actual table enumerates
  // more. The Python POC (gold standard) ships 27 + 8 extensions
  // (T_MONEY, T_GRAPH_NODE, T_GRAPH_EDGE, T_TS_SERIES, T_GEO_PATH,
  // T_GEO_POLYGON, T_GEO_MULTIPOINT, T_GEO_MULTIPOLYGON, T_KV_*,
  // T_SEARCH_*) = 40. The Go engine vbp_engine_types.go declares 36
  // (different set). We follow the Python POC's registry. See
  // deliverable.md for the full reconciliation.
  assert.strictEqual(TYPE_IDS.length, 40);
});

test('opcodes: type ID names for common types', () => {
  assert.strictEqual(typeIdName(T_BOOL), 'T_BOOL');
  assert.strictEqual(typeIdName(T_INT4), 'T_INT4');
  assert.strictEqual(typeIdName(T_TEXT), 'T_TEXT');
  assert.strictEqual(typeIdName(T_VECTOR), 'T_VECTOR');
  assert.strictEqual(typeIdName(T_JSONB), 'T_JSONB');
  assert.strictEqual(typeIdName(0xDEAD), 'T_UNKNOWN_0xdead');
});

test('opcodes: specific type ID values', () => {
  assert.strictEqual(T_BOOL, 16);
  assert.strictEqual(T_INT4, 23);
  assert.strictEqual(T_INT8, 20);
  assert.strictEqual(T_FLOAT4, 700);
  assert.strictEqual(T_FLOAT8, 701);
  assert.strictEqual(T_TEXT, 25);
  assert.strictEqual(T_BYTEA, 17);
  assert.strictEqual(T_TIMESTAMP, 1114);
  assert.strictEqual(T_JSONB, 3802);
  assert.strictEqual(T_ARRAY, 2277);
  assert.strictEqual(T_VECTOR, 5000);
  assert.strictEqual(T_DOCUMENT, 5100);
  assert.strictEqual(T_GEO_POINT, 5500);
  assert.strictEqual(T_TS_POINT, 5400);
});

test('opcodes: auth mechanism strings', () => {
  assert.strictEqual(AUTH_MECH_NONE, 'NONE');
  assert.strictEqual(AUTH_MECH_PLAIN, 'PLAIN');
  assert.strictEqual(AUTH_MECH_SCRAM_SHA_256, 'SCRAM-SHA-256');
});

test('opcodes: SQLSTATE constants', () => {
  assert.strictEqual(SQLSTATE_FEATURE_NOT_SUPPORTED, '0A000');
});

test('opcodes: TYPE_IDS is frozen', () => {
  assert.ok(Object.isFrozen(TYPE_IDS));
});

test('opcodes: TYPE_ID_NAMES is complete', () => {
  for (const tid of TYPE_IDS) {
    assert.ok(TYPE_ID_NAMES[tid], `type ${tid} missing name`);
  }
});

// ---------------------------------------------------------------------------
// Terminal-opcode classification (the team-engine's v2 multichunk fix)
// ---------------------------------------------------------------------------

test('opcodes [streaming fix]: TERMINAL_OPCODES is frozen', () => {
  assert.ok(Object.isFrozen(TERMINAL_OPCODES));
});

test('opcodes [streaming fix]: terminal opcodes — ROWS_FINISHED, COMMAND_COMPLETE, ERROR, SERVER_READY, AUTH_OK, AUTH_CHALLENGE, PONG, CLOSE', () => {
  for (const op of [
    OP_ROWS_FINISHED, OP_COMMAND_COMPLETE, OP_ERROR,
    OP_SERVER_READY, OP_AUTH_OK, OP_AUTH_CHALLENGE,
    OP_PONG, OP_CLOSE,
  ]) {
    assert.ok(isTerminal(op), `0x${op.toString(16)} should be terminal`);
  }
});

test('opcodes [streaming fix]: non-terminal opcodes — DATA_CHUNK, AUTH_RESPONSE, BEGIN, COMMIT, ROLLBACK, COPY_*, PING, CLIENT_HELLO, QUERY, EXT_QUERY, PARSE, BIND, CANCEL_QUERY', () => {
  for (const op of [
    OP_DATA_CHUNK, OP_AUTH_RESPONSE, OP_BEGIN, OP_COMMIT, OP_ROLLBACK,
    OP_COPY_IN, OP_COPY_DONE, OP_COPY_FAIL, OP_CANCEL_QUERY,
    OP_PING, OP_CLIENT_HELLO,
    OP_QUERY, OP_EXT_QUERY, OP_PARSE, OP_BIND,
  ]) {
    assert.ok(!isTerminal(op), `0x${op.toString(16)} should NOT be terminal`);
  }
});

test('opcodes [streaming fix]: unknown opcode byte is non-terminal', () => {
  // 0x00 is reserved, 0x15 is reserved, 0xFE is unknown — none are terminal.
  for (const op of [0x00, 0x15, 0xFE, 0xFF]) {
    assert.ok(!isTerminal(op), `0x${op.toString(16)} should NOT be terminal`);
  }
});
