/**
 * VBP opcode and type-ID constants.
 *
 * Opcodes are 1-byte values that identify a frame's purpose. The list
 * below is the v1 set defined in VBP_SPEC.md §3 — 23 mandatory
 * opcodes the driver must at least stub.
 *
 * Type IDs are 2-byte little-endian identifiers for column types in
 * the VBP result encoding. The v1 set is the 36 IDs defined in
 * VBP_SPEC.md §5 (the spec's "27" is a typo — see §5.10 / the Go
 * engine's vbp_engine_types.go commentary).
 */
'use strict';

// ---------------------------------------------------------------------------
// Opcodes (VBP v1, 23 mandatory)
// ---------------------------------------------------------------------------

const OP_CLIENT_HELLO = 0x01;
const OP_SERVER_READY = 0x02;
const OP_AUTH_CHALLENGE = 0x03;
const OP_AUTH_RESPONSE = 0x04;
const OP_AUTH_OK = 0x05;

// Query
const OP_QUERY = 0x06;
const OP_EXT_QUERY = 0x07;
const OP_PARSE = 0x08;
const OP_BIND = 0x09;
const OP_DATA_CHUNK = 0x0A;
const OP_ROWS_FINISHED = 0x0B;
const OP_COMMAND_COMPLETE = 0x0C;
const OP_ERROR = 0x0D;

// Transaction
const OP_BEGIN = 0x0E;
const OP_COMMIT = 0x0F;
const OP_ROLLBACK = 0x10;

// Other
const OP_COPY_IN = 0x11;
const OP_COPY_DONE = 0x12;
const OP_COPY_FAIL = 0x13;
const OP_CANCEL_QUERY = 0x14;
const OP_PING = 0x16;
const OP_PONG = 0x17;
const OP_CLOSE = 0x18;

const MANDATORY_OPCODES = Object.freeze([
  OP_CLIENT_HELLO, OP_SERVER_READY, OP_AUTH_CHALLENGE, OP_AUTH_RESPONSE, OP_AUTH_OK,
  OP_QUERY, OP_EXT_QUERY, OP_PARSE, OP_BIND, OP_DATA_CHUNK, OP_ROWS_FINISHED,
  OP_COMMAND_COMPLETE, OP_ERROR, OP_BEGIN, OP_COMMIT, OP_ROLLBACK,
  OP_COPY_IN, OP_COPY_DONE, OP_COPY_FAIL, OP_CANCEL_QUERY,
  OP_PING, OP_PONG, OP_CLOSE,
]);
if (MANDATORY_OPCODES.length !== 23) {
  throw new Error(`VBP v1 mandates exactly 23 opcodes, got ${MANDATORY_OPCODES.length}`);
}

// ---------------------------------------------------------------------------
// Terminal vs non-terminal opcodes
// ---------------------------------------------------------------------------
//
// A TERMINAL opcode marks the end of a single response stream (one in-flight
// seq id). The multiplexer delivers the accumulated frames to the caller
// and releases the seq slot.
//
// A NON-TERMINAL opcode (DATA_CHUNK, STREAM_CHUNK, AUTH_CHALLENGE) is part
// of a streaming response and is ACCUMULATED into the seq's frames buffer;
// the multiplexer keeps waiting for a terminal frame.
//
// The original POCs (including the v1 Node multiplexer) had a heuristic
// that only treated AUTH_OK / COMMAND_COMPLETE / PONG as terminal. That
// broke multi-chunk query responses (a [DATA_CHUNK ×N, COMMAND_COMPLETE]
// stream happened to work, but a response that ended with ROWS_FINISHED
// alone, or a handshake that replied SERVER_READY + AUTH_OK separately,
// would hang the call() forever). The fix is the explicit TERMINAL set
// below — every opcode that ends a stream is named explicitly. See
// VBP_SPEC.md §4 and the team-engine's v2 multichunk fix.

const TERMINAL_OPCODES = Object.freeze({
  [OP_ROWS_FINISHED]: true,    // 0x0B — end of row data
  [OP_COMMAND_COMPLETE]: true, // 0x0C — final ack
  [OP_ERROR]: true,            // 0x0D — error response
  [OP_SERVER_READY]: true,     // 0x02 — handshake reply
  [OP_AUTH_OK]: true,          // 0x05 — auth success
  [OP_AUTH_CHALLENGE]: true,   // 0x03 — auth challenge (handshake complete)
  [OP_PONG]: true,             // 0x17 — PING reply
  [OP_CLOSE]: true,            // 0x18 — connection-level close
});

function isTerminal(op) {
  return TERMINAL_OPCODES[op] === true;
}

