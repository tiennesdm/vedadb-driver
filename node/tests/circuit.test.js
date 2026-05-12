/**
 * circuit.test.js — Circuit breaker tests for VedaDB Node.js driver
 */

const { EventEmitter } = require('events');

class CircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 3;
    this.timeout = options.timeout || 30000;
    this._state = 'CLOSED';
    this._failureCount = 0;
    this._successCount = 0;
    this._lastFailureTime = null;
    this._halfOpenCalls = 0;
    this._halfOpenMax = 1;
  }

  get state() {
    return this._state;
  }

  allow() {
    if (this._state === 'CLOSED') return true;
    if (this._state === 'OPEN') {
      if (Date.now() - this._lastFailureTime > this.timeout) {
        this._state = 'HALF_OPEN';
        this._halfOpenCalls = 0;
        this._successCount = 0;
        this.emit('halfOpen');
        return true;
      }
      return false;
    }
    // HALF_OPEN
    if (this._halfOpenCalls < this._halfOpenMax) {
      this._halfOpenCalls++;
      return true;
    }
    return false;
  }

  recordSuccess() {
    if (this._state === 'HALF_OPEN') {
      this._successCount++;
      if (this._successCount >= this.successThreshold) {
        this._state = 'CLOSED';
        this._failureCount = 0;
        this._halfOpenCalls = 0;
        this.emit('close');
      }
    } else if (this._state === 'CLOSED') {
      this._failureCount = 0;
    }
  }

  recordFailure() {
    this._lastFailureTime = Date.now();
    if (this._state === 'HALF_OPEN') {
      this._state = 'OPEN';
      this._halfOpenCalls = 0;
      this.emit('open');
      return;
    }
    this._failureCount++;
    if (this._failureCount >= this.failureThreshold) {
      this._state = 'OPEN';
      this.emit('open');
    }
  }

  async execute(fn) {
    if (!this.allow()) {
      throw new CircuitBreakerOpenError('Circuit breaker is OPEN');
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  reset() {
    this._state = 'CLOSED';
    this._failureCount = 0;
    this._successCount = 0;
    this._halfOpenCalls = 0;
    this.emit('close');
  }
}

class CircuitBreakerOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

describe('CircuitBreaker', () => {
  describe('Closed State', () => {
    test('should start closed', () => {
      const cb = new CircuitBreaker();
      expect(cb.state).toBe('CLOSED');
    });

    test('should allow requests when closed', () => {
      const cb = new CircuitBreaker();
      expect(cb.allow()).toBe(true);
    });

    test('should execute successfully', async () => {
      const cb = new CircuitBreaker();
      const result = await cb.execute(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('Open State', () => {
    test('should open after failure threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe('CLOSED');
      cb.recordFailure();
      expect(cb.state).toBe('OPEN');
    });

    test('should reject when open', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 60000 });
      cb.recordFailure();
      expect(cb.allow()).toBe(false);
    });

    test('should throw when executing while open', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 60000 });
      cb.recordFailure();
      await expect(cb.execute(async () => 'should not run')).rejects.toThrow(CircuitBreakerOpenError);
    });

    test('should be exact at threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe('CLOSED');
      cb.recordFailure();
      expect(cb.state).toBe('OPEN');
    });
  });

  describe('Half-Open State', () => {
    test('should transition to half-open after timeout', (done) => {
      const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 50 });
      cb.recordFailure();
      expect(cb.state).toBe('OPEN');

      cb.on('halfOpen', () => {
        expect(cb.state).toBe('HALF_OPEN');
        done();
      });

      setTimeout(() => {
        cb.allow();
      }, 100);
    }, 200);

    test('should close after success in half-open', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5, successThreshold: 1, timeout: 10 });
      cb.recordFailure();
      await new Promise(r => setTimeout(r, 20));
      cb.allow();
      cb.recordSuccess();
      expect(cb.state).toBe('CLOSED');
    });

    test('should reopen after failure in half-open', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5, timeout: 10 });
      cb.recordFailure();
      await new Promise(r => setTimeout(r, 20));
      cb.allow();
      cb.recordFailure();
      expect(cb.state).toBe('OPEN');
    });

    test('should require multiple successes', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5, successThreshold: 3, timeout: 10 });
      cb.recordFailure();
      await new Promise(r => setTimeout(r, 20));

      cb.allow(); cb.recordSuccess();
      expect(cb.state).toBe('HALF_OPEN');

      await new Promise(r => setTimeout(r, 20));
      cb.allow(); cb.recordSuccess();
      expect(cb.state).toBe('HALF_OPEN');

      await new Promise(r => setTimeout(r, 20));
      cb.allow(); cb.recordSuccess();
      expect(cb.state).toBe('CLOSED');
    });
  });

  describe('Recovery', () => {
    test('should complete full recovery cycle', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, successThreshold: 1, timeout: 10 });

      expect(cb.state).toBe('CLOSED');

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe('OPEN');

      await new Promise(r => setTimeout(r, 20));
      expect(cb.allow()).toBe(true);
      expect(cb.state).toBe('HALF_OPEN');

      cb.recordSuccess();
      expect(cb.state).toBe('CLOSED');
    });
  });

  describe('Reset', () => {
    test('should reset manually', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      expect(cb.state).toBe('OPEN');
      cb.reset();
      expect(cb.state).toBe('CLOSED');
      expect(cb.allow()).toBe(true);
    });
  });

  describe('Events', () => {
    test('should emit open event', (done) => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.on('open', () => done());
      cb.recordFailure();
    });

    test('should emit close event', (done) => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.on('close', () => done());
      cb.reset();
    });
  });

  describe('Concurrency', () => {
    test('should handle concurrent failures', () => {
      const cb = new CircuitBreaker({ failureThreshold: 100 });
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(new Promise(resolve => {
          setImmediate(() => {
            cb.recordFailure();
            resolve();
          });
        }));
      }
      return Promise.all(promises).then(() => {
        expect(cb.state).toBe('OPEN');
      });
    });
  });
});

module.exports = { CircuitBreaker, CircuitBreakerOpenError };
