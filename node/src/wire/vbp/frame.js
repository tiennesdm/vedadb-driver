/**
 * VedaDB Binary Protocol (VBP) — frame I/O.
 *
 * Wire format (VBP_SPEC.md §2):
 *
 *   +--------+---------+-----+-----+-----+----------+...+
 *   | 'VDB'  | len_le4 | seq | op  | flg |  body    |
 *   +--------+---------+-----+-----+-----+----------+...+
 *   | 3 B    | 4 B     | 1 B | 1 B | 1 B | (len-2)B |
 *   +--------+---------+-----+-----+-----+----------+...+
 *
 *  * Magic is ASCII bytes 'V', 'D', 'B' (0x56 0x44 0x42).
 *  * `len_le4` is the payload length (op + flags + body), little-endian u32.
 *  * `seq` is u8 (0-255), wraps at 256.
 *  * `op` is u8 (see opcodes.js).
 *  * `flags` is u8 (zero in v1).
 *  * `body` length is `len_le4 - 2`.
 *
 * Pure stdlib: Buffer + module 'node:buffer'. No third-party deps.
 */
'use strict';

const MAGIC = Buffer.from('VDB', 'ascii');
const MAGIC_LEN = 3;
const LEN_LEN = 4;
const SEQ_LEN = 1;
const HDR_LEN = 8; // 3 + 4 + 1
const OP_LEN = 1;
const FLAGS_LEN = 1;
const OPFLAGS_LEN = 2;

const DEFAULT_VBP_PORT = 6380;
const MAX_FRAME_LEN = 64 * 1024 * 1024; // 64 MiB

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class VBPProtocolError extends Error {
  constructor(msg) { super(msg); this.name = 'VBPProtocolError'; }
}
class VBPBadMagic extends VBPProtocolError {
  constructor(msg) { super(msg); this.name = 'VBPBadMagic'; }
}
class VBPFrameTooShort extends VBPProtocolError {
  constructor(msg) { super(msg); this.name = 'VBPFrameTooShort'; }
}
class VBPFrameTooLarge extends VBPProtocolError {
  constructor(msg) { super(msg); this.name = 'VBPFrameTooLarge'; }
}
class VBPConnectionClosed extends VBPProtocolError {
  constructor(msg) { super(msg); this.name = 'VBPConnectionClosed'; }
}

// ---------------------------------------------------------------------------
// Frame struct
// ---------------------------------------------------------------------------

class Frame {
  constructor(seq, op, flags, body) {
    if (!Number.isInteger(seq) || seq < 0 || seq > 0xFF) {
      throw new RangeError(`seq out of range: ${seq}`);
    }
    if (!Number.isInteger(op) || op < 0 || op > 0xFF) {
      throw new RangeError(`op out of range: ${op}`);
    }
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xFF) {
      throw new RangeError(`flags out of range: ${flags}`);
    }
    this.seq = seq;
    this.op = op;
    this.flags = flags;
    this.body = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  }
  toString() {
    return `Frame(seq=${this.seq}, op=0x${this.op.toString(16).padStart(2, '0')}, flags=0x${this.flags.toString(16).padStart(2, '0')}, body_len=${this.body.length})`;
  }
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

function writeFrame(buf, seq, op, flags, body) {
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xFF) {
    throw new RangeError(`seq out of range: ${seq}`);
  }
  if (!Number.isInteger(op) || op < 0 || op > 0xFF) {
    throw new RangeError(`op out of range: ${op}`);
  }
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xFF) {
    throw new RangeError(`flags out of range: ${flags}`);
  }
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  const payloadLen = OPFLAGS_LEN + bodyBuf.length;
  if (payloadLen > MAX_FRAME_LEN) {
    throw new VBPFrameTooLarge(`payload length ${payloadLen} exceeds MAX_FRAME_LEN ${MAX_FRAME_LEN}`);
  }
  // 3-byte magic + 4-byte LE length + 1-byte seq + 1-byte op + 1-byte flags + body
  const out = Buffer.alloc(HDR_LEN + OPFLAGS_LEN + bodyBuf.length);
  MAGIC.copy(out, 0);
  out.writeUInt32LE(payloadLen, MAGIC_LEN);
  out[7] = seq & 0xFF;
  out[8] = op & 0xFF;
  out[9] = flags & 0xFF;
  if (bodyBuf.length > 0) {
    bodyBuf.copy(out, HDR_LEN + OPFLAGS_LEN);
  }
  buf.write(out);
  return out;
}

