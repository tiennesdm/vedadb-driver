'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { VBPConnection, VBPError, VBPConnectionError } = require('../../../src/wire/vbp');

// Helper: a fake server that speaks a minimal VBP handshake so
// we don't depend on vbp_dev_server for unit tests.
function startFakeServer(onFrame, port = 0) {
  return new Promise((resolve) => {
    const sockets = [];
    const srv = net.createServer((sock) => {
      sockets.push(sock);
      let buf = Buffer.alloc(0);
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        // Try to decode any complete frames
        while (buf.length >= 8) {
          const magic = buf.subarray(0, 3);
          if (!magic.equals(Buffer.from('VDB', 'ascii'))) {
            sock.destroy();
            return;
          }
          const plen = buf.readUInt32LE(3);
          if (plen < 2 || plen > 64 * 1024 * 1024) { sock.destroy(); return; }
          if (buf.length < 8 + plen) return;
          const seq = buf[7];
          const op = buf[8];
          const flags = buf[9];
          const body = buf.subarray(10, 8 + plen);
          buf = buf.subarray(8 + plen);
          onFrame(sock, { seq, op, flags, body });
        }
      });
    });
    srv.listen(port, '127.0.0.1', () => {
      // Wrap srv.close to also destroy all accepted client sockets,
      // so the test process can exit cleanly even if a client left a
      // socket half-open.
      const origClose = srv.close.bind(srv);
      srv.close = async (cb) => {
        for (const s of sockets) {
          try { s.destroy(); } catch (_) { /* ignore */ }
        }
        const ret = origClose();
        if (ret && typeof ret.then === 'function') {
          await ret;
        }
        if (cb) cb();
      };
      resolve({ srv, port: srv.address().port });
    });
  });
}

async function closeServer(srv) {
  if (srv && typeof srv.close === 'function') {
    const ret = srv.close();
    if (ret && typeof ret.then === 'function') await ret;
  }
}

function writeFrame(sock, seq, op, flags, body) {
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
  const frame = Buffer.alloc(8 + 2 + bodyBuf.length);
  frame.write('VDB', 0, 3, 'ascii');
  frame.writeUInt32LE(2 + bodyBuf.length, 3);
  frame[7] = seq;
  frame[8] = op;
  frame[9] = flags;
  bodyBuf.copy(frame, 10);
  sock.write(frame);
}

test('connection: connect() + ping() against fake server', async () => {
  const { srv, port } = await startFakeServer((sock, frame) => {
    if (frame.op === 0x01) {
      // CLIENT_HELLO → SERVER_READY + AUTH_OK
      writeFrame(sock, frame.seq, 0x02, 0, Buffer.alloc(29, 0));
      writeFrame(sock, 0x00, 0x05, 0, Buffer.alloc(20, 0));
    } else if (frame.op === 0x16) {
      // PING → PONG
      writeFrame(sock, frame.seq, 0x17, 0, frame.body.subarray(0, 8));
    }
  });
  try {
    const conn = new VBPConnection({ host: '127.0.0.1', port, user: 'admin', password: 'x' });
    await conn.connect();
    const nonce = await conn.ping();
    assert.ok(typeof nonce === 'number');
    await conn.close();
  } finally {
    await closeServer(srv);
  }
});

test('connection: execute(SELECT 1) against fake server returns rows', async () => {
  const { srv, port } = await startFakeServer((sock, frame) => {
    if (frame.op === 0x01) {
      writeFrame(sock, frame.seq, 0x02, 0, Buffer.alloc(29, 0));
      writeFrame(sock, 0x00, 0x05, 0, Buffer.alloc(20, 0));
    } else if (frame.op === 0x06) {
      // QUERY → DATA_CHUNK (1 row, 1 col T_INT4=23) + ROWS_FINISHED + COMMAND_COMPLETE
      const dataBody = Buffer.alloc(17);
      dataBody.writeUInt32LE(1, 0);  // chunk_id
      dataBody.writeUInt32LE(1, 4);  // row_count
      dataBody.writeUInt16LE(1, 8);  // col_count
      dataBody.writeUInt16LE(23, 10); // type_id T_INT4
      dataBody.writeUInt8(0, 12);    // bitmap_count
      dataBody.writeInt32LE(42, 13); // value
      writeFrame(sock, frame.seq, 0x0A, 0, dataBody);
      const tag = Buffer.from('SELECT 1', 'utf-8');
      const rfBody = Buffer.alloc(8 + 4 + tag.length + 4);
      rfBody.writeBigUInt64LE(1n, 0);
      rfBody.writeUInt32LE(tag.length, 8);
      tag.copy(rfBody, 12);
      writeFrame(sock, frame.seq, 0x0B, 0, rfBody);
      writeFrame(sock, frame.seq, 0x0C, 0, Buffer.from([0]));
    }
  });
  try {
    const conn = new VBPConnection({ host: '127.0.0.1', port, user: 'admin', password: 'x' });
    await conn.connect();
    const r = await conn.execute('SELECT 1');
    assert.strictEqual(r.rows.length, 1);
    assert.deepStrictEqual(r.rows[0], [42]);
    assert.strictEqual(r.commandTag, 'SELECT 1');
    await conn.close();
  } finally {
    await closeServer(srv);
  }
});

