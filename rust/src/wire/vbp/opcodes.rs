//! VBP opcode and type-id constants.
//!
//! Opcodes are 1-byte values that identify a frame's purpose. The list
//! below is the v1 set defined in `VBP_SPEC.md` §3 — 23 mandatory
//! opcodes the driver must at least stub.
//!
//! Type IDs are 2-byte little-endian identifiers for column types in
//! the VBP result encoding. The v1 set is 27 IDs (per the v1 closed
//! set); the Go reference implementation documents 36 IDs total (the
//! full registry), but the driver POC sticks to the 27 v1 IDs.
//!
//! See <https://github.com/tiennesdm/vedadb-driver/blob/conformance/vbp_README.md>.

// ────────────────────────────────────────────────────────────────────
// Opcodes (VBP v1, 23 mandatory)
// ────────────────────────────────────────────────────────────────────

// Connection lifecycle
pub const OP_CLIENT_HELLO: u8 = 0x01;
pub const OP_SERVER_READY: u8 = 0x02;
pub const OP_AUTH_CHALLENGE: u8 = 0x03;
pub const OP_AUTH_RESPONSE: u8 = 0x04;
pub const OP_AUTH_OK: u8 = 0x05;

// Query
pub const OP_QUERY: u8 = 0x06;
pub const OP_EXT_QUERY: u8 = 0x07;
pub const OP_PARSE: u8 = 0x08;
pub const OP_BIND: u8 = 0x09;
pub const OP_DATA_CHUNK: u8 = 0x0A;
pub const OP_ROWS_FINISHED: u8 = 0x0B;
pub const OP_COMMAND_COMPLETE: u8 = 0x0C;
pub const OP_ERROR: u8 = 0x0D;

// Transaction
pub const OP_BEGIN: u8 = 0x0E;
pub const OP_COMMIT: u8 = 0x0F;
pub const OP_ROLLBACK: u8 = 0x10;

// Other
pub const OP_COPY_IN: u8 = 0x11;
pub const OP_COPY_DONE: u8 = 0x12;
pub const OP_COPY_FAIL: u8 = 0x13;
pub const OP_CANCEL_QUERY: u8 = 0x14;
pub const OP_PING: u8 = 0x16;
pub const OP_PONG: u8 = 0x17;
pub const OP_CLOSE: u8 = 0x18;

// Streaming / extensions
pub const OP_STREAM_CHUNK: u8 = 0x19;
pub const OP_STREAM_END: u8 = 0x1A;
pub const OP_SERVER_PUSH: u8 = 0x1B;

// Reserved / future
pub const OP_RESERVED_RANGE_LO: u8 = 0x15;
pub const OP_RESERVED_RANGE_HI: u8 = 0x1F;

/// All 23 mandatory opcodes (the v1 set the driver must stub).
pub const MANDATORY_OPCODES: &[u8] = &[
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
];

/// Human-readable opcode name (for error messages and JUnit reports).
pub fn opcode_name(op: u8) -> &'static str {
    match op {
        OP_CLIENT_HELLO => "CLIENT_HELLO",
        OP_SERVER_READY => "SERVER_READY",
        OP_AUTH_CHALLENGE => "AUTH_CHALLENGE",
        OP_AUTH_RESPONSE => "AUTH_RESPONSE",
        OP_AUTH_OK => "AUTH_OK",
        OP_QUERY => "QUERY",
        OP_EXT_QUERY => "EXT_QUERY",
        OP_PARSE => "PARSE",
        OP_BIND => "BIND",
        OP_DATA_CHUNK => "DATA_CHUNK",
        OP_ROWS_FINISHED => "ROWS_FINISHED",
        OP_COMMAND_COMPLETE => "COMMAND_COMPLETE",
        OP_ERROR => "ERROR",
        OP_BEGIN => "BEGIN",
        OP_COMMIT => "COMMIT",
        OP_ROLLBACK => "ROLLBACK",
        OP_COPY_IN => "COPY_IN",
        OP_COPY_DONE => "COPY_DONE",
        OP_COPY_FAIL => "COPY_FAIL",
        OP_CANCEL_QUERY => "CANCEL_QUERY",
        OP_PING => "PING",
        OP_PONG => "PONG",
        OP_CLOSE => "CLOSE",
        OP_STREAM_CHUNK => "STREAM_CHUNK",
        OP_STREAM_END => "STREAM_END",
        OP_SERVER_PUSH => "SERVER_PUSH",
        _ => "OP_UNKNOWN",
    }
}

