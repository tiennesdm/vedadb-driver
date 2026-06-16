//! VedaDB Binary Protocol (VBP) — frame I/O.
//!
//! Wire format (see `VBP_SPEC.md` §2):
//!
//! ```text
//! +--------+---------+-----+-----+-----+----------+...+
//! | 'VDB'  | len_le4 | seq | op  | flg |  body    |
//! +--------+---------+-----+-----+-----+----------+...+
//! | 3 B    | 4 B     | 1 B | 1 B | 1 B | (len-2)B |
//! +--------+---------+-----+-----+-----+----------+...+
//! ```
//!
//! * Magic is the literal ASCII bytes `V`, `D`, `B` (0x56 0x44 0x42).
//! * `len_le4` is the **payload length** (op + flags + body), encoded
//!   little-endian as an unsigned 32-bit integer. It must be >= 2.
//! * `seq` is an unsigned byte used for request/response multiplexing.
//!   Wraps at 256.
//! * `op` is the opcode (one byte).
//! * `flags` is reserved for connection-level flags; zero in v1.
//! * `body` length is `len_le4 - 2`.

use std::fmt;
use std::io::{self, Read, Write};

use thiserror::Error;

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

pub const MAGIC: &[u8; 3] = b"VDB";
pub const MAGIC_LEN: usize = 3;
pub const LEN_LEN: usize = 4;
pub const SEQ_LEN: usize = 1;
pub const HDR_LEN: usize = MAGIC_LEN + LEN_LEN + SEQ_LEN; // 8 bytes
pub const OP_LEN: usize = 1;
pub const FLAGS_LEN: usize = 1;
pub const OPFLAGS_LEN: usize = OP_LEN + FLAGS_LEN; // 2 bytes

/// Default v1 port (matches the engine's vbp package).
pub const DEFAULT_VBP_PORT: u16 = 6380;

/// Maximum single-frame body — matches the Go reference implementation
/// (64 MiB). Frames larger than this are rejected by the wire layer.
pub const MAX_FRAME_LEN: u32 = 64 * 1024 * 1024;

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

/// Base class for VBP wire-layer errors.
#[derive(Debug, Error)]
pub enum VBPProtocolError {
    #[error("bad magic: expected {expected:?}, got {got:?}")]
    BadMagic { expected: Vec<u8>, got: Vec<u8> },

    #[error("payload_length {0} < {min} (no room for op+flags)", min = OPFLAGS_LEN)]
    Truncated(u32),

    #[error("payload_length {0} exceeds MAX_FRAME_LEN {max}", max = MAX_FRAME_LEN)]
    Oversize(u32),

    #[error("connection closed: {0}")]
    Closed(String),

    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

// ────────────────────────────────────────────────────────────────────
// Frame struct
// ────────────────────────────────────────────────────────────────────

/// A decoded VBP frame.
#[derive(Clone, PartialEq, Eq)]
pub struct Frame {
    pub seq: u8,
    pub op: u8,
    pub flags: u8,
    pub body: Vec<u8>,
}

impl fmt::Debug for Frame {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Frame")
            .field("seq", &self.seq)
            .field("op", &format_args!("0x{:02x}", self.op))
            .field("flags", &format_args!("0x{:02x}", self.flags))
            .field("body_len", &self.body.len())
            .finish()
    }
}

// ────────────────────────────────────────────────────────────────────
// Encode / decode
// ────────────────────────────────────────────────────────────────────

/// Encode a single frame and write it to `out`.
pub fn write_frame(out: &mut impl Write, seq: u8, op: u8, flags: u8, body: &[u8]) -> io::Result<()> {
    let payload_len = (OPFLAGS_LEN as u32) + (body.len() as u32);
    if payload_len > MAX_FRAME_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            VBPProtocolError::Oversize(payload_len),
        ));
    }
    out.write_all(MAGIC)?;
    out.write_all(&payload_len.to_le_bytes())?;
    out.write_all(&[seq])?;
    out.write_all(&[op])?;
    out.write_all(&[flags])?;
    if !body.is_empty() {
        out.write_all(body)?;
    }
    Ok(())
}

/// Encode a single frame and return the bytes (no I/O).
pub fn frame_bytes(seq: u8, op: u8, flags: u8, body: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(HDR_LEN + OPFLAGS_LEN + body.len());
    // Best-effort: write_frame can't fail on Vec.
    write_frame(&mut buf, seq, op, flags, body).expect("write to Vec never fails");
    buf
}

