"""
VBP type codecs — encode/decode Python values to/from the wire
representations defined in VBP_SPEC.md §5.

The v1 type set is 27 IDs. Every type has a *fixed-width* binary
representation (e.g. T_INT4 is a 4-byte little-endian signed integer)
or a *length-prefixed* representation (e.g. T_TEXT is a u32 length
followed by that many UTF-8 bytes).

All functions return/accept ``bytes`` and operate on ``io.BytesIO``
for incremental parsing. They are pure — no I/O.
"""
from __future__ import annotations

import io
import struct
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable

from .opcodes import (
    T_ARRAY,
    T_BOOL,
    T_BYTEA,
    T_CIDR,
    T_DATE,
    T_DOCUMENT,
    T_FLOAT4,
    T_FLOAT8,
    T_GEO_POINT,
    T_INET,
    T_INT2,
    T_INT4,
    T_INT8,
    T_INTERVAL,
    T_JSON,
    T_JSONB,
    T_MACADDR,
    T_MONEY,
    T_NUMERIC,
    T_TEXT,
    T_TIME,
    T_TIMESTAMP,
    T_TIMESTAMPTZ,
    T_TS_POINT,
    T_TSVECTOR,
    T_UUID,
    T_VARCHAR,
    T_VECTOR,
)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class VBPTypeError(Exception):
    """Type-encoding error (unknown type, value out of range, etc.)."""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _write_u8(buf: io.BytesIO, v: int) -> None:
    if not 0 <= v <= 0xFF:
        raise VBPTypeError(f"u8 out of range: {v}")
    buf.write(bytes([v & 0xFF]))


def _write_u16(buf: io.BytesIO, v: int) -> None:
    if not 0 <= v <= 0xFFFF:
        raise VBPTypeError(f"u16 out of range: {v}")
    buf.write(struct.pack("<H", v))


def _write_u32(buf: io.BytesIO, v: int) -> None:
    if not 0 <= v <= 0xFFFFFFFF:
        raise VBPTypeError(f"u32 out of range: {v}")
    buf.write(struct.pack("<I", v))


def _write_i16(buf: io.BytesIO, v: int) -> None:
    if not -0x8000 <= v <= 0x7FFF:
        raise VBPTypeError(f"i16 out of range: {v}")
    buf.write(struct.pack("<h", v))


def _write_i32(buf: io.BytesIO, v: int) -> None:
    if not -0x80000000 <= v <= 0x7FFFFFFF:
        raise VBPTypeError(f"i32 out of range: {v}")
    buf.write(struct.pack("<i", v))


def _write_i64(buf: io.BytesIO, v: int) -> None:
    if not -(1 << 63) <= v <= (1 << 63) - 1:
        raise VBPTypeError(f"i64 out of range: {v}")
    buf.write(struct.pack("<q", v))


def _write_bytes_lp(buf: io.BytesIO, data: bytes) -> None:
    """Write a u32 length + payload."""
    if len(data) > 0xFFFFFFFF:
        raise VBPTypeError(f"length-prefixed data too large: {len(data)}")
    _write_u32(buf, len(data))
    if data:
        buf.write(data)


def _read_exact(buf: io.BytesIO, n: int) -> bytes:
    data = buf.read(n)
    if len(data) != n:
        raise VBPTypeError(
            f"truncated read: wanted {n} bytes, got {len(data)}"
        )
    return data


def _read_u8(buf: io.BytesIO) -> int:
    return _read_exact(buf, 1)[0]


def _read_u16(buf: io.BytesIO) -> int:
    return struct.unpack("<H", _read_exact(buf, 2))[0]


def _read_u32(buf: io.BytesIO) -> int:
    return struct.unpack("<I", _read_exact(buf, 4))[0]


def _read_i16(buf: io.BytesIO) -> int:
    return struct.unpack("<h", _read_exact(buf, 2))[0]


def _read_i32(buf: io.BytesIO) -> int:
    return struct.unpack("<i", _read_exact(buf, 4))[0]


