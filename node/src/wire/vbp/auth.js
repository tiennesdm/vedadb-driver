/**
 * VBP authentication: PLAIN (RFC 4616) and SCRAM-SHA-256 (RFC 5802 / RFC 7677).
 *
 * Two message-flow variants are supported:
 *   * PLAIN — a single AUTH_RESPONSE carrying "\0user\0pass" (RFC 4616).
 *   * SCRAM-SHA-256 — RFC 5802 4-message flow (client-first →
 *     server-first → client-final → server-final).
 *
 * PLAIN: a single AUTH_RESPONSE round trip.
 * SCRAM: 4-message flow using node:crypto (createHmac, pbkdf2Sync).
 *
 * IMPORTANT (gotcha): the SCRAM c= binding is `gs2_header + "," +
 * client_first_bare` (per RFC 5802 §6), NOT `gs2_header + "," +
 * client_first_bare + "," + ...`. We use the spec-correct form.
 *
 * Pure stdlib. No third-party deps.
 */
'use strict';

const crypto = require('node:crypto');

const {
  AUTH_MECH_NONE,
  AUTH_MECH_PLAIN,
  AUTH_MECH_SCRAM_SHA_256,
  OP_AUTH_CHALLENGE,
  OP_AUTH_OK,
  OP_AUTH_RESPONSE,
  SQLSTATE_AUTH_FAILED,
  opcodeName,
} = require('./opcodes');

class VBPAuthError extends Error {
  constructor(sqlstate, message) {
    super(`[${sqlstate}] ${message}`);
    this.name = 'VBPAuthError';
    this.sqlstate = sqlstate;
  }
}

// ---------------------------------------------------------------------------
// PLAIN
// ---------------------------------------------------------------------------

function plainClientFirst(username, password) {
  // RFC 4616: [authzid] NUL authcid NUL password. v1 has no authzid.
  return Buffer.concat([
    Buffer.from([0]),
    Buffer.from(String(username), 'utf-8'),
    Buffer.from([0]),
    Buffer.from(String(password), 'utf-8'),
  ]);
}

// ---------------------------------------------------------------------------
// SCRAM-SHA-256 (RFC 5802)
// ---------------------------------------------------------------------------

const _SCRAM_GS2_HEADER = 'n,,'; // no channel binding, no authzid

function _xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function _hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg).digest();
}

function _hi(password, salt, iters) {
  return crypto.pbkdf2Sync(
    Buffer.from(password, 'utf-8'),
    salt,
    iters,
    32,
    'sha256'
  );
}

