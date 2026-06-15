/**
 * VBP opcode handler stubs (server-side reference).
 *
 * The v1 driver ships at least a stub for every one of the 23
 * mandatory opcodes. A stub returns an ERROR frame with sqlstate
 * 0A000 ("feature not supported"). Real handlers are wired in v2.
 *
 * Mirrors the Python POC: the v1 SDK is a *transport* demonstrator.
 */
'use strict';

const {
  MANDATORY_OPCODES,
  OP_AUTH_CHALLENGE, OP_AUTH_OK, OP_AUTH_RESPONSE,
  OP_BEGIN, OP_BIND, OP_CANCEL_QUERY, OP_CLIENT_HELLO,
  OP_CLOSE, OP_COMMAND_COMPLETE, OP_COMMIT, OP_COPY_DONE,
  OP_COPY_FAIL, OP_COPY_IN, OP_DATA_CHUNK, OP_ERROR, OP_EXT_QUERY,
  OP_PARSE, OP_PING, OP_PONG, OP_QUERY, OP_ROLLBACK, OP_ROWS_FINISHED,
  OP_SERVER_READY,
  SQLSTATE_FEATURE_NOT_SUPPORTED, SQLSTATE_SYNTAX_ERROR,
  opcodeName,
} = require('./opcodes');
const { Frame } = require('./frame');

function errFrame(seq, sqlstate, message) {
  const msgBuf = Buffer.from(message, 'utf-8');
  const body = Buffer.alloc(5 + 4 + msgBuf.length + 4 + 4);
  body.write(sqlstate, 0, 5, 'ascii');
  body.writeUInt32LE(msgBuf.length, 5);
  msgBuf.copy(body, 9);
  // detail len=0
  body.writeUInt32LE(0, 9 + msgBuf.length);
  // hint len=0
  body.writeUInt32LE(0, 9 + msgBuf.length + 4);
  return new Frame(seq, OP_ERROR, 0, body);
}

function stub(op) {
  return errFrame(0, SQLSTATE_FEATURE_NOT_SUPPORTED,
    `vbp v1 driver: opcode ${opcodeName(op)} not implemented (v2)`);
}

function dataChunkInt(seq, value) {
  // u32 chunk_id, u32 row_count, u16 col_count, u16 type_id, u8 null_bitmap_byte_count, i32 value
  const body = Buffer.alloc(4 + 4 + 2 + 2 + 1 + 4);
  body.writeUInt32LE(1, 0);   // chunk_id
  body.writeUInt32LE(1, 4);   // row_count
  body.writeUInt16LE(1, 8);   // col_count
  body.writeUInt16LE(23, 10); // type_id = T_INT4
  body.writeUInt8(0, 12);     // null_bitmap_byte_count
  body.writeInt32LE(value, 13);
  return new Frame(seq, OP_DATA_CHUNK, 0, body);
}

function rowsFinished(seq, rowsAffected, tag) {
  const tagBuf = Buffer.from(tag, 'utf-8');
  const body = Buffer.alloc(8 + 4 + tagBuf.length + 4);
  body.writeBigUInt64LE(BigInt(rowsAffected), 0);
  body.writeUInt32LE(tagBuf.length, 8);
  tagBuf.copy(body, 12);
  body.writeUInt32LE(0, 12 + tagBuf.length); // exec_time_us
  return new Frame(seq, OP_ROWS_FINISHED, 0, body);
}

