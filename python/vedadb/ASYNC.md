# `vedadb.aio` — async surface reference

`AsyncVedaDB` and `AsyncConnectionPool` ship in the same wheel as the
sync `VedaDB` client. Import from `vedadb.aio` directly, or from the
re-exports on the package root:

```python
from vedadb import AsyncVedaDB, AsyncConnectionPool          # re-exported
from vedadb.aio import AsyncVedaDB, AsyncConnectionPool      # canonical
```

> **Status — Phase 0.5.1 of the 0.3 → 1.0 roadmap.**
> The async surface covers the *core* query path. Cache / vector /
> graph / table-helper convenience methods are **sync-only** today
> and must be wrapped in `asyncio.to_thread` (see § *Coverage gaps*).

---

## What is implemented

Read [`aio.py`](./aio.py) for the authoritative source of truth.

### `AsyncVedaDB`

| Method | Purpose | Mirrors sync |
|---|---|---|
| `__init__(host, port, *, tls, timeout, user, password)` | Construct (lazy connect) | `VedaDB.__init__` |
| `await connect()` | Open TCP/TLS, run `AUTH` | `VedaDB.connect` |
| `await close()` | Drain & close the writer | `VedaDB.close` |
| `await query(sql)` → `Result` | Execute VedaQL, return rows | `VedaDB.query` |
| `await execute(sql)` → `Result` | Alias for `query`, intent-DML | `VedaDB.execute` |
| `await ping()` → `bool` | Liveness probe | `VedaDB.ping` |
| `async with AsyncVedaDB(...)` | Auto-connect / auto-close | `with VedaDB(...)` |

### `AsyncConnectionPool`

| Method | Purpose |
|---|---|
| `__init__(host, port, *, min_size, max_size, ...)` | Configure pool |
| `async with pool.acquire() as db:` | Borrow a connection (auto-release) |
| `await pool.close()` | Drain all idle / wait for in-flight |
| `async with AsyncConnectionPool(...)` | Manage pool lifecycle |

`acquire()` is an async context manager (it yields exactly one
`AsyncVedaDB`). The pool grows up to `max_size`, shrinks idle
connections back toward `min_size`.

---

## Hello world

```python
import asyncio
from vedadb.aio import AsyncVedaDB

async def main():
    async with AsyncVedaDB(host="localhost", port=6380) as db:
        result = await db.query("SELECT id, name FROM users LIMIT 5;")
        for row in result.to_dicts():
            print(row)

asyncio.run(main())
```

With a pool:

```python
from vedadb.aio import AsyncConnectionPool

async def main():
    async with AsyncConnectionPool(
        host="localhost", port=6380, min_size=2, max_size=10,
    ) as pool:
        async with pool.acquire() as db:
            await db.execute("INSERT INTO events (kind) VALUES ('login');")
```

---

## Coverage gaps

The sync `VedaDB` client exposes ~30 convenience methods. The async
surface exposes only the **core query path**: `connect`, `close`,
`query`, `execute`, `ping`. Everything else — `cache_get`,
`cache_set`, `cache_del`, `cache_keys`, `cache_incr`, `search`,
`graph_add_node`, `graph_add_edge`, `graph_bfs`, `prepare`,
`execute_prepared`, `transaction`, `insert`, `select`, `update`,
`delete`, `count`, `show_tables`, `drop_table`, `insert_many` — is
sync-only as of 0.3.x.

**Workaround:** wrap the sync method with `asyncio.to_thread`:

```python
import asyncio
from vedadb import VedaDB

def _cache_get_sync(host, port, key):
    with VedaDB(host=host, port=port) as db:
        return db.cache_get(key).scalar()

async def cache_get(host, port, key):
    return await asyncio.to_thread(_cache_get_sync, host, port, key)
```

For high-throughput cache traffic, prefer the sync client behind a
synchronous worker pool — the wire protocol is line-terminated and
the cost of the extra thread hop is negligible relative to the
network round-trip.

---

## Roadmap

Tracked alongside the parity roadmap in
[`../../STRATEGY.md`](../../STRATEGY.md):

* `AsyncVedaDB.cache_*`, `AsyncVedaDB.search`, `AsyncVedaDB.graph_*`
  — direct ports of the sync helpers, slated for 0.4.x.
* `AsyncVedaDB.transaction(coro)` — async-context-manager
  transaction wrapper (sync version takes a callback today).
* `prepare` / `execute_prepared` — async port; needs care because
  the prepared-statement registry is per-connection.

If you need any of these *now*, please file an issue tagged
`area:python-aio` — implementations are mechanical and can be
prioritized on demand.

---

## Testing

The async client is covered by `tests/test_aio.py` (sync-style
asyncio tests via `pytest-asyncio`). To run only the async tests:

```bash
cd drivers/python
pytest tests/test_aio.py -q
```

The conformance suite under [`../../conformance/`](../../conformance/)
exercises both sync and async clients against the same wire-protocol
fixtures.