function frameBytes(seq, op, flags, body) {
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  const out = Buffer.alloc(HDR_LEN + OPFLAGS_LEN + bodyBuf.length);
  MAGIC.copy(out, 0);
  const payloadLen = OPFLAGS_LEN + bodyBuf.length;
  out.writeUInt32LE(payloadLen, MAGIC_LEN);
  out[7] = seq & 0xFF;
  out[8] = op & 0xFF;
  out[9] = flags & 0xFF;
  if (bodyBuf.length > 0) bodyBuf.copy(out, HDR_LEN + OPFLAGS_LEN);
  return out;
}

function _readExact(state, n) {
  if (state.buf.length < state.offset + n) {
    return null;
  }
  const slice = state.buf.subarray(state.offset, state.offset + n);
  state.offset += n;
  return slice;
}

function tryDecodeFrame(state) {
  // state: { buf: Buffer, offset: number }
  if (state.offset + HDR_LEN > state.buf.length) return null;
  if (!state.buf.subarray(state.offset, state.offset + 3).equals(MAGIC)) {
    // We must inspect — bad magic is a protocol error.
    if (state.buf.length - state.offset < 3) return null;
    const got = state.buf.subarray(state.offset, state.offset + 3).toString('hex');
    throw new VBPBadMagic(`bad magic: expected 564442, got ${got}`);
  }
  const payloadLen = state.buf.readUInt32LE(state.offset + MAGIC_LEN);
  if (payloadLen < OPFLAGS_LEN) {
    throw new VBPFrameTooShort(`payload_length ${payloadLen} < ${OPFLAGS_LEN}`);
  }
  if (payloadLen > MAX_FRAME_LEN) {
    throw new VBPFrameTooLarge(`payload_length ${payloadLen} exceeds MAX_FRAME_LEN ${MAX_FRAME_LEN}`);
  }
  const totalLen = HDR_LEN + payloadLen;
  if (state.offset + totalLen > state.buf.length) return null;
  const seq = state.buf[state.offset + MAGIC_LEN + LEN_LEN];
  const op = state.buf[state.offset + HDR_LEN];
  const flags = state.buf[state.offset + HDR_LEN + 1];
  const bodyStart = state.offset + HDR_LEN + OPFLAGS_LEN;
  const bodyEnd = state.offset + totalLen;
  const body = state.buf.subarray(bodyStart, bodyEnd);
  // Copy body into a new Buffer (defensive — subarray shares memory)
  const bodyCopy = Buffer.from(body);
  state.offset += totalLen;
  return new Frame(seq, op, flags, bodyCopy);
}

function resetState(state) {
  state.buf = Buffer.alloc(0);
  state.offset = 0;
}

function feedBytes(state, chunk) {
  // Append chunk to internal buffer.
  if (state.offset === 0) {
    state.buf = Buffer.concat([state.buf, chunk]);
  } else {
    // Compact: drop already-decoded prefix.
    state.buf = Buffer.concat([state.buf.subarray(state.offset), chunk]);
    state.offset = 0;
  }
}

module.exports = {
  MAGIC,
  MAGIC_LEN,
  HDR_LEN,
  OPFLAGS_LEN,
  DEFAULT_VBP_PORT,
  MAX_FRAME_LEN,
  Frame,
  VBPProtocolError,
  VBPBadMagic,
  VBPFrameTooShort,
  VBPFrameTooLarge,
  VBPConnectionClosed,
  writeFrame,
  frameBytes,
  tryDecodeFrame,
  resetState,
  feedBytes,
};
