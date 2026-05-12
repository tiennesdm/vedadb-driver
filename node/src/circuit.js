/**
 * VedaDB Node.js Driver - Circuit Breaker
 *
 * Prevents cascading failures by detecting when a remote service is
 * experiencing problems and temporarily rejecting requests instead of
 * making them, giving the service time to recover.
 */

'use strict';

const { EventEmitter } = require('events');
const { CircuitOpenError } = require('./errors');

/**
 * Circuit breaker states.
 */
const CircuitState = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',           // Failing, rejecting requests
  HALF_OPEN: 'HALF_OPEN', // Testing if service recovered
};

/**
 * Circuit breaker for VedaDB connections.
 * Monitors failures and opens when threshold is exceeded.
 */
class CircuitBreaker extends EventEmitter {
  /**
   * @param {Object} options
   * @param {number} [options.failureThreshold=5] - Failures before opening
   * @param {number} [options.resetTimeoutMs=30000] - Time before half-open
   * @param {number} [options.halfOpenMaxCalls=3] - Test calls in half-open
   * @param {number} [options.successThreshold=2] - Successes to close
   * @param {function(Error):boolean} [options.isRetryable] - Custom retryable check
   */
  constructor(options = {}) {
    super();
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls || 3;
    this.successThreshold = options.successThreshold || 2;
    this.isRetryable = options.isRetryable || (() => true);

    this._state = CircuitState.CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._halfOpenCalls = 0;
    this._lastFailureTime = null;
    this._resetTimer = null;
  }

  /** Current circuit state. */
  get state() {
    return this._state;
  }

  /** Number of consecutive failures. */
  get failureCount() {
    return this._failures;
  }

  /** Whether the circuit allows requests through. */
  get allowsRequests() {
    return this._state === CircuitState.CLOSED ||
      (this._state === CircuitState.HALF_OPEN && this._halfOpenCalls < this.halfOpenMaxCalls);
  }

  /** Stats snapshot. */
  get stats() {
    return {
      state: this._state,
      failures: this._failures,
      successes: this._successes,
      halfOpenCalls: this._halfOpenCalls,
      lastFailureTime: this._lastFailureTime,
      allowsRequests: this.allowsRequests,
    };
  }

  /**
   * Execute a function with circuit breaker protection.
   *
   * @template T
   * @param {function(): Promise<T>} fn - Function to execute
   * @returns {Promise<T>}
   * @throws {CircuitOpenError} If circuit is OPEN
   */
  async execute(fn) {
    if (!this.allowsRequests) {
      throw new CircuitOpenError(
        `Circuit breaker is OPEN (failures=${this._failures}, lastFailure=${this._lastFailureTime})`
      );
    }

    if (this._state === CircuitState.HALF_OPEN) {
      this._halfOpenCalls++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  /** @private */
  _onSuccess() {
    if (this._state === CircuitState.HALF_OPEN) {
      this._successes++;
      if (this._successes >= this.successThreshold) {
        this._close();
      }
    } else {
      this._failures = 0;
    }
  }

  /** @private */
  _onFailure(err) {
    if (!this.isRetryable(err)) return;

    this._failures++;
    this._lastFailureTime = Date.now();
    this._successes = 0;

    if (this._state === CircuitState.HALF_OPEN) {
      this._open();
    } else if (this._failures >= this.failureThreshold) {
      this._open();
    }
  }

  /** @private */
  _open() {
    if (this._state === CircuitState.OPEN) return;
    this._state = CircuitState.OPEN;
    this.emit('open', { failures: this._failures, lastFailureTime: this._lastFailureTime });

    this._resetTimer = setTimeout(() => {
      this._halfOpen();
    }, this.resetTimeoutMs);
  }

  /** @private */
  _halfOpen() {
    if (this._state !== CircuitState.OPEN) return;
    this._state = CircuitState.HALF_OPEN;
    this._halfOpenCalls = 0;
    this._successes = 0;
    this.emit('halfOpen');
  }

  /** @private */
  _close() {
    if (this._resetTimer) {
      clearTimeout(this._resetTimer);
      this._resetTimer = null;
    }
    const wasOpen = this._state === CircuitState.OPEN || this._state === CircuitState.HALF_OPEN;
    this._state = CircuitState.CLOSED;
    this._failures = 0;
    this._successes = 0;
    this._halfOpenCalls = 0;
    if (wasOpen) this.emit('close');
  }

  /** Manually close the circuit (force normal operation). */
  forceClose() {
    this._close();
    this.emit('forceClose');
  }

  /** Manually open the circuit (force rejection). */
  forceOpen() {
    this._open();
    this.emit('forceOpen');
  }

  /** Clean up timers. */
  destroy() {
    if (this._resetTimer) {
      clearTimeout(this._resetTimer);
      this._resetTimer = null;
    }
    this.removeAllListeners();
  }
}

module.exports = {
  CircuitBreaker,
  CircuitState,
};
