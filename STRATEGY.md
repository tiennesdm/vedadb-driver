# Driver Strategy: Thin Client vs ORM

> **Scope.** This document explains *why* the Python and Node ecosystems
> ship two libraries each (a thin client and an ORM), and which one you
> should reach for. For release engineering, registries, and the
> language coverage matrix, see [`README.md`](./README.md).

VedaDB ships **two complementary surfaces** for both Python and
Node.js, plus a single thin client for Go / Java / Rust / .NET / Ruby /
PHP. The asymmetry is deliberate — see § *Why the asymmetry* below.

---

## At a glance

| Surface | Package | Style | Best for |
|---|---|---|---|
| Python sync client | [`vedadb`](./python) | Direct VedaQL over TCP/TLS | Scripts, CLI tools, ad-hoc queries, simple integrations |
| Python async client | [`vedadb.aio`](./python/vedadb/aio.py) | `asyncio` / `anyio` / FastAPI | Async services, request handlers, high-fan-out jobs |
| Python ORM | [`vedadb_orm`](./python/vedadb_orm) | Models, schemas, migrations, hooks | Apps that want SQLAlchemy-style ergonomics |
| Node thin client | [`vedadb`](./node) | Direct VedaQL over TCP/TLS | Scripts, edge functions, custom layers |
| Node ORM | [`vedadb-orm`](./node/vedadb-orm) | TypeScript-first ORM with strict typing | Application-tier code that owns its schema |

All five share the same wire protocol, the same `X-API-Key` /
`AUTH`-handshake auth, and the same connection-pooling defaults. You
can mix them in one codebase — e.g. an admin script using the thin
client against a production app using the ORM.

---

## Hello world (one block per surface)

### Python — sync client

```python
from vedadb import VedaDB

with VedaDB(host="localhost", port=6380) as db:
    result = db.query("SELECT id, name FROM users LIMIT 10;")
    for row in result.to_dicts():
        print(row)
```

Install: `pip install vedadb`

### Python — async client

```python
import asyncio
from vedadb.aio import AsyncVedaDB

async def main():
    async with AsyncVedaDB(host="localhost", port=6380) as db:
        result = await db.query("SELECT id, name FROM users LIMIT 10;")
        for row in result.rows:
            print(row)

asyncio.run(main())
```

Install: `pip install vedadb` (the `aio` module ships in the same
wheel — no extra dependency).

### Python — ORM

```python
from vedadb_orm import VedaORM, BaseModel, Field, FieldType, Schema

orm = VedaORM(host="localhost", port=6380)
orm.connect()

users = Schema("users", fields=[
    Field("id",   FieldType.INT, primary_key=True),
    Field("name", FieldType.TEXT, required=True),
])
User = orm.register(BaseModel(users))
print(User.find_many(where={"name": "Asha"}))
```

Install: `pip install vedadb-orm` (depends on `vedadb`).

### Node — thin client

```ts
import { VedaDB } from "vedadb";

const db = new VedaDB({ host: "localhost", port: 6380 });
await db.connect();
const result = await db.query("SELECT id, name FROM users LIMIT 10;");
console.log(result.rows);
await db.close();
```

Install: `npm install vedadb`

### Node — ORM

```ts
import { createORM, defineSchema, FieldType, Model } from "vedadb-orm";

const orm = await createORM({ connection: { host: "localhost", port: 6380 } });
const userSchema = defineSchema("users", {
  id:   { type: FieldType.INT, primaryKey: true },
  name: { type: FieldType.TEXT, required: true },
});
const User = orm.register(userSchema);
const rows = await User.findMany({ where: { name: "Asha" } });
```

Install: `npm install vedadb-orm` (peers on `vedadb >= 0.2.0`).

---

## Picking a surface

| You are… | Reach for |
|---|---|
| Writing a one-off migration / data-load script | thin client |
| Building a FastAPI / aiohttp / Sanic service | Python `aio` |
| Building a Django-style app with model classes | Python ORM |
| Writing a Lambda or edge function in TS | Node thin client |
| Building a long-running NestJS / Next.js API | Node ORM |
| In Go / Java / Rust / .NET / Ruby / PHP today | the thin client (only surface for now) |

**Rule of thumb:** if you'd reach for `psycopg` or `pg`, use the thin
client. If you'd reach for SQLAlchemy or TypeORM, use the ORM.

---

## Why the asymmetry

The Python and Node ecosystems have very different defaults around
data-access ergonomics, and we ship to those expectations rather than
forcing a single shape:

* **Python** users in 2024+ are split between FastAPI / async and
  classic sync stacks, and *very* often want SQLAlchemy-shaped models.
  So Python gets all three: sync client, async client, and ORM.
* **Node / TypeScript** users almost always want compile-time-checked
  schemas (Prisma, Drizzle, TypeORM). The thin client is there for
  edge / ops, but the ORM is the expected default for app code.
* **Go / Java / Rust / .NET / Ruby / PHP** each have entrenched
  ORM ecosystems we *don't* want to compete with — Hibernate,
  Diesel, EF Core, ActiveRecord, Doctrine. We ship a clean wire-level
  client and let the host ecosystem layer its own ORM on top.

This is a deliberate trade. We could ship eight ORMs; we chose two
plus six well-tested wire clients.

---

## Roadmap for parity

Tracked in [`../packaging/PLAN.md`](../packaging/PLAN.md) and the
top-level `CHANGELOG.md`:

1. **Node async / pool unification** — the thin client already exposes
   `acquire()` / `release()`, the ORM uses its own pool. We're
   collapsing onto one `DriverPool` interface so an app can hand a
   pool to either.
2. **Python ORM async** — `vedadb_orm` is sync-only today; an
   `AsyncSession` mirroring the SQLAlchemy 2.0 split is on the
   0.4 milestone.
3. **Java / Rust ORM exploration** — *not committed.* If demand
   appears we'd more likely ship integrations (Hibernate dialect,
   Diesel backend) than a ground-up ORM.
4. **Wire-protocol stability guarantee** — once the wire spec is
   frozen at 1.0, third-party drivers / ORMs become viable; we'll
   publish a conformance suite (sketch already in
   [`./conformance`](./conformance)).

---

## See also

* [`README.md`](./README.md) — registries, install commands, release tags
* [`./python/README.md`](./python/README.md) — sync/async client reference
* [`./python/vedadb_orm/__init__.py`](./python/vedadb_orm/__init__.py) — ORM public API
* [`./node/README.md`](./node/README.md) — thin-client reference
* [`./node/vedadb-orm/`](./node/vedadb-orm) — ORM source and README
