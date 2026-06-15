// VedaDB .NET SDK — VBP wire layer
//
// VBP type codecs — encode/decode .NET values to/from wire body bytes.
//
// Two envelope shapes (VBP_SPEC.md §5.1):
//   - Input envelope (per-value): u8 null_tag, [u16 type_id, [u32 len, body]] for non-null.
//   - Output envelope (column-wide, used by DATA_CHUNK):
//       u32 n_columns, u32 null_bitmap_bytes, [u16 col_type_id]*, u8 null_bitmap,
//       then per-row bodies (NULLs are zero-filled for fixed-width types,
//       length-prefixed bytes for variable-width).
//
// All multi-byte integers are little-endian.

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Text;

namespace VedaDB.Wire.Vbp
{
    public static class VBPTypeCodec
    {
        public const byte NullTagNull    = 1;
        public const byte NullTagNotNull = 0;

        // ============================================================
        // Fixed-width encoders
        // ============================================================

        public static byte[] EncodeBool(bool v) => new byte[] { (byte)(v ? 1 : 0) };

        public static byte[] EncodeInt2(short v)
        {
            var b = new byte[2];
            BinaryPrimitives.WriteInt16LittleEndian(b, v);
            return b;
        }

        public static byte[] EncodeInt4(int v)
        {
            var b = new byte[4];
            BinaryPrimitives.WriteInt32LittleEndian(b, v);
            return b;
        }

        public static byte[] EncodeInt8(long v)
        {
            var b = new byte[8];
            BinaryPrimitives.WriteInt64LittleEndian(b, v);
            return b;
        }

        public static byte[] EncodeFloat4(float v)
        {
            var b = new byte[4];
            BinaryPrimitives.WriteSingleLittleEndian(b, v);
            return b;
        }

        public static byte[] EncodeFloat8(double v)
        {
            var b = new byte[8];
            BinaryPrimitives.WriteDoubleLittleEndian(b, v);
            return b;
        }

        public static byte[] EncodeBytea(byte[] v) => LengthPrefixed(v);

        public static byte[] EncodeText(string v) => LengthPrefixed(Encoding.UTF8.GetBytes(v));
        public static byte[] EncodeVarchar(string v) => LengthPrefixed(Encoding.UTF8.GetBytes(v));

        public static byte[] EncodeUuid(Guid v)
        {
            // Wire order: BIG-endian (matches the Go reference and Java POC).
            var b = v.ToByteArray(); // .NET returns mixed-endian for Guid
            // Reorder to canonical big-endian byte order.
            return ReorderGuidToBigEndian(b);
        }

        private static byte[] ReorderGuidToBigEndian(byte[] mixed)
        {
            // .NET Guid layout: int32 (LE) | int16 (LE) | int16 (LE) | 8 bytes (BE)
            // We need a fully big-endian encoding for wire compatibility.
            var b = new byte[16];
            // Swap the first 4 bytes (LE int32 -> BE)
            b[0] = mixed[3]; b[1] = mixed[2]; b[2] = mixed[1]; b[3] = mixed[0];
            // Swap next 2 bytes (LE int16 -> BE)
            b[4] = mixed[5]; b[5] = mixed[4];
            // Swap next 2 bytes (LE int16 -> BE)
            b[6] = mixed[7]; b[7] = mixed[6];
            // Last 8 bytes already BE
            Buffer.BlockCopy(mixed, 8, b, 8, 8);
            return b;
        }

        public static byte[] EncodeDate(int daysSince1970) => EncodeInt4(daysSince1970);
        public static byte[] EncodeTime(long micros) => EncodeInt8(micros);
        public static byte[] EncodeTimestamp(long micros) => EncodeInt8(micros);
        public static byte[] EncodeTimestamptz(long micros) => EncodeInt8(micros);