def _read_i64(buf: io.BytesIO) -> int:
    return struct.unpack("<q", _read_exact(buf, 8))[0]


def _read_bytes_lp(buf: io.BytesIO) -> bytes:
    n = _read_u32(buf)
    if n == 0xFFFFFFFF:
        return b""  # treat overflow sentinel as empty
    return _read_exact(buf, n)


# ---------------------------------------------------------------------------
# Encoders
# ---------------------------------------------------------------------------


def encode_bool(value: bool) -> bytes:
    return bytes([1 if value else 0])


def encode_int2(value: int) -> bytes:
    buf = io.BytesIO()
    _write_i16(buf, int(value))
    return buf.getvalue()


def encode_int4(value: int) -> bytes:
    buf = io.BytesIO()
    _write_i32(buf, int(value))
    return buf.getvalue()


def encode_int8(value: int) -> bytes:
    buf = io.BytesIO()
    _write_i64(buf, int(value))
    return buf.getvalue()


def encode_float4(value: float) -> bytes:
    return struct.pack("<f", float(value))


def encode_float8(value: float) -> bytes:
    return struct.pack("<d", float(value))


def encode_text(value: str) -> bytes:
    data = value.encode("utf-8") if isinstance(value, str) else bytes(value)
    return _lp(data)


def encode_varchar(value: str) -> bytes:
    data = value.encode("utf-8") if isinstance(value, str) else bytes(value)
    return _lp(data)


def encode_bytea(value: bytes) -> bytes:
    return _lp(bytes(value))


def encode_uuid(value) -> bytes:
    if isinstance(value, uuid.UUID):
        return value.bytes
    if isinstance(value, str):
        return uuid.UUID(value).bytes
    raise VBPTypeError(f"cannot encode uuid from {type(value).__name__}")


def encode_date(value) -> bytes:
    """Date as i32 days since 1970-01-01 (PostgreSQL convention)."""
    if isinstance(value, date) and not isinstance(value, datetime):
        epoch = date(1970, 1, 1)
        days = (value - epoch).days
    elif isinstance(value, datetime):
        epoch = date(1970, 1, 1)
        days = (value.date() - epoch).days
    elif isinstance(value, int):
        days = value
    elif isinstance(value, str):
        days = (date.fromisoformat(value) - date(1970, 1, 1)).days
    else:
        raise VBPTypeError(f"cannot encode date from {type(value).__name__}")
    return struct.pack("<i", days)


def encode_time(value) -> bytes:
    """Time as i64 microseconds since midnight."""
    if isinstance(value, time):
        micros = value.hour * 3600_000_000 + value.minute * 60_000_000 + value.second * 1_000_000 + value.microsecond
    elif isinstance(value, int):
        micros = value
    elif isinstance(value, str):
        micros = _time_string_to_micros(value)
    else:
        raise VBPTypeError(f"cannot encode time from {type(value).__name__}")
    return struct.pack("<q", micros)


def encode_timestamp(value) -> bytes:
    """Timestamp as i64 microseconds since 1970-01-01T00:00:00Z (UTC)."""
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        epoch = datetime(1970, 1, 1)
        delta = value - epoch
        micros = delta.days * 86400_000_000 + delta.seconds * 1_000_000 + delta.microseconds
    elif isinstance(value, int):
        micros = value
    elif isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        epoch = datetime(1970, 1, 1)
        delta = value - epoch
        micros = delta.days * 86400_000_000 + delta.seconds * 1_000_000 + delta.microseconds
    else:
        raise VBPTypeError(f"cannot encode timestamp from {type(value).__name__}")
    return struct.pack("<q", micros)


def encode_timestamptz(value) -> bytes:
    """TSTZ as i64 microseconds since 1970-01-01T00:00:00Z (UTC)."""
    return encode_timestamp(value)


def encode_interval(value) -> bytes:
    """Interval as i64 microseconds + i32 days + i32 months (PostgreSQL)."""
    if isinstance(value, timedelta):
        micros = int(value.total_seconds() * 1_000_000)
        return struct.pack("<qii", micros, 0, 0)
    if isinstance(value, int):
        return struct.pack("<qii", value, 0, 0)
    raise VBPTypeError(f"cannot encode interval from {type(value).__name__}")


