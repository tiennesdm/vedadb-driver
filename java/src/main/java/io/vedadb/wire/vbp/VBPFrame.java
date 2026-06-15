package io.vedadb.wire.vbp;

import java.util.Objects;

/**
 * VBP frame: 8-byte header (3B magic 'VDB' + 4B LE payload_length + 1B seq) + body.
 *
 * <p>Wire layout (see VBP_SPEC.md §2):
 * <pre>
 *   +--------+---------+-----+-----+-----+----------+...+
 *   | 'VDB'  | len_le4 | seq | op  | flg |  body    |
 *   +--------+---------+-----+-----+-----+----------+...+
 *   | 3 B    | 4 B     | 1 B | 1 B | 1 B | (len-2)B |
 *   +--------+---------+-----+-----+-----+----------+...+
 * </pre>
 *
 * <p>Magic is the literal ASCII bytes 0x56 0x44 0x42.
 * payload_length is the op + flags + body size (little-endian u32).
 *
 * <p>MAX_FRAME_LEN is 64 MiB (matches the Go reference).
 */
public final class VBPFrame {
    public static final byte[] MAGIC = {'V', 'D', 'B'};
    public static final int MAGIC_LEN = 3;
    public static final int LEN_LEN = 4;
    public static final int SEQ_LEN = 1;
    public static final int HDR_LEN = MAGIC_LEN + LEN_LEN + SEQ_LEN; // 8
    public static final int OP_LEN = 1;
    public static final int FLAGS_LEN = 1;
    public static final int OPFLAGS_LEN = OP_LEN + FLAGS_LEN; // 2
    public static final int MAX_FRAME_LEN = 64 * 1024 * 1024; // 64 MiB

    public final int seq;
    public final int op;
    public final int flags;
    public final byte[] body;

    public VBPFrame(int seq, int op, int flags, byte[] body) {
        checkRange("seq", seq, 0, 0xFF);
        checkRange("op", op, 0, 0xFF);
        checkRange("flags", flags, 0, 0xFF);
        Objects.requireNonNull(body, "body");
        if (body.length > MAX_FRAME_LEN - OPFLAGS_LEN) {
            throw new VBPFrameTooLarge("body too large: " + body.length);
        }
        this.seq = seq;
        this.op = op;
        this.flags = flags;
        this.body = body;
    }

    public int payloadLength() {
        return OPFLAGS_LEN + body.length;
    }

    public int totalLength() {
        return HDR_LEN + OPFLAGS_LEN + body.length;
    }

    /** Encode this frame to a fresh byte array. */
    public byte[] encode() {
        byte[] out = new byte[totalLength()];
        int p = 0;
        out[p++] = MAGIC[0];
        out[p++] = MAGIC[1];
        out[p++] = MAGIC[2];
        int pl = payloadLength();
        out[p++] = (byte) (pl & 0xFF);
        out[p++] = (byte) ((pl >>> 8) & 0xFF);
        out[p++] = (byte) ((pl >>> 16) & 0xFF);
        out[p++] = (byte) ((pl >>> 24) & 0xFF);
        out[p++] = (byte) (seq & 0xFF);
        out[p++] = (byte) (op & 0xFF);
        out[p++] = (byte) (flags & 0xFF);
        if (body.length > 0) {
            System.arraycopy(body, 0, out, p, body.length);
        }
        return out;
    }

    /** Encode into an existing buffer at offset; returns bytes written. */
    public int encodeTo(byte[] out, int offset) {
        int p = offset;
        out[p++] = MAGIC[0];
        out[p++] = MAGIC[1];
        out[p++] = MAGIC[2];
        int pl = payloadLength();
        out[p++] = (byte) (pl & 0xFF);
        out[p++] = (byte) ((pl >>> 8) & 0xFF);
        out[p++] = (byte) ((pl >>> 16) & 0xFF);
        out[p++] = (byte) ((pl >>> 24) & 0xFF);
        out[p++] = (byte) (seq & 0xFF);
        out[p++] = (byte) (op & 0xFF);
        out[p++] = (byte) (flags & 0xFF);
        if (body.length > 0) {
            System.arraycopy(body, 0, out, p, body.length);
        }
        return p + body.length - offset;
    }

    /** Decode a frame from buf starting at offset. */
    public static VBPFrame decode(byte[] buf, int offset) {
        if (buf == null || buf.length - offset < HDR_LEN) {
            throw new VBPFrameTooShort("need at least " + HDR_LEN + " bytes");
        }
        if (buf[offset] != MAGIC[0] || buf[offset + 1] != MAGIC[1] || buf[offset + 2] != MAGIC[2]) {
            throw new VBPBadMagic("bad magic at offset " + offset);
        }
        int pl = (buf[offset + 3] & 0xFF)
                | ((buf[offset + 4] & 0xFF) << 8)
                | ((buf[offset + 5] & 0xFF) << 16)
                | ((buf[offset + 6] & 0xFF) << 24);
        int seq = buf[offset + 7] & 0xFF;
        if (pl < OPFLAGS_LEN) {
            throw new VBPFrameTooShort("payload_length " + pl + " < " + OPFLAGS_LEN);
        }
        if (pl > MAX_FRAME_LEN) {
            throw new VBPFrameTooLarge("payload_length " + pl + " > " + MAX_FRAME_LEN);
        }
        int need = HDR_LEN + pl;
        if (buf.length - offset < need) {
            throw new VBPFrameTooShort("buffer truncated: need " + need + ", have " + (buf.length - offset));
        }
        int op = buf[offset + HDR_LEN] & 0xFF;
        int flags = buf[offset + HDR_LEN + 1] & 0xFF;
        int bodyLen = pl - OPFLAGS_LEN;
        byte[] body = new byte[bodyLen];
        if (bodyLen > 0) {
            System.arraycopy(buf, offset + HDR_LEN + OPFLAGS_LEN, body, 0, bodyLen);
        }
        return new VBPFrame(seq, op, flags, body);
    }

    private static void checkRange(String name, int v, int lo, int hi) {
        if (v < lo || v > hi) {
            throw new IllegalArgumentException(name + " out of range: " + v);
        }
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof VBPFrame)) return false;
        VBPFrame other = (VBPFrame) o;
        return seq == other.seq && op == other.op && flags == other.flags
                && java.util.Arrays.equals(body, other.body);
    }

    @Override
    public int hashCode() {
        return seq * 31 + op;
    }

    @Override
    public String toString() {
        return "Frame(seq=" + seq + ", op=0x" + Integer.toHexString(op) + ", flags=0x"
                + Integer.toHexString(flags) + ", body_len=" + body.length + ")";
    }
}
