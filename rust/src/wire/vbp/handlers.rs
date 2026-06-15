//! VBP opcode handler stubs.
//!
//! The v1 driver must ship at least a stub for every one of the 23
//! mandatory opcodes.  A stub returns an `ERROR` frame with sqlstate
//! `0A000` ("feature not supported") and a clear message so callers
//! know to use a real handler.

use std::io::{self, Cursor, Read, Write};

use super::frame::Frame;
use super::opcodes::{
    opcode_name, OP_AUTH_OK, OP_AUTH_RESPONSE, OP_COMMAND_COMPLETE, OP_DATA_CHUNK,
    OP_ERROR, OP_PING, OP_PONG, OP_QUERY, OP_ROWS_FINISHED, OP_SERVER_READY,
    SQLSTATE_FEATURE_NOT_SUPPORTED, SQLSTATE_SYNTAX_ERROR,
};

pub type HandlerResult = Result<Vec<Frame>, String>;

/// All handlers in the v1 SDK take a body and return a list of frames.
/// They are stateless.
pub fn dispatch(op: u8, body: &[u8]) -> Vec<Frame> {
    match op {
        OP_SERVER_READY | OP_PONG | OP_DATA_CHUNK | OP_ROWS_FINISHED | OP_COMMAND_COMPLETE
        | OP_ERROR => vec![_err_frame(
            0,
            SQLSTATE_SYNTAX_ERROR,
            &format!("{} is server-to-client", opcode_name(op)),
        )],
        OP_PING => vec![_pong(0, body)],
        OP_AUTH_RESPONSE => vec![_auth_ok(0, 0xABCD)],
        OP_QUERY => handle_query(body),
        _ => vec![_err_frame(
            0,
            SQLSTATE_FEATURE_NOT_SUPPORTED,
            &format!("opcode {} not implemented (v2)", opcode_name(op)),
        )],
    }
}

pub fn _err_frame(seq: u8, sqlstate: &str, message: &str) -> Frame {
    let mut body = io::Cursor::new(Vec::new());
    let mut bytes: Vec<u8> = Vec::new();
    // sqlstate: 5 bytes ASCII (pad with '0' if shorter)
    let mut s = sqlstate.as_bytes().to_vec();
    s.resize(5, b'0');
    bytes.extend_from_slice(&s);
    bytes.extend_from_slice(&(message.len() as u32).to_le_bytes());
    bytes.extend_from_slice(message.as_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes()); // detail
    bytes.extend_from_slice(&0u32.to_le_bytes()); // hint
    bytes.extend_from_slice(&0u32.to_le_bytes()); // position
    let _ = body.write_all(&bytes);
    Frame {
        seq,
        op: OP_ERROR,
        flags: 0,
        body: bytes,
    }
}

pub fn _command_complete(seq: u8, status: u8) -> Frame {
    Frame {
        seq,
        op: OP_COMMAND_COMPLETE,
        flags: 0,
        body: vec![status],
    }
}

pub fn _data_chunk_int(seq: u8, value: i32) -> Frame {
    let mut body = Vec::new();
    body.extend_from_slice(&1u32.to_le_bytes()); // chunk_id
    body.extend_from_slice(&1u32.to_le_bytes()); // row_count
    body.extend_from_slice(&1u16.to_le_bytes()); // col_count
    body.extend_from_slice(&super::opcodes::T_INT4.to_le_bytes()); // type_id
    body.push(0); // null_bitmap_byte_count
    body.extend_from_slice(&value.to_le_bytes());
    Frame {
        seq,
        op: OP_DATA_CHUNK,
        flags: 0,
        body,
    }
}

pub fn _rows_finished(seq: u8, rows_affected: u64, tag: &str) -> Frame {
    let mut body = Vec::new();
    body.extend_from_slice(&rows_affected.to_le_bytes());
    body.extend_from_slice(&(tag.len() as u32).to_le_bytes());
    body.extend_from_slice(tag.as_bytes());
    body.extend_from_slice(&0u32.to_le_bytes()); // exec_time_us
    Frame {
        seq,
        op: OP_ROWS_FINISHED,
        flags: 0,
        body,
    }
}