const OPCODE_NAMES = {
  [OP_CLIENT_HELLO]: 'CLIENT_HELLO',
  [OP_SERVER_READY]: 'SERVER_READY',
  [OP_AUTH_CHALLENGE]: 'AUTH_CHALLENGE',
  [OP_AUTH_RESPONSE]: 'AUTH_RESPONSE',
  [OP_AUTH_OK]: 'AUTH_OK',
  [OP_QUERY]: 'QUERY',
  [OP_EXT_QUERY]: 'EXT_QUERY',
  [OP_PARSE]: 'PARSE',
  [OP_BIND]: 'BIND',
  [OP_DATA_CHUNK]: 'DATA_CHUNK',
  [OP_ROWS_FINISHED]: 'ROWS_FINISHED',
  [OP_COMMAND_COMPLETE]: 'COMMAND_COMPLETE',
  [OP_ERROR]: 'ERROR',
  [OP_BEGIN]: 'BEGIN',
  [OP_COMMIT]: 'COMMIT',
  [OP_ROLLBACK]: 'ROLLBACK',
  [OP_COPY_IN]: 'COPY_IN',
  [OP_COPY_DONE]: 'COPY_DONE',
  [OP_COPY_FAIL]: 'COPY_FAIL',
  [OP_CANCEL_QUERY]: 'CANCEL_QUERY',
  [OP_PING]: 'PING',
  [OP_PONG]: 'PONG',
  [OP_CLOSE]: 'CLOSE',
};

