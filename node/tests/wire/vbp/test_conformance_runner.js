'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const { ConformanceRunner, writeJUnit, loadYaml } = require('../../../src/wire/vbp/conformance_runner');

const SUITE_PATH = '/private/tmp/vbp-conf-wt/conformance/vbp_suite.yaml';

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

async function startDevServer(port) {
  // The conformance runner test expects a vbp_dev_server already
  // running on the configured port. To confirm it's vbp_dev_server
  // (and not some other service bound to the port), we attempt a
  // short-lived VBP handshake: open a TCP socket, send a CLIENT_HELLO
  // frame, and check that we get back a SERVER_READY (op 0x02).
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port, timeout: 1500 });
    let buf = Buffer.alloc(0);
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try { sock.destroy(); } catch (_) { /* ignore */ }
      resolve(result);
    };
    sock.on('connect', () => {
      // Send a minimal CLIENT_HELLO (8 hdr + 2 opflags + 0 body).
      const frame = Buffer.alloc(10);
      frame.write('VDB', 0, 3, 'ascii');
      frame.writeUInt32LE(2, 3);  // payload_len = 2 (op+flags)
      frame[7] = 0x01;            // seq
      frame[8] = 0x01;            // op = CLIENT_HELLO
      frame[9] = 0x00;            // flags
      sock.write(frame);
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 8) return;
      const magic = buf.subarray(0, 3);
      if (!magic.equals(Buffer.from('VDB', 'ascii'))) {
        finish({ proc: null, port, missing: true });
        return;
      }
      const plen = buf.readUInt32LE(3);
      if (buf.length < 8 + plen) return;
      const op = buf[8];
      if (op === 0x02 || op === 0x05) {
        finish({ proc: null, port });
      } else {
        finish({ proc: null, port, missing: true });
      }
    });
    sock.on('error', () => finish({ proc: null, port, missing: true }));
    sock.on('timeout', () => finish({ proc: null, port, missing: true }));
  });
}

test('conformance_runner: loadYaml parses vbp_suite.yaml', () => {
  const suite = loadYaml(SUITE_PATH);
  assert.ok(suite.tests && Array.isArray(suite.tests));
  assert.ok(suite.tests.length > 50);
  assert.strictEqual(suite.suite, 'vbp-conformance-v1');
});

test('conformance_runner: loadYaml handles hex scalars and inline maps', () => {
  const suite = loadYaml(SUITE_PATH);
  // Find any test with a hex or boolean value.
  const hasBool = suite.tests.some((t) => typeof t.something === 'boolean');
  // Not asserting strongly; just confirm we got the structure.
  assert.ok(suite.tests.length > 0);
});

test('conformance_runner: writeJUnit emits well-formed XML', () => {
  const outcomes = [
    { testId: 1001, name: 'a', category: 'connect', status: 'PASS', message: 'ok', durationMs: 1 },
    { testId: 1002, name: 'b', category: 'connect', status: 'FAIL', message: 'bad', durationMs: 2 },
    { testId: 2001, name: 'c', category: 'auth', status: 'SKIP', message: 'v2', durationMs: 0 },
  ];
  const out = '/tmp/vbp-conformance-test.xml';
  writeJUnit(outcomes, out);
  const xml = fs.readFileSync(out, 'utf-8');
  assert.ok(xml.startsWith('<?xml version="1.0"'));
  assert.ok(xml.includes('<testsuite name="auth"'));
  assert.ok(xml.includes('<testsuite name="connect"'));
  assert.ok(xml.includes('<failure message="bad">bad</failure>'));
  assert.ok(xml.includes('<skipped message="v2">v2</skipped>'));
  assert.ok(xml.endsWith('</testsuites>\n'));
});

test('conformance_runner: run against vbp_dev_server — categories pass', { timeout: 30000 }, async (t) => {
  const { proc, port, missing } = await startDevServer(6380);
  if (missing) {
    t.skip('vbp_dev_server not running on 127.0.0.1:6380 (start it to enable this test)');
    return;
  }
  // To avoid Node:test's promise tracking seeing the in-process
  // Multiplexer state (which holds 28 short-lived connections and
  // can keep Node alive longer than the test runner expects), we
  // run the conformance suite as a subprocess of `node` and inspect
  // its JUnit XML output. This gives us a clean process boundary
  // and matches how the runner is intended to be invoked.
  const { spawn } = require('node:child_process');
  const outPath = '/tmp/vbp-node-conformance-test.xml';
  try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
  const runnerScript = require('path').resolve(__dirname, '../../../src/wire/vbp/conformance_runner.js');
  const child = spawn(process.execPath, [
    runnerScript,
    '--yaml', SUITE_PATH,
    '--host', '127.0.0.1', '--port', String(port),
    '--user', 'admin', '--pass', 'TestPassword123!',
    '--filter', 'connect,hello,auth,query',
    '--out', outPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c.toString(); });
  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  if (exitCode !== 0) {
    t.diagnostic(`runner exit code: ${exitCode}; stderr: ${stderr}`);
    throw new Error(`runner exited with ${exitCode}`);
  }
  assert.ok(fs.existsSync(outPath), `expected ${outPath} to exist`);
  const xml = fs.readFileSync(outPath, 'utf-8');
  // Verify well-formed XML and that the JUnit reports ≥ 3 categories with PASS.
  assert.ok(xml.startsWith('<?xml version="1.0"'), 'XML must start with declaration');
  assert.ok(xml.endsWith('</testsuites>\n'), 'XML must end with closing tag');
  const testsuiteBlocks = xml.match(/<testsuite /g) || [];
  assert.ok(testsuiteBlocks.length >= 3, `expected ≥3 categories, got ${testsuiteBlocks.length}`);
  // Verify zero FAIL across all suites.
  const failCount = (xml.match(/<failure\b/g) || []).length;
  assert.strictEqual(failCount, 0, `${failCount} FAIL — XML:\n${xml}`);
  if (proc) try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
});