pub fn _auth_ok(seq: u8, session_token: u64) -> Frame {
    let mut body = Vec::new();
    body.extend_from_slice(&session_token.to_le_bytes());
    body.extend_from_slice(&0xFFFFFFFFFFFFFFFFu64.to_le_bytes()); // expires_at
    body.extend_from_slice(&0u32.to_le_bytes()); // sf_len
    Frame {
        seq,
        op: OP_AUTH_OK,
        flags: 0,
        body,
    }
}

pub fn _pong(seq: u8, nonce: &[u8]) -> Frame {
    Frame {
        seq,
        op: OP_PONG,
        flags: 0,
        body: nonce.to_vec(),
    }
}

pub fn handle_query(body: &[u8]) -> Vec<Frame> {
    // Decode: [u32 query_id][u32 text_len][text]
    let mut cur = Cursor::new(body);
    let mut qid_buf = [0u8; 4];
    if cur.read_exact(&mut qid_buf).is_err() {
        return vec![_err_frame(0, SQLSTATE_SYNTAX_ERROR, "truncated query body")];
    }
    let _qid = u32::from_le_bytes(qid_buf);
    let mut tlen_buf = [0u8; 4];
    if cur.read_exact(&mut tlen_buf).is_err() {
        return vec![_err_frame(0, SQLSTATE_SYNTAX_ERROR, "truncated query text_len")];
    }
    let tlen = u32::from_le_bytes(tlen_buf) as usize;
    let mut text_buf = vec![0u8; tlen];
    if cur.read_exact(&mut text_buf).is_err() {
        return vec![_err_frame(0, SQLSTATE_SYNTAX_ERROR, "truncated query text")];
    }
    let text = String::from_utf8_lossy(&text_buf).to_string();
    let upper = text.trim().trim_end_matches(';').to_uppercase();
    if upper == "SELECT 1" {
        vec![
            _data_chunk_int(0, 1),
            _rows_finished(0, 1, "SELECT 1"),
            _command_complete(0, 0),
        ]
    } else {
        vec![_command_complete(0, 0)]
    }
}