function commandComplete(seq, status) {
  return new Frame(seq, OP_COMMAND_COMPLETE, 0, Buffer.from([status & 0xFF]));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleClientHello(/* mux, body */) {
  const srBody = Buffer.alloc(4 + 4 + 1 + 4 + 16);
  srBody.writeUInt32LE(0x000A0000, 0);  // v10.0.0
  srBody.writeUInt32LE(0x0000001F, 4);  // all caps
  srBody.writeUInt8(0, 8);              // auth_required = 0 (dev mode)
  srBody.writeUInt32LE(16, 9);          // nonce_len
  // nonce: zeros (fine for dev)
  return [
    new Frame(0, OP_SERVER_READY, 0, srBody),
    new Frame(0, OP_AUTH_OK, 0, Buffer.alloc(20)),
  ];
}

function handleAuthResponse() {
  return [
    new Frame(0, OP_AUTH_OK, 0, Buffer.alloc(20)),
  ];
}

function handleQuery(/* mux, body */) {
  // v1 stub: emit 1-row DATA_CHUNK + ROWS_FINISHED + COMMAND_COMPLETE
  return [
    dataChunkInt(0, 1),
    rowsFinished(0, 1, 'SELECT 1'),
    commandComplete(0, 0),
  ];
}

function handlePing(mux, body) {
  return [new Frame(0, OP_PONG, 0, body.subarray(0, 8))];
}

function handleClose() { return []; }
function handleBegin() { return [commandComplete(0, 1)]; }
function handleCommit() { return [commandComplete(0, 0)]; }
function handleRollback() { return [commandComplete(0, 0)]; }
function handleExtQuery() { return [stub(OP_EXT_QUERY)]; }
function handleParse() { return [commandComplete(0, 0)]; }
function handleBind() { return [commandComplete(0, 0)]; }
function handleCopyIn() { return [stub(OP_COPY_IN)]; }
function handleCopyDone() { return [commandComplete(0, 0)]; }
function handleCopyFail() { return [commandComplete(0, 0)]; }
function handleCancelQuery() { return [commandComplete(0, 0)]; }
function handleDataChunk() {
  return [errFrame(0, SQLSTATE_SYNTAX_ERROR, 'DATA_CHUNK is server-to-client')];
}
function handleRowsFinished() {
  return [errFrame(0, SQLSTATE_SYNTAX_ERROR, 'ROWS_FINISHED is server-to-client')];
}
function handleCommandComplete() {
  return [errFrame(0, SQLSTATE_SYNTAX_ERROR, 'COMMAND_COMPLETE is server-to-client')];
}
function handleError() {
  return [errFrame(0, SQLSTATE_SYNTAX_ERROR, 'ERROR is server-to-client')];
}
function handleAuthChallenge() {
  return [errFrame(0, SQLSTATE_SYNTAX_ERROR, 'AUTH_CHALLENGE is server-to-client')];
}
function handleServerReady() {
  return [errFrame(0, SQLSTATE_SYNTAX_ERROR, 'SERVER_READY is server-to-client')];
}
function handlePong() {
  return [errFrame(0, SQLSTATE_SYNTAX_ERROR, 'PONG is server-to-client')];
}

const HANDLERS = {
  [OP_CLIENT_HELLO]: handleClientHello,
  [OP_SERVER_READY]: handleServerReady,
  [OP_AUTH_CHALLENGE]: handleAuthChallenge,
  [OP_AUTH_RESPONSE]: handleAuthResponse,
  [OP_AUTH_OK]: () => [],
  [OP_QUERY]: handleQuery,
  [OP_EXT_QUERY]: handleExtQuery,
  [OP_PARSE]: handleParse,
  [OP_BIND]: handleBind,
  [OP_DATA_CHUNK]: handleDataChunk,
  [OP_ROWS_FINISHED]: handleRowsFinished,
  [OP_COMMAND_COMPLETE]: handleCommandComplete,
  [OP_ERROR]: handleError,
  [OP_BEGIN]: handleBegin,
  [OP_COMMIT]: handleCommit,
  [OP_ROLLBACK]: handleRollback,
  [OP_COPY_IN]: handleCopyIn,
  [OP_COPY_DONE]: handleCopyDone,
  [OP_COPY_FAIL]: handleCopyFail,
  [OP_CANCEL_QUERY]: handleCancelQuery,
  [OP_PING]: handlePing,
  [OP_PONG]: handlePong,
  [OP_CLOSE]: handleClose,
};

function assertAllMandatoryHandlersRegistered() {
  const missing = MANDATORY_OPCODES.filter((op) => !(op in HANDLERS));
  if (missing.length > 0) {
    throw new Error(`missing handlers for: ${missing.map(opcodeName).join(', ')}`);
  }
}

module.exports = {
  HANDLERS,
  assertAllMandatoryHandlersRegistered,
  errFrame, dataChunkInt, rowsFinished, commandComplete,
};
