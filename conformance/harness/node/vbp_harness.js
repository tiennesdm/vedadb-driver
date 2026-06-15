#!/usr/bin/env node
// vbp_harness.js — VBP v1 conformance skeleton harness (Node.js).
//
// Loads conformance/vbp_suite.yaml using only stdlib (Node 18+ has
// no built-in YAML parser, so this skeleton uses a small block-style
// parser that handles the structure of vbp_suite.yaml).
//
// Iterates every test, emits a JUnit XML report, and SKIPs all
// tests. Exit code 0 on success, 1 on any FAIL/ERROR.
//
// Usage:
//
//   node vbp_harness.js \
//     --suite ../../vbp_suite.yaml \
//     --addr  127.0.0.1:6380 \
//     --out   ./vbp-conformance-node.junit.xml

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Tiny block-style YAML loader (stdlib-only).
// Mirrors the structure of the python skeleton's _flat_yaml_load —
// both languages share the constraint of "no extra deps".
// ---------------------------------------------------------------------------

function parseScalar(v) {
  if (v === '' || v == null) return null;
  const low = String(v).toLowerCase();
  if (low === 'true') return true;
  if (low === 'false') return false;
  if (low === 'null' || low === '~') return null;
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(p => parseScalar(p.trim()));
  }
  if (v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return {};
    const out = {};
    for (const pair of inner.split(',')) {
      const ix = pair.indexOf(':');
      if (ix < 0) continue;
      out[pair.slice(0, ix).trim()] = parseScalar(pair.slice(ix + 1).trim());
    }
    return out;
  }
  const asInt = Number(v);
  if (Number.isInteger(asInt)) return asInt;
  const asFloat = Number(v);
  if (!Number.isNaN(asFloat)) return asFloat;
  return v;
}

function loadYaml(file) {
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  const out = {};
  const tests = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    const s = line.trim();
    if (!s || s.startsWith('#')) { i++; continue; }
    // Compute the indent of the *non-blank* current line. We only
    // treat a `- ` as a top-level test marker when its indent is 2
    // (the suite uses 2-space indent under `tests:`).
    const indent = line.length - line.replace(/^\s+/, '').length;
    if (s.startsWith('- ') && indent === 2) {
      const cur = {};
      const first = s.slice(2).trim();
      if (first.includes(':')) {
        const [k, ...rest] = first.split(':');
        cur[k.trim()] = parseScalar(rest.join(':').trim());
      }
      i++;
      while (i < lines.length) {
        const nxt = lines[i];
        if (!nxt.trim()) { i++; continue; }
        const stripped = nxt.replace(/^\s+/, '');
        const ix = nxt.length - stripped.length;
        // A same-level (indent==2) `- ` starts a new test.
        if (ix === 2 && stripped.startsWith('- ')) break;
        // An indent-0 (or empty) line ends the test block.
        if (ix === 0 && stripped) break;
        if (stripped.includes(':')) {
          const [k, ...rest] = stripped.split(':');
          cur[k.trim()] = parseScalar(rest.join(':').trim());
        }
        i++;
      }
      tests.push(cur);
      continue;
    }
    if (s.includes(':') && indent === 0) {
      const [k, ...rest] = s.split(':');
      out[k.trim()] = parseScalar(rest.join(':').trim());
    }
    i++;
  }
  if (tests.length) out.tests = tests;
  return out;
}

// ---------------------------------------------------------------------------
// JUnit emit
// ---------------------------------------------------------------------------

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function writeJUnit(outcomes, outPath, suiteName) {
  const byCat = {};
  for (const o of outcomes) {
    (byCat[o.category] = byCat[o.category] || []).push(o);
  }
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<testsuites>'];
  for (const cat of Object.keys(byCat).sort()) {
    const oo = byCat[cat];
    const totalDur = oo.reduce((a, b) => a + b.duration, 0);
    const fails = oo.filter(x => x.status === 'fail').length;
    const skips = oo.filter(x => x.status === 'skip').length;
    const errs  = oo.filter(x => x.status === 'error').length;
    lines.push(`  <testsuite name="${xmlEscape(cat)}" tests="${oo.length}" failures="${fails}" skipped="${skips}" errors="${errs}" time="${totalDur.toFixed(3)}">`);
    for (const o of oo) {
      lines.push(`    <testcase classname="${xmlEscape(suiteName)}" name="${xmlEscape(o.id + ' ' + o.name)}" time="${o.duration.toFixed(3)}">`);
      if (o.status === 'fail') {
        lines.push(`      <failure>${xmlEscape(o.message)}</failure>`);
      } else if (o.status === 'skip') {
        lines.push(`      <skipped>${xmlEscape(o.message)}</skipped>`);
      } else if (o.status === 'error') {
        lines.push(`      <error>${xmlEscape(o.message)}</error>`);
      }
      lines.push(`    </testcase>`);
    }
    lines.push(`  </testsuite>`);
  }
  lines.push('</testsuites>');
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Test runner (skeleton — all SKIP)
// ---------------------------------------------------------------------------

function runTest(t /*, addr, user, pass */) {
  return {
    id: t.id || 0,
    name: t.name || 'unknown',
    category: t.category || 'unknown',
    status: 'skip',
    message: 'Node harness: skeleton — no test cases driven end-to-end (TODO: port vbp_harness.go to node)',
    duration: 0,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const opts = {
    suite: 'conformance/vbp_suite.yaml',
    addr: '127.0.0.1:6380',
    out: 'vbp-conformance-node.junit.xml',
    user: 'admin',
    pass: 'TestPassword123!',
    category: '',
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    switch (k) {
      case '--suite':    opts.suite = v; i++; break;
      case '--addr':     opts.addr = v; i++; break;
      case '--out':      opts.out = v; i++; break;
      case '--user':     opts.user = v; i++; break;
      case '--pass':     opts.pass = v; i++; break;
      case '--category': opts.category = v; i++; break;
    }
  }

  if (!fs.existsSync(opts.suite)) {
    console.error(`ERROR: suite file not found: ${opts.suite}`);
    process.exit(2);
  }

  const suite = loadYaml(opts.suite);
  let tests = suite.tests || [];
  if (opts.category) tests = tests.filter(t => t.category === opts.category);
  const suiteName = suite.suite || 'vbp-conformance-v1';

  const outcomes = tests.map(t => runTest(t, opts.addr, opts.user, opts.pass));

  try {
    writeJUnit(outcomes, opts.out, suiteName);
  } catch (e) {
    console.error(`ERROR: write JUnit: ${e.message}`);
    process.exit(2);
  }

  const passN = outcomes.filter(o => o.status === 'pass').length;
  const failN = outcomes.filter(o => o.status === 'fail').length;
  const skipN = outcomes.filter(o => o.status === 'skip').length;
  const errN  = outcomes.filter(o => o.status === 'error').length;
  console.log('VBP v1 conformance (Node skeleton)');
  console.log(`  tests:  ${outcomes.length}`);
  console.log(`  pass:   ${passN}`);
  console.log(`  fail:   ${failN}`);
  console.log(`  skip:   ${skipN}`);
  console.log(`  error:  ${errN}`);
  console.log(`  report: ${opts.out}`);
  process.exit((failN + errN) > 0 ? 1 : 0);
}

main();
