//! VBP type codecs — encode/decode values to/from the wire representations
//! defined in VBP_SPEC.md §5.
//!
//! The v1 type set is 27 IDs. Every type has a *fixed-width* binary
//! representation (e.g. T_INT4 is a 4-byte little-endian signed integer)
//! or a *length-prefixed* representation (e.g. T_TEXT is a u32 length
//! followed by that many UTF-8 bytes).
//!
//! All functions operate on `&[u8]` / `Vec<u8>` slices and are pure — no I/O.

use thiserror::Error;

use super::opcodes::{
    T_ARRAY, T_BOOL, T_BYTEA, T_CIDR, T_DATE, T_DOCUMENT, T_FLOAT4, T_FLOAT8, T_GEO_POINT,
    T_INET, T_INT2, T_INT4, T_INT8, T_INTERVAL, T_JSON, T_JSONB, T_MACADDR, T_MONEY, T_NUMERIC,
    T_TEXT, T_TIME, T_TIMESTAMP, T_TIMESTAMPTZ, T_TS_POINT, T_TSVECTOR, T_UUID, T_VARCHAR,
    T_VECTOR,
};

#[derive(Debug, Error)]
pub enum VBPTypeError {
    #[error("truncated read: wanted {wanted}, got {got}")]
    Truncated { wanted: usize, got: usize },

    #[error("out of range: {0}")]
    OutOfRange(String),

    #[error("no encoder/decoder for type_id {0}")]
    UnknownTypeId(u16),

    #[error("cannot encode value of type {0}")]
    UnsupportedValueType(String),
}

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

pub type VBPTypeResult<T> = Result<T, VBPTypeError>;

// ────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────

fn read_exact(data: &[u8], off: usize, n: usize) -> VBPTypeResult<&[u8]> {
    if off + n > data.len() {
        return Err(VBPTypeError::Truncated {
            wanted: n,
            got: data.len().saturating_sub(off),
        });
    }
    Ok(&data[off..off + n])
}

fn read_u8(data: &[u8], off: usize) -> VBPTypeResult<(u8, usize)> {
    let b = read_exact(data, off, 1)?[0];
    Ok((b, off + 1))
}

fn read_u16(data: &[u8], off: usize) -> VBPTypeResult<(u16, usize)> {
    let s = read_exact(data, off, 2)?;
    let v = u16::from_le_bytes([s[0], s[1]]);
    Ok((v, off + 2))
}

fn read_u32(data: &[u8], off: usize) -> VBPTypeResult<(u32, usize)> {
    let s = read_exact(data, off, 4)?;
    let v = u32::from_le_bytes([s[0], s[1], s[2], s[3]]);
    Ok((v, off + 4))
}

fn read_i16(data: &[u8], off: usize) -> VBPTypeResult<(i16, usize)> {
    let s = read_exact(data, off, 2)?;
    let v = i16::from_le_bytes([s[0], s[1]]);
    Ok((v, off + 2))
}

fn read_i32(data: &[u8], off: usize) -> VBPTypeResult<(i32, usize)> {
    let s = read_exact(data, off, 4)?;
    let v = i32::from_le_bytes([s[0], s[1], s[2], s[3]]);
    Ok((v, off + 4))
}

fn read_i64(data: &[u8], off: usize) -> VBPTypeResult<(i64, usize)> {
    let s = read_exact(data, off, 8)?;
    let v = i64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]]);
    Ok((v, off + 8))
}

fn read_u32_lp(data: &[u8], off: usize) -> VBPTypeResult<(&[u8], usize)> {
    let (n, off) = read_u32(data, off)?;
    let payload = read_exact(data, off, n as usize)?;
    Ok((payload, off + n as usize))
}

fn write_u16(out: &mut Vec<u8>, v: u16) -> VBPTypeResult<()> {
    out.extend_from_slice(&v.to_le_bytes());
    Ok(())
}

fn write_u32(out: &mut Vec<u8>, v: u32) -> VBPTypeResult<()> {
    out.extend_from_slice(&v.to_le_bytes());
    Ok(())
}

fn write_i16(out: &mut Vec<u8>, v: i16) -> VBPTypeResult<()> {
    out.extend_from_slice(&v.to_le_bytes());
    Ok(())
}

