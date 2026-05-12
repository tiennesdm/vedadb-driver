/**
 * bulk.test.js — Bulk operations tests for VedaDB Node.js driver
 */

class BulkInserter {
  constructor(client, table, columns, batchSize = 100) {
    this.client = client;
    this.table = table;
    this.columns = columns;
    this.batchSize = batchSize;
    this.buffer = [];
    this.totalSent = 0;
    this.flushes = 0;
  }

  async insert(row) {
    this.buffer.push(row);
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  async insertMany(rows) {
    for (const row of rows) {
      await this.insert(row);
    }
  }

  async flush() {
    if (this.buffer.length === 0) return 0;
    const count = this.buffer.length;
    // Mock: send to client
    this.totalSent += count;
    this.flushes++;
    this.buffer = [];
    return count;
  }

  async close() {
    return this.flush();
  }

  get pending() {
    return this.buffer.length;
  }
}

class Pipeline {
  constructor(client) {
    this.client = client;
    this.commands = [];
  }

  add(sql, params = []) {
    this.commands.push({ sql, params });
  }

  async execute() {
    const results = [];
    for (const cmd of this.commands) {
      results.push({ rowsAffected: 1 });
    }
    this.commands = [];
    return results;
  }

  get length() {
    return this.commands.length;
  }

  clear() {
    this.commands = [];
  }
}

describe('BulkInserter', () => {
  const mockClient = { query: () => Promise.resolve() };

  test('should insert single row', async () => {
    const inserter = new BulkInserter(mockClient, 'users', ['name', 'age'], 10);
    await inserter.insert({ name: 'Alice', age: 30 });
    expect(inserter.pending).toBe(1);
    expect(inserter.totalSent).toBe(0);
  });

  test('should auto-flush on batch size', async () => {
    const inserter = new BulkInserter(mockClient, 'users', ['name'], 3);
    await inserter.insert({ name: 'Alice' });
    await inserter.insert({ name: 'Bob' });
    await inserter.insert({ name: 'Charlie' });
    expect(inserter.totalSent).toBe(3);
    expect(inserter.pending).toBe(0);
  });

  test('should explicitly flush', async () => {
    const inserter = new BulkInserter(mockClient, 'users', ['name'], 100);
    for (let i = 0; i < 5; i++) {
      await inserter.insert({ name: `User${i}` });
    }
    expect(inserter.pending).toBe(5);
    await inserter.flush();
    expect(inserter.totalSent).toBe(5);
    expect(inserter.pending).toBe(0);
  });

  test('should flush remaining on close', async () => {
    const inserter = new BulkInserter(mockClient, 'users', ['name'], 100);
    for (let i = 0; i < 7; i++) {
      await inserter.insert({ id: i });
    }
    await inserter.close();
    expect(inserter.totalSent).toBe(7);
    expect(inserter.pending).toBe(0);
  });

  test('should handle batch size of 1', async () => {
    const inserter = new BulkInserter(mockClient, 'users', ['name'], 1);
    await inserter.insert({ name: 'Alice' });
    expect(inserter.totalSent).toBe(1);
  });

  test('should handle empty flush', async () => {
    const inserter = new BulkInserter(mockClient, 'users', ['name'], 10);
    const count = await inserter.flush();
    expect(count).toBe(0);
  });

  test('should insert many at once', async () => {
    const inserter = new BulkInserter(mockClient, 'users', ['name'], 50);
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    await inserter.insertMany(rows);
    await inserter.close();
    expect(inserter.totalSent).toBe(25);
  });

  test('should track flushes', async () => {
    const inserter = new BulkInserter(mockClient, 'users', ['name'], 5);
    for (let i = 0; i < 12; i++) {
      await inserter.insert({ id: i });
    }
    await inserter.close();
    expect(inserter.totalSent).toBe(12);
    expect(inserter.flushes).toBe(3); // 2 auto + 1 close
  });
});

describe('Pipeline', () => {
  const mockClient = { query: () => Promise.resolve() };

  test('should add commands', () => {
    const pipeline = new Pipeline(mockClient);
    pipeline.add('INSERT INTO users VALUES (?)', [1]);
    pipeline.add('INSERT INTO users VALUES (?)', [2]);
    expect(pipeline.length).toBe(2);
  });

  test('should execute and return results', async () => {
    const pipeline = new Pipeline(mockClient);
    pipeline.add('INSERT INTO t VALUES (1)');
    pipeline.add('INSERT INTO t VALUES (2)');
    pipeline.add('INSERT INTO t VALUES (3)');
    const results = await pipeline.execute();
    expect(results).toHaveLength(3);
    expect(results.every(r => r.rowsAffected === 1)).toBe(true);
  });

  test('should clear pipeline after execute', async () => {
    const pipeline = new Pipeline(mockClient);
    pipeline.add('INSERT INTO t VALUES (1)');
    await pipeline.execute();
    expect(pipeline.length).toBe(0);
  });

  test('should execute empty pipeline', async () => {
    const pipeline = new Pipeline(mockClient);
    const results = await pipeline.execute();
    expect(results).toHaveLength(0);
  });

  test('should clear manually', () => {
    const pipeline = new Pipeline(mockClient);
    pipeline.add('INSERT INTO t VALUES (1)');
    pipeline.add('INSERT INTO t VALUES (2)');
    pipeline.clear();
    expect(pipeline.length).toBe(0);
  });
});

module.exports = { BulkInserter, Pipeline };
