/**
 * VedaDB Node driver — retry-with-backoff helper.
 *
 * Phase 0.5.1 of the 0.3→1.0 roadmap. Every language driver is
 * required to ship a retry wrapper with consistent semantics so
 * client code behaves the same across Python, Node, Go, etc.
 *
 * Policy
 * ------
 * Retry only on `ConnectionError` and `TimeoutError`. `QueryError`
 * (a real SQL-level failure) must NOT be retried — repeating it
 * would mask a schema or data bug.
 *
 * Usage
 * -----
 *   const { withRetry } = require('vedadb/src/retry');
 *   const result = await withRetry(
 *     () => db.query('SELECT 1;'),
 *     { maxAttempts: 5, baseDelayMs: 50, maxDelayMs: 2000 }
 *   );
 *
 * `withRetry` resolves with the callback's value, or rejects with the
 * last observed error. A small amount of full-jitter is applied to
 * prevent thundering-herd retries across a fleet of clients.
 */

'use strict';

const { ConnectionError, TimeoutError } = require('./client');

const DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 50,
  maxDelayMs: 2000,
  factor: 2,
  jitter: true,
};

/**
 * Compute the next sleep interval for attempt n (0-indexed).
 * Uses exponential-backoff with optional full-jitter.
 *
 * @param {number} n
 * @param {Object} opts
 * @returns {number} milliseconds to sleep
 */
function backoffMs(n, opts) {
  const base = Math.min(opts.baseDelayMs * Math.pow(opts.factor, n), opts.maxDelayMs);
  if (!opts.jitter) return base;
  return Math.floor(Math.random() * base);
}

/**
 * isRetryable returns true only for transport-level failures that a
 * retry could plausibly fix.
 */
function isRetryable(err) {
  if (err instanceof ConnectionError) return true;
  if (err instanceof TimeoutError) return true;
  // Some transient cases manifest as a generic Error — scan the message
  // for the tell-tale phrases. Keep this list short and audited.
  if (err && typeof err.message === 'string') {
    const m = err.message.toLowerCase();
    if (m.includes('econnreset') || m.includes('epipe') || m.includes('etimedout')) {
      return true;
    }
  }
  return false;
}

/**
 * Run `fn` with retry-on-transient-error semantics.
 *
 * @param {() => Promise<T>} fn
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {Promise<T>}
 * @template T
 */
async function withRetry(fn, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (opts.maxAttempts < 1) {
    throw new Error('withRetry: maxAttempts must be >= 1');
  }

  let lastErr;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === opts.maxAttempts - 1) {
        throw err;
      }
      const sleep = backoffMs(attempt, opts);
      await new Promise((r) => setTimeout(r, sleep));
    }
  }
  // Unreachable — the loop either returned or threw.
  throw lastErr;
}

module.exports = { withRetry, isRetryable, backoffMs, DEFAULTS };