/// Read exactly one frame from `reader` (a stateful byte stream).
///
/// Returns `VBPProtocolError::Closed` if the peer closes mid-frame.
pub fn read_frame<R: Read>(reader: &mut R) -> Result<Frame, VBPProtocolError> {
    let mut hdr = [0u8; HDR_LEN];
    if let Err(e) = reader.read_exact(&mut hdr) {
        if e.kind() == io::ErrorKind::UnexpectedEof {
            return Err(VBPProtocolError::Closed(
                "peer closed before any frame bytes".into(),
            ));
        }
        return Err(VBPProtocolError::Io(e));
    }
    if &hdr[..MAGIC_LEN] != MAGIC {
        return Err(VBPProtocolError::BadMagic {
            expected: MAGIC.to_vec(),
            got: hdr[..MAGIC_LEN].to_vec(),
        });
    }
    let payload_len = u32::from_le_bytes(
        hdr[MAGIC_LEN..MAGIC_LEN + LEN_LEN]
            .try_into()
            .expect("4 bytes"),
    );
    if payload_len < OPFLAGS_LEN as u32 {
        return Err(VBPProtocolError::Truncated(payload_len));
    }
    if payload_len > MAX_FRAME_LEN {
        return Err(VBPProtocolError::Oversize(payload_len));
    }
    let seq = hdr[MAGIC_LEN + LEN_LEN];
    let mut opflags = [0u8; OPFLAGS_LEN];
    reader.read_exact(&mut opflags)?;
    let op = opflags[0];
    let flags = opflags[1];
    let body_len = (payload_len as usize) - OPFLAGS_LEN;
    let mut body = vec![0u8; body_len];
    if body_len > 0 {
        if let Err(e) = reader.read_exact(&mut body) {
            if e.kind() == io::ErrorKind::UnexpectedEof {
                return Err(VBPProtocolError::Closed(
                    "peer closed mid-frame (in body)".into(),
                ));
            }
            return Err(VBPProtocolError::Io(e));
        }
    }
    Ok(Frame { seq, op, flags, body })
}

