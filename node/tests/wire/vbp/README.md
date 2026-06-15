# VBP v1 Conformance Test Suite (Node.js)

The VBP (VedaDB Binary Protocol) v1 transport is a parallel wire to
the existing HTTP/JSON-lines driver. This directory contains:

- `test_frame.js` — frame encode/decode round-trips, error paths.
- `test_opcodes.js` — opcode + type-ID constants and registry checks.
- `test_types.js` — per-type encode/decode round-trips for all 36
  type IDs.
- `test_multiplexer.js` — seq allocation, dispatch, unsolicited
  frame routing, timeout, error frame rejection.
- `test_handlers.js` — all 23 mandatory opcodes have a registered
  handler; stubs return 0A000 errors.
- `test_auth.js` — PLAIN format + SCRAM-SHA-256 client (RFC 5802
  client-first / client-final flow).
- `test_connection.js` — `VBPConnection.connect()`, `execute()`,
  `ping()`, `close()` against a fake TCP server (no dev_server
  dependency).
- `test_conformance_runner.js` — `loadYaml`, `writeJUnit`, and a
  live round-trip against `vbp_dev_server` (when available).

## Run

```bash
node --test tests/wire/vbp/
```

or via npm:

```bash
cd node && npm run test:vbp
```

The conformance runner test in `test_conformance_runner.js` will
spawn `vbp_dev_server` on port 6380 if not already running. If
`vbp_dev_server` is not on disk, the test will be skipped (no FAIL).

## Conformance runner (CLI)

```bash
node src/wire/vbp/conformance_runner.js \
  --yaml /private/tmp/vbp-conf-wt/conformance/vbp_suite.yaml \
  --host 127.0.0.1 --port 6380 \
  --user admin --pass TestPassword123! \
  --filter connect,hello,auth,query \
  --out /tmp/vbp-node-conformance.xml
```

Exit 0 = all PASS, 1 = any FAIL/ERROR.

## Coverage

The suite has 100+ unit tests covering:

- 8-byte VBP header encode/decode (round-trip, truncation, bad magic,
  payload too short/large)
- All 23 mandatory opcodes (each has a registered handler)
- All 36 v1 type IDs (encode/decode round-trip; spec §5.10 — the
  "27" in §5 is a typo)
- PLAIN (RFC 4616) and SCRAM-SHA-256 (RFC 5802) auth with the
  spec-correct c= binding (`gs2_header + "," + client_first_bare`)
- Multiplexer (per-seq dispatch, unsolicited seq=0 routing for
  server-emitted AUTH_OK in dev mode, timeout, ERROR frame rejection)
- `VBPConnection` against a fake server (connect/ping/execute/close)
- Conformance runner YAML loader + JUnit XML emit + live round-trip