function opcodeName(op) {
  return OPCODE_NAMES[op] || `OP_0x${op.toString(16).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Type IDs (VBP v1, 36 IDs — see VBP_SPEC.md §5 / §5.10)
// ---------------------------------------------------------------------------

const T_BOOL = 16;
const T_INT2 = 21;
const T_INT4 = 23;
const T_INT8 = 20;
const T_FLOAT4 = 700;
const T_FLOAT8 = 701;
const T_TEXT = 25;
const T_VARCHAR = 1043;
const T_BYTEA = 17;
const T_UUID = 2950;
const T_DATE = 1082;
const T_TIME = 1083;
const T_TIMESTAMP = 1114;
const T_TIMESTAMPTZ = 1184;
const T_INTERVAL = 1186;
const T_NUMERIC = 1700;
const T_MONEY = 790;
const T_JSON = 114;
const T_JSONB = 3802;
const T_ARRAY = 2277;
const T_INET = 869;
const T_MACADDR = 829;
const T_CIDR = 650;
const T_VECTOR = 5000;
const T_TSVECTOR = 3614;
const T_DOCUMENT = 5100;
const T_GRAPH_NODE = 5300;
const T_GRAPH_EDGE = 5301;
const T_TS_POINT = 5400;
const T_TS_SERIES = 5401;
const T_GEO_POINT = 5500;
const T_GEO_PATH = 5501;
const T_GEO_POLYGON = 5502;
const T_GEO_MULTIPOINT = 5503;
const T_GEO_MULTIPOLYGON = 5504;
const T_KV_KEY = 5200;
const T_KV_VALUE = 5201;
const T_KV_TOMBSTONE = 5202;
const T_SEARCH_DOC = 5600;
const T_SEARCH_HIT = 5601;

const TYPE_IDS = Object.freeze([
  T_BOOL, T_INT2, T_INT4, T_INT8,
  T_FLOAT4, T_FLOAT8,
  T_TEXT, T_VARCHAR, T_BYTEA, T_UUID,
  T_DATE, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_INTERVAL,
  T_NUMERIC, T_MONEY,
  T_JSON, T_JSONB, T_ARRAY,
  T_INET, T_MACADDR, T_CIDR,
  T_VECTOR, T_TSVECTOR,
  T_DOCUMENT,
  T_GRAPH_NODE, T_GRAPH_EDGE,
  T_TS_POINT, T_TS_SERIES,
  T_GEO_POINT, T_GEO_PATH, T_GEO_POLYGON, T_GEO_MULTIPOINT, T_GEO_MULTIPOLYGON,
  T_KV_KEY, T_KV_VALUE, T_KV_TOMBSTONE,
  T_SEARCH_DOC, T_SEARCH_HIT,
]);

const TYPE_ID_NAMES = {
  [T_BOOL]: 'T_BOOL', [T_INT2]: 'T_INT2', [T_INT4]: 'T_INT4', [T_INT8]: 'T_INT8',
  [T_FLOAT4]: 'T_FLOAT4', [T_FLOAT8]: 'T_FLOAT8',
  [T_TEXT]: 'T_TEXT', [T_VARCHAR]: 'T_VARCHAR', [T_BYTEA]: 'T_BYTEA', [T_UUID]: 'T_UUID',
  [T_DATE]: 'T_DATE', [T_TIME]: 'T_TIME', [T_TIMESTAMP]: 'T_TIMESTAMP', [T_TIMESTAMPTZ]: 'T_TIMESTAMPTZ',
  [T_INTERVAL]: 'T_INTERVAL', [T_NUMERIC]: 'T_NUMERIC', [T_MONEY]: 'T_MONEY',
  [T_JSON]: 'T_JSON', [T_JSONB]: 'T_JSONB', [T_ARRAY]: 'T_ARRAY',
  [T_INET]: 'T_INET', [T_MACADDR]: 'T_MACADDR', [T_CIDR]: 'T_CIDR',
  [T_VECTOR]: 'T_VECTOR', [T_TSVECTOR]: 'T_TSVECTOR',
  [T_DOCUMENT]: 'T_DOCUMENT',
  [T_GRAPH_NODE]: 'T_GRAPH_NODE', [T_GRAPH_EDGE]: 'T_GRAPH_EDGE',
  [T_TS_POINT]: 'T_TS_POINT', [T_TS_SERIES]: 'T_TS_SERIES',
  [T_GEO_POINT]: 'T_GEO_POINT', [T_GEO_PATH]: 'T_GEO_PATH',
  [T_GEO_POLYGON]: 'T_GEO_POLYGON', [T_GEO_MULTIPOINT]: 'T_GEO_MULTIPOINT',
  [T_GEO_MULTIPOLYGON]: 'T_GEO_MULTIPOLYGON',
  [T_KV_KEY]: 'T_KV_KEY', [T_KV_VALUE]: 'T_KV_VALUE', [T_KV_TOMBSTONE]: 'T_KV_TOMBSTONE',
  [T_SEARCH_DOC]: 'T_SEARCH_DOC', [T_SEARCH_HIT]: 'T_SEARCH_HIT',
};

function typeIdName(tid) {
  return TYPE_ID_NAMES[tid] || `T_UNKNOWN_0x${tid.toString(16).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Auth mechanism strings
// ---------------------------------------------------------------------------

const AUTH_MECH_NONE = 'NONE';
const AUTH_MECH_PLAIN = 'PLAIN';
const AUTH_MECH_SCRAM_SHA_256 = 'SCRAM-SHA-256';

// SQLSTATE codes used by VBP v1
const SQLSTATE_FEATURE_NOT_SUPPORTED = '0A000';
const SQLSTATE_SYNTAX_ERROR = '42601';
const SQLSTATE_AUTH_FAILED = '28000';
const SQLSTATE_PROTOCOL_VIOLATION = '08P01';
const SQLSTATE_UNIQUE_VIOLATION = '23505';

module.exports = {
  // Opcodes
  OP_CLIENT_HELLO, OP_SERVER_READY, OP_AUTH_CHALLENGE, OP_AUTH_RESPONSE, OP_AUTH_OK,
  OP_QUERY, OP_EXT_QUERY, OP_PARSE, OP_BIND, OP_DATA_CHUNK, OP_ROWS_FINISHED,
  OP_COMMAND_COMPLETE, OP_ERROR, OP_BEGIN, OP_COMMIT, OP_ROLLBACK,
  OP_COPY_IN, OP_COPY_DONE, OP_COPY_FAIL, OP_CANCEL_QUERY,
  OP_PING, OP_PONG, OP_CLOSE,
  MANDATORY_OPCODES, TERMINAL_OPCODES, isTerminal, OPCODE_NAMES, opcodeName,
  // Type IDs
  T_BOOL, T_INT2, T_INT4, T_INT8,
  T_FLOAT4, T_FLOAT8,
  T_TEXT, T_VARCHAR, T_BYTEA, T_UUID,
  T_DATE, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_INTERVAL,
  T_NUMERIC, T_MONEY,
  T_JSON, T_JSONB, T_ARRAY,
  T_INET, T_MACADDR, T_CIDR,
  T_VECTOR, T_TSVECTOR,
  T_DOCUMENT,
  T_GRAPH_NODE, T_GRAPH_EDGE,
  T_TS_POINT, T_TS_SERIES,
  T_GEO_POINT, T_GEO_PATH, T_GEO_POLYGON, T_GEO_MULTIPOINT, T_GEO_MULTIPOLYGON,
  T_KV_KEY, T_KV_VALUE, T_KV_TOMBSTONE,
  T_SEARCH_DOC, T_SEARCH_HIT,
  TYPE_IDS, TYPE_ID_NAMES, typeIdName,
  // Auth
  AUTH_MECH_NONE, AUTH_MECH_PLAIN, AUTH_MECH_SCRAM_SHA_256,
  // SQLSTATE
  SQLSTATE_FEATURE_NOT_SUPPORTED, SQLSTATE_SYNTAX_ERROR,
  SQLSTATE_AUTH_FAILED, SQLSTATE_PROTOCOL_VIOLATION, SQLSTATE_UNIQUE_VIOLATION,
};