test('connection: execute before connect throws VBPConnectionError', async () => {
  const conn = new VBPConnection({ host: '127.0.0.1', port: 1 });
  await assert.rejects(() => conn.execute('SELECT 1'), VBPConnectionError);
});

test('connection: ERROR frame on QUERY throws VBPError', async () => {
  const { srv, port } = await startFakeServer((sock, frame) => {
    if (frame.op === 0x01) {
      writeFrame(sock, frame.seq, 0x02, 0, Buffer.alloc(29, 0));
      writeFrame(sock, 0x00, 0x05, 0, Buffer.alloc(20, 0));
    } else if (frame.op === 0x06) {
      // ERROR: sqlstate 42601, msg 'syntax error'
      const errBody = Buffer.concat([
        Buffer.from('42601', 'ascii'),
        Buffer.from([12, 0, 0, 0]),
        Buffer.from('syntax error'),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from([0, 0, 0, 0]),
      ]);
      writeFrame(sock, frame.seq, 0x0D, 0, errBody);
    }
  });
  try {
    const conn = new VBPConnection({ host: '127.0.0.1', port, user: 'admin', password: 'x' });
    await conn.connect();
    await assert.rejects(() => conn.execute('BAD SQL'), VBPError);
    await conn.close();
  } finally {
    await closeServer(srv);
  }
});

test('connection: close is idempotent', async () => {
  const { srv, port } = await startFakeServer((sock, frame) => {
    if (frame.op === 0x01) {
      writeFrame(sock, frame.seq, 0x02, 0, Buffer.alloc(29, 0));
      writeFrame(sock, 0x00, 0x05, 0, Buffer.alloc(20, 0));
    }
  });
  try {
    const conn = new VBPConnection({ host: '127.0.0.1', port, user: 'admin', password: 'x' });
    await conn.connect();
    await conn.close();
    await conn.close();
  } finally {
    await closeServer(srv);
  }
});

test('connection: connect is idempotent', async () => {
  const { srv, port } = await startFakeServer((sock, frame) => {
    if (frame.op === 0x01) {
      writeFrame(sock, frame.seq, 0x02, 0, Buffer.alloc(29, 0));
      writeFrame(sock, 0x00, 0x05, 0, Buffer.alloc(20, 0));
    }
  });
  try {
    const conn = new VBPConnection({ host: '127.0.0.1', port, user: 'admin', password: 'x' });
    await conn.connect();
    await conn.connect(); // no-op
    await conn.close();
  } finally {
    await closeServer(srv);
  }
});

test('connection: unsupported auth mechanism string defaults to PLAIN', async () => {
  // Set VEDADB_VBP_MECH to something; connection should still work
  // because PLAIN is the default.
  const origEnv = process.env.VEDADB_VBP_MECH;
  process.env.VEDADB_VBP_MECH = 'BOGUS';
  const { srv, port } = await startFakeServer((sock, frame) => {
    if (frame.op === 0x01) {
      writeFrame(sock, frame.seq, 0x02, 0, Buffer.alloc(29, 0));
      writeFrame(sock, 0x00, 0x05, 0, Buffer.alloc(20, 0));
    }
  });
  try {
    const conn = new VBPConnection({ host: '127.0.0.1', port, user: 'admin', password: 'x' });
    await conn.connect();
    await conn.close();
  } finally {
    await closeServer(srv);
    if (origEnv === undefined) delete process.env.VEDADB_VBP_MECH;
    else process.env.VEDADB_VBP_MECH = origEnv;
  }
});

test('connection: dev-mode auth (no user) works without AUTH_RESPONSE', async () => {
  const { srv, port } = await startFakeServer((sock, frame) => {
    if (frame.op === 0x01) {
      // Server includes AUTH_OK in hello reply — no further auth required.
      writeFrame(sock, frame.seq, 0x02, 0, Buffer.alloc(29, 0));
      writeFrame(sock, 0x00, 0x05, 0, Buffer.alloc(20, 0));
    }
  });
  try {
    const conn = new VBPConnection({ host: '127.0.0.1', port });
    await conn.connect();
    await conn.close();
  } finally {
    await closeServer(srv);
  }
});

test('connection: dev-mode auth with empty user string still works', async () => {
  const { srv, port } = await startFakeServer((sock, frame) => {
    if (frame.op === 0x01) {
      writeFrame(sock, frame.seq, 0x02, 0, Buffer.alloc(29, 0));
      writeFrame(sock, 0x00, 0x05, 0, Buffer.alloc(20, 0));
    }
  });
  try {
    const conn = new VBPConnection({ host: '127.0.0.1', port, user: '', password: '' });
    await conn.connect();
    await conn.close();
  } finally {
    await closeServer(srv);
  }
});