        public static byte[] EncodeInterval(long micros, int days, int months)
        {
            var b = new byte[16];
            BinaryPrimitives.WriteInt64LittleEndian(b.AsSpan(0, 8), micros);
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(8, 4), days);
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(12, 4), months);
            return b;
        }

        public static byte[] EncodeNumeric(string s) => LengthPrefixed(Encoding.ASCII.GetBytes(s));
        public static byte[] EncodeMoney(long cents) => EncodeInt8(cents);
        public static byte[] EncodeJson(string s) => LengthPrefixed(Encoding.UTF8.GetBytes(s));
        public static byte[] EncodeJsonb(string s) => LengthPrefixed(Encoding.UTF8.GetBytes(s));

        public static byte[] LengthPrefixed(byte[] body)
        {
            var b = new byte[4 + body.Length];
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(0, 4), body.Length);
            Buffer.BlockCopy(body, 0, b, 4, body.Length);
            return b;
        }

        // ============================================================
        // Decoders
        // ============================================================

        public static bool DecodeBool(byte[] body)
        {
            if (body == null || body.Length < 1) throw new ArgumentException("BOOL body too short");
            return body[0] != 0;
        }

        public static int DecodeInt4(byte[] body) =>
            BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(0, 4));

        public static long DecodeInt8(byte[] body) =>
            BinaryPrimitives.ReadInt64LittleEndian(body.AsSpan(0, 8));

        public static short DecodeInt2(byte[] body) =>
            BinaryPrimitives.ReadInt16LittleEndian(body.AsSpan(0, 2));

        public static float DecodeFloat4(byte[] body) =>
            BinaryPrimitives.ReadSingleLittleEndian(body.AsSpan(0, 4));

        public static double DecodeFloat8(byte[] body) =>
            BinaryPrimitives.ReadDoubleLittleEndian(body.AsSpan(0, 8));

        public static string DecodeText(byte[] body)
        {
            if (body.Length < 4) return "";
            int len = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(0, 4));
            if (len == 0 || body.Length < 4 + len) return "";
            return Encoding.UTF8.GetString(body, 4, Math.Min(len, body.Length - 4));
        }

        public static byte[] DecodeBytea(byte[] body)
        {
            if (body.Length < 4) return Array.Empty<byte>();
            int len = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(0, 4));
            if (len == 0 || body.Length < 4 + len) return Array.Empty<byte>();
            var out_ = new byte[len];
            Buffer.BlockCopy(body, 4, out_, 0, Math.Min(len, body.Length - 4));
            return out_;
        }

        public static Guid DecodeUuid(byte[] body)
        {
            if (body.Length < 16) throw new ArgumentException("UUID body too short");
            // Reverse of ReorderGuidToBigEndian
            var mixed = new byte[16];
            mixed[0] = body[3]; mixed[1] = body[2]; mixed[2] = body[1]; mixed[3] = body[0];
            mixed[4] = body[5]; mixed[5] = body[4];
            mixed[6] = body[7]; mixed[7] = body[6];
            Buffer.BlockCopy(body, 8, mixed, 8, 8);
            return new Guid(mixed);
        }

        public static long DecodeTimestamp(byte[] body) => DecodeInt8(body);

        // ============================================================
        // Input envelope (per-value, used by QUERY/BIND/EXT_QUERY)
        // ============================================================

        /// <summary>Build input-envelope bytes for a typed value. body == null → NULL.</summary>
        public static byte[] InputEnvelope(ushort typeId, byte[]? body)
        {
            if (body == null)
            {
                var b = new byte[3];
                b[0] = NullTagNull;
                BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(1, 2), typeId);
                return b;
            }
            var buf = new byte[3 + 4 + body.Length];
            buf[0] = NullTagNotNull;
            BinaryPrimitives.WriteUInt16LittleEndian(buf.AsSpan(1, 2), typeId);
            BinaryPrimitives.WriteInt32LittleEndian(buf.AsSpan(3, 4), body.Length);
            Buffer.BlockCopy(body, 0, buf, 7, body.Length);
            return buf;
        }

        public static byte[] InputEnvelopeNull(ushort typeId) => InputEnvelope(typeId, null);

        // ============================================================
        // Output envelope (column-wide, used by DATA_CHUNK)
        // ============================================================

        /// <summary>Build an output-envelope DATA_CHUNK body for a single row of N columns.</summary>
        public static byte[] OutputEnvelopeRow(ushort[] colTypes, byte[][]? bodies, byte nullBitmap)
        {
            int n = colTypes.Length;
            int nullBmpBytes = (n + 7) / 8;
            int colTypeBytes = 2 * n;
            int bodyTotal = 0;
            if (bodies != null)
            {
                foreach (var b in bodies) bodyTotal += b == null ? 0 : b.Length;
            }
            var bb = new byte[4 + 4 + colTypeBytes + nullBmpBytes + bodyTotal];
            int p = 0;
            BinaryPrimitives.WriteInt32LittleEndian(bb.AsSpan(p, 4), n); p += 4;
            BinaryPrimitives.WriteInt32LittleEndian(bb.AsSpan(p, 4), nullBmpBytes); p += 4;
            for (int i = 0; i < n; i++)
            {
                BinaryPrimitives.WriteUInt16LittleEndian(bb.AsSpan(p, 2), colTypes[i]);
                p += 2;
            }
            // null bitmap (only first byte is meaningful for ≤8 cols)
            bb[p] = nullBitmap;
            p += nullBmpBytes;
            if (bodies != null)
            {
                foreach (var b in bodies)
                {
                    if (b != null && b.Length > 0)
                    {
                        Buffer.BlockCopy(b, 0, bb, p, b.Length);
                        p += b.Length;
                    }
                }
            }
            return bb;
        }

        /// <summary>Helper: build an output-envelope for a single INT4 column "1" (canonical "SELECT 1").</summary>
        public static byte[] SelectOneRow() =>
            OutputEnvelopeRow(new ushort[] { VBPTypeIds.Int4 }, new byte[][] { EncodeInt4(1) }, 0);

        // ============================================================
        // ROWS_FINISHED body
        // ============================================================

        public static byte[] RowsFinished(int nRows, int nColumns, ushort[] colTypes)
        {
            var b = new byte[4 + 4 + 2 * nColumns];
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(0, 4), nRows);
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(4, 4), nColumns);
            int p = 8;
            for (int i = 0; i < nColumns; i++)
            {
                BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(p, 2), colTypes[i]);
                p += 2;
            }
            return b;
        }

        // ============================================================
        // COMMAND_COMPLETE body
        // ============================================================

        public static byte[] CommandComplete(string tag, long rowsAffected)
        {
            var tagBytes = Encoding.ASCII.GetBytes(tag);
            var b = new byte[4 + tagBytes.Length + 8];
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(0, 4), tagBytes.Length);
            Buffer.BlockCopy(tagBytes, 0, b, 4, tagBytes.Length);
            BinaryPrimitives.WriteInt64LittleEndian(b.AsSpan(4 + tagBytes.Length, 8), rowsAffected);
            return b;
        }

        // ============================================================
        // ERROR body
        // ============================================================

        public static byte[] ErrorBody(string sqlState, string message, string? detail, string? hint)
        {
            var ss = Encoding.ASCII.GetBytes(sqlState);
            var msg = Encoding.UTF8.GetBytes(message);
            var dtl = detail == null ? Array.Empty<byte>() : Encoding.UTF8.GetBytes(detail);
            var hnt = hint == null ? Array.Empty<byte>() : Encoding.UTF8.GetBytes(hint);

            var b = new byte[5 + 4 + msg.Length + 4 + dtl.Length + 4 + hnt.Length + 4];
            int p = 0;
            int copy = Math.Min(5, ss.Length);
            Buffer.BlockCopy(ss, 0, b, p, copy);
            for (int i = copy; i < 5; i++) b[p + i] = (byte)'0';
            p += 5;

            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), msg.Length);
            p += 4;
            Buffer.BlockCopy(msg, 0, b, p, msg.Length);
            p += msg.Length;

            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), dtl.Length);
            p += 4;
            if (dtl.Length > 0) Buffer.BlockCopy(dtl, 0, b, p, dtl.Length);
            p += dtl.Length;

            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), hnt.Length);
            p += 4;
            if (hnt.Length > 0) Buffer.BlockCopy(hnt, 0, b, p, hnt.Length);
            p += hnt.Length;

            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), 0); // position
            return b;
        }

        public sealed class ErrorParts
        {
            public string SqlState { get; }
            public string Message { get; }
            public string Detail { get; }
            public string Hint { get; }
            public ErrorParts(string s, string m, string d, string h)
            {
                SqlState = s; Message = m; Detail = d; Hint = h;
            }
        }

        public static ErrorParts ParseErrorBody(byte[] body)
        {
            if (body == null || body.Length < 5)
                return new ErrorParts("0A000", "truncated error body", "", "");
            var ss = Encoding.ASCII.GetString(body, 0, 5);
            int p = 5;
            if (body.Length < p + 4) return new ErrorParts(ss, "", "", "");
            int mLen = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(p, 4));
            p += 4;
            string m = "";
            if (mLen > 0 && body.Length >= p + mLen)
            {
                m = Encoding.UTF8.GetString(body, p, Math.Min(mLen, body.Length - p));
                p += mLen;
            }
            if (body.Length < p + 4) return new ErrorParts(ss, m, "", "");
            int dLen = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(p, 4));
            p += 4;
            string d = "";
            if (dLen > 0 && body.Length >= p + dLen)
            {
                d = Encoding.UTF8.GetString(body, p, Math.Min(dLen, body.Length - p));
                p += dLen;
            }
            if (body.Length < p + 4) return new ErrorParts(ss, m, d, "");
            int hLen = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(p, 4));
            p += 4;
            string h = "";
            if (hLen > 0 && body.Length >= p + hLen)
            {
                h = Encoding.UTF8.GetString(body, p, Math.Min(hLen, body.Length - p));
            }
            return new ErrorParts(ss, m, d, h);
        }

        // ============================================================
        // CLIENT_HELLO body
        // ============================================================

        public static byte[] ClientHelloBody(ushort protocolVersion, ushort clientFlags,
                                             string username, string database,
                                             byte actorKind, string actorId)
        {
            var u = Encoding.UTF8.GetBytes(username);
            var d = Encoding.UTF8.GetBytes(database);
            var a = Encoding.UTF8.GetBytes(actorId);
            var b = new byte[2 + 2 + 4 + u.Length + 4 + d.Length + 1 + 4 + a.Length];
            int p = 0;
            BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(p, 2), protocolVersion);
            p += 2;
            BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(p, 2), clientFlags);
            p += 2;
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), u.Length);
            p += 4;
            Buffer.BlockCopy(u, 0, b, p, u.Length);
            p += u.Length;
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), d.Length);
            p += 4;
            Buffer.BlockCopy(d, 0, b, p, d.Length);
            p += d.Length;
            b[p++] = actorKind;
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), a.Length);
            p += 4;
            Buffer.BlockCopy(a, 0, b, p, a.Length);
            return b;
        }

        // ============================================================
        // SERVER_READY body parser
        // ============================================================

        public sealed class ServerReadyParts
        {
            public int ServerVersion { get; }
            public int ServerCaps { get; }
            public bool AuthRequired { get; }
            public byte[] Nonce { get; }
            public ServerReadyParts(int v, int c, bool a, byte[] n)
            {
                ServerVersion = v; ServerCaps = c; AuthRequired = a; Nonce = n;
            }
        }

        public static ServerReadyParts ParseServerReady(byte[] body)
        {
            int version = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(0, 4));
            int caps = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(4, 4));
            bool authReq = body[8] != 0;
            int nLen = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(9, 4));
            byte[] nonce = Array.Empty<byte>();
            if (nLen > 0 && body.Length >= 13 + nLen)
            {
                nonce = new byte[nLen];
                Buffer.BlockCopy(body, 13, nonce, 0, Math.Min(nLen, body.Length - 13));
            }
            return new ServerReadyParts(version, caps, authReq, nonce);
        }

        // ============================================================
        // AUTH_OK body parser
        // ============================================================

        public sealed class AuthOkParts
        {
            public long SessionTokenLo { get; }
            public long SessionTokenHi { get; }
            public int ServerFlags { get; }
            public AuthOkParts(long lo, long hi, int f)
            {
                SessionTokenLo = lo; SessionTokenHi = hi; ServerFlags = f;
            }
        }

        public static AuthOkParts ParseAuthOk(byte[] body)
        {
            long lo = BinaryPrimitives.ReadInt64LittleEndian(body.AsSpan(0, 8));
            long hi = BinaryPrimitives.ReadInt64LittleEndian(body.AsSpan(8, 8));
            int flags = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(16, 4));
            return new AuthOkParts(lo, hi, flags);
        }

        // ============================================================
        // QUERY body
        // ============================================================

        public static byte[] QueryBody(int queryId, string sql, List<byte[]>? paramEnvelopes)
        {
            var sqlBytes = Encoding.UTF8.GetBytes(sql);
            int nParams = paramEnvelopes?.Count ?? 0;
            int total = 4 + 4 + sqlBytes.Length + 4;
            foreach (var env in paramEnvelopes ?? new List<byte[]>()) total += env.Length;
            var b = new byte[total];
            int p = 0;
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), queryId);
            p += 4;
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), sqlBytes.Length);
            p += 4;
            Buffer.BlockCopy(sqlBytes, 0, b, p, sqlBytes.Length);
            p += sqlBytes.Length;
            BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(p, 4), nParams);
            p += 4;
            if (paramEnvelopes != null)
            {
                foreach (var env in paramEnvelopes)
                {
                    Buffer.BlockCopy(env, 0, b, p, env.Length);
                    p += env.Length;
                }
            }
            return b;
        }

        public sealed class QueryParts
        {
            public int QueryId { get; }
            public string Sql { get; }
            public int NParams { get; }
            public QueryParts(int q, string s, int n) { QueryId = q; Sql = s; NParams = n; }
        }

        public static QueryParts ParseQuery(byte[] body)
        {
            int qid = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(0, 4));
            int tlen = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(4, 4));
            string sql = "";
            if (tlen > 0 && body.Length >= 8 + tlen)
            {
                sql = Encoding.UTF8.GetString(body, 8, Math.Min(tlen, body.Length - 8));
            }
            int nParams = body.Length >= 12 + tlen
                ? BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(8 + tlen, 4)) : 0;
            return new QueryParts(qid, sql, nParams);
        }

        // ============================================================
        // DATA_CHUNK body parser (single-row v1 POC)
        // ============================================================

        public sealed class DataChunk
        {
            public int NColumns { get; }
            public byte NullBitmap { get; }
            public ushort[] ColTypes { get; }
            public List<object?> RowValues { get; }
            public DataChunk(int n, byte bm, ushort[] types, List<object?> vals)
            {
                NColumns = n; NullBitmap = bm; ColTypes = types; RowValues = vals;
            }
        }

        public static DataChunk ParseDataChunk(byte[] body)
        {
            if (body == null || body.Length < 8)
                return new DataChunk(0, 0, Array.Empty<ushort>(), new List<object?>());
            int p = 0;
            int nCols = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(p, 4));
            p += 4;
            int nullBmpBytes = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(p, 4));
            p += 4;
            var types = new ushort[nCols];
            for (int i = 0; i < nCols; i++)
            {
                types[i] = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(p, 2));
                p += 2;
            }
            byte firstBmp = (nullBmpBytes > 0 && body.Length > p) ? body[p] : (byte)0;
            p += nullBmpBytes;
            var vals = new List<object?>();
            for (int i = 0; i < nCols; i++)
            {
                bool isNull = ((firstBmp >> i) & 1) == 1;
                if (isNull) { vals.Add(null); continue; }
                ushort t = types[i];
                switch (t)
                {
                    case VBPTypeIds.Bool:
                        if (p < body.Length) { vals.Add(body[p] != 0); p++; } else vals.Add(null);
                        break;
                    case VBPTypeIds.Int2:
                        if (p + 2 <= body.Length)
                        {
                            vals.Add(BinaryPrimitives.ReadInt16LittleEndian(body.AsSpan(p, 2)));
                            p += 2;
                        }
                        else vals.Add(null);
                        break;
                    case VBPTypeIds.Int4:
                        if (p + 4 <= body.Length)
                        {
                            vals.Add(BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(p, 4)));
                            p += 4;
                        }
                        else vals.Add(null);
                        break;
                    case VBPTypeIds.Int8:
                        if (p + 8 <= body.Length)
                        {
                            vals.Add(BinaryPrimitives.ReadInt64LittleEndian(body.AsSpan(p, 8)));
                            p += 8;
                        }
                        else vals.Add(null);
                        break;
                    case VBPTypeIds.Float4:
                        if (p + 4 <= body.Length)
                        {
                            vals.Add(BinaryPrimitives.ReadSingleLittleEndian(body.AsSpan(p, 4)));
                            p += 4;
                        }
                        else vals.Add(null);
                        break;
                    case VBPTypeIds.Float8:
                        if (p + 8 <= body.Length)
                        {
                            vals.Add(BinaryPrimitives.ReadDoubleLittleEndian(body.AsSpan(p, 8)));
                            p += 8;
                        }
                        else vals.Add(null);
                        break;
                    case VBPTypeIds.Text:
                    case VBPTypeIds.Varchar:
                    case VBPTypeIds.Json:
                    case VBPTypeIds.Jsonb:
                    case VBPTypeIds.Bytea:
                        if (p + 4 <= body.Length)
                        {
                            int len = BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(p, 4));
                            p += 4;
                            if (p + len <= body.Length)
                            {
                                if (t == VBPTypeIds.Bytea)
                                {
                                    var buf = new byte[len];
                                    Buffer.BlockCopy(body, p, buf, 0, len);
                                    vals.Add(buf);
                                }
                                else
                                {
                                    vals.Add(Encoding.UTF8.GetString(body, p, len));
                                }
                                p += len;
                            }
                            else vals.Add(null);
                        }
                        else vals.Add(null);
                        break;
                    default:
                        vals.Add(null);
                        break;
                }
            }
            return new DataChunk(nCols, firstBmp, types, vals);
        }
    }
}
