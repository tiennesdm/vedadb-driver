//! VedaDB Binary Protocol (VBP) — public API.
//!
//! The v1 transport option for the VedaDB Rust driver. **Opt-in**:
//! the high-level `VedaClient`/`AsyncVedaClient` API still uses HTTP
//! by default. To use VBP, import from this module:
//!
//! ```ignore
//! use vedadb::wire::vbp::{VBPConnection, VBPError, Multiplexer, Frame};
//!
//! let mut conn = VBPConnection::new("127.0.0.1", 6380, "admin", "pw", "main");
//! conn.connect().await?;
//! let rows = conn.execute("SELECT 1", &[]).await?;
//! conn.close().await;
//! ```

#![forbid(unsafe_code)]

pub mod auth;
pub mod conformance_runner;
pub mod connection;
pub mod frame;
pub mod handlers;
pub mod multiplexer;
pub mod opcodes;
pub mod types;

// Re-exports for convenience.
pub use auth::{
    plain_client_first, perform_handshake, HandshakeOptions, HandshakeResult, SCRAMClient,
    VBPAuthError,
};
pub use conformance_runner::{
    parse_addr, run_all, run_category, spawn_dev_server, to_junit_xml, wait_for_server,
    Category, CategoryResult, ConformanceReport, TestCase,
};
pub use connection::{
    decode_rows, DecodedColumn, ServerHello, VBPConnection, VBPConnectionError,
};
pub use frame::{frame_bytes, read_frame, read_frame_bytes, write_frame, Frame, VBPProtocolError, MAGIC, MAX_FRAME_LEN, DEFAULT_VBP_PORT};
pub use handlers::{
    assert_all_handlers_covered, dispatch as dispatch_opcode,
};
pub use multiplexer::{parse_error_frame, Multiplexer, MultiplexerError, Reply, VBPError};
pub use opcodes::{
    type_id_name, AUTH_MECH_NONE, AUTH_MECH_PLAIN, AUTH_MECH_SCRAM_SHA_256, MANDATORY_OPCODES,
    OP_AUTH_CHALLENGE, OP_AUTH_OK, OP_AUTH_RESPONSE, OP_BEGIN, OP_BIND, OP_CANCEL_QUERY,
    OP_CLIENT_HELLO, OP_CLOSE, OP_COMMAND_COMPLETE, OP_COMMIT, OP_COPY_DONE, OP_COPY_FAIL,
    OP_COPY_IN, OP_DATA_CHUNK, OP_ERROR, OP_EXT_QUERY, OP_PARSE, OP_PING, OP_PONG, OP_QUERY,
    OP_ROLLBACK, OP_ROWS_FINISHED, OP_SERVER_READY, SQLSTATE_AUTH_FAILED,
    SQLSTATE_FEATURE_NOT_SUPPORTED, SQLSTATE_PROTOCOL_VIOLATION, SQLSTATE_SYNTAX_ERROR,
    SQLSTATE_UNIQUE_VIOLATION, T_ARRAY, T_BOOL, T_BYTEA, T_CIDR, T_DATE, T_DOCUMENT, T_FLOAT4,
    T_FLOAT8, T_GEO_POINT, T_INET, T_INT2, T_INT4, T_INT8, T_INTERVAL, T_JSON, T_JSONB,
    T_MACADDR, T_MONEY, T_NUMERIC, T_TEXT, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_TS_POINT,
    T_TSVECTOR, T_UUID, T_VARCHAR, T_VECTOR, TYPE_IDS,
};
pub use types::{encode_input_envelope, encode_value, decode_value_at, is_null_bit, TypedValue, VBPTypeError, VBPValue};
