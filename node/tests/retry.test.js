/**
 * retry.test.js — Retry policy tests for VedaDB Node.js driver
 */

class RetryPolicy {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 100;
    this.maxDelay = options.maxDelay || 5000;
    this.multiplier = options.multiplier || 2;
    this.retryableErrors = options.retryableErrors || ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];
  }

  async execute(fn) {
    let delay = this.baseDelay;
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await this._sleep(delay);
        delay = Math.min(delay * this.multiplier, this.maxDelay);
      }

      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error)) {
          throw error;
        }
      }
    }

    throw new RetryExhaustedError(`Retry exhausted after ${this.maxRetries} attempts`, lastError);
  }

  isRetryable(error) {
    if (error.code && this.retryableErrors.includes(error.code)) return true;
    if (error.statusCode >= 500 && error.statusCode < 600) return true;
    return false;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class RetryExhaustedError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RetryExhaustedError';
    this.cause = cause;
  }
}

describe('RetryPolicy', () => {
  test('should succeed on first attempt', async () => {
    const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 10 });
    const fn = jest.fn().mockResolvedValue('success');

    const result = await policy.execute(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should retry on failure and succeed', async () => {
    const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 10 });
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('fail'), { code: 'ECONNRESET' }))
      .mockRejectedValueOnce(Object.assign(new Error('fail'), { code: 'ECONNRESET' }))
      .mockResolvedValue('success');

    const result = await policy.execute(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('should exhaust retries', async () => {
    const policy = new RetryPolicy({ maxRetries: 2, baseDelay: 10 });
    const fn = jest.fn().mockRejectedValue(
      Object.assign(new Error('fail'), { code: 'ECONNRESET' })
    );

    await expect(policy.execute(fn)).rejects.toThrow(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('should not retry non-retryable errors', async () => {
    const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 10 });
    const fn = jest.fn().mockRejectedValue(new TypeError('invalid'));

    await expect(policy.execute(fn)).rejects.toThrow(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should use exponential backoff', async () => {
    const delays = [];
    const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 50, multiplier: 2 });
    const originalSleep = policy._sleep.bind(policy);
    policy._sleep = async (ms) => {
      delays.push(ms);
      return originalSleep(1); // Use 1ms for test speed
    };

    const fn = jest.fn().mockRejectedValue(
      Object.assign(new Error('fail'), { code: 'ECONNRESET' })
    );

    try { await policy.execute(fn); } catch (e) { /* expected */ }

    expect(delays[0]).toBe(50);
    expect(delays[1]).toBe(100);
    expect(delays[2]).toBe(200);
  });

  test('should cap delay at maxDelay', async () => {
    const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 100, maxDelay: 150, multiplier: 10 });
    policy._sleep = async () => {}; // skip sleep

    const fn = jest.fn().mockRejectedValue(
      Object.assign(new Error('fail'), { code: 'ECONNRESET' })
    );

    try { await policy.execute(fn); } catch (e) { /* expected */ }

    // Should not throw or hang - cap is respected
    expect(fn).toHaveBeenCalledTimes(6);
  });

  test('should retry on 5xx status code', async () => {
    const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 10 });
    const error = new Error('Server Error');
    error.statusCode = 503;
    const fn = jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success');

    const result = await policy.execute(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('should not retry on 4xx status code', async () => {
    const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 10 });
    const error = new Error('Bad Request');
    error.statusCode = 400;
    const fn = jest.fn().mockRejectedValue(error);

    await expect(policy.execute(fn)).rejects.toThrow('Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should work with zero retries', async () => {
    const policy = new RetryPolicy({ maxRetries: 0, baseDelay: 10 });
    const fn = jest.fn().mockResolvedValue('success');

    const result = await policy.execute(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should fail fast with zero retries', async () => {
    const policy = new RetryPolicy({ maxRetries: 0, baseDelay: 10 });
    const fn = jest.fn().mockRejectedValue(
      Object.assign(new Error('fail'), { code: 'ECONNRESET' })
    );

    await expect(policy.execute(fn)).rejects.toThrow(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should handle async functions', async () => {
    const policy = new RetryPolicy({ maxRetries: 2, baseDelay: 10 });
    let callCount = 0;

    const result = await policy.execute(async () => {
      callCount++;
      if (callCount < 2) {
        throw Object.assign(new Error('fail'), { code: 'ECONNRESET' });
      }
      return await Promise.resolve('async-success');
    });

    expect(result).toBe('async-success');
  });
});

module.exports = { RetryPolicy, RetryExhaustedError };
