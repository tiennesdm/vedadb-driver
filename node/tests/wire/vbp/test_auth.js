'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { SCRAMClient, plainClientFirst, VBPAuthError } = require('../../../src/wire/vbp/auth');

// ---------------------------------------------------------------------------
// PLAIN
// ---------------------------------------------------------------------------

test('auth PLAIN: format is \\0user\\0pass', () => {
  const buf = plainClientFirst('alice', 'secret');
  // \x00 alice \x00 secret
  assert.strictEqual(buf[0], 0);
  assert.strictEqual(buf.subarray(1, 6).toString('utf-8'), 'alice');
  assert.strictEqual(buf[6], 0);
  assert.strictEqual(buf.subarray(7).toString('utf-8'), 'secret');
});

test('auth PLAIN: works with non-ASCII passwords (utf-8)', () => {
  const buf = plainClientFirst('u', 'пароль');
  // \x00 u \x00 + utf8
  assert.strictEqual(buf[0], 0);
  assert.strictEqual(buf[2], 0);
});

// ---------------------------------------------------------------------------
// SCRAM
// ---------------------------------------------------------------------------

test('auth SCRAM: clientFirstBare has n=user,r=nonce', () => {
  const c = new SCRAMClient('alice', 'pw');
  const cfb = c.clientFirstBare();
  assert.ok(cfb.startsWith('n=alice,r='));
  // nonce is 18 bytes base64 = 24 chars
  const m = cfb.match(/r=([A-Za-z0-9+/=]+)$/);
  assert.ok(m);
  assert.strictEqual(m[1].length, 24);
});

test('auth SCRAM: saslname escapes = and ,', () => {
  const c = new SCRAMClient('a=b,c', 'pw');
  const cfb = c.clientFirstBare();
  assert.ok(cfb.startsWith('n=a=3Db=2Cc,'));
});

test('auth SCRAM: clientFinalMessage verifies server-first nonce', () => {
  const c = new SCRAMClient('alice', 'pw');
  const cfb = c.clientFirstBare();
  const clientNonce = cfb.match(/r=([^,]+)$/)[1];
  const serverFirst = `r=${clientNonce}AAAAAAAAAAAAAAAAAAAAAA,s=c2FsdA==,i=4096`;
  const finalMsg = c.clientFinalMessage(serverFirst);
  // Format: c=<b64>,r=<nonce>,p=<b64>
  assert.ok(finalMsg.startsWith('c='));
  const parts = finalMsg.split(',');
  assert.strictEqual(parts.length, 3);
  assert.ok(parts[1].startsWith('r='));
  assert.ok(parts[2].startsWith('p='));
  // The nonce in r= should equal combined nonce (= client nonce + AAA...)
  assert.strictEqual(parts[1].slice(2), clientNonce + 'AAAAAAAAAAAAAAAAAAAAAA');
});

test('auth SCRAM: rejects server-first that does not begin with client nonce', () => {
  const c = new SCRAMClient('alice', 'pw');
  const serverFirst = 'r=DIFFERENTNONCE,s=c2FsdA==,i=4096';
  assert.throws(() => c.clientFinalMessage(serverFirst), VBPAuthError);
});

test('auth SCRAM: rejects malformed server-first', () => {
  const c = new SCRAMClient('alice', 'pw');
  assert.throws(() => c.clientFinalMessage('garbage'), VBPAuthError);
  assert.throws(() => c.clientFinalMessage('r=x,s=y'), VBPAuthError); // missing i
});

test('auth SCRAM: cbind_input is exactly the gs2_header (RFC 5802 §6 pencil vector)', () => {
  // Per RFC 5802 §6, when the gs2-flag is 'n' (no channel binding),
  // cbind-data is ABSENT, so cbind-input is just the gs2-header.
  // The canonical pencil test vector is c=biws, which is
  // base64("n,,"). Anything else (e.g. "n,,n=user,r=nonce") is a
  // conformance bug — that would imply a non-'n' gs2-flag.
  const c = new SCRAMClient('alice', 'pw');
  const serverFirst = `r=${c.clientNonce}AAAA,s=c2FsdA==,i=4096`;
  const finalMsg = c.clientFinalMessage(serverFirst);
  // finalMsg format: c=<b64>,r=<nonce>,p=<b64>
  const parts = finalMsg.split(',');
  assert.strictEqual(parts[0].slice(0, 2), 'c=');
  const cPart = parts[0].slice(2);
  // The exact pencil vector from RFC 5802 §5 / §6: c=biws.
  assert.strictEqual(cPart, 'biws',
    `cbind channel-binding should be base64("n,,") = "biws", got ${JSON.stringify(cPart)}`);
  // Defensive: decode and assert the literal string.
  assert.strictEqual(Buffer.from(cPart, 'base64').toString('utf-8'), 'n,,');
});

test('auth SCRAM: empty username throws', () => {
  assert.throws(() => new SCRAMClient('', 'pw'), VBPAuthError);
});

test('auth SCRAM: verifyServerFinal with no v= is a no-op (dev mode)', () => {
  const c = new SCRAMClient('alice', 'pw');
  const serverFirst = `r=${c.clientNonce}AAAA,s=c2FsdA==,i=4096`;
  c.clientFinalMessage(serverFirst);
  // Empty body (no v=) — dev server skips signature verification.
  c.verifyServerFinal('');
  // Garbage v= should throw a real signature mismatch.
  assert.throws(() => c.verifyServerFinal('v=AQIDBAUGBwgJCgsMDQ4PEA'), VBPAuthError);
});