def encode_numeric(value) -> bytes:
    """Numeric as length-prefixed ASCII (PostgreSQL-style, simple form).

    Wire format: u32 len + ASCII representation. We use a simple string
    form; the engine parses it as a numeric value.
    """
    s = str(value)
    return _lp(s.encode("ascii"))


def encode_money(value) -> bytes:
    """Money as i64 cents (PostgreSQL convention; -1 = INVALID)."""
    if isinstance(value, str):
        cents = int(round(float(value) * 100))
    else:
        cents = int(round(float(value) * 100))
    return struct.pack("<q", cents)


def encode_json(value) -> bytes:
    import json
    return _lp(json.dumps(value, separators=(",", ":")).encode("utf-8"))


def encode_jsonb(value) -> bytes:
    return encode_json(value)


def encode_array(value) -> bytes:
    """Array as u32 element_count + concatenated element encodings.

    Note: This is a *flat* encoding (no element type id per element)
    suitable for homogeneous T_INT4 arrays. Mixed-type arrays would
    require per-element type tags. Used for the v1 conformance
    ``unnest($1::int[])`` test.
    """
    if not isinstance(value, (list, tuple)):
        raise VBPTypeError(f"cannot encode array from {type(value).__name__}")
    out = io.BytesIO()
    _write_u32(out, len(value))
    for elem in value:
        out.write(encode_int4(int(elem)))
    return out.getvalue()


def encode_inet(value: str) -> bytes:
    """Inet/CIDR as length-prefixed ASCII. The engine parses to a network."""
    if isinstance(value, bytes):
        return _lp(value)
    return _lp(str(value).encode("ascii"))


def encode_macaddr(value: str) -> bytes:
    return _lp(str(value).encode("ascii"))


def encode_cidr(value: str) -> bytes:
    return _lp(str(value).encode("ascii"))


def encode_vector(value) -> bytes:
    """Vector as u32 dim + dim × f32 (PostgreSQL ``pgvector`` convention)."""
    if isinstance(value, dict):
        dim = int(value["dim"])
        values = list(value["values"])
    elif isinstance(value, (list, tuple)):
        dim = len(value)
        values = [float(v) for v in value]
    else:
        raise VBPTypeError(f"cannot encode vector from {type(value).__name__}")
    out = io.BytesIO()
    _write_u32(out, dim)
    for v in values:
        out.write(struct.pack("<f", float(v)))
    return out.getvalue()


def encode_tsvector(value) -> bytes:
    return _lp(str(value).encode("utf-8"))


def encode_document(value) -> bytes:
    """Document as a length-prefixed JSON-like blob."""
    import json
    if isinstance(value, dict) and "fields" in value:
        return _lp(json.dumps(value, separators=(",", ":")).encode("utf-8"))
    return _lp(json.dumps(value, separators=(",", ":")).encode("utf-8"))


def encode_ts_point(value) -> bytes:
    """TS point as i64 ts (micros) + f64 value."""
    if isinstance(value, dict):
        ts_us = int(value.get("ts", 0))
        v = float(value.get("value", 0.0))
    else:
        ts_us, v = int(value[0]), float(value[1])
    return struct.pack("<q d".replace(" ", ""), ts_us, v)  # 8+8 = 16 bytes


def encode_geo_point(value) -> bytes:
    """Geo point as i32 lat_e7 + i32 lon_e7 (1e-7 degree precision)."""
    if isinstance(value, dict):
        if "lat_e7" in value:
            lat_e7 = int(value["lat_e7"])
        elif "lat" in value:
            lat_e7 = int(float(value["lat"]) * 1e7)
        else:
            raise VBPTypeError("geo_point dict needs 'lat' or 'lat_e7'")
        if "lon_e7" in value:
            lon_e7 = int(value["lon_e7"])
        elif "lon" in value:
            lon_e7 = int(float(value["lon"]) * 1e7)
        else:
            raise VBPTypeError("geo_point dict needs 'lon' or 'lon_e7'")
    else:
        lat_e7, lon_e7 = int(value[0]), int(value[1])
    return struct.pack("<ii", lat_e7, lon_e7)