fn write_i32(out: &mut Vec<u8>, v: i32) -> VBPTypeResult<()> {
    out.extend_from_slice(&v.to_le_bytes());
    Ok(())
}

fn write_i64(out: &mut Vec<u8>, v: i64) -> VBPTypeResult<()> {
    out.extend_from_slice(&v.to_le_bytes());
    Ok(())
}

fn write_lp(out: &mut Vec<u8>, data: &[u8]) -> VBPTypeResult<()> {
    write_u32(out, data.len() as u32)?;
    out.extend_from_slice(data);
    Ok(())
}

// ────────────────────────────────────────────────────────────────────
// Encoders — input envelope is `u16 type_id + u8 null_tag + body`.
// (v1 input is one value per param; the `param_count` lives in the
// QUERY body header in VBP_SPEC §A.6.)
// ────────────────────────────────────────────────────────────────────

/// Encode a typed input value as the wire envelope:
/// `[u16 type_id][u8 null_tag=0][body]`. Returns the full envelope.
pub fn encode_input_envelope(type_id: u16, value: &VBPValue) -> VBPTypeResult<Vec<u8>> {
    let mut out = Vec::with_capacity(8);
    write_u16(&mut out, type_id)?;
    out.push(0); // null_tag = 0 (not null)
    let body = encode_value(type_id, value)?;
    out.extend_from_slice(&body);
    Ok(out)
}

