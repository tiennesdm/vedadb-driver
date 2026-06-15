package io.vedadb.wire.vbp;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static io.vedadb.wire.vbp.VBPOpcodes.*;

/**
 * VBP type codecs — encode/decode Java values to/from wire body bytes.
 *
 * <p>Two envelope shapes (VBP_SPEC.md §5.1):
 * <ul>
 *   <li>Input envelope (per-value): u8 null_tag, [u16 type_id, [u32 len, body]] for non-null.
 *   <li>Output envelope (column-wide): u32 n_columns, u32 null_bitmap_bytes, [u16 col_type_id]*,
 *       u8 null_bitmap, then per-row bodies (NULLs are zero-filled for fixed-width types,
 *       length-prefixed bytes for variable-width).
 * </ul>
 *
 * <p>All multi-byte integers are little-endian.
 */
public final class VBPTypeCodec {

    public static final byte NULL_TAG_NULL = 1;
    public static final byte NULL_TAG_NOT_NULL = 0;

    private VBPTypeCodec() {}

    // ============================================================
    // Fixed-width encoders
    // ============================================================

    public static byte[] encodeBool(boolean v) {
        return new byte[]{(byte) (v ? 1 : 0)};
    }

    public static byte[] encodeInt2(short v) {
        return ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(v).array();
    }

