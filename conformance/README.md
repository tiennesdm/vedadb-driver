# VedaDB driver conformance suite

Phase 0.5.1 of the VedaDB 0.3→1.0 roadmap.

Every language driver (Python, Node, Go, Java, Rust, .NET, Ruby, PHP)
is required to pass this suite before release. The single source of
truth is [`suite.yaml`](./suite.yaml) — per-driver harnesses translate
it to their native test framework.

## Structure

| Category | Covers |
|---|---|
| `connect` | TCP + TLS + AUTH |
| `exec` | DDL / DML, rows-affected semantics, error surfacing |
| `query` | Row/column shape, NULL handling, large result sets |
| `txn` | BEGIN/COMMIT/ROLLBACK/SAVEPOINT |
| `pool` | Connection reuse, health checks, max-open enforcement |
| `types` | Int/String/Unicode round-trip, boundary values |
| `retry` | Exponential backoff on transient errors |
| `telemetry` | OpenTelemetry span propagation per query |
| `orm` | Language-specific ORM hook (SQLAlchemy / Prisma / Hibernate / sqlx / EF / ActiveRecord / Doctrine) |

## Running locally

```bash
# Bring up a VedaDB server on :6380
make run-server &

# Run the conformance suite for your driver:
cd drivers/python && pytest tests/conformance_test.py -v
cd drivers/node   && npm run test:conformance
cd drivers/go     && go test ./tests/conformance/...
```

Each driver's harness loads `suite.yaml`, filters by category (skipping
anything not yet implemented with a clear `SKIP` marker), and emits a
JUnit-style XML report the release workflow aggregates across all 8
languages.

## Adding a test

1. Pick the next free `id` (gaps are fine, but don't renumber existing
   tests — drivers reference them by number in change logs).
2. Add the YAML entry with `setup`, `operation`, `expect`, `teardown`.
3. Update each driver's harness if the `operation.kind` is new.
4. Run the suite against all 8 drivers before merging.

## CI gating

The 8 per-driver workflows in `.github/workflows/release-driver-*.yml`
load the YAML and fail the release if any `fail` test unexpectedly
passes or any `pass` test fails. Coverage currently gates at:

| Driver | Pass rate required |
|---|---|
| Python | ≥ 95 % |
| Node | ≥ 95 % |
| Go | ≥ 90 % |
| Java | ≥ 85 % |
| Rust / .NET / Ruby / PHP | ≥ 60 % (tightens in 1.0.0) |
