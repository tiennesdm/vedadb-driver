# VedaDB VBP v1 conformance suite

This directory contains the official VedaDB Binary Protocol (VBP) v1
conformance test suite — the SINGLE SOURCE OF TRUTH for VBP
conformance across all 8 driver SDKs (Python, Node.js, Go, Java, Rust,
.NET, Ruby, PHP).

See also:

- The VBP spec: <https://github.com/tiennesdm/vedadb-engine/blob/feat/vbp-wire-spec/VBP_SPEC.md>
- The reference VBP server: <https://github.com/tiennesdm/vedadb-engine/tree/feat/vbp-wire-v1/internal/wire/vbp>
- The existing (pre-VBP) PG-wire conformance suite: [`suite.yaml`](./suite.yaml)

## Structure

```
conformance/
├── vbp_suite.yaml              # 119 tests across 20 categories
├── harness/
│   ├── go/                     # Reference harness (fully working)
│   │   ├── vbp_harness.go
│   │   └── go.mod
│   ├── dev_server/             # Self-contained VBP v1 test server (no engine dep)
│   │   └── vbp_dev_server.go
│   ├── python/                 # Skeleton — all SKIP
│   ├── node/                   # Skeleton — all SKIP
│   ├── java/                   # Skeleton — all SKIP
│   ├── rust/                   # Skeleton — all SKIP
│   ├── dotnet/                 # Skeleton — all SKIP
│   ├── ruby/                   # Skeleton — all SKIP
│   └── php/                    # Skeleton — all SKIP
```

## Test categories (20 total, 119 tests)

| Category | Tests | What it covers |
|---|--:|---|
| `connect` | 5 | TCP, magic check, payload size, truncation, seq wrap |
| `hello` | 5 | CLIENT_HELLO / SERVER_READY, version, caps, actor kind |
| `auth` | 8 | no-auth, PLAIN, SCRAM-SHA-256, error paths, token reuse |
| `query` | 10 | SELECT, parameters of all v1 types, syntax/duplicate errors |
| `result` | 10 | DATA_CHUNK shape, null bitmap, 0-row sets, int4/int8 boundaries |
| `txn` | 7 | BEGIN/COMMIT/ROLLBACK/SAVEPOINT, in_txn flag, error in txn |
| `vector` | 8 | T_VECTOR_F32/F16, SPARSE, EMBEDDING, QUANT, BINARY, search |
| `document` | 4 | T_DOC flat + nested, T_DOC_PATH, null field |
| `kv` | 4 | T_KV_KEY, T_KV_VALUE, T_KV_TOMBSTONE, large key, missing key |
| `graph` | 5 | T_NODE, T_EDGE, GRAPH_BFS, GRAPH_PATH, traversal state |
| `ts` | 5 | T_TSID, T_TS_SAMPLE, T_TS_RANGE, ingest, range query |
| `geo` | 6 | T_GEO_POINT, T_GEO_LINESTRING, T_GEO_POLYGON, H3, S2, GEO_WITHIN |
| `search` | 4 | T_SEARCH_DOC, T_SEARCH_HIT, T_ANALYZED_TOKENS, bulk search |
| `cross_model` | 6 | mixed-model queries (vector+rel, doc-in-select, geo-in-where) |
| `streaming` | 6 | STREAM_BEGIN/CHUNK/END, checksum, backpressure, payload cap |
| `cancel` | 4 | CANCEL opcode, reason codes, unknown query |
| `copy` | 5 | COPY_IN CSV/binary, COPY_FAIL, format validation, empty body |
| `error` | 10 | mandatory sqlstate codes (42601, 28000, 23505, 53300, 57014, 0A000, 58000) |
| `tls` | 4 | TLS handshake, cert validation, V1 reserved TLS_UPGRADE |
| `type_registry` | 3 | round-trip for all 36 type IDs (the spec's "27" is a typo) |

## Running the suite

### Go reference harness (fully working)

```bash
# Start a VBP v1 server (use the engine's feat/vbp-wire-v1, or
# our standalone dev server in conformance/harness/dev_server/).
go run ./conformance/harness/dev_server -addr 127.0.0.1:6380 &

# Run the harness.
go run ./conformance/harness/go \
  -suite  conformance/vbp_suite.yaml \
  -addr   127.0.0.1:6380 \
  -out    ./vbp-conformance-go.junit.xml \
  -insecure
```

The Go harness implements end-to-end:

- `connect` (1001 only — full TCP+hello)
- `hello` (all 5 tests)
- `auth` (all 8 tests, PLAIN and SCRAM)
- `query` (the SELECT-1 query path)
- `result` (DATA_CHUNK + ROWS_FINISHED + COMMAND_COMPLETE)
- `txn` (BEGIN/COMMIT/ROLLBACK)
- `send_only` (raw opcode send for error-cases)

The other operations (`ext_query`, `encode_decode`, `copy_in`,
`cancel_query`, etc.) are emitted as `SKIP` with a clear TODO
message — these will be filled in as the Go SDK lands VBP support.

### Skeleton harnesses (the other 7 SDKs)

```bash
python3 conformance/harness/python/vbp_harness.py \
  --suite conformance/vbp_suite.yaml \
  --out   ./vbp-conformance-python.junit.xml

node conformance/harness/node/vbp_harness.js \
  --suite conformance/vbp_suite.yaml \
  --out   ./vbp-conformance-node.junit.xml

# Java
javac conformance/harness/java/VbpHarness.java
java -cp . VbpHarness --suite conformance/vbp_suite.yaml --out ...

# Rust
rustc -O conformance/harness/rust/vbp_harness.rs -o vbp_harness_rust
./vbp_harness_rust --suite conformance/vbp_suite.yaml --out ...

# .NET
cd /tmp && dotnet new console -o vbp_harness_dotnet --force
cp .../VbpHarness.cs vbp_harness_dotnet/Program.cs
cd vbp_harness_dotnet && dotnet run -c Release -- --suite ... --out ...

# Ruby
ruby conformance/harness/ruby/vbp_harness.rb --suite ... --out ...

# PHP
php conformance/harness/php/vbp_harness.php --suite=... --out=...
```

All 7 skeleton harnesses SKIP every test today (the VBP wire
implementation in each SDK is in progress). They run, load YAML,
emit JUnit, and exit 0 — they're ready to be filled in as the
SDKs grow VBP support.

## CI

`.github/workflows/vbp-conformance.yml` runs the full matrix on
push/PR to main and on `feat/**` / `fix/**` branches. The Go
matrix entry is the only one that drives real tests; the other
7 are smoke tests that the harness builds and emits valid JUnit.

The aggregate job fails the workflow if any SDK has FAIL or ERROR
outcomes. Today only the Go matrix entry can produce FAILs, and
they're scoped to the in-development categories.