# ---------------------------------------------------------------------------
# Decoders
# ---------------------------------------------------------------------------


def decode_bool(buf: io.BytesIO) -> bool:
    return _read_u8(buf) != 0


def decode_int2(buf: io.BytesIO) -> int:
    return _read_i16(buf)


def decode_int4(buf: io.BytesIO) -> int:
    return _read_i32(buf)


def decode_int8(buf: io.BytesIO) -> int:
    return _read_i64(buf)


def decode_float4(buf: io.BytesIO) -> float:
    return struct.unpack("<f", _read_exact(buf, 4))[0]


def decode_float8(buf: io.BytesIO) -> float:
    return struct.unpack("<d", _read_exact(buf, 8))[0]


def decode_text(buf: io.BytesIO) -> str:
    return _read_exact(buf, _read_u32(buf)).decode("utf-8")


def decode_varchar(buf: io.BytesIO) -> str:
    return decode_text(buf)


def decode_bytea(buf: io.BytesIO) -> bytes:
    return _read_exact(buf, _read_u32(buf))


def decode_uuid(buf: io.BytesIO) -> uuid.UUID:
    return uuid.UUID(bytes=_read_exact(buf, 16))


def decode_date(buf: io.BytesIO) -> date:
    days = _read_i32(buf)
    return date(1970, 1, 1) + timedelta(days=days)


def decode_time(buf: io.BytesIO) -> time:
    micros = _read_i64(buf)
    s, ms = divmod(micros, 1_000_000)
    s, mn = divmod(s, 60)
    h, m = divmod(s, 60)
    return time(h, m, mn, ms)


def decode_timestamp(buf: io.BytesIO) -> datetime:
    micros = _read_i64(buf)
    return datetime(1970, 1, 1) + timedelta(microseconds=micros)


def decode_timestamptz(buf: io.BytesIO) -> datetime:
    return decode_timestamp(buf)


def decode_interval(buf: io.BytesIO) -> timedelta:
    micros, _days, _months = struct.unpack("<qii", _read_exact(buf, 16))
    return timedelta(microseconds=micros)


def decode_numeric(buf: io.BytesIO) -> str:
    return _read_exact(buf, _read_u32(buf)).decode("ascii")


def decode_money(buf: io.BytesIO) -> float:
    cents = _read_i64(buf)
    return cents / 100.0


def decode_json(buf: io.BytesIO) -> Any:
    import json
    return json.loads(_read_exact(buf, _read_u32(buf)).decode("utf-8"))


def decode_jsonb(buf: io.BytesIO) -> Any:
    return decode_json(buf)


def decode_array(buf: io.BytesIO) -> list[int]:
    n = _read_u32(buf)
    return [_read_i32(buf) for _ in range(n)]


def decode_inet(buf: io.BytesIO) -> str:
    return _read_exact(buf, _read_u32(buf)).decode("ascii")


def decode_macaddr(buf: io.BytesIO) -> str:
    return _read_exact(buf, _read_u32(buf)).decode("ascii")


def decode_cidr(buf: io.BytesIO) -> str:
    return _read_exact(buf, _read_u32(buf)).decode("ascii")


def decode_vector(buf: io.BytesIO) -> list[float]:
    dim = _read_u32(buf)
    return [struct.unpack("<f", _read_exact(buf, 4))[0] for _ in range(dim)]


def decode_tsvector(buf: io.BytesIO) -> str:
    return _read_exact(buf, _read_u32(buf)).decode("utf-8")


def decode_document(buf: io.BytesIO) -> Any:
    import json
    return json.loads(_read_exact(buf, _read_u32(buf)).decode("utf-8"))


def decode_ts_point(buf: io.BytesIO) -> tuple[int, float]:
    ts_us, v = struct.unpack("<qd", _read_exact(buf, 16))
    return (ts_us, v)