/// Encode the value *body* (no type tag, no null tag) for `type_id`.
pub fn encode_value(type_id: u16, value: &VBPValue) -> VBPTypeResult<Vec<u8>> {
    use VBPValue::*;
    match type_id {
        T_BOOL => match value {
            Bool(b) => Ok(vec![if *b { 1 } else { 0 }]),
            _ => Err(VBPTypeError::UnsupportedValueType("bool".into())),
        },
        T_INT2 => match value {
            I16(v) => {
                let mut out = Vec::new();
                write_i16(&mut out, *v)?;
                Ok(out)
            }
            I32(v) => {
                let mut out = Vec::new();
                write_i16(&mut out, *v as i16)?;
                Ok(out)
            }
            I64(v) => {
                let mut out = Vec::new();
                write_i16(&mut out, *v as i16)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("i16".into())),
        },
        T_INT4 => match value {
            I32(v) => {
                let mut out = Vec::new();
                write_i32(&mut out, *v)?;
                Ok(out)
            }
            I16(v) => {
                let mut out = Vec::new();
                write_i32(&mut out, *v as i32)?;
                Ok(out)
            }
            I64(v) => {
                let mut out = Vec::new();
                write_i32(&mut out, *v as i32)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("i32".into())),
        },
        T_INT8 => match value {
            I64(v) => {
                let mut out = Vec::new();
                write_i64(&mut out, *v)?;
                Ok(out)
            }
            I32(v) => {
                let mut out = Vec::new();
                write_i64(&mut out, *v as i64)?;
                Ok(out)
            }
            I16(v) => {
                let mut out = Vec::new();
                write_i64(&mut out, *v as i64)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("i64".into())),
        },
        T_FLOAT4 => match value {
            F32(v) => Ok(v.to_le_bytes().to_vec()),
            F64(v) => Ok((*v as f32).to_le_bytes().to_vec()),
            _ => Err(VBPTypeError::UnsupportedValueType("f32".into())),
        },
        T_FLOAT8 => match value {
            F64(v) => Ok(v.to_le_bytes().to_vec()),
            F32(v) => Ok(((*v) as f64).to_le_bytes().to_vec()),
            _ => Err(VBPTypeError::UnsupportedValueType("f64".into())),
        },
        T_TEXT | T_VARCHAR => match value {
            Str(s) => {
                let mut out = Vec::new();
                write_lp(&mut out, s.as_bytes())?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("text".into())),
        },
        T_BYTEA => match value {
            Bytes(b) => {
                let mut out = Vec::new();
                write_lp(&mut out, b)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("bytea".into())),
        },
        T_UUID => match value {
            Str(s) => {
                // accept hyphenated form, encode as 16 raw bytes
                let bytes = parse_uuid(s)?;
                Ok(bytes.to_vec())
            }
            _ => Err(VBPTypeError::UnsupportedValueType("uuid".into())),
        },
        T_DATE => match value {
            I32(days) => {
                let mut out = Vec::new();
                write_i32(&mut out, *days)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("date".into())),
        },
        T_TIME => match value {
            I64(micros) => {
                let mut out = Vec::new();
                write_i64(&mut out, *micros)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("time".into())),
        },
        T_TIMESTAMP | T_TIMESTAMPTZ => match value {
            I64(micros) => {
                let mut out = Vec::new();
                write_i64(&mut out, *micros)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("timestamp".into())),
        },
        T_INTERVAL => match value {
            I64(micros) => {
                let mut out = Vec::new();
                write_i64(&mut out, *micros)?;
                write_i32(&mut out, 0)?;
                write_i32(&mut out, 0)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("interval".into())),
        },
        T_NUMERIC => match value {
            Str(s) => {
                let mut out = Vec::new();
                write_lp(&mut out, s.as_bytes())?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("numeric".into())),
        },
        T_MONEY => match value {
            F64(v) => {
                let cents = (v * 100.0).round() as i64;
                let mut out = Vec::new();
                write_i64(&mut out, cents)?;
                Ok(out)
            }
            I64(cents) => {
                let mut out = Vec::new();
                write_i64(&mut out, *cents)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("money".into())),
        },
        T_JSON | T_JSONB => match value {
            Str(s) => {
                let mut out = Vec::new();
                write_lp(&mut out, s.as_bytes())?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("json".into())),
        },
        T_ARRAY => match value {
            Array(values) => {
                // Flat array of T_INT4 (v1 conformance `unnest($1::int[])`).
                let mut out = Vec::new();
                write_u32(&mut out, values.len() as u32)?;
                for v in values {
                    let n = match v {
                        I32(x) => *x,
                        _ => {
                            return Err(VBPTypeError::UnsupportedValueType(
                                "array element must be i32".into(),
                            ))
                        }
                    };
                    write_i32(&mut out, n)?;
                }
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("array".into())),
        },
        T_INET | T_MACADDR | T_CIDR => match value {
            Str(s) => {
                let mut out = Vec::new();
                write_lp(&mut out, s.as_bytes())?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("net".into())),
        },
        T_VECTOR => match value {
            Array(values) => {
                let mut out = Vec::new();
                write_u32(&mut out, values.len() as u32)?;
                for v in values {
                    let f = match v {
                        F32(x) => *x,
                        F64(x) => *x as f32,
                        _ => {
                            return Err(VBPTypeError::UnsupportedValueType(
                                "vector element must be f32".into(),
                            ))
                        }
                    };
                    out.extend_from_slice(&f.to_le_bytes());
                }
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("vector".into())),
        },
        T_TSVECTOR => match value {
            Str(s) => {
                let mut out = Vec::new();
                write_lp(&mut out, s.as_bytes())?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("tsvector".into())),
        },
        T_DOCUMENT => match value {
            Str(s) => {
                let mut out = Vec::new();
                write_lp(&mut out, s.as_bytes())?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("document".into())),
        },
        T_TS_POINT => match value {
            Array(values) => {
                if values.len() != 2 {
                    return Err(VBPTypeError::UnsupportedValueType(
                        "ts_point must be [ts_us, value]".into(),
                    ));
                }
                let ts_us = match &values[0] {
                    I64(x) => *x,
                    _ => {
                        return Err(VBPTypeError::UnsupportedValueType(
                            "ts_point[0] must be i64".into(),
                        ))
                    }
                };
                let v = match &values[1] {
                    F64(x) => *x,
                    F32(x) => *x as f64,
                    _ => {
                        return Err(VBPTypeError::UnsupportedValueType(
                            "ts_point[1] must be f64".into(),
                        ))
                    }
                };
                let mut out = Vec::new();
                write_i64(&mut out, ts_us)?;
                out.extend_from_slice(&v.to_le_bytes());
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("ts_point".into())),
        },
        T_GEO_POINT => match value {
            Array(values) => {
                if values.len() != 2 {
                    return Err(VBPTypeError::UnsupportedValueType(
                        "geo_point must be [lat_e7, lon_e7]".into(),
                    ));
                }
                let lat = match &values[0] {
                    I32(x) => *x,
                    _ => {
                        return Err(VBPTypeError::UnsupportedValueType(
                            "geo_point[0] must be i32".into(),
                        ))
                    }
                };
                let lon = match &values[1] {
                    I32(x) => *x,
                    _ => {
                        return Err(VBPTypeError::UnsupportedValueType(
                            "geo_point[1] must be i32".into(),
                        ))
                    }
                };
                let mut out = Vec::new();
                write_i32(&mut out, lat)?;
                write_i32(&mut out, lon)?;
                Ok(out)
            }
            _ => Err(VBPTypeError::UnsupportedValueType("geo_point".into())),
        },
        _ => Err(VBPTypeError::UnknownTypeId(type_id)),
    }
}

