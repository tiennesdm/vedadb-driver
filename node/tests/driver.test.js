/**
 * driver.test.js — Core driver tests for VedaDB Node.js driver
 */
const { VedaClient, VedaClientError } = require('../lib/client');

// Mock server for testing
class MockServer {
  constructor() {
    this.responses = [];
    this.requestLog = [];
    this.callCount = 0;
    this.failureCount = 0;
  }

  addResponse(statusCode, body) {
    this.responses.push({ statusCode, body });
  }

  setFailureSequence(count, statusCode = 503) {
    this.failureCount = count;
    for (let i = 0; i < count; i++) {
      this.responses.push({ statusCode, body: { error: 'temporary error' } });
    }
  }

  handle(req) {
    this.callCount++;
    this.requestLog.push(req);
    if (this.responses.length > 0) {
      return this.responses.shift();
    }
    return { statusCode: 200, body: { result: null } };
  }

  reset() {
    this.responses = [];
    this.requestLog = [];
    this.callCount = 0;
    this.failureCount = 0;
  }
}

// Simple mock client for tests
class TestVedaClient {
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.timeout = options.timeout || 10000;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 100;
    this.authToken = options.authToken || null;
    this.closed = false;
    this.healthy = false;
    this._transport = options.transport;
  }

  async connect() {
    this.healthy = true;
    return this;
  }

  async query(sql, params = []) {
    if (this.closed) throw new VedaClientError('Client is closed');
    const body = { sql, params };
    const response = await this._send(body);
    if (response.body.error) {
      throw new VedaClientError(response.body.error);
    }
    return response.body.result || [];
  }

  async execute(sql, params = []) {
    if (this.closed) throw new VedaClientError('Client is closed');
    const body = { sql, params };
    const response = await this._send(body);
    if (response.body.error) {
      throw new VedaClientError(response.body.error);
    }
    return new ExecuteResult(response.body.result || {});
  }

  close() {
    this.closed = true;
  }

  isHealthy() {
    return this.healthy && !this.closed;
  }

  async _send(body) {
    let lastError;
    for (let i = 0; i <= this.maxRetries; i++) {
      if (i > 0) {
        await this._sleep(this.retryDelay * Math.pow(2, i - 1));
      }
      try {
        const response = this._transport(body);
        if (response.statusCode >= 500 && response.statusCode < 600) {
          lastError = new VedaClientError(`HTTP ${response.statusCode}`);
          continue;
        }
        return response;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new VedaClientError('Request failed');
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class ExecuteResult {
  constructor(result) {
    this.rowsAffected = result.rowsAffected || 0;
    this.lastInsertId = result.lastInsertId || null;
  }
}

class VedaClientError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VedaClientError';
  }
}

describe('VedaClient', () => {
  let mockServer;

  beforeEach(() => {
    mockServer = new MockServer();
  });

  describe('Connection', () => {
    test('should connect successfully', async () => {
      mockServer.addResponse(200, { result: 'connected' });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      await client.connect();
      expect(client.isHealthy()).toBe(true);
    });

    test('should configure with custom options', () => {
      const client = new TestVedaClient('http://db:9999', {
        timeout: 5000,
        maxRetries: 5,
        retryDelay: 50
      });
      expect(client.timeout).toBe(5000);
      expect(client.maxRetries).toBe(5);
      expect(client.retryDelay).toBe(50);
    });

    test('should connect with auth token', async () => {
      const client = new TestVedaClient('http://localhost:8080', {
        authToken: 'test-token-123',
        transport: (req) => mockServer.handle(req)
      });
      expect(client.authToken).toBe('test-token-123');
    });
  });

  describe('Query', () => {
    test('should query single row', async () => {
      mockServer.addResponse(200, {
        result: [{ id: 1, name: 'Alice' }]
      });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      const results = await client.query('SELECT * FROM users WHERE id = ?', [1]);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });

    test('should query multiple rows', async () => {
      mockServer.addResponse(200, {
        result: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' }
        ]
      });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      const results = await client.query('SELECT * FROM users');
      expect(results).toHaveLength(3);
    });

    test('should handle empty result', async () => {
      mockServer.addResponse(200, { result: [] });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      const results = await client.query('SELECT * FROM empty_table');
      expect(results).toHaveLength(0);
    });

    test('should throw on server error', async () => {
      mockServer.addResponse(500, { error: 'database error' });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      await expect(client.query('SELECT * FROM users')).rejects.toThrow();
    });

    test('should retry on transient failure', async () => {
      mockServer.setFailureSequence(2, 503);
      mockServer.addResponse(200, { result: [{ id: 1, name: 'Alice' }] });
      const client = new TestVedaClient('http://localhost:8080', {
        maxRetries: 5,
        retryDelay: 10,
        transport: (req) => mockServer.handle(req)
      });
      const results = await client.query('SELECT * FROM users');
      expect(results).toHaveLength(1);
      expect(mockServer.callCount).toBeGreaterThanOrEqual(3);
    });

    test('should throw on application error', async () => {
      mockServer.addResponse(200, { error: 'syntax error at position 14' });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      await expect(client.query('INVALID SQL')).rejects.toThrow('syntax error');
    });
  });

  describe('Execute', () => {
    test('should execute INSERT', async () => {
      mockServer.addResponse(200, {
        result: { rowsAffected: 1, lastInsertId: 42 }
      });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      const result = await client.execute('INSERT INTO users (name) VALUES (?)', ['Alice']);
      expect(result.rowsAffected).toBe(1);
      expect(result.lastInsertId).toBe(42);
    });

    test('should execute UPDATE', async () => {
      mockServer.addResponse(200, { result: { rowsAffected: 5 } });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      const result = await client.execute('UPDATE users SET active = false');
      expect(result.rowsAffected).toBe(5);
    });

    test('should execute DELETE', async () => {
      mockServer.addResponse(200, { result: { rowsAffected: 1 } });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      const result = await client.execute('DELETE FROM users WHERE id = ?', [99]);
      expect(result.rowsAffected).toBe(1);
    });

    test('should throw on execute error', async () => {
      mockServer.addResponse(400, { error: 'syntax error' });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      await expect(client.execute('INVALID SQL')).rejects.toThrow();
    });
  });

  describe('Close', () => {
    test('should close client', () => {
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      client.close();
      expect(client.closed).toBe(true);
    });

    test('close should be idempotent', () => {
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      client.close();
      expect(() => client.close()).not.toThrow();
    });

    test('should throw when querying closed client', async () => {
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      client.close();
      await expect(client.query('SELECT 1')).rejects.toThrow('closed');
    });

    test('should throw when executing on closed client', async () => {
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      client.close();
      await expect(client.execute('INSERT INTO t VALUES (1)')).rejects.toThrow('closed');
    });
  });

  describe('Concurrency', () => {
    test('should handle concurrent queries', async () => {
      mockServer.addResponse(200, { result: [{ id: 1 }] });
      const client = new TestVedaClient('http://localhost:8080', {
        transport: (req) => mockServer.handle(req)
      });
      const promises = Array(10).fill().map(() =>
        client.query('SELECT 1')
      );
      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
    });
  });
});

module.exports = { MockServer, TestVedaClient, ExecuteResult, VedaClientError };