/// Parse a single frame from a leading prefix of `data`.
///
/// Returns `(Frame, n_bytes_consumed)`. Raises an error variant of
/// `VBPProtocolError` on malformed data, or returns an `Err(Closed)`
/// if `data` is incomplete (caller is expected to read more).
pub fn read_frame_bytes(data: &[u8]) -> Result<(Frame, usize), VBPProtocolError> {
    if data.len() < HDR_LEN {
        return Err(VBPProtocolError::Closed(format!(
            "incomplete: have {} bytes, need {} for header",
            data.len(),
            HDR_LEN
        )));
    }
    if &data[..MAGIC_LEN] != MAGIC {
        return Err(VBPProtocolError::BadMagic {
            expected: MAGIC.to_vec(),
            got: data[..MAGIC_LEN].to_vec(),
        });
    }
    let payload_len = u32::from_le_bytes(
        data[MAGIC_LEN..MAGIC_LEN + LEN_LEN]
            .try_into()
            .expect("4 bytes"),
    );
    if payload_len < OPFLAGS_LEN as u32 {
        return Err(VBPProtocolError::Truncated(payload_len));
    }
    if payload_len > MAX_FRAME_LEN {
        return Err(VBPProtocolError::Oversize(payload_len));
    }
    let total = HDR_LEN + payload_len as usize;
    if data.len() < total {
        return Err(VBPProtocolError::Closed(format!(
            "incomplete: have {} bytes, need {} for full frame",
            data.len(),
            total
        )));
    }
    let seq = data[MAGIC_LEN + LEN_LEN];
    let op = data[HDR_LEN];
    let flags = data[HDR_LEN + 1];
    let body = data[HDR_LEN + OPFLAGS_LEN..total].to_vec();
    Ok((Frame { seq, op, flags, body }, total))
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::vbp::{OP_AUTH_OK, OP_AUTH_RESPONSE, OP_PING};
    use std::io::Cursor;

    #[test]
    fn round_trip_empty_body() {
        let bytes = frame_bytes(0x07, OP_PING, 0, &[]);
        let (f, n) = read_frame_bytes(&bytes).expect("decode");
        assert_eq!(f.seq, 0x07);
        assert_eq!(f.op, OP_PING);
        assert_eq!(f.flags, 0);
        assert!(f.body.is_empty());
        assert_eq!(n, bytes.len());
    }

    #[test]
    fn round_trip_with_body() {
        let body = b"hello, vbp";
        let bytes = frame_bytes(0x10, OP_AUTH_RESPONSE, 0, body);
        let (f, n) = read_frame_bytes(&bytes).expect("decode");
        assert_eq!(f.seq, 0x10);
        assert_eq!(f.op, OP_AUTH_RESPONSE);
        assert_eq!(f.flags, 0);
        assert_eq!(f.body, body);
        assert_eq!(n, bytes.len());
    }

    #[test]
    fn magic_bytes() {
        assert_eq!(MAGIC, b"VDB");
        assert_eq!(MAGIC[0], b'V');
        assert_eq!(MAGIC[1], b'D');
        assert_eq!(MAGIC[2], b'B');
    }

    #[test]
    fn header_layout() {
        let body = b"abc";
        let bytes = frame_bytes(0xAB, 0xCD, 0xEF, body);
        // 3 magic + 4 length + 1 seq + 1 op + 1 flags + 3 body = 13
        assert_eq!(bytes.len(), HDR_LEN + OPFLAGS_LEN + body.len());
        assert_eq!(&bytes[..3], b"VDB");
        let len = u32::from_le_bytes([bytes[3], bytes[4], bytes[5], bytes[6]]);
        assert_eq!(len, OPFLAGS_LEN as u32 + body.len() as u32);
        assert_eq!(bytes[7], 0xAB); // seq
        assert_eq!(bytes[8], 0xCD); // op
        assert_eq!(bytes[9], 0xEF); // flags
        assert_eq!(&bytes[10..], body);
    }

    #[test]
    fn bad_magic_raises_bad_magic_error() {
        let mut bytes = frame_bytes(0x01, OP_PING, 0, b"x");
        bytes[0] = b'X';
        let err = read_frame_bytes(&bytes).unwrap_err();
        assert!(matches!(err, VBPProtocolError::BadMagic { .. }), "{err:?}");
    }

    #[test]
    fn truncated_payload_raises_truncated() {
        // Hand-craft a frame with payload_length = 1 (< OPFLAGS_LEN=2)
        let mut bytes = vec![];
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&1u32.to_le_bytes()); // payload_len = 1
        bytes.push(0x01); // seq
        let err = read_frame_bytes(&bytes).unwrap_err();
        assert!(matches!(err, VBPProtocolError::Truncated(1)), "{err:?}");
    }

    #[test]
    fn oversize_payload_raises_oversize() {
        let mut bytes = vec![];
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&(MAX_FRAME_LEN + 1).to_le_bytes());
        bytes.push(0x01);
        let err = read_frame_bytes(&bytes).unwrap_err();
        assert!(matches!(err, VBPProtocolError::Oversize(_)), "{err:?}");
    }

    #[test]
    fn incomplete_header_raises_closed() {
        let bytes = vec![b'V', b'D']; // < HDR_LEN
        let err = read_frame_bytes(&bytes).unwrap_err();
        assert!(matches!(err, VBPProtocolError::Closed(_)), "{err:?}");
    }

    #[test]
    fn incomplete_body_raises_closed() {
        let body = b"0123456789";
        let bytes = frame_bytes(0x01, OP_PING, 0, body);
        // truncate the body
        let truncated = &bytes[..bytes.len() - 3];
        let err = read_frame_bytes(truncated).unwrap_err();
        assert!(matches!(err, VBPProtocolError::Closed(_)), "{err:?}");
    }

    #[test]
    fn read_frame_from_cursor_round_trip() {
        let body = b"some payload";
        let bytes = frame_bytes(0x42, OP_AUTH_RESPONSE, 0, body);
        let mut cur = Cursor::new(&bytes);
        let f = read_frame(&mut cur).expect("decode");
        assert_eq!(f.seq, 0x42);
        assert_eq!(f.op, OP_AUTH_RESPONSE);
        assert_eq!(f.body, body);
    }

    #[test]
    fn read_frame_on_empty_raises_closed() {
        let mut cur = Cursor::new(Vec::<u8>::new());
        let err = read_frame(&mut cur).unwrap_err();
        assert!(matches!(err, VBPProtocolError::Closed(_)), "{err:?}");
    }

    #[test]
    fn read_frame_on_bad_magic_raises_bad_magic() {
        let mut cur = Cursor::new(b"XXX");
        let err = read_frame(&mut cur).unwrap_err();
        assert!(matches!(err, VBPProtocolError::BadMagic { .. }), "{err:?}");
    }

    #[test]
    fn max_frame_len_constant() {
        assert_eq!(MAX_FRAME_LEN, 64 * 1024 * 1024);
    }

    #[test]
    fn default_vbp_port_constant() {
        assert_eq!(DEFAULT_VBP_PORT, 6380);
    }

    #[test]
    fn write_frame_to_writer() {
        let mut buf = Vec::new();
        write_frame(&mut buf, 0x05, OP_AUTH_OK, 0, b"ok").expect("write");
        let (f, _) = read_frame_bytes(&buf).unwrap();
        assert_eq!(f.op, OP_AUTH_OK);
        assert_eq!(f.body, b"ok");
    }
}
