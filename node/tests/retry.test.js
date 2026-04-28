/**
 * retry.test.js — unit tests for the 0.5.1 retry helper.
 *
 * Runs under the repository's default test runner (`npm test`).
 * The helper is self-contained so these tests do not hit a VedaDB
 * server — they drive the wrapper with synthetic failures.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ConnectionError, QueryError } = require('../src/client');
const { withRetry, isRetryable, backoffMs } = require('../src/retry');

test('withRetry — resolves on first success', async () => {
  const result = await withRetry(async () => 42);
  assert.equal(result, 42);
});

test('withRetry — retries on ConnectionError, then succeeds', async () => {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new ConnectionError('econnreset');
      return 'ok';
    },
    { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('withRetry — gives up after maxAttempts and rethrows', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new ConnectionError('always');
      },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
    ),
    ConnectionError,
  );
  assert.equal(attempts, 3);
});

test('withRetry — does NOT retry a QueryError (schema-level failures)', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new QueryError('table not found');
      },
      { maxAttempts: 5, baseDelayMs: 1, jitter: false },
    ),
    QueryError,
  );
  assert.equal(attempts, 1, 'QueryError must not trigger a retry');
});

test('isRetryable — recognises transport-level failures only', () => {
  assert.equal(isRetryable(new ConnectionError('x')), true);
  assert.equal(isRetryable(new QueryError('x')), false);
  assert.equal(isRetryable(new Error('ETIMEDOUT')), true);
  assert.equal(isRetryable(new Error('unexpected EOF mid-row')), false);
  assert.equal(isRetryable(null), false);
});

test('backoffMs — exponential without jitter, capped at maxDelayMs', () => {
  const opts = { baseDelayMs: 10, maxDelayMs: 100, factor: 2, jitter: false };
  assert.equal(backoffMs(0, opts), 10);
  assert.equal(backoffMs(1, opts), 20);
  assert.equal(backoffMs(2, opts), 40);
  assert.equal(backoffMs(3, opts), 80);
  assert.equal(backoffMs(4, opts), 100, 'cap enforced');
  assert.equal(backoffMs(10, opts), 100, 'still capped');
});

test('backoffMs — with jitter, stays in [0, base]', () => {
  const opts = { baseDelayMs: 50, maxDelayMs: 50, factor: 1, jitter: true };
  for (let i = 0; i < 100; i++) {
    const v = backoffMs(0, opts);
    assert.ok(v >= 0 && v <= 50, `jitter out of range: ${v}`);
  }
});

test('withRetry — maxAttempts < 1 throws configuration error synchronously', async () => {
  await assert.rejects(withRetry(async () => 1, { maxAttempts: 0 }), /maxAttempts/);
});