    public static byte[] encodeInt4(int v) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(v).array();
    }

    public static byte[] encodeInt8(long v) {
        return ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(v).array();
    }

    public static byte[] encodeFloat4(float v) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putFloat(v).array();
    }

    public static byte[] encodeFloat8(double v) {
        return ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putDouble(v).array();
    }

    public static byte[] encodeBytea(byte[] v) {
        return lengthPrefixed(v);
    }

    public static byte[] encodeText(String v) {
        return lengthPrefixed(v.getBytes(StandardCharsets.UTF_8));
    }

    public static byte[] encodeVarchar(String v) {
        return lengthPrefixed(v.getBytes(StandardCharsets.UTF_8));
    }

    public static byte[] encodeUuid(UUID v) {
        byte[] b = new byte[16];
        ByteBuffer bb = ByteBuffer.wrap(b).order(ByteOrder.BIG_ENDIAN);
        bb.putLong(v.getMostSignificantBits());
        bb.putLong(v.getLeastSignificantBits());
        return b;
    }

    public static byte[] encodeDate(int daysSince1970) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(daysSince1970).array();
    }

    public static byte[] encodeTime(long micros) {
        return ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(micros).array();
    }

    public static byte[] encodeTimestamp(long micros) {
        return ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(micros).array();
    }

    public static byte[] encodeTimestamptz(long micros) {
        return encodeTimestamp(micros);
    }

    public static byte[] encodeInterval(long micros, int days, int months) {
        ByteBuffer bb = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN);
        bb.putLong(micros);
        bb.putInt(days);
        bb.putInt(months);
        return bb.array();
    }

    public static byte[] encodeNumeric(String s) {
        return lengthPrefixed(s.getBytes(StandardCharsets.US_ASCII));
    }

    public static byte[] encodeMoney(long cents) {
        return ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(cents).array();
    }

    public static byte[] encodeJson(String s) {
        return lengthPrefixed(s.getBytes(StandardCharsets.UTF_8));
    }

    public static byte[] encodeJsonb(String s) {
        return lengthPrefixed(s.getBytes(StandardCharsets.UTF_8));
    }

    public static byte[] lengthPrefixed(byte[] body) {
        ByteBuffer bb = ByteBuffer.allocate(4 + body.length).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(body.length);
        bb.put(body);
        return bb.array();
    }

    // ============================================================
    // Decoders
    // ============================================================

    public static boolean decodeBool(byte[] body) {
        if (body == null || body.length < 1) throw new IllegalArgumentException("BOOL body too short");
        return body[0] != 0;
    }

    public static int decodeInt4(byte[] body) {
        return ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN).getInt();
    }

    public static long decodeInt8(byte[] body) {
        return ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN).getLong();
    }

    public static short decodeInt2(byte[] body) {
        return ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN).getShort();
    }

    public static float decodeFloat4(byte[] body) {
        return ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN).getFloat();
    }

    public static double decodeFloat8(byte[] body) {
        return ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN).getDouble();
    }

    public static String decodeText(byte[] body) {
        if (body.length < 4) return "";
        int len = ByteBuffer.wrap(body, 0, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
        if (len == 0) return "";
        return new String(body, 4, Math.min(len, body.length - 4), StandardCharsets.UTF_8);
    }

    public static byte[] decodeBytea(byte[] body) {
        if (body.length < 4) return new byte[0];
        int len = ByteBuffer.wrap(body, 0, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
        if (len == 0) return new byte[0];
        byte[] out = new byte[len];
        System.arraycopy(body, 4, out, 0, Math.min(len, body.length - 4));
        return out;
    }

    public static UUID decodeUuid(byte[] body) {
        if (body.length < 16) throw new IllegalArgumentException("UUID body too short");
        ByteBuffer bb = ByteBuffer.wrap(body).order(ByteOrder.BIG_ENDIAN);
        return new UUID(bb.getLong(), bb.getLong());
    }

    public static long decodeTimestamp(byte[] body) {
        return ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN).getLong();
    }

    // ============================================================
    // Input envelope (per-value, used by QUERY/BIND/EXT_QUERY)
    // ============================================================

    /** Build input-envelope bytes for a typed value. */
    public static byte[] inputEnvelope(int typeId, byte[] body) {
        ByteBuffer bb;
        if (body == null) {
            // null
            bb = ByteBuffer.allocate(3).order(ByteOrder.LITTLE_ENDIAN);
            bb.put(NULL_TAG_NULL);
            bb.putShort((short) typeId);
        } else {
            bb = ByteBuffer.allocate(3 + 4 + body.length).order(ByteOrder.LITTLE_ENDIAN);
            bb.put(NULL_TAG_NOT_NULL);
            bb.putShort((short) typeId);
            bb.putInt(body.length);
            bb.put(body);
        }
        return bb.array();
    }

    public static byte[] inputEnvelopeNull(int typeId) {
        return inputEnvelope(typeId, null);
    }

    // ============================================================
    // Output envelope (column-wide, used by DATA_CHUNK)
    // ============================================================

    /**
     * Build an output-envelope DATA_CHUNK body for a single row of N columns.
     *
     * @param colTypes type IDs in column order
     * @param bodies   column bodies in column order (null = NULL column, zero-filled
     *                 for fixed-width or empty for variable-width)
     * @param nullBitmap null bitmap (1 = null). If null, all non-null.
     */
    public static byte[] outputEnvelopeRow(int[] colTypes, byte[][] bodies, byte nullBitmap) {
        int n = colTypes.length;
        // Header: u32 n_cols, u32 null_bitmap_bytes, col types
        int nullBmpBytes = (n + 7) / 8;
        int colTypeBytes = 2 * n;
        int bodyTotal = 0;
        for (byte[] b : bodies) bodyTotal += (b == null ? 0 : b.length);
        ByteBuffer bb = ByteBuffer.allocate(4 + 4 + colTypeBytes + nullBmpBytes + bodyTotal)
                .order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(n);
        bb.putInt(nullBmpBytes);
        for (int t : colTypes) bb.putShort((short) t);
        // null bitmap
        byte[] bmp = new byte[nullBmpBytes];
        bmp[0] = nullBitmap;
        bb.put(bmp);
        for (byte[] b : bodies) {
            if (b != null && b.length > 0) bb.put(b);
        }
        return bb.array();
    }

    /**
     * Helper: build an output-envelope for a single INT4 column "1" (the canonical
     * "SELECT 1" response).
     */
    public static byte[] selectOneRow() {
        return outputEnvelopeRow(new int[]{T_INT4}, new byte[][]{encodeInt4(1)}, (byte) 0);
    }

    // ============================================================
    // ROWS_FINISHED body
    // ============================================================

    /**
     * Build a ROWS_FINISHED body: u32 n_rows, u32 n_columns, [u16 col_type_id]*.
     * The commandTag is encoded in COMMAND_COMPLETE.
     */
    public static byte[] rowsFinished(int nRows, int nColumns, int[] colTypes) {
        ByteBuffer bb = ByteBuffer.allocate(4 + 4 + 2 * nColumns).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(nRows);
        bb.putInt(nColumns);
        for (int t : colTypes) bb.putShort((short) t);
        return bb.array();
    }

    /**
     * Build a COMMAND_COMPLETE body: u32 len, ascii tag, u64 rowsAffected.
     */
    public static byte[] commandComplete(String tag, long rowsAffected) {
        byte[] tagBytes = tag.getBytes(StandardCharsets.US_ASCII);
        ByteBuffer bb = ByteBuffer.allocate(4 + tagBytes.length + 8).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(tagBytes.length);
        bb.put(tagBytes);
        bb.putLong(rowsAffected);
        return bb.array();
    }

    // ============================================================
    // ERROR body
    // ============================================================

    public static byte[] errorBody(String sqlstate, String message, String detail, String hint) {
        byte[] ss = sqlstate.getBytes(StandardCharsets.US_ASCII);
        byte[] msg = message.getBytes(StandardCharsets.UTF_8);
        byte[] dtl = detail == null ? new byte[0] : detail.getBytes(StandardCharsets.UTF_8);
        byte[] hnt = hint == null ? new byte[0] : hint.getBytes(StandardCharsets.UTF_8);
        ByteBuffer bb = ByteBuffer.allocate(5 + 4 + msg.length + 4 + dtl.length + 4 + hnt.length + 4)
                .order(ByteOrder.LITTLE_ENDIAN);
        if (ss.length >= 5) bb.put(ss, 0, 5);
        else {
            bb.put(ss);
            for (int i = ss.length; i < 5; i++) bb.put((byte) '0');
        }
        bb.putInt(msg.length); bb.put(msg);
        bb.putInt(dtl.length); bb.put(dtl);
        bb.putInt(hnt.length); bb.put(hnt);
        bb.putInt(0); // position
        return bb.array();
    }

    public static class ErrorParts {
        public final String sqlstate;
        public final String message;
        public final String detail;
        public final String hint;
        public ErrorParts(String s, String m, String d, String h) {
            this.sqlstate = s; this.message = m; this.detail = d; this.hint = h;
        }
    }

    public static ErrorParts parseErrorBody(byte[] body) {
        if (body.length < 5) return new ErrorParts("0A000", "truncated error body", "", "");
        String ss = new String(body, 0, 5, StandardCharsets.US_ASCII);
        ByteBuffer bb = ByteBuffer.wrap(body, 5, body.length - 5).order(ByteOrder.LITTLE_ENDIAN);
        int mLen = bb.getInt();
        // Skip message bytes in the buffer so subsequent reads align.
        if (mLen > 0 && bb.remaining() >= mLen) bb.position(bb.position() + mLen);
        String m = mLen > 0 && body.length >= 9 + mLen
                ? new String(body, 9, mLen, StandardCharsets.UTF_8) : "";
        if (bb.remaining() < 4) return new ErrorParts(ss, m, "", "");
        int dLen = bb.getInt();
        if (dLen > 0 && bb.remaining() >= dLen) bb.position(bb.position() + dLen);
        String d = dLen > 0 && body.length >= 13 + mLen + dLen
                ? new String(body, 13 + mLen, dLen, StandardCharsets.UTF_8) : "";
        if (bb.remaining() < 4) return new ErrorParts(ss, m, d, "");
        int hLen = bb.getInt();
        String h = hLen > 0 && bb.remaining() >= hLen
                ? new String(body, 17 + mLen + dLen, hLen, StandardCharsets.UTF_8) : "";
        return new ErrorParts(ss, m, d, h);
    }

    // ============================================================
    // CLIENT_HELLO body
    // ============================================================

    public static byte[] clientHelloBody(int protocolVersion, int clientFlags,
                                         String username, String database,
                                         byte actorKind, String actorId) {
        byte[] u = username.getBytes(StandardCharsets.UTF_8);
        byte[] d = database.getBytes(StandardCharsets.UTF_8);
        byte[] a = actorId.getBytes(StandardCharsets.UTF_8);
        ByteBuffer bb = ByteBuffer.allocate(2 + 2 + 4 + u.length + 4 + d.length + 1 + 4 + a.length)
                .order(ByteOrder.LITTLE_ENDIAN);
        bb.putShort((short) protocolVersion);
        bb.putShort((short) clientFlags);
        bb.putInt(u.length); bb.put(u);
        bb.putInt(d.length); bb.put(d);
        bb.put(actorKind);
        bb.putInt(a.length); bb.put(a);
        return bb.array();
    }

    // ============================================================
    // SERVER_READY body parser
    // ============================================================

    public static class ServerReadyParts {
        public final int serverVersion;
        public final int serverCaps;
        public final boolean authRequired;
        public final byte[] nonce;
        public ServerReadyParts(int v, int c, boolean a, byte[] n) {
            this.serverVersion = v; this.serverCaps = c; this.authRequired = a; this.nonce = n;
        }
    }

    public static ServerReadyParts parseServerReady(byte[] body) {
        ByteBuffer bb = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN);
        int version = bb.getInt();
        int caps = bb.getInt();
        boolean authReq = bb.get() != 0;
        int nLen = bb.getInt();
        byte[] nonce = new byte[Math.max(0, nLen)];
        if (nLen > 0) bb.get(nonce);
        return new ServerReadyParts(version, caps, authReq, nonce);
    }

    // ============================================================
    // AUTH_OK body
    // ============================================================

    public static class AuthOkParts {
        public final long sessionTokenLo;
        public final long sessionTokenHi;
        public final int serverFlags;
        public AuthOkParts(long lo, long hi, int f) {
            this.sessionTokenLo = lo; this.sessionTokenHi = hi; this.serverFlags = f;
        }
    }

    public static AuthOkParts parseAuthOk(byte[] body) {
        ByteBuffer bb = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN);
        return new AuthOkParts(bb.getLong(), bb.getLong(), bb.getInt());
    }

    // ============================================================
    // QUERY body
    // ============================================================

    public static byte[] queryBody(int queryId, String sql, List<byte[]> paramEnvelopes) {
        byte[] sqlBytes = sql.getBytes(StandardCharsets.UTF_8);
        ByteBuffer bb = ByteBuffer.allocate(4 + 4 + sqlBytes.length + 4)
                .order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(queryId);
        bb.putInt(sqlBytes.length);
        bb.put(sqlBytes);
        bb.putInt(paramEnvelopes == null ? 0 : paramEnvelopes.size());
        if (paramEnvelopes != null) {
            for (byte[] env : paramEnvelopes) bb.put(env);
        }
        return bb.array();
    }

    public static class QueryParts {
        public final int queryId;
        public final String sql;
        public final int nParams;
        public QueryParts(int q, String s, int n) { queryId = q; sql = s; nParams = n; }
    }

    public static QueryParts parseQuery(byte[] body) {
        ByteBuffer bb = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN);
        int qid = bb.getInt();
        int tlen = bb.getInt();
        if (tlen > 0 && bb.remaining() >= tlen) bb.position(bb.position() + tlen);
        String sql = tlen > 0 && body.length >= 8 + tlen
                ? new String(body, 8, tlen, StandardCharsets.UTF_8) : "";
        int nParams = bb.remaining() >= 4 ? bb.getInt() : 0;
        return new QueryParts(qid, sql, nParams);
    }

    // ============================================================
    // DATA_CHUNK body parser
    // ============================================================

    public static class DataChunk {
        public final int nColumns;
        public final byte nullBitmap;
        public final int[] colTypes;
        public final List<Object> rowValues;
        public DataChunk(int n, byte bm, int[] types, List<Object> vals) {
            nColumns = n; nullBitmap = bm; colTypes = types; rowValues = vals;
        }
    }

    /** Parse a single-row DATA_CHUNK. Multi-row DATA_CHUNK is server-only in v1. */
    public static DataChunk parseDataChunk(byte[] body) {
        if (body == null || body.length < 8) {
            return new DataChunk(0, (byte) 0, new int[0], new ArrayList<>());
        }
        ByteBuffer bb = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN);
        int nCols = bb.getInt();
        int nullBmpBytes = bb.getInt();
        int[] types = new int[nCols];
        for (int i = 0; i < nCols; i++) types[i] = bb.getShort() & 0xFFFF;
        byte[] bmp = new byte[nullBmpBytes];
        bb.get(bmp);
        byte firstBmp = bmp.length > 0 ? bmp[0] : 0;
        List<Object> vals = new ArrayList<>();
        for (int i = 0; i < nCols; i++) {
            boolean isNull = ((firstBmp >> i) & 1) == 1;
            if (isNull) {
                vals.add(null);
                continue;
            }
            int t = types[i];
            switch (t) {
                case T_BOOL: vals.add(bb.get() != 0); break;
                case T_INT2: vals.add(bb.getShort()); break;
                case T_INT4: vals.add(bb.getInt()); break;
                case T_INT8: vals.add(bb.getLong()); break;
                case T_FLOAT4: vals.add(bb.getFloat()); break;
                case T_FLOAT8: vals.add(bb.getDouble()); break;
                case T_TEXT: case T_VARCHAR: case T_JSON: case T_JSONB: case T_BYTEA: {
                    int len = bb.getInt();
                    byte[] buf = new byte[len];
                    bb.get(buf);
                    vals.add(t == T_BYTEA ? buf : new String(buf, StandardCharsets.UTF_8));
                    break;
                }
                default: vals.add(null); break;
            }
        }
        return new DataChunk(nCols, firstBmp, types, vals);
    }
}