// ────────────────────────────────────────────────────────────────────
// Type IDs (VBP v1, 27 mandatory)
// ────────────────────────────────────────────────────────────────────

// Integers
pub const T_BOOL: u16 = 16;
pub const T_INT2: u16 = 21;
pub const T_INT4: u16 = 23;
pub const T_INT8: u16 = 20;

// Floats
pub const T_FLOAT4: u16 = 700;
pub const T_FLOAT8: u16 = 701;

// Strings / bytes
pub const T_TEXT: u16 = 25;
pub const T_VARCHAR: u16 = 1043;
pub const T_BYTEA: u16 = 17;
pub const T_UUID: u16 = 2950;

// Date/time
pub const T_DATE: u16 = 1082;
pub const T_TIME: u16 = 1083;
pub const T_TIMESTAMP: u16 = 1114;
pub const T_TIMESTAMPTZ: u16 = 1184;
pub const T_INTERVAL: u16 = 1186;

// Numeric
pub const T_NUMERIC: u16 = 1700;
pub const T_MONEY: u16 = 790;

// Composite / structured
pub const T_JSON: u16 = 114;
pub const T_JSONB: u16 = 3802;
pub const T_ARRAY: u16 = 2277;

// Network types
pub const T_INET: u16 = 869;
pub const T_MACADDR: u16 = 829;
pub const T_CIDR: u16 = 650;

// Vector / search
pub const T_VECTOR: u16 = 5000;
pub const T_TSVECTOR: u16 = 3614;

// Document
pub const T_DOCUMENT: u16 = 5100;

// Graph
pub const T_GRAPH_NODE: u16 = 5300;
pub const T_GRAPH_EDGE: u16 = 5301;

// Timeseries
pub const T_TS_POINT: u16 = 5400;
pub const T_TS_SERIES: u16 = 5401;

// Geospatial
pub const T_GEO_POINT: u16 = 5500;
pub const T_GEO_PATH: u16 = 5501;
pub const T_GEO_POLYGON: u16 = 5502;
pub const T_GEO_MULTIPOINT: u16 = 5503;
pub const T_GEO_MULTIPOLYGON: u16 = 5504;

/// Canonical 27 v1 type IDs (stable, ordered).
pub const TYPE_IDS: &[u16] = &[
    T_BOOL, T_INT2, T_INT4, T_INT8,                          // 4
    T_FLOAT4, T_FLOAT8,                                       // 2
    T_TEXT, T_VARCHAR, T_BYTEA, T_UUID,                       // 4
    T_DATE, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_INTERVAL,   // 5
    T_NUMERIC,                                                // 1
    T_JSON, T_JSONB, T_ARRAY,                                 // 3
    T_INET, T_MACADDR, T_CIDR,                                // 3
    T_VECTOR, T_TSVECTOR,                                     // 2
    T_DOCUMENT,                                               // 1
    T_TS_POINT,                                               // 1
    T_GEO_POINT,                                              // 1
];

