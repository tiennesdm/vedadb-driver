# VedaDB Client Drivers

Official client libraries for [VedaDB](https://github.com/tiennesdm/vedadb-server-code),
the lightweight relational + vector + graph engine. This monorepo
hosts every first-party driver — from the GA-tier Python and Go
clients that we run in production at Tiennes today, through the
Beta-tier Java and Node clients, down to the Alpha-tier .NET, Ruby
and PHP clients we ship for ecosystem coverage. Every driver
speaks the same wire protocol, runs the same conformance suite on
every release, and follows the same versioning policy, so a query
written against one driver behaves identically against any other.

---

## Driver tiers

| Language | Tier | Sync | Async | Type stubs | Conn pool | Source |
|---|---|---|---|---|---|---|
| Python | **GA** | yes | yes (`vedadb.aio`) | yes (PEP 561 `py.typed`) | yes | [`python/`](./python) |
| Go | **GA** | yes | yes (context-aware) | yes (native) | yes (`sql.DB`-style) | [`go/`](./go) |
| Java | Beta | yes | yes (CompletableFuture) | yes (native) | yes (`VedaPool`) | [`java/`](./java) |
| Node / TS | Beta | n/a | yes (Promise-based) | yes (`index.d.ts`) | yes | [`node/`](./node) |
| .NET / C# | Alpha | yes | yes (Task-based) | yes (native) | yes (`VedaPool`) | [`dotnet/`](./dotnet) |
| Ruby | Alpha | yes | no (planned) | no (sorbet planned) | yes | [`ruby/`](./ruby) |
| PHP | Alpha | yes | no | yes (PHPDoc) | yes | [`php/`](./php) |

GA = production-ready, semver-stable, on-call coverage.
Beta = API stable, used in production by early adopters, no SLA on
breaking-change windows shorter than a minor release.
Alpha = surface area subject to revision; pin exact versions.

Python and Node additionally ship a higher-level ORM (`vedadb-orm`)
alongside the thin client. See [`STRATEGY.md`](./STRATEGY.md) for
the rationale.

---

## Quick start

### Python

```bash
pip install vedadb
```

```python
from vedadb import VedaDB

with VedaDB(host="localhost", port=6380, password="secret") as db:
    rows = db.query("SELECT id, name FROM users LIMIT 10").to_dicts()
    for r in rows:
        print(r)
```

Async variant: `from vedadb.aio import AsyncVedaDB`.

### Go

```bash
go get github.com/vedadb/vedadb-go
```

```go
import "github.com/vedadb/vedadb-go"

db, _ := vedadb.Connect(ctx, "vedadb://user:pass@localhost:6380/")
defer db.Close()
rows, _ := db.Query(ctx, "SELECT id, name FROM users LIMIT 10")
```

### Node / TypeScript

```bash
npm install vedadb
```

```ts
import { VedaDB } from "vedadb";
const db = new VedaDB({ host: "localhost", port: 6380, password: "secret" });
await db.connect();
const result = await db.query("SELECT id, name FROM users LIMIT 10");
console.log(result.rows);
```

### Java

```xml
<dependency>
  <groupId>io.vedadb</groupId>
  <artifactId>vedadb</artifactId>
  <version>0.2.0</version>
</dependency>
```

```java
try (VedaClient db = VedaClient.connect("vedadb://localhost:6380", "secret")) {
    VedaResult r = db.query("SELECT id, name FROM users LIMIT 10");
}
```

### .NET / C#

```bash
dotnet add package VedaDB
```

```csharp
using var db = await VedaClient.ConnectAsync("localhost", 6380, password: "secret");
var result = await db.QueryAsync("SELECT id, name FROM users LIMIT 10");
```

### Ruby

```bash
gem install vedadb
```

```ruby
require "vedadb"
VedaDB::Client.open(host: "localhost", port: 6380, password: "secret") do |db|
  db.query("SELECT id, name FROM users LIMIT 10").each { |row| puts row }
end
```

### PHP

```bash
composer require vedadb/vedadb
```

```php
use VedaDB\Client;
$db = new Client(['host' => 'localhost', 'port' => 6380, 'password' => 'secret']);
foreach ($db->query("SELECT id, name FROM users LIMIT 10") as $row) {
    print_r($row);
}
```

---

## How they all work

Every driver in this repo is a *thin* client over the same wire
protocol — there is no language-specific server logic to learn:

* **Transport.** TCP with newline-delimited JSON frames. Each
  request and each response is a single JSON object terminated
  by `\n`. Drivers may pipeline multiple requests on one
  connection.
* **TLS.** Either implicit TLS (connect straight into a TLS
  socket on the TLS port) or STARTTLS upgrade on the plaintext
  port. All drivers default to verifying the server certificate
  against the system trust store; pass an explicit CA bundle for
  self-signed deployments.
* **Auth.** Two equivalent mechanisms: a shared `password` sent
  in the opening `AUTH` frame, or a Bearer token (`Authorization:
  Bearer <jwt>`) for fleets that want short-lived credentials.
  Both authenticate the connection, not individual queries.
* **Errors.** A single uniform error shape (`code`, `message`,
  `detail`) — drivers translate it into idiomatic exceptions.
* **Cursors and pools.** Streaming result sets and connection
  pooling are first-class in every GA/Beta driver; the Alpha
  drivers expose the same surface but tune the defaults more
  conservatively.

If you want to write a brand-new driver, the reference is the
[wire spec in the server repo](https://github.com/tiennesdm/vedadb-server-code)
plus the [`conformance/`](./conformance) suite in this repo.

---

## Versioning policy

Drivers follow strict semantic versioning, anchored to the wire
protocol they speak:

* **Major** — driver MAJOR equals the wire-protocol MAJOR. A 1.x
  driver speaks wire 1; a 2.x driver speaks wire 2. Mixed
  major/wire combinations are unsupported.
* **Minor** — adds new client APIs or surfaces new server
  features introduced in a wire MINOR bump. Always
  backwards-compatible with the previous MINOR within the same
  MAJOR.
* **Patch** — bug fixes and dependency bumps only. Never adds
  API surface, never changes wire behaviour.

The current line is **0.x** — pre-1.0, every minor may break a
narrow surface, but we ship migration notes in the per-driver
CHANGELOG.

---

## Conformance

Every driver runs the cross-driver suite in
[`conformance/`](./conformance) on every release tag. The suite
drives a real VedaDB instance and asserts identical results
across all drivers — same row order, same type coercions, same
error codes for the same bad inputs. A driver cannot tag a new
version without a green conformance run.

See [`conformance/README.md`](./conformance/README.md) for how to
add a new test scenario or a new driver.

---

## Backlog: missing languages

We do not yet ship official drivers for the following languages.
Community PRs that follow the conformance suite are welcome:

* **Rust** — exploratory crate exists internally; not yet promoted.
* **Elixir** — wire protocol maps cleanly to `gen_tcp`; no driver yet.
* **Swift** — desired for mobile / server-side Swift; no driver yet.

If you start one, open an issue first so we can reserve the
package name on the relevant registry and pair you with a
maintainer.

---

## Related repositories

* **[tiennesdm/vedadb-server-code](https://github.com/tiennesdm/vedadb-server-code)**
  — the VedaDB server, including the wire-protocol reference.
* **[tiennesdm/vedadb-workbench](https://github.com/tiennesdm/vedadb-workbench)**
  — the browser-based admin / query UI.

---

## License

All drivers in this repository are licensed under the Apache
License, Version 2.0. See [`LICENSE`](./LICENSE) at the repo root
and the per-package `LICENSE` files for redistribution terms.

## Contributing

Bug reports, conformance fixes, and new-language PRs are all
welcome. Before opening a non-trivial PR:

1. Open an issue describing the change and which drivers it touches.
2. Run the relevant per-language test suite locally.
3. Run `conformance/` against your changed driver.
4. Update the per-driver CHANGELOG and bump the appropriate
   semver component (see *Versioning policy* above).

For wire-protocol changes, the source of truth is the server
repo — propose those there first.
