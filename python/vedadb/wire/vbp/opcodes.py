"""
VBP opcode and type-id constants.

Opcodes are 1-byte values that identify a frame's purpose. The list
below is the v1 set defined in ``VBP_SPEC.md`` §3 — 23 mandatory
opcodes the driver must at least stub.

Type IDs are 2-byte little-endian identifiers for column types
in the VBP result encoding. The v1 set is 27 IDs as defined in
``VBP_SPEC.md`` §5 (the Go reference implementation documents 36
IDs total — the 27 IDs below are the closed v1 set).
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Opcodes (VBP v1, 23 mandatory)
# ---------------------------------------------------------------------------

# Connection lifecycle
OP_CLIENT_HELLO: int = 0x01
OP_SERVER_READY: int = 0x02
OP_AUTH_CHALLENGE: int = 0x03
OP_AUTH_RESPONSE: int = 0x04
OP_AUTH_OK: int = 0x05

# Query
OP_QUERY: int = 0x06
OP_EXT_QUERY: int = 0x07
OP_PARSE: int = 0x08
OP_BIND: int = 0x09
OP_DATA_CHUNK: int = 0x0A
OP_ROWS_FINISHED: int = 0x0B
OP_COMMAND_COMPLETE: int = 0x0C
OP_ERROR: int = 0x0D

# Transaction
OP_BEGIN: int = 0x0E
OP_COMMIT: int = 0x0F
OP_ROLLBACK: int = 0x10

# Other
OP_COPY_IN: int = 0x11
OP_COPY_DONE: int = 0x12
OP_COPY_FAIL: int = 0x13
OP_CANCEL_QUERY: int = 0x14
OP_PING: int = 0x16
OP_PONG: int = 0x17
OP_CLOSE: int = 0x18

# Streaming / extensions
OP_STREAM_CHUNK: int = 0x19
OP_STREAM_END: int = 0x1A
OP_SERVER_PUSH: int = 0x1B

# Reserved / future
OP_RESERVED_RANGE_LO: int = 0x15  # 0x15 is reserved
OP_RESERVED_RANGE_HI: int = 0x1F  # 0x1F+ reserved for extensions

# All 23 mandatory opcodes (the v1 set the driver must stub).
MANDATORY_OPCODES: tuple[int, ...] = (
    OP_CLIENT_HELLO,
    OP_SERVER_READY,
    OP_AUTH_CHALLENGE,
    OP_AUTH_RESPONSE,
    OP_AUTH_OK,
    OP_QUERY,
    OP_EXT_QUERY,
    OP_PARSE,
    OP_BIND,
    OP_DATA_CHUNK,
    OP_ROWS_FINISHED,
    OP_COMMAND_COMPLETE,
    OP_ERROR,
    OP_BEGIN,
    OP_COMMIT,
    OP_ROLLBACK,
    OP_COPY_IN,
    OP_COPY_DONE,
    OP_COPY_FAIL,
    OP_CANCEL_QUERY,
    OP_PING,
    OP_PONG,
    OP_CLOSE,
)
assert len(MANDATORY_OPCODES) == 23, (
    f"VBP v1 mandates exactly 23 opcodes, got {len(MANDATORY_OPCODES)}"
)

# String <-> opcode name (for error messages and JUnit reports).
OPCODE_NAMES: dict[int, str] = {
    OP_CLIENT_HELLO: "CLIENT_HELLO",
    OP_SERVER_READY: "SERVER_READY",
    OP_AUTH_CHALLENGE: "AUTH_CHALLENGE",
    OP_AUTH_RESPONSE: "AUTH_RESPONSE",
    OP_AUTH_OK: "AUTH_OK",
    OP_QUERY: "QUERY",
    OP_EXT_QUERY: "EXT_QUERY",
    OP_PARSE: "PARSE",
    OP_BIND: "BIND",
    OP_DATA_CHUNK: "DATA_CHUNK",
    OP_ROWS_FINISHED: "ROWS_FINISHED",
    OP_COMMAND_COMPLETE: "COMMAND_COMPLETE",
    OP_ERROR: "ERROR",
    OP_BEGIN: "BEGIN",
    OP_COMMIT: "COMMIT",
    OP_ROLLBACK: "ROLLBACK",
    OP_COPY_IN: "COPY_IN",
    OP_COPY_DONE: "COPY_DONE",
    OP_COPY_FAIL: "COPY_FAIL",
    OP_CANCEL_QUERY: "CANCEL_QUERY",
    OP_PING: "PING",
    OP_PONG: "PONG",
    OP_CLOSE: "CLOSE",
    OP_STREAM_CHUNK: "STREAM_CHUNK",
    OP_STREAM_END: "STREAM_END",
    OP_SERVER_PUSH: "SERVER_PUSH",
}


def opcode_name(op: int) -> str:
    """Return the symbolic name for an opcode, or ``"OP_0xNN"`` if unknown."""
    return OPCODE_NAMES.get(op, f"OP_0x{op:02x}")


# ---------------------------------------------------------------------------
# Type IDs (VBP v1, 27 mandatory)
# ---------------------------------------------------------------------------

# Integers
T_BOOL: int = 16
T_INT2: int = 21
T_INT4: int = 23
T_INT8: int = 20

# Floats
T_FLOAT4: int = 700
T_FLOAT8: int = 701

# Strings / bytes
T_TEXT: int = 25
T_VARCHAR: int = 1043
T_BYTEA: int = 17
T_UUID: int = 2950

# Date/time
T_DATE: int = 1082
T_TIME: int = 1083
T_TIMESTAMP: int = 1114
T_TIMESTAMPTZ: int = 1184
T_INTERVAL: int = 1186

# Numeric
T_NUMERIC: int = 1700
T_MONEY: int = 790

# Composite / structured
T_JSON: int = 114
T_JSONB: int = 3802
T_ARRAY: int = 2277

# Network types
T_INET: int = 869
T_MACADDR: int = 829
T_CIDR: int = 650

# Vector / search
T_VECTOR: int = 5000
T_TSVECTOR: int = 3614

# Document
T_DOCUMENT: int = 5100

# Graph
T_GRAPH_NODE: int = 5300
T_GRAPH_EDGE: int = 5301

# Timeseries
T_TS_POINT: int = 5400
T_TS_SERIES: int = 5401

# Geospatial
T_GEO_POINT: int = 5500
T_GEO_PATH: int = 5501
T_GEO_POLYGON: int = 5502
T_GEO_MULTIPOINT: int = 5503
T_GEO_MULTIPOLYGON: int = 5504


def _build_type_registry() -> tuple[int, ...]:
    """Return the canonical 27 v1 type IDs (stable, ordered)."""
    ids: list[int] = [
        T_BOOL, T_INT2, T_INT4, T_INT8,            # 4
        T_FLOAT4, T_FLOAT8,                          # 2
        T_TEXT, T_VARCHAR, T_BYTEA, T_UUID,          # 4
        T_DATE, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_INTERVAL,  # 5
        T_NUMERIC,                                   # 1  (T_MONEY is an optional extension; not in the v1 closed set)
        T_JSON, T_JSONB, T_ARRAY,                    # 3
        T_INET, T_MACADDR, T_CIDR,                   # 3
        T_VECTOR, T_TSVECTOR,                        # 2
        T_DOCUMENT,                                  # 1
        T_TS_POINT,                                  # 1
        T_GEO_POINT,                                 # 1 (T_GEO_POINT is the umbrella id for the geo closed set)
    ]
    assert len(ids) == 27, (
        f"VBP v1 mandates exactly 27 type IDs, got {len(ids)}"
    )
    return tuple(ids)


TYPE_IDS: tuple[int, ...] = _build_type_registry()
assert len(TYPE_IDS) == 27

TYPE_ID_NAMES: dict[int, str] = {
    T_BOOL: "T_BOOL",
    T_INT2: "T_INT2",
    T_INT4: "T_INT4",
    T_INT8: "T_INT8",
    T_FLOAT4: "T_FLOAT4",
    T_FLOAT8: "T_FLOAT8",
    T_TEXT: "T_TEXT",
    T_VARCHAR: "T_VARCHAR",
    T_BYTEA: "T_BYTEA",
    T_UUID: "T_UUID",
    T_DATE: "T_DATE",
    T_TIME: "T_TIME",
    T_TIMESTAMP: "T_TIMESTAMP",
    T_TIMESTAMPTZ: "T_TIMESTAMPTZ",
    T_INTERVAL: "T_INTERVAL",
    T_NUMERIC: "T_NUMERIC",
    T_MONEY: "T_MONEY",
    T_JSON: "T_JSON",
    T_JSONB: "T_JSONB",
    T_ARRAY: "T_ARRAY",
    T_INET: "T_INET",
    T_MACADDR: "T_MACADDR",
    T_CIDR: "T_CIDR",
    T_VECTOR: "T_VECTOR",
    T_TSVECTOR: "T_TSVECTOR",
    T_DOCUMENT: "T_DOCUMENT",
    T_GRAPH_NODE: "T_GRAPH_NODE",
    T_GRAPH_EDGE: "T_GRAPH_EDGE",
    T_TS_POINT: "T_TS_POINT",
    T_TS_SERIES: "T_TS_SERIES",
    T_GEO_POINT: "T_GEO_POINT",
    T_GEO_PATH: "T_GEO_PATH",
    T_GEO_POLYGON: "T_GEO_POLYGON",
    T_GEO_MULTIPOINT: "T_GEO_MULTIPOINT",
    T_GEO_MULTIPOLYGON: "T_GEO_MULTIPOLYGON",
}


def type_id_name(tid: int) -> str:
    """Return the symbolic name for a type ID."""
    return TYPE_ID_NAMES.get(tid, f"T_UNKNOWN_0x{tid:04x}")


# ---------------------------------------------------------------------------
# Auth mechanism strings (used in SCRAM client-first)
# ---------------------------------------------------------------------------

AUTH_MECH_PLAIN: str = "PLAIN"
AUTH_MECH_SCRAM_SHA_256: str = "SCRAM-SHA-256"
AUTH_MECH_NONE: str = "NONE"

# SQLSTATE codes used by VBP v1 (subset we handle).
SQLSTATE_FEATURE_NOT_SUPPORTED: str = "0A000"  # feature not supported
SQLSTATE_SYNTAX_ERROR: str = "42601"
SQLSTATE_AUTH_FAILED: str = "28000"
SQLSTATE_PROTOCOL_VIOLATION: str = "08P01"
SQLSTATE_UNIQUE_VIOLATION: str = "23505"


__all__ = [
    # Opcodes
    "OP_CLIENT_HELLO", "OP_SERVER_READY", "OP_AUTH_CHALLENGE",
    "OP_AUTH_RESPONSE", "OP_AUTH_OK", "OP_QUERY", "OP_EXT_QUERY",
    "OP_PARSE", "OP_BIND", "OP_DATA_CHUNK", "OP_ROWS_FINISHED",
    "OP_COMMAND_COMPLETE", "OP_ERROR", "OP_BEGIN", "OP_COMMIT",
    "OP_ROLLBACK", "OP_COPY_IN", "OP_COPY_DONE", "OP_COPY_FAIL",
    "OP_CANCEL_QUERY", "OP_PING", "OP_PONG", "OP_CLOSE",
    "OP_STREAM_CHUNK", "OP_STREAM_END", "OP_SERVER_PUSH",
    "OP_RESERVED_RANGE_LO", "OP_RESERVED_RANGE_HI",
    "MANDATORY_OPCODES", "OPCODE_NAMES", "opcode_name",
    # Type IDs
    "T_BOOL", "T_INT2", "T_INT4", "T_INT8", "T_FLOAT4", "T_FLOAT8",
    "T_TEXT", "T_VARCHAR", "T_BYTEA", "T_UUID",
    "T_DATE", "T_TIME", "T_TIMESTAMP", "T_TIMESTAMPTZ", "T_INTERVAL",
    "T_NUMERIC", "T_MONEY",
    "T_JSON", "T_JSONB", "T_ARRAY",
    "T_INET", "T_MACADDR", "T_CIDR",
    "T_VECTOR", "T_TSVECTOR",
    "T_DOCUMENT",
    "T_GRAPH_NODE", "T_GRAPH_EDGE",
    "T_TS_POINT", "T_TS_SERIES",
    "T_GEO_POINT", "T_GEO_PATH", "T_GEO_POLYGON",
    "T_GEO_MULTIPOINT", "T_GEO_MULTIPOLYGON",
    "TYPE_IDS", "TYPE_ID_NAMES", "type_id_name",
    # Auth
    "AUTH_MECH_PLAIN", "AUTH_MECH_SCRAM_SHA_256", "AUTH_MECH_NONE",
    # SQLSTATE
    "SQLSTATE_FEATURE_NOT_SUPPORTED", "SQLSTATE_SYNTAX_ERROR",
    "SQLSTATE_AUTH_FAILED", "SQLSTATE_PROTOCOL_VIOLATION",
    "SQLSTATE_UNIQUE_VIOLATION",
]