def decode_geo_point(buf: io.BytesIO) -> tuple[int, int]:
    lat_e7, lon_e7 = struct.unpack("<ii", _read_exact(buf, 8))
    return (lat_e7, lon_e7)


# ---------------------------------------------------------------------------
# Dispatch tables
# ---------------------------------------------------------------------------


_ENCODERS: dict[int, Callable[[Any], bytes]] = {
    T_BOOL: encode_bool,
    T_INT2: encode_int2,
    T_INT4: encode_int4,
    T_INT8: encode_int8,
    T_FLOAT4: encode_float4,
    T_FLOAT8: encode_float8,
    T_TEXT: encode_text,
    T_VARCHAR: encode_varchar,
    T_BYTEA: encode_bytea,
    T_UUID: encode_uuid,
    T_DATE: encode_date,
    T_TIME: encode_time,
    T_TIMESTAMP: encode_timestamp,
    T_TIMESTAMPTZ: encode_timestamptz,
    T_INTERVAL: encode_interval,
    T_NUMERIC: encode_numeric,
    T_JSON: encode_json,
    T_JSONB: encode_jsonb,
    T_ARRAY: encode_array,
    T_INET: encode_inet,
    T_MACADDR: encode_macaddr,
    T_CIDR: encode_cidr,
    T_VECTOR: encode_vector,
    T_TSVECTOR: encode_tsvector,
    T_DOCUMENT: encode_document,
    T_TS_POINT: encode_ts_point,
    T_GEO_POINT: encode_geo_point,
}


_DECODERS: dict[int, Callable[[io.BytesIO], Any]] = {
    T_BOOL: decode_bool,
    T_INT2: decode_int2,
    T_INT4: decode_int4,
    T_INT8: decode_int8,
    T_FLOAT4: decode_float4,
    T_FLOAT8: decode_float8,
    T_TEXT: decode_text,
    T_VARCHAR: decode_varchar,
    T_BYTEA: decode_bytea,
    T_UUID: decode_uuid,
    T_DATE: decode_date,
    T_TIME: decode_time,
    T_TIMESTAMP: decode_timestamp,
    T_TIMESTAMPTZ: decode_timestamptz,
    T_INTERVAL: decode_interval,
    T_NUMERIC: decode_numeric,
    T_JSON: decode_json,
    T_JSONB: decode_jsonb,
    T_ARRAY: decode_array,
    T_INET: decode_inet,
    T_MACADDR: decode_macaddr,
    T_CIDR: decode_cidr,
    T_VECTOR: decode_vector,
    T_TSVECTOR: decode_tsvector,
    T_DOCUMENT: decode_document,
    T_TS_POINT: decode_ts_point,
    T_GEO_POINT: decode_geo_point,
}


def _lp(data: bytes) -> bytes:
    """Length-prefixed encoding helper."""
    out = io.BytesIO()
    _write_u32(out, len(data))
    if data:
        out.write(data)
    return out.getvalue()


def _time_string_to_micros(s: str) -> int:
    t = time.fromisoformat(s)
    return t.hour * 3600_000_000 + t.minute * 60_000_000 + t.second * 1_000_000 + t.microsecond


def encode_value(type_id: int, value: Any) -> bytes:
    """Encode a Python ``value`` for a column of ``type_id``."""
    enc = _ENCODERS.get(type_id)
    if enc is None:
        raise VBPTypeError(f"no encoder for type_id {type_id}")
    return enc(value)


def decode_value(type_id: int, raw: bytes) -> Any:
    """Decode ``raw`` bytes as a value of ``type_id``."""
    dec = _DECODERS.get(type_id)
    if dec is None:
        raise VBPTypeError(f"no decoder for type_id {type_id}")
    return dec(io.BytesIO(raw))


def is_known_type(type_id: int) -> bool:
    """Return True if the type ID is in the v1 registry."""
    return type_id in _ENCODERS


__all__ = [
    "VBPTypeError",
    "encode_value", "decode_value", "is_known_type",
]