/// A typed parameter value (input) for VBP `QUERY`/`PARSE` calls.
#[derive(Debug, Clone, PartialEq)]
pub enum VBPValue {
    Bool(bool),
    I16(i16),
    I32(i32),
    I64(i64),
    F32(f32),
    F64(f64),
    Str(String),
    Bytes(Vec<u8>),
    Array(Vec<VBPValue>),
    Null,
}

// ────────────────────────────────────────────────────────────────────
// Decoders — output envelope is `u16 type_id + u8 null_bitmap_byte_count
// + bitmap + values`. Per-row values follow the column's null bitmap.
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct TypedValue {
    pub type_id: u16,
    pub is_null: bool,
    pub body: Vec<u8>,
}

/// Parse a single typed value from a body slice.
///
/// `off` is the read cursor; returns `(TypedValue, new_off)`. The
/// caller advances `off` by the consumed byte count.
pub fn decode_value_at(type_id: u16, body: &[u8], off: usize) -> VBPTypeResult<(TypedValue, usize)> {
    // If body is empty, return a null placeholder.
    if body.is_empty() {
        return Ok((
            TypedValue {
                type_id,
                is_null: true,
                body: vec![],
            },
            off,
        ));
    }
    // Read null_tag (u8). 0 = not null, 1 = null.
    if off >= body.len() {
        return Ok((
            TypedValue {
                type_id,
                is_null: true,
                body: vec![],
            },
            off,
        ));
    }
    let (null_tag, new_off) = read_u8(body, off)?;
    if null_tag != 0 {
        return Ok((
            TypedValue {
                type_id,
                is_null: true,
                body: vec![],
            },
            new_off,
        ));
    }
    // Read the fixed/var body.  For variable types the body length is
    // encoded as a u32 prefix; for fixed types it is a known constant.
    let (raw, after) = match type_id {
        T_BOOL => read_exact(body, new_off, 1).map(|b| (b.to_vec(), new_off + 1))?,
        T_INT2 => read_exact(body, new_off, 2).map(|b| (b.to_vec(), new_off + 2))?,
        T_INT4 => read_exact(body, new_off, 4).map(|b| (b.to_vec(), new_off + 4))?,
        T_INT8 => read_exact(body, new_off, 8).map(|b| (b.to_vec(), new_off + 8))?,
        T_FLOAT4 => read_exact(body, new_off, 4).map(|b| (b.to_vec(), new_off + 4))?,
        T_FLOAT8 => read_exact(body, new_off, 8).map(|b| (b.to_vec(), new_off + 8))?,
        T_TEXT | T_VARCHAR | T_BYTEA | T_INET | T_MACADDR | T_CIDR | T_TSVECTOR
        | T_DOCUMENT | T_NUMERIC | T_JSON | T_JSONB => {
            let (payload, after) = read_u32_lp(body, new_off)?;
            (payload.to_vec(), after)
        }
        T_UUID => read_exact(body, new_off, 16).map(|b| (b.to_vec(), new_off + 16))?,
        T_DATE => read_exact(body, new_off, 4).map(|b| (b.to_vec(), new_off + 4))?,
        T_TIME => read_exact(body, new_off, 8).map(|b| (b.to_vec(), new_off + 8))?,
        T_TIMESTAMP | T_TIMESTAMPTZ => read_exact(body, new_off, 8).map(|b| (b.to_vec(), new_off + 8))?,
        T_INTERVAL => read_exact(body, new_off, 16).map(|b| (b.to_vec(), new_off + 16))?,
        T_MONEY => read_exact(body, new_off, 8).map(|b| (b.to_vec(), new_off + 8))?,
        T_ARRAY => {
            // Body: u32 elem_count + (n × i32). The full body becomes
            // the "raw" — we don't try to recurse on the elements.
            let (count, after) = read_u32(body, new_off)?;
            let payload_size = (count as usize) * 4;
            let bytes = read_exact(body, after, payload_size)?;
            (bytes.to_vec(), after + payload_size)
        }
        T_VECTOR => {
            let (dim, after) = read_u32(body, new_off)?;
            let payload_size = (dim as usize) * 4;
            let bytes = read_exact(body, after, payload_size)?;
            (bytes.to_vec(), after + payload_size)
        }
        T_TS_POINT => read_exact(body, new_off, 16).map(|b| (b.to_vec(), new_off + 16))?,
        T_GEO_POINT => read_exact(body, new_off, 8).map(|b| (b.to_vec(), new_off + 8))?,
        _ => return Err(VBPTypeError::UnknownTypeId(type_id)),
    };
    Ok((
        TypedValue {
            type_id,
            is_null: false,
            body: raw,
        },
        after,
    ))
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

fn parse_uuid(s: &str) -> VBPTypeResult<[u8; 16]> {
    // Accept hyphenated UUIDs and emit 16 raw bytes.
    let hex: String = s.chars().filter(|c| *c != '-').collect();
    if hex.len() != 32 {
        return Err(VBPTypeError::OutOfRange(format!(
            "uuid must be 32 hex digits, got {}",
            hex.len()
        )));
    }
    let mut out = [0u8; 16];
    for i in 0..16 {
        out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
            .map_err(|_| VBPTypeError::OutOfRange(format!("invalid uuid hex: {s}")))?;
    }
    Ok(out)
}

/// Return true if a bit is set in a null bitmap.
pub fn is_null_bit(bitmap: &[u8], row: usize) -> bool {
    if bitmap.is_empty() {
        return false;
    }
    let byte = row / 8;
    let bit = row % 8;
    if byte >= bitmap.len() {
        return false;
    }
    (bitmap[byte] & (1 << bit)) != 0
}

/// Encode a null bitmap for `row_count` rows as `[(u8 byte_count), bytes]`.
pub fn encode_null_bitmap_prefix(_row_count: usize) -> u8 {
    0 // no bitmap bytes
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_bool_round_trip() {
        let body = encode_value(T_BOOL, &VBPValue::Bool(true)).unwrap();
        assert_eq!(body, vec![1]);
        let body = encode_value(T_BOOL, &VBPValue::Bool(false)).unwrap();
        assert_eq!(body, vec![0]);
    }

    #[test]
    fn encode_int4_round_trip() {
        let body = encode_value(T_INT4, &VBPValue::I32(42)).unwrap();
        assert_eq!(body, 42i32.to_le_bytes());
    }

    #[test]
    fn encode_int8_round_trip() {
        let body = encode_value(T_INT8, &VBPValue::I64(-1)).unwrap();
        assert_eq!(body, (-1i64).to_le_bytes());
    }

    #[test]
    fn encode_text_round_trip() {
        let body = encode_value(T_TEXT, &VBPValue::Str("hi".into())).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&2u32.to_le_bytes());
        expected.extend_from_slice(b"hi");
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_float8_round_trip() {
        let body = encode_value(T_FLOAT8, &VBPValue::F64(3.5)).unwrap();
        assert_eq!(body, 3.5f64.to_le_bytes());
    }

    #[test]
    fn encode_bytea_round_trip() {
        let body = encode_value(T_BYTEA, &VBPValue::Bytes(vec![1, 2, 3])).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&3u32.to_le_bytes());
        expected.extend_from_slice(&[1, 2, 3]);
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_array_int() {
        let v = VBPValue::Array(vec![VBPValue::I32(1), VBPValue::I32(2), VBPValue::I32(3)]);
        let body = encode_value(T_ARRAY, &v).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&3u32.to_le_bytes());
        expected.extend_from_slice(&1i32.to_le_bytes());
        expected.extend_from_slice(&2i32.to_le_bytes());
        expected.extend_from_slice(&3i32.to_le_bytes());
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_vector() {
        let v = VBPValue::Array(vec![
            VBPValue::F32(1.0),
            VBPValue::F32(2.0),
            VBPValue::F32(3.0),
        ]);
        let body = encode_value(T_VECTOR, &v).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&3u32.to_le_bytes());
        expected.extend_from_slice(&1.0f32.to_le_bytes());
        expected.extend_from_slice(&2.0f32.to_le_bytes());
        expected.extend_from_slice(&3.0f32.to_le_bytes());
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_uuid() {
        let v = VBPValue::Str("550e8400-e29b-41d4-a716-446655440000".into());
        let body = encode_value(T_UUID, &v).unwrap();
        assert_eq!(body.len(), 16);
    }

    #[test]
    fn encode_geo_point() {
        let v = VBPValue::Array(vec![VBPValue::I32(100), VBPValue::I32(200)]);
        let body = encode_value(T_GEO_POINT, &v).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&100i32.to_le_bytes());
        expected.extend_from_slice(&200i32.to_le_bytes());
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_ts_point() {
        let v = VBPValue::Array(vec![VBPValue::I64(1234), VBPValue::F64(5.5)]);
        let body = encode_value(T_TS_POINT, &v).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&1234i64.to_le_bytes());
        expected.extend_from_slice(&5.5f64.to_le_bytes());
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_input_envelope_includes_type_id_and_null_tag() {
        let env = encode_input_envelope(T_INT4, &VBPValue::I32(7)).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&T_INT4.to_le_bytes());
        expected.push(0); // null_tag
        expected.extend_from_slice(&7i32.to_le_bytes());
        assert_eq!(env, expected);
    }

    #[test]
    fn unknown_type_id_raises_error() {
        let err = encode_value(0xFFFF, &VBPValue::I32(0)).unwrap_err();
        assert!(matches!(err, VBPTypeError::UnknownTypeId(0xFFFF)));
    }

    #[test]
    fn wrong_value_type_raises_error() {
        let err = encode_value(T_BOOL, &VBPValue::I32(1)).unwrap_err();
        assert!(matches!(err, VBPTypeError::UnsupportedValueType(_)));
    }

    #[test]
    fn decode_value_at_empty_body_returns_null() {
        let (v, off) = decode_value_at(T_INT4, &[], 0).unwrap();
        assert!(v.is_null);
        assert_eq!(off, 0);
    }

    #[test]
    fn decode_value_at_with_null_tag_returns_null() {
        let (v, off) = decode_value_at(T_INT4, &[1], 0).unwrap();
        assert!(v.is_null);
        assert_eq!(off, 1);
    }

    #[test]
    fn decode_value_at_int4_reads_value() {
        let body = vec![0, 42, 0, 0, 0]; // null_tag=0, then 4-byte int
        let (v, off) = decode_value_at(T_INT4, &body, 0).unwrap();
        assert!(!v.is_null);
        assert_eq!(v.body, vec![42, 0, 0, 0]);
        assert_eq!(off, 5);
    }

    #[test]
    fn decode_value_at_text_reads_lp() {
        let mut body = vec![0]; // null_tag
        body.extend_from_slice(&3u32.to_le_bytes());
        body.extend_from_slice(b"abc");
        let (v, off) = decode_value_at(T_TEXT, &body, 0).unwrap();
        assert_eq!(v.body, b"abc");
        assert_eq!(off, body.len());
    }

    #[test]
    fn is_null_bit_works() {
        let bitmap = vec![0b00000001]; // row 0 = null
        assert!(is_null_bit(&bitmap, 0));
        assert!(!is_null_bit(&bitmap, 1));
        let bitmap2 = vec![0b00000010]; // row 1 = null
        assert!(!is_null_bit(&bitmap2, 0));
        assert!(is_null_bit(&bitmap2, 1));
    }

    #[test]
    fn is_null_bit_empty_bitmap_returns_false() {
        assert!(!is_null_bit(&[], 0));
        assert!(!is_null_bit(&[], 100));
    }

    #[test]
    fn is_null_bit_out_of_range_returns_false() {
        let bitmap = vec![0xFF];
        assert!(!is_null_bit(&bitmap, 1000));
    }

    #[test]
    fn encode_value_int16() {
        let body = encode_value(T_INT2, &VBPValue::I16(-1)).unwrap();
        assert_eq!(body, (-1i16).to_le_bytes());
    }

    #[test]
    fn encode_value_float4() {
        let body = encode_value(T_FLOAT4, &VBPValue::F32(1.5)).unwrap();
        assert_eq!(body, 1.5f32.to_le_bytes());
    }

    #[test]
    fn encode_value_date() {
        let body = encode_value(T_DATE, &VBPValue::I32(100)).unwrap();
        assert_eq!(body, 100i32.to_le_bytes());
    }

    #[test]
    fn encode_value_time() {
        let body = encode_value(T_TIME, &VBPValue::I64(1000)).unwrap();
        assert_eq!(body, 1000i64.to_le_bytes());
    }

    #[test]
    fn encode_value_money_from_f64() {
        let body = encode_value(T_MONEY, &VBPValue::F64(12.34)).unwrap();
        let cents = i64::from_le_bytes(body.as_slice().try_into().unwrap());
        assert_eq!(cents, 1234);
    }

    #[test]
    fn encode_value_money_from_i64_cents() {
        let body = encode_value(T_MONEY, &VBPValue::I64(9999)).unwrap();
        assert_eq!(body, 9999i64.to_le_bytes());
    }

    #[test]
    fn encode_value_interval() {
        let body = encode_value(T_INTERVAL, &VBPValue::I64(500)).unwrap();
        assert_eq!(body.len(), 16);
        assert_eq!(&body[..8], &500i64.to_le_bytes());
    }

    #[test]
    fn encode_value_macaddr() {
        let body = encode_value(T_MACADDR, &VBPValue::Str("aa:bb:cc:dd:ee:ff".into())).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&17u32.to_le_bytes());
        expected.extend_from_slice(b"aa:bb:cc:dd:ee:ff");
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_value_inet() {
        let body = encode_value(T_INET, &VBPValue::Str("10.0.0.1".into())).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&8u32.to_le_bytes());
        expected.extend_from_slice(b"10.0.0.1");
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_value_cidr() {
        let body = encode_value(T_CIDR, &VBPValue::Str("10.0.0.0/8".into())).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&10u32.to_le_bytes());
        expected.extend_from_slice(b"10.0.0.0/8");
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_value_tsvector() {
        let body = encode_value(T_TSVECTOR, &VBPValue::Str("cat dog".into())).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&7u32.to_le_bytes());
        expected.extend_from_slice(b"cat dog");
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_value_document() {
        let body = encode_value(T_DOCUMENT, &VBPValue::Str("{\"a\":1}".into())).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&7u32.to_le_bytes());
        expected.extend_from_slice(b"{\"a\":1}");
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_value_json() {
        let body = encode_value(T_JSON, &VBPValue::Str("[1,2,3]".into())).unwrap();
        let mut expected = Vec::new();
        expected.extend_from_slice(&7u32.to_le_bytes());
        expected.extend_from_slice(b"[1,2,3]");
        assert_eq!(body, expected);
    }

    #[test]
    fn encode_value_array_rejects_non_i32() {
        let v = VBPValue::Array(vec![VBPValue::Str("x".into())]);
        assert!(encode_value(T_ARRAY, &v).is_err());
    }

    #[test]
    fn encode_value_vector_rejects_non_f32() {
        let v = VBPValue::Array(vec![VBPValue::Str("x".into())]);
        assert!(encode_value(T_VECTOR, &v).is_err());
    }

    #[test]
    fn encode_value_geo_point_wrong_len() {
        let v = VBPValue::Array(vec![VBPValue::I32(1)]);
        assert!(encode_value(T_GEO_POINT, &v).is_err());
    }

    #[test]
    fn encode_value_ts_point_wrong_len() {
        let v = VBPValue::Array(vec![VBPValue::I64(1)]);
        assert!(encode_value(T_TS_POINT, &v).is_err());
    }

    #[test]
    fn parse_uuid_works() {
        let bytes = parse_uuid("550E8400-E29B-41D4-A716-446655440000").unwrap();
        assert_eq!(
            bytes,
            [0x55, 0x0e, 0x84, 0x00, 0xe2, 0x9b, 0x41, 0xd4, 0xa7, 0x16, 0x44, 0x66, 0x55, 0x44, 0x00, 0x00]
        );
    }

    #[test]
    fn parse_uuid_rejects_short() {
        assert!(parse_uuid("1234").is_err());
    }

    #[test]
    fn encode_null_bitmap_prefix_is_zero() {
        assert_eq!(encode_null_bitmap_prefix(8), 0);
    }
}