/// Return the symbolic name for a type ID.
pub fn type_id_name(tid: u16) -> &'static str {
    match tid {
        T_BOOL => "T_BOOL",
        T_INT2 => "T_INT2",
        T_INT4 => "T_INT4",
        T_INT8 => "T_INT8",
        T_FLOAT4 => "T_FLOAT4",
        T_FLOAT8 => "T_FLOAT8",
        T_TEXT => "T_TEXT",
        T_VARCHAR => "T_VARCHAR",
        T_BYTEA => "T_BYTEA",
        T_UUID => "T_UUID",
        T_DATE => "T_DATE",
        T_TIME => "T_TIME",
        T_TIMESTAMP => "T_TIMESTAMP",
        T_TIMESTAMPTZ => "T_TIMESTAMPTZ",
        T_INTERVAL => "T_INTERVAL",
        T_NUMERIC => "T_NUMERIC",
        T_MONEY => "T_MONEY",
        T_JSON => "T_JSON",
        T_JSONB => "T_JSONB",
        T_ARRAY => "T_ARRAY",
        T_INET => "T_INET",
        T_MACADDR => "T_MACADDR",
        T_CIDR => "T_CIDR",
        T_VECTOR => "T_VECTOR",
        T_TSVECTOR => "T_TSVECTOR",
        T_DOCUMENT => "T_DOCUMENT",
        T_GRAPH_NODE => "T_GRAPH_NODE",
        T_GRAPH_EDGE => "T_GRAPH_EDGE",
        T_TS_POINT => "T_TS_POINT",
        T_TS_SERIES => "T_TS_SERIES",
        T_GEO_POINT => "T_GEO_POINT",
        T_GEO_PATH => "T_GEO_PATH",
        T_GEO_POLYGON => "T_GEO_POLYGON",
        T_GEO_MULTIPOINT => "T_GEO_MULTIPOINT",
        T_GEO_MULTIPOLYGON => "T_GEO_MULTIPOLYGON",
        _ => "T_UNKNOWN",
    }
}

// ────────────────────────────────────────────────────────────────────
// Auth mechanism constants (used in SCRAM client-first)
// ────────────────────────────────────────────────────────────────────

pub const AUTH_MECH_NONE: &str = "NONE";
pub const AUTH_MECH_PLAIN: &str = "PLAIN";
pub const AUTH_MECH_SCRAM_SHA_256: &str = "SCRAM-SHA-256";

// ────────────────────────────────────────────────────────────────────
// SQLSTATE codes used by VBP v1 (subset we handle).
// ────────────────────────────────────────────────────────────────────

pub const SQLSTATE_FEATURE_NOT_SUPPORTED: &str = "0A000";
pub const SQLSTATE_SYNTAX_ERROR: &str = "42601";
pub const SQLSTATE_AUTH_FAILED: &str = "28000";
pub const SQLSTATE_PROTOCOL_VIOLATION: &str = "08P01";
pub const SQLSTATE_UNIQUE_VIOLATION: &str = "23505";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mandatory_opcodes_count_is_23() {
        assert_eq!(MANDATORY_OPCODES.len(), 23);
    }

    #[test]
    fn type_ids_count_is_27() {
        assert_eq!(TYPE_IDS.len(), 27);
    }

    #[test]
    fn opcode_names_cover_mandatory_set() {
        for op in MANDATORY_OPCODES {
            assert!(
                !opcode_name(*op).starts_with("OP_UNKNOWN"),
                "opcode 0x{op:02x} ({op}) has no human name"
            );
        }
    }

    #[test]
    fn opcode_name_handles_unknown() {
        assert_eq!(opcode_name(0xFE), "OP_UNKNOWN");
        assert_eq!(opcode_name(0x00), "OP_UNKNOWN");
    }

    #[test]
    fn type_id_name_handles_unknown() {
        assert_eq!(type_id_name(0xFFFF), "T_UNKNOWN");
    }

    #[test]
    fn type_id_names_cover_registry() {
        for tid in TYPE_IDS {
            assert!(
                !type_id_name(*tid).starts_with("T_UNKNOWN"),
                "type id {tid} has no human name"
            );
        }
    }

    #[test]
    fn reserved_range_low_is_0x15() {
        assert_eq!(OP_RESERVED_RANGE_LO, 0x15);
    }

    #[test]
    fn auth_mech_constants_distinct() {
        assert_ne!(AUTH_MECH_PLAIN, AUTH_MECH_SCRAM_SHA_256);
        assert_ne!(AUTH_MECH_PLAIN, AUTH_MECH_NONE);
    }
}
