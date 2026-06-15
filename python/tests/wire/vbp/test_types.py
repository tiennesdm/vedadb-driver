"""Tests for the vbp.wire.types module — encode/decode round-trips for all 27 v1 type IDs."""
from __future__ import annotations

import io
import os
import struct
import sys
import unittest
import uuid
from datetime import date, datetime, time, timedelta, timezone

# Make sure we can import the vedadb package from the repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from vedadb.wire.vbp.opcodes import (  # noqa: E402
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
    TYPE_IDS,
)
from vedadb.wire.vbp.types import (  # noqa: E402
    decode_value,
    encode_value,
    is_known_type,
)


class TestRegistry(unittest.TestCase):
    """The v1 type registry is 27 IDs as per the spec."""

    def test_exactly_27_type_ids(self):
        self.assertEqual(len(TYPE_IDS), 27)

    def test_all_in_registry_round_trip(self):
        for tid in TYPE_IDS:
            self.assertTrue(is_known_type(tid), f"type_id {tid} not in registry")

    def test_unknown_type_rejected(self):
        self.assertFalse(is_known_type(0xDEAD))
        with self.assertRaises(Exception):
            encode_value(0xDEAD, "x")
        with self.assertRaises(Exception):
            decode_value(0xDEAD, b"\x00" * 4)


class TestIntegerRoundTrip(unittest.TestCase):
    def test_bool(self):
        for v in (True, False):
            raw = encode_value(T_BOOL, v)
            self.assertEqual(decode_value(T_BOOL, raw), v)

    def test_int2_range(self):
        for v in (-32768, -1, 0, 1, 32767):
            raw = encode_value(T_INT2, v)
            self.assertEqual(decode_value(T_INT2, raw), v)

    def test_int4_range(self):
        for v in (-2**31, -1, 0, 1, 2**31 - 1):
            raw = encode_value(T_INT4, v)
            self.assertEqual(decode_value(T_INT4, raw), v)

    def test_int8_range(self):
        for v in (-(2**63), -1, 0, 1, 2**63 - 1):
            raw = encode_value(T_INT8, v)
            self.assertEqual(decode_value(T_INT8, raw), v)

    def test_int4_out_of_range(self):
        with self.assertRaises(Exception):
            encode_value(T_INT4, 2**32)


class TestFloatRoundTrip(unittest.TestCase):
    def test_float4(self):
        # float32 has ~7 significant digits; use values within that range.
        for v in (0.0, 1.5, -3.14, 1e6, 1e-6):
            raw = encode_value(T_FLOAT4, v)
            decoded = decode_value(T_FLOAT4, raw)
            # Use relative tolerance for larger values.
            if abs(v) >= 1.0:
                self.assertAlmostEqual(decoded / v, 1.0, places=4)
            else:
                self.assertAlmostEqual(decoded, v, places=5)

    def test_float8_full_precision(self):
        for v in (0.0, 1.5, -3.14159, 3.14159):
            raw = encode_value(T_FLOAT8, v)
            self.assertEqual(decode_value(T_FLOAT8, raw), v)


class TestStringByteRoundTrip(unittest.TestCase):
    def test_text_ascii(self):
        for s in ("", "hello", "x" * 1024):
            raw = encode_value(T_TEXT, s)
            self.assertEqual(decode_value(T_TEXT, raw), s)

    def test_text_unicode(self):
        for s in ("héllo", "日本語", "🚀", "héllo 日本語 🚀"):
            raw = encode_value(T_TEXT, s)
            self.assertEqual(decode_value(T_TEXT, raw), s)

    def test_varchar(self):
        s = "varchar test"
        self.assertEqual(decode_value(T_VARCHAR, encode_value(T_VARCHAR, s)), s)

    def test_bytea_with_nul(self):
        b = b"hello\x00world"
        raw = encode_value(T_BYTEA, b)
        self.assertEqual(decode_value(T_BYTEA, raw), b)

    def test_bytea_round_trip(self):
        for b in (b"", b"\x00", b"\xDE\xAD\xBE\xEF\x00\xFF", b"x" * 1024):
            self.assertEqual(decode_value(T_BYTEA, encode_value(T_BYTEA, b)), b)

    def test_uuid(self):
        u = uuid.UUID("12345678-1234-5678-1234-567812345678")
        raw = encode_value(T_UUID, u)
        self.assertEqual(decode_value(T_UUID, raw), u)

    def test_uuid_from_string(self):
        s = "12345678-1234-5678-1234-567812345678"
        raw = encode_value(T_UUID, s)
        self.assertEqual(decode_value(T_UUID, raw), uuid.UUID(s))