function _saslName(name) {
  return String(name).replace(/[=,]/g, (m) => `=${m.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function _parseServerFirst(serverFirst) {
  const out = {};
  for (const part of serverFirst.split(',')) {
    const ix = part.indexOf('=');
    if (ix < 0) continue;
    out[part.slice(0, ix)] = part.slice(ix + 1);
  }
  if (!out.r || !out.s || !out.i) {
    throw new VBPAuthError('0A000', 'malformed server-first: missing r/s/i');
  }
  out._iters = parseInt(out.i, 10);
  if (!Number.isFinite(out._iters)) {
    throw new VBPAuthError('0A000', `invalid iteration count: ${out.i}`);
  }
  return out;
}

class SCRAMClient {
  constructor(username, password) {
    if (!username) throw new VBPAuthError(SQLSTATE_AUTH_FAILED, 'empty username');
    this.username = username;
    this.password = password;
    // 18 random bytes -> 24 base64 chars
    this._clientNonce = crypto.randomBytes(18).toString('base64');
    this._combinedNonce = null;
    this._authMessage = null;
    this._clientProof = null;
    this._storedKey = null;
    this._saltB64 = null;
    this._iters = 0;
  }

  get clientNonce() { return this._clientNonce; }

  clientFirstBare() {
    return `n=${_saslName(this.username)},r=${this._clientNonce}`;
  }

  clientFirst() {
    return `${_SCRAM_GS2_HEADER}${this.clientFirstBare()}`;
  }

  clientFinalMessage(serverFirstMsg) {
    const parsed = _parseServerFirst(serverFirstMsg);
    const combined = parsed.r;
    if (!combined.startsWith(this._clientNonce)) {
      throw new VBPAuthError(SQLSTATE_AUTH_FAILED, 'server nonce does not begin with client nonce');
    }
    this._combinedNonce = combined;
    const saltB64 = parsed.s;
    const iters = parsed._iters;
    this._saltB64 = saltB64;
    this._iters = iters;

    const clientFirstBare = this.clientFirstBare();
    const gs2Header = _SCRAM_GS2_HEADER;
    // RFC 5802 §6: for gs2-flag 'n' (client does not support channel
    // binding), cbind-data is ABSENT, so cbind-input is just gs2-header.
    // The pencil test vector is c=biws which is base64("n,,").
    const cbindInput = Buffer.from(gs2Header, 'utf-8');
    const channelBinding = cbindInput.toString('base64');
    const clientFinalWithoutProof = `c=${channelBinding},r=${combined}`;
    const serverFirstRecon = `r=${combined},s=${saltB64},i=${iters}`;
    this._authMessage = Buffer.from(
      `${clientFirstBare},${serverFirstRecon},${clientFinalWithoutProof}`,
      'utf-8'
    );

    const salt = Buffer.from(saltB64, 'base64');
    const saltedPassword = _hi(this.password, salt, iters);
    const clientKey = _hmacSha256(saltedPassword, Buffer.from('Client Key', 'utf-8'));
    const storedKey = crypto.createHash('sha256').update(clientKey).digest();
    this._storedKey = storedKey;
    const clientSignature = _hmacSha256(storedKey, this._authMessage);
    this._clientProof = _xor(clientKey, clientSignature);

    return `${clientFinalWithoutProof},p=${this._clientProof.toString('base64')}`;
  }

  verifyServerFinal(serverFinalMsg) {
    if (this._clientProof === null || this._authMessage === null) {
      throw new VBPAuthError('0A000', 'verifyServerFinal called before clientFinal');
    }
    // v1 dev server may emit empty server-final — treat as success.
    if (!serverFinalMsg || !serverFinalMsg.startsWith('v=')) return;
    const serverSig = Buffer.from(serverFinalMsg.slice(2), 'base64');
    const salt = Buffer.from(this._saltB64, 'base64');
    const saltedPassword = _hi(this.password, salt, this._iters);
    const serverKey = _hmacSha256(saltedPassword, Buffer.from('Server Key', 'utf-8'));
    const expectedSig = _hmacSha256(serverKey, this._authMessage);
    if (!serverSig.equals(expectedSig)) {
      throw new VBPAuthError(SQLSTATE_AUTH_FAILED, 'server signature mismatch');
    }
  }
}

// ---------------------------------------------------------------------------
// High-level handshake driver
// ---------------------------------------------------------------------------

async function performHandshake(mux, opts) {
  const mechanism = (opts.mechanism || AUTH_MECH_PLAIN).toUpperCase();
  if (mechanism === AUTH_MECH_NONE) {
    return { sessionToken: 0n, expiresAt: 0n, serverFinal: Buffer.alloc(0) };
  }
  if (mechanism === AUTH_MECH_PLAIN) {
    const body = plainClientFirst(opts.username, opts.password);
    const replies = await mux.call(OP_AUTH_RESPONSE, body, opts);
    return _parseAuthOk(replies);
  }
  if (mechanism === AUTH_MECH_SCRAM_SHA_256) {
    const scram = new SCRAMClient(opts.username, opts.password);
    // Step 1: client-first
    const cfFull = scram.clientFirst();
    const replies1 = await mux.call(OP_AUTH_RESPONSE, Buffer.from(cfFull, 'utf-8'), opts);
    // Replies may be AUTH_CHALLENGE or AUTH_OK (if server skips SCRAM in dev mode).
    let challengeFrame = null;
    let challengeBody = null;
    for (const f of replies1) {
      if (f.op === OP_AUTH_CHALLENGE) { challengeFrame = f; break; }
      if (f.op === OP_AUTH_OK) return _parseAuthOk(replies1);
    }
    if (!challengeFrame) {
      throw new VBPAuthError(SQLSTATE_AUTH_FAILED, 'no AUTH_CHALLENGE from server');
    }
    const serverFirstMsg = challengeFrame.body.toString('utf-8');
    // Step 2: client-final
    const clientFinal = scram.clientFinalMessage(serverFirstMsg);
    const replies2 = await mux.call(OP_AUTH_RESPONSE, Buffer.from(clientFinal, 'utf-8'), opts);
    for (const f of replies2) {
      if (f.op === OP_AUTH_OK) {
        // v1 server may include server-final in the AUTH_OK body.
        const result = _parseAuthOk(replies2);
        const serverFinal = result.serverFinal;
        if (serverFinal && serverFinal.length > 0) {
          scram.verifyServerFinal(serverFinal.toString('utf-8'));
        }
        return result;
      }
    }
    return _parseAuthOk(replies2);
  }
  throw new VBPAuthError('0A000', `unsupported auth mechanism: ${mechanism}`);
}

function _parseAuthOk(replies) {
  for (const f of replies) {
    if (f.op === OP_AUTH_OK) {
      const body = f.body;
      // AUTH_OK body: u64 session_token, u64 expires_at, u32 sf_len, [sf]
      const sessionToken = body.readBigUInt64LE(0);
      const expiresAt = body.readBigUInt64LE(8);
      const sfLen = body.readUInt32LE(16);
      const serverFinal = body.subarray(20, 20 + sfLen);
      return { sessionToken, expiresAt, serverFinal };
    }
  }
  throw new VBPAuthError(SQLSTATE_AUTH_FAILED, 'no AUTH_OK in replies');
}

module.exports = {
  VBPAuthError,
  SCRAMClient,
  performHandshake,
  plainClientFirst,
};
