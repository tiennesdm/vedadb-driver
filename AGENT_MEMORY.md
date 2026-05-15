# AGENT_MEMORY.md — VedaDB Driver

> **Repository:** `veda-db/vedadb-driver`  
> **Branch:** `main`  
> **Purpose:** Official multi-language SDKs for VedaDB  
> **Last Updated:** 2025-01-15

---

## Repository Purpose

This repository contains official VedaDB client drivers (SDKs) for 8 programming languages. Each driver implements the VedaDB wire protocol for connecting to `vedadb-server` (port 7480). Conformance tests ensure cross-language consistency.

---

## Scale & Statistics

| Metric | Value |
|--------|-------|
| Total Files | **393** |
| Languages | **8** |
| Conformance Tests | Included |

---

## SDK Matrix

| Language | Maturity | Files | Path | Notes |
|----------|----------|-------|------|-------|
| **Python** | GA | 99 | `python/` | Production-ready, pip installable |
| **Node.js** | Beta | 70 | `nodejs/` | npm package, async/await |
| **Go** | GA | 51 | `go/` | Native Go module |
| **Java** | Beta | 64 | `java/` | Maven/Gradle, JDBC-like |
| **.NET** | Alpha | 74 | `dotnet/` | NuGet package |
| **Rust** | Alpha | 25 | `rust/` | Cargo crate |
| **Ruby** | Alpha | 34 | `ruby/` | Gem package |
| **PHP** | Alpha | 33 | `php/` | Composer package |

---

## Directory Layout

```
├── python/                 (99 files)      Python SDK (GA)
│   ├── vedadb/
│   ├── tests/
│   └── setup.py
├── nodejs/                 (70 files)      Node.js SDK (Beta)
│   ├── src/
│   ├── tests/
│   └── package.json
├── go/                     (51 files)      Go SDK (GA)
│   ├── vedadb/
│   └── go.mod
├── java/                   (64 files)      Java SDK (Beta)
│   ├── src/main/java/com/vedadb/driver/
│   └── pom.xml
├── dotnet/                 (74 files)      .NET SDK (Alpha)
│   ├── VedaDB.Driver/
│   └── VedaDB.Driver.Tests/
├── rust/                   (25 files)      Rust SDK (Alpha)
│   ├── src/
│   └── Cargo.toml
├── ruby/                   (34 files)      Ruby SDK (Alpha)
│   ├── lib/
│   └── vedadb.gemspec
├── php/                    (33 files)      PHP SDK (Alpha)
│   ├── src/
│   └── composer.json
├── conformance/                            Cross-language test suite
│   └── tests/
├── Makefile
└── README.md
```

---

## Conformance Tests

The `conformance/` directory contains shared test cases that every SDK must pass. Tests cover:

- Connection handshake
- Query execution (all 7 engines)
- Parameter binding
- Result set iteration
- Error handling
- Binary protocol edge cases

Run conformance tests per language:

```bash
# Python
make test-python

# Node.js
make test-nodejs

# Go
make test-go

# etc.
```

---

## Wire Protocol

All drivers implement the VedaDB binary protocol:

1. TCP connection to server port **7480**
2. Handshake with version negotiation
3. Authenticated session
4. Binary query/command frames
5. Streaming result frames

See `docs/protocol.md` for frame format details.

---

## SDK Status Legend

| Badge | Meaning |
|-------|---------|
| GA | General Availability — stable API, full test coverage |
| Beta | Feature-complete, API may change, good test coverage |
| Alpha | Early development, incomplete, API will change |

---

## Adding a New Language

1. Create `newlang/` directory with SDK layout
2. Implement wire protocol in target language
3. Add language to `conformance/` test runner
4. Update this `AGENT_MEMORY.md`

---

## Files You Should Read First

1. `README.md` — Quickstart for all languages
2. `go/vedadb/client.go` — Reference implementation (Go GA)
3. `conformance/tests/` — Expected behavior specification
4. `python/vedadb/__init__.py` — Most-used SDK entrypoint

---

*This file is auto-generated. Update it when SDKs mature or languages are added.*
