/**
 * pool.test.js — Connection pool tests for VedaDB Node.js driver
 */

class ConnectionPool {
  constructor(factory, options = {}) {
    this.factory = factory;
    this.maxSize = options.maxSize || 10;
    this.maxIdle = options.maxIdle || 5;
    this.waitTimeout = options.waitTimeout || 5000;
    this.available = [];
    this.allConnections = [];
    this.activeCount = 0;
    this.totalCreated = 0;
    this.closed = false;
    this.acquiring = [];
  }

  async acquire() {
    if (this.closed) throw new Error('Pool is closed');

    // Try to get from pool
    if (this.available.length > 0) {
      const conn = this.available.pop();
      conn.inUse = true;
      return conn;
    }

    // Create new if under max
    if (this.totalCreated < this.maxSize) {
      this.totalCreated++;
      const raw = this.factory();
      const conn = new PooledConnection(raw, this.totalCreated, this);
      conn.inUse = true;
      this.allConnections.push(conn);
      this.activeCount++;
      return conn;
    }

    // Wait for available connection
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Pool exhausted: wait timeout'));
      }, this.waitTimeout);

      const check = () => {
        if (this.available.length > 0) {
          clearTimeout(timer);
          const conn = this.available.pop();
          conn.inUse = true;
          resolve(conn);
        } else {
          setTimeout(check, 10);
        }
      };
      setTimeout(check, 10);
    });
  }

  release(conn) {
    conn.inUse = false;
    this.activeCount--;
    if (this.available.length < this.maxIdle) {
      this.available.push(conn);
    }
  }

  close() {
    this.closed = true;
    for (const conn of this.allConnections) {
      if (conn.close) conn.close();
    }
    this.available = [];
  }
}

class PooledConnection {
  constructor(connection, id, pool) {
    this.connection = connection;
    this.id = id;
    this.pool = pool;
    this.inUse = false;
    this.createdAt = Date.now();
  }

  release() {
    this.pool.release(this);
  }

  get isValid() {
    return !this.connection.closed;
  }
}

describe('ConnectionPool', () => {
  const mockFactory = () => ({ closed: false, query: () => Promise.resolve([]) });

  describe('Acquire', () => {
    test('should acquire new connection', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 5 });
      const conn = await pool.acquire();
      expect(conn).toBeDefined();
      expect(conn.inUse).toBe(true);
      conn.release();
      pool.close();
    });

    test('should reuse released connection', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 5 });
      const conn1 = await pool.acquire();
      const id1 = conn1.id;
      conn1.release();
      const conn2 = await pool.acquire();
      expect(conn2.id).toBe(id1);
      conn2.release();
      pool.close();
    });

    test('should track total created', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 5 });
      expect(pool.totalCreated).toBe(0);
      const conn = await pool.acquire();
      expect(pool.totalCreated).toBe(1);
      conn.release();
      pool.close();
    });
  });

  describe('Pool Exhaustion', () => {
    test('should timeout when exhausted', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 1, waitTimeout: 50 });
      const conn = await pool.acquire();
      await expect(pool.acquire()).rejects.toThrow('timeout');
      conn.release();
      pool.close();
    });

    test('should enforce max connections', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 3 });
      const conns = [];
      for (let i = 0; i < 3; i++) {
        conns.push(await pool.acquire());
      }
      expect(pool.totalCreated).toBe(3);
      for (const c of conns) c.release();
      pool.close();
    });
  });

  describe('Release', () => {
    test('should return connection to pool', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 5 });
      const conn = await pool.acquire();
      conn.release();
      const conn2 = await pool.acquire();
      expect(conn2).toBeDefined();
      conn2.release();
      pool.close();
    });
  });

  describe('Close', () => {
    test('should close pool', () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 5 });
      pool.close();
      expect(pool.closed).toBe(true);
    });

    test('should reject acquire after close', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 5 });
      pool.close();
      await expect(pool.acquire()).rejects.toThrow('closed');
    });
  });

  describe('Concurrency', () => {
    test('should handle concurrent acquire/release', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 5, waitTimeout: 1000 });
      const promises = [];

      for (let i = 0; i < 20; i++) {
        promises.push((async () => {
          const conn = await pool.acquire();
          await new Promise(r => setTimeout(r, 1));
          conn.release();
        })());
      }

      await Promise.all(promises);
      pool.close();
    });

    test('should handle stress test', async () => {
      const pool = new ConnectionPool(mockFactory, { maxSize: 5, waitTimeout: 2000 });
      const promises = [];
      let acquired = 0;

      for (let i = 0; i < 50; i++) {
        promises.push((async () => {
          try {
            const conn = await pool.acquire();
            acquired++;
            await new Promise(r => setTimeout(r, 1));
            conn.release();
          } catch (e) {
            // Expected for some
          }
        })());
      }

      await Promise.all(promises);
      expect(acquired).toBeGreaterThan(0);
      pool.close();
    });
  });
});

module.exports = { ConnectionPool, PooledConnection };
