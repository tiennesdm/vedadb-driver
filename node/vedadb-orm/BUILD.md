# Building `vedadb-orm`

This package is **TypeScript-source-first**. The repository ships
`src/` only; the compiled `dist/` is **not** committed. It's produced
on-demand:

* by `npm run build` during local development,
* by `prepublishOnly` automatically before `npm publish`,
* by the `release-driver-node.yml` workflow on tag push.

That keeps the repo lean (no generated `.js` / `.d.ts` churn in diffs)
and forces every release to come from a clean compile.

---

## Layout

```
drivers/node/vedadb-orm/
├── src/                   # TypeScript sources (committed)
│   ├── index.ts           # public entry — re-exports the API
│   ├── connection.ts      # VedaORM, createORM
│   ├── model.ts           # Model class
│   ├── query-builder.ts
│   ├── migration.ts
│   ├── cache.ts           # CacheProxy
│   ├── search.ts          # SearchProxy
│   ├── vector.ts          # VectorProxy
│   ├── graph.ts           # GraphProxy
│   ├── document.ts        # DocumentProxy
│   ├── …                  # see `src/` for the full list
│   └── tests/             # Jest suites (TS, run via ts-jest)
├── dist/                  # ⛔ generated — not in git, not in src
├── package.json           # main: dist/index.js, types: dist/index.d.ts
└── tsconfig.json          # outDir: dist, rootDir: src
```

`package.json` declares:

```json
{
  "main":  "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist/", "LICENSE", "README.md"]
}
```

so `npm publish` ships **only** `dist/` plus license / readme — never
the TypeScript sources, never the test suite.

---

## Local build

From this directory:

```bash
cd drivers/node/vedadb-orm
npm install        # installs typescript, jest, @types/*
npm run build      # invokes `tsc` → emits dist/
```

Or from the repo root:

```bash
npm --prefix drivers/node/vedadb-orm install
npm --prefix drivers/node/vedadb-orm run build
```

After `npm run build` you'll have:

```
dist/index.js
dist/index.d.ts
dist/index.js.map
dist/index.d.ts.map
…one .js / .d.ts pair per file in src/
```

---

## Running tests

Tests live in `src/tests/` and are written in TypeScript; `ts-jest`
compiles them on the fly so you do **not** need to run `npm run
build` first.

```bash
cd drivers/node/vedadb-orm
npm test                       # full Jest run
npm test -- --watch            # watch mode
npm test -- query-builder      # filter by name
```

Tests assume a VedaDB server on `localhost:6380`. To start one for the
duration of a test run, use the helper in `drivers/conformance/`
(see [`../../conformance/`](../../conformance/)).

---

## Why dist isn't committed

1. **Diff hygiene.** Every code change would otherwise produce a
   matching set of generated `.js` / `.d.ts` / `.map` files in the
   PR. Reviews would drown in noise.
2. **Publish-time provenance.** `prepublishOnly` always runs `tsc`
   from a clean `dist/`. There's no scenario where a stale build
   ships to npm.
3. **No "TypeScript optional" lie.** Users consuming the *published*
   package on npm get `dist/` and don't need TypeScript installed.
   Users consuming this folder *from a git checkout* must build —
   and that's a one-time `npm install && npm run build`.

If you need to consume the ORM directly from a checkout *without*
building (e.g. in a CI job), point your `package.json` at the
upstream npm package instead of the repo:

```json
{ "dependencies": { "vedadb-orm": "^0.1.0" } }
```

---

## Source on GitHub

The canonical source mirrors this folder:

* upstream path: `drivers/node/vedadb-orm/src/` on the
  `main` branch of the VedaDB repo.
* released tarballs: <https://www.npmjs.com/package/vedadb-orm>
  (each release tagged `drivers/node-orm-v<semver>`).

If you're reading this file *inside* a published tarball something
has gone wrong — `BUILD.md` is excluded from the npm package via the
`files` allowlist in `package.json`.

---

## See also

* [`README.md`](./README.md) — usage and API walkthrough
* [`../../STRATEGY.md`](../../STRATEGY.md) — when to pick the ORM vs
  the thin client
* [`../README.md`](../README.md) — Node thin-client reference