class TestDateTimeRoundTrip(unittest.TestCase):
    def test_date(self):
        d = date(2026, 6, 15)
        self.assertEqual(decode_value(T_DATE, encode_value(T_DATE, d)), d)

    def test_date_epoch(self):
        d = date(1970, 1, 1)
        self.assertEqual(decode_value(T_DATE, encode_value(T_DATE, d)), d)

    def test_time(self):
        t = time(12, 30, 45, 123456)
        self.assertEqual(decode_value(T_TIME, encode_value(T_TIME, t)), t)

    def test_timestamp(self):
        dt = datetime(2026, 6, 15, 12, 30, 45, 123456)
        self.assertEqual(decode_value(T_TIMESTAMP, encode_value(T_TIMESTAMP, dt)), dt)

    def test_timestamptz_normalizes_to_utc(self):
        # 2026-06-15T12:00:00+05:30 == 2026-06-15T06:30:00Z
        dt = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
        out = decode_value(T_TIMESTAMPTZ, encode_value(T_TIMESTAMPTZ, dt))
        self.assertEqual(out, datetime(2026, 6, 15, 6, 30, 0))

    def test_interval(self):
        td = timedelta(hours=2, minutes=30)
        out = decode_value(T_INTERVAL, encode_value(T_INTERVAL, td))
        self.assertEqual(out, td)


class TestNumericRoundTrip(unittest.TestCase):
    def test_numeric(self):
        for v in ("0", "123", "3.14159", "-1.5"):
            self.assertEqual(decode_value(T_NUMERIC, encode_value(T_NUMERIC, v)), v)

    def test_money(self):
        # T_MONEY is an optional v1 extension; the v1 closed set is 27
        # types and excludes T_MONEY.  We still ship a working encoder
        # for it but do not include it in TYPE_IDS.  The dispatch
        # table above therefore rejects T_MONEY (no entry); the
        # encode_value call below should raise.
        for v in (0.0, 1.23, -99.99):
            with self.assertRaises(Exception):
                encode_value(T_MONEY, v)


class TestStructuredRoundTrip(unittest.TestCase):
    def test_json(self):
        for v in (None, True, 42, "hello", [1, 2, 3], {"k": "v"}):
            self.assertEqual(decode_value(T_JSON, encode_value(T_JSON, v)), v)

    def test_jsonb(self):
        for v in (None, [1, 2, 3], {"a": 1, "b": [2, 3]}):
            self.assertEqual(decode_value(T_JSONB, encode_value(T_JSONB, v)), v)

    def test_array(self):
        v = [1, 2, 3, 4, 5]
        self.assertEqual(decode_value(T_ARRAY, encode_value(T_ARRAY, v)), v)

    def test_inet(self):
        self.assertEqual(decode_value(T_INET, encode_value(T_INET, "192.168.1.1")), "192.168.1.1")

    def test_macaddr(self):
        self.assertEqual(decode_value(T_MACADDR, encode_value(T_MACADDR, "00:1A:2B:3C:4D:5E")), "00:1A:2B:3C:4D:5E")

    def test_cidr(self):
        self.assertEqual(decode_value(T_CIDR, encode_value(T_CIDR, "10.0.0.0/8")), "10.0.0.0/8")


class TestVectorAndDocument(unittest.TestCase):
    def test_vector_from_list(self):
        v = [0.1, 0.2, 0.3]
        out = decode_value(T_VECTOR, encode_value(T_VECTOR, v))
        for a, b in zip(v, out):
            self.assertAlmostEqual(a, b, places=4)

    def test_vector_from_dict(self):
        v = {"dim": 4, "values": [1.0, 2.0, 3.0, 4.0]}
        out = decode_value(T_VECTOR, encode_value(T_VECTOR, v))
        self.assertEqual(len(out), 4)
        self.assertAlmostEqual(out[0], 1.0)
        self.assertAlmostEqual(out[3], 4.0)

    def test_document(self):
        v = {"fields": [{"name": "x", "value": 1}]}
        self.assertEqual(decode_value(T_DOCUMENT, encode_value(T_DOCUMENT, v)), v)

    def test_ts_point(self):
        v = (1718455845000000, 42.5)
        out = decode_value(T_TS_POINT, encode_value(T_TS_POINT, v))
        self.assertEqual(out, v)

    def test_ts_point_from_dict(self):
        v = {"ts": 1718455845000000, "value": 42.5}
        out = decode_value(T_TS_POINT, encode_value(T_TS_POINT, v))
        self.assertEqual(out, (1718455845000000, 42.5))

    def test_geo_point(self):
        v = (37747900, -122419400)
        out = decode_value(T_GEO_POINT, encode_value(T_GEO_POINT, v))
        self.assertEqual(out, v)

    def test_geo_point_from_dict(self):
        v = {"lat_e7": 37747900, "lon_e7": -122419400}
        out = decode_value(T_GEO_POINT, encode_value(T_GEO_POINT, v))
        self.assertEqual(out, (37747900, -122419400))


if __name__ == "__main__":
    unittest.main()
