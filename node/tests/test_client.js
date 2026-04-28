/**
 * VedaDB Node.js Driver - Unit Tests
 *
 * These tests verify the client and pool logic without requiring a live
 * server by using a lightweight TCP mock.
 *
 * Run:  node tests/test_client.js
 */

const net = require('net');
const {
  VedaDB,
  VedaDBError,
  ConnectionError,
  QueryError,
  TimeoutError,
  Result,
  VedaPool,
  createClient,
  escapeValue,
} = require('../index');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
  }
}

/**
 * Create a mock VedaDB TCP server that replies with JSON lines.
 * `handler` receives the query string and returns a response object.
 */
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.setEncoding('utf-8');
      // Send welcome banner
      socket.write('Welcome to VedaDB v0.1.0\n');

      let buf = '';
      socket.on('data', (data) => {
        buf += data;
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const query = buf.substring(0, idx).trim();
          buf = buf.substring(idx + 1);
          if (query === 'QUIT') {
            socket.end();
            return;
          }
          const response = handler(query);
          socket.write(JSON.stringify(response) + '\n');
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests: escapeValue
// ---------------------------------------------------------------------------

function testEscapeValue() {
  console.log('\n--- escapeValue ---');
  assertEqual(escapeValue(null), 'NULL', 'null => NULL');
  assertEqual(escapeValue(undefined), 'NULL', 'undefined => NULL');
  assertEqual(escapeValue(true), 'TRUE', 'true => TRUE');
  assertEqual(escapeValue(false), 'FALSE', 'false => FALSE');
  assertEqual(escapeValue(42), '42', 'number => string');
  assertEqual(escapeValue(3.14), '3.14', 'float => string');
  assertEqual(escapeValue('hello'), "'hello'", 'string => quoted');
  assertEqual(escapeValue("it's"), "'it''s'", "single quotes doubled");
  assertEqual(escapeValue({ a: 1 }), "'{\"a\":1}'", 'object => JSON string');
}

// ---------------------------------------------------------------------------
// Tests: Result
// ---------------------------------------------------------------------------

function testResult() {
  console.log('\n--- Result ---');

  const r = new Result({
    columns: ['id', 'name', 'age'],
    rows: [['1', 'Alice', '30'], ['2', 'Bob', '25']],
    row_count: 2,
    message: 'OK',
  });

  assertEqual(r.columns.length, 3, 'columns count');
  assertEqual(r.rowCount, 2, 'rowCount');
  assertEqual(r.message, 'OK', 'message');

  const objs = r.toObjects();
  assertEqual(objs.length, 2, 'toObjects length');
  assertEqual(objs[0].name, 'Alice', 'toObjects[0].name');
  assertEqual(objs[1].age, '25', 'toObjects[1].age');

  const first = r.first();
  assertEqual(first.id, '1', 'first().id');

  const names = r.pluck('name');
  assertEqual(names, ['Alice', 'Bob'], 'pluck(name)');

  const empty = new Result({});
  assertEqual(empty.first(), null, 'empty result first() => null');
  assertEqual(empty.pluck('x'), [], 'empty result pluck => []');
}

// ---------------------------------------------------------------------------
// Tests: Error hierarchy
// ---------------------------------------------------------------------------

function testErrors() {
  console.log('\n--- Error hierarchy ---');

  const ve = new VedaDBError('base');
  assert(ve instanceof Error, 'VedaDBError is Error');
  assertEqual(ve.name, 'VedaDBError', 'VedaDBError name');

  const ce = new ConnectionError('conn');
  assert(ce instanceof VedaDBError, 'ConnectionError extends VedaDBError');
  assert(ce instanceof Error, 'ConnectionError is Error');
  assertEqual(ce.name, 'ConnectionError', 'ConnectionError name');

  const qe = new QueryError('query');
  assert(qe instanceof VedaDBError, 'QueryError extends VedaDBError');
  assertEqual(qe.name, 'QueryError', 'QueryError name');

  const te = new TimeoutError();
  assert(te instanceof VedaDBError, 'TimeoutError extends VedaDBError');
  assertEqual(te.name, 'TimeoutError', 'TimeoutError name');
}

// ---------------------------------------------------------------------------
// Tests: VedaDB client against mock server
// ---------------------------------------------------------------------------

async function testClient() {
  console.log('\n--- VedaDB Client ---');

  const { server, port } = await createMockServer((query) => {
    if (query.startsWith('SELECT')) {
      return {
        columns: ['id', 'name'],
        rows: [['1', 'Alice'], ['2', 'Bob']],
        row_count: 2,
      };
    }
    if (query.startsWith('INSERT') || query.startsWith('UPDATE') || query.startsWith('DELETE')) {
      return { message: '1 row affected', row_count: 1 };
    }
    if (query.startsWith('CREATE')) {
      return { message: 'Table created' };
    }
    if (query.startsWith('SHOW')) {
      return { columns: ['table_name'], rows: [['users']], row_count: 1 };
    }
    if (query.startsWith('BAD')) {
      return { error: 'Syntax error near BAD' };
    }
    if (query.startsWith('BEGIN') || query.startsWith('COMMIT') || query.startsWith('ROLLBACK')) {
      return { message: 'OK' };
    }
    if (query.startsWith('CACHE')) {
      return { message: 'OK' };
    }
    return { message: 'OK' };
  });

  const db = new VedaDB({ host: '127.0.0.1', port });
  assert(!db.connected, 'not connected before connect()');

  await db.connect();
  assert(db.connected, 'connected after connect()');

  // query
  const result = await db.query('SELECT * FROM users;');
  assert(result instanceof Result, 'query returns Result');
  assertEqual(result.rowCount, 2, 'query rowCount');
  assertEqual(result.toObjects()[0].name, 'Alice', 'query toObjects');

  // exec
  const msg = await db.exec('INSERT INTO users (name) VALUES (\'Carol\');');
  assertEqual(msg, '1 row affected', 'exec message');

  // insert helper
  const insertMsg = await db.insert('users', { name: 'Dave', age: 40 });
  assertEqual(insertMsg, '1 row affected', 'insert helper');

  // select helper
  const selResult = await db.select('users', {
    columns: ['id', 'name'],
    where: { age: 30 },
    orderBy: 'name',
    limit: 10,
  });
  assertEqual(selResult.rowCount, 2, 'select helper rowCount');

  // update helper
  const updMsg = await db.update('users', { name: 'Updated' }, { id: 1 });
  assertEqual(updMsg, '1 row affected', 'update helper');

  // deleteFrom helper
  const delMsg = await db.deleteFrom('users', { id: 2 });
  assertEqual(delMsg, '1 row affected', 'deleteFrom helper');

  // createTable
  const createMsg = await db.createTable('CREATE TABLE t (id INT);');
  assertEqual(createMsg, 'Table created', 'createTable');

  // ping
  const pong = await db.ping();
  assert(pong === true, 'ping returns true');

  // error handling
  try {
    await db.query('BAD QUERY;');
    assert(false, 'should have thrown QueryError');
  } catch (e) {
    assert(e instanceof QueryError, 'QueryError thrown for bad query');
    assert(e.message.includes('Syntax error'), 'QueryError message');
  }

  // transaction
  const txResult = await db.transaction(async (client) => {
    await client.exec('INSERT INTO users (name) VALUES (\'TxUser\');');
    return 'done';
  });
  assertEqual(txResult, 'done', 'transaction returns value');

  db.close();
  assert(!db.connected, 'disconnected after close()');

  server.close();
}

// ---------------------------------------------------------------------------
// Tests: VedaDB - not connected
// ---------------------------------------------------------------------------

async function testNotConnected() {
  console.log('\n--- Not connected errors ---');

  const db = new VedaDB({ host: '127.0.0.1', port: 1 });

  try {
    await db.query('SELECT 1;');
    assert(false, 'should throw when not connected');
  } catch (e) {
    assert(e instanceof ConnectionError, 'ConnectionError when not connected');
  }
}

// ---------------------------------------------------------------------------
// Tests: VedaPool
// ---------------------------------------------------------------------------

async function testPool() {
  console.log('\n--- VedaPool ---');

  const { server, port } = await createMockServer((query) => {
    if (query.startsWith('SELECT')) {
      return { columns: ['x'], rows: [['42']], row_count: 1 };
    }
    if (query.startsWith('SHOW')) {
      return { columns: ['table_name'], rows: [], row_count: 0 };
    }
    return { message: 'OK' };
  });

  const pool = new VedaPool({ host: '127.0.0.1', port, min: 1, max: 3 });
  assertEqual(pool.size, 0, 'initial size = 0');

  // acquire / release
  const client = await pool.acquire();
  assert(client instanceof VedaDB, 'acquire returns VedaDB');
  assert(client.connected, 'acquired client is connected');
  assertEqual(pool.activeCount, 1, 'activeCount = 1');

  pool.release(client);
  assertEqual(pool.activeCount, 0, 'activeCount after release = 0');
  assertEqual(pool.idleCount, 1, 'idleCount after release = 1');

  // pool.query convenience
  const result = await pool.query('SELECT 42;');
  assertEqual(result.rows[0][0], '42', 'pool.query works');

  // pool.exec convenience
  const msg = await pool.exec('CREATE TABLE test (id INT);');
  assertEqual(msg, 'OK', 'pool.exec works');

  // acquire multiple up to max
  const c1 = await pool.acquire();
  const c2 = await pool.acquire();
  const c3 = await pool.acquire();
  assertEqual(pool.activeCount, 3, '3 active connections');

  // next acquire should wait (and timeout)
  const poolTimeout = new VedaPool({
    host: '127.0.0.1', port, max: 0, acquireTimeout: 100,
  });
  try {
    await poolTimeout.acquire();
    assert(false, 'should timeout');
  } catch (e) {
    assert(e instanceof ConnectionError, 'acquire timeout is ConnectionError');
    assert(e.message.includes('Acquire timeout'), 'timeout message');
  }
  poolTimeout.close();

  pool.release(c1);
  pool.release(c2);
  pool.release(c3);

  // close
  pool.close();
  assertEqual(pool.idleCount, 0, 'idle after close = 0');

  // acquire after close
  try {
    await pool.acquire();
    assert(false, 'should reject after close');
  } catch (e) {
    assert(e instanceof ConnectionError, 'acquire after close throws');
  }

  server.close();
}

// ---------------------------------------------------------------------------
// Tests: createClient factory
// ---------------------------------------------------------------------------

async function testCreateClient() {
  console.log('\n--- createClient ---');

  const { server, port } = await createMockServer(() => {
    return { message: 'OK' };
  });

  const db = await createClient({ host: '127.0.0.1', port });
  assert(db instanceof VedaDB, 'createClient returns VedaDB');
  assert(db.connected, 'createClient auto-connects');
  db.close();
  server.close();
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

async function main() {
  console.log('VedaDB Node.js Driver Tests\n===========================');

  testEscapeValue();
  testResult();
  testErrors();
  await testNotConnected();
  await testClient();
  await testPool();
  await testCreateClient();

  console.log(`\n===========================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
