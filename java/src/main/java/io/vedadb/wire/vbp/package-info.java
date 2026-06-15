/**
 * VedaDB Binary Protocol (VBP) v1 — pure-JDK transport for the VedaDB Java driver.
 *
 * <p>Mirrors the structure of the Python POC at
 * {@code python/vedadb/wire/vbp/}: frame I/O, opcode/type registries, multiplexed
 * request/response, PLAIN+SCRAM authentication, handler stubs, and a
 * conformance runner.
 *
 * <p>Public API: {@link VBPConnection}, {@link VBPResult}, {@link VBPError},
 * {@link VBPException}.
 *
 * <p>No third-party dependencies — uses {@code java.nio} and
 * {@code java.security} only. Additive to the existing {@code io.vedadb} HTTP
 * driver; existing classes are not modified.
 */
package io.vedadb.wire.vbp;