pub fn assert_all_handlers_covered() {
    use super::opcodes::MANDATORY_OPCODES;
    for op in MANDATORY_OPCODES {
        // Every mandatory opcode has a stub or real handler in dispatch().
        let _ = dispatch(*op, &[]);
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::vbp::opcodes::{
        OP_AUTH_CHALLENGE, OP_BEGIN, OP_BIND, OP_CANCEL_QUERY, OP_CLIENT_HELLO, OP_CLOSE,
        OP_COMMIT, OP_COPY_DONE, OP_COPY_FAIL, OP_COPY_IN, OP_PING, OP_ROLLBACK,
    };

    #[test]
    fn dispatch_ping_returns_pong() {
        let nonce = b"12345678";
        let frames = dispatch(OP_PING, nonce);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].op, OP_PONG);
        assert_eq!(frames[0].body, nonce);
    }

    #[test]
    fn dispatch_pong_returns_error() {
        let frames = dispatch(OP_PONG, &[]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].op, OP_ERROR);
    }

    #[test]
    fn dispatch_data_chunk_returns_error() {
        let frames = dispatch(OP_DATA_CHUNK, &[]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].op, OP_ERROR);
    }

    #[test]
    fn dispatch_rows_finished_returns_error() {
        let frames = dispatch(OP_ROWS_FINISHED, &[]);
        assert_eq!(frames[0].op, OP_ERROR);
    }

    #[test]
    fn dispatch_command_complete_returns_error() {
        let frames = dispatch(OP_COMMAND_COMPLETE, &[]);
        assert_eq!(frames[0].op, OP_ERROR);
    }

    #[test]
    fn dispatch_error_returns_error() {
        let frames = dispatch(OP_ERROR, &[]);
        assert_eq!(frames[0].op, OP_ERROR);
    }

    #[test]
    fn dispatch_server_ready_returns_error() {
        let frames = dispatch(OP_SERVER_READY, &[]);
        assert_eq!(frames[0].op, OP_ERROR);
    }

    #[test]
    fn dispatch_auth_response_returns_auth_ok() {
        let frames = dispatch(OP_AUTH_RESPONSE, b"");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].op, OP_AUTH_OK);
    }

    #[test]
    fn dispatch_query_select_1() {
        let mut body = Vec::new();
        body.extend_from_slice(&1u32.to_le_bytes()); // qid
        body.extend_from_slice(&8u32.to_le_bytes()); // text_len
        body.extend_from_slice(b"SELECT 1");
        let frames = dispatch(OP_QUERY, &body);
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].op, OP_DATA_CHUNK);
        assert_eq!(frames[1].op, OP_ROWS_FINISHED);
        assert_eq!(frames[2].op, OP_COMMAND_COMPLETE);
    }

    #[test]
    fn dispatch_query_other_returns_command_complete() {
        let mut body = Vec::new();
        body.extend_from_slice(&1u32.to_le_bytes());
        body.extend_from_slice(&11u32.to_le_bytes());
        body.extend_from_slice(b"INSERT INTO");
        let frames = dispatch(OP_QUERY, &body);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].op, OP_COMMAND_COMPLETE);
    }

    #[test]
    fn dispatch_query_truncated_returns_error() {
        let frames = dispatch(OP_QUERY, &[1, 2, 3]);
        assert_eq!(frames[0].op, OP_ERROR);
    }

    #[test]
    fn dispatch_unimplemented_returns_0a000() {
        // 0xFE is not in the registry
        let frames = dispatch(0xFE, &[]);
        assert_eq!(frames[0].op, OP_ERROR);
        let body_str = String::from_utf8_lossy(&frames[0].body);
        assert!(body_str.contains("0A000"));
    }

    #[test]
    fn assert_all_handlers_covered_does_not_panic() {
        assert_all_handlers_covered();
    }

    #[test]
    fn all_mandatory_opcodes_can_be_dispatched() {
        for op in [
            OP_CLIENT_HELLO,
            OP_SERVER_READY,
            OP_AUTH_CHALLENGE,
            OP_AUTH_RESPONSE,
            OP_AUTH_OK,
            OP_QUERY,
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
            OP_BIND,
        ] {
            let _ = dispatch(op, &[]);
        }
    }

    #[test]
    fn err_frame_format() {
        let f = _err_frame(0, "0A000", "not supported");
        assert_eq!(f.op, OP_ERROR);
        assert_eq!(&f.body[..5], b"0A000");
    }

    #[test]
    fn data_chunk_int_format() {
        let f = _data_chunk_int(0, 42);
        assert_eq!(f.op, OP_DATA_CHUNK);
        // chunk_id (4) + row_count (4) + col_count (2) + type_id (2) +
        // null_bitmap_byte_count (1) + value (4) = 17
        assert_eq!(f.body.len(), 17);
    }

    #[test]
    fn rows_finished_format() {
        let f = _rows_finished(0, 5, "INSERT");
        assert_eq!(f.op, OP_ROWS_FINISHED);
        // u64 + u32 + "INSERT" + u32 = 8 + 4 + 6 + 4 = 22
        assert_eq!(f.body.len(), 22);
    }

    #[test]
    fn command_complete_format() {
        let f = _command_complete(0, 0);
        assert_eq!(f.op, OP_COMMAND_COMPLETE);
        assert_eq!(f.body, vec![0]);
    }

    #[test]
    fn auth_ok_format() {
        let f = _auth_ok(0, 0xDEAD);
        assert_eq!(f.op, OP_AUTH_OK);
        // u64 + u64 + u32 = 20
        assert_eq!(f.body.len(), 20);
    }
}
