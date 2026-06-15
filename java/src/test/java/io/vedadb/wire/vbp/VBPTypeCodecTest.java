package io.vedadb.wire.vbp;

import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class VBPTypeCodecTest {

    @Test
    void encodeBoolTrue() {
        assertArrayEquals(new byte[]{1}, VBPTypeCodec.encodeBool(true));
    }

    @Test
    void encodeBoolFalse() {
        assertArrayEquals(new byte[]{0}, VBPTypeCodec.encodeBool(false));
    }

    @Test
    void encodeInt2() {
        assertArrayEquals(new byte[]{(byte) 0xFF, (byte) 0xFF}, VBPTypeCodec.encodeInt2((short) -1));
        assertArrayEquals(new byte[]{0x00, 0x7F}, VBPTypeCodec.encodeInt2((short) 32512));
    }

    @Test
    void encodeInt4LittleEndian() {
        assertArrayEquals(new byte[]{0x78, 0x56, 0x34, 0x12}, VBPTypeCodec.encodeInt4(0x12345678));
    }

    @Test
    void encodeInt8LittleEndian() {
        // 0x123456789ABCDEF0 little-endian: F0 DE BC 9A 78 56 34 12
        byte[] b = VBPTypeCodec.encodeInt8(0x123456789ABCDEF0L);
        assertEquals(8, b.length);
        assertEquals((byte) 0xF0, b[0]);
        assertEquals((byte) 0xDE, b[1]);
        assertEquals((byte) 0xBC, b[2]);
        assertEquals((byte) 0x9A, b[3]);
        assertEquals((byte) 0x78, b[4]);
        assertEquals((byte) 0x56, b[5]);
        assertEquals((byte) 0x34, b[6]);
        assertEquals((byte) 0x12, b[7]);
    }

    @Test
    void encodeDecodeRoundTripInt4() {
        byte[] enc = VBPTypeCodec.encodeInt4(0x12345678);
        assertEquals(0x12345678, VBPTypeCodec.decodeInt4(enc));
    }

    @Test
    void encodeDecodeRoundTripInt8() {
        byte[] enc = VBPTypeCodec.encodeInt8(-1L);
        assertEquals(-1L, VBPTypeCodec.decodeInt8(enc));
    }

    @Test
    void encodeFloat8Pi() {
        byte[] b = VBPTypeCodec.encodeFloat8(Math.PI);
        assertEquals(Math.PI, VBPTypeCodec.decodeFloat8(b), 1e-15);
    }

    @Test
    void encodeFloat4() {
        byte[] b = VBPTypeCodec.encodeFloat4(1.5f);
        assertEquals(1.5f, VBPTypeCodec.decodeFloat4(b), 1e-6);
    }

    @Test
    void encodeTextIsLengthPrefixed() {
        byte[] b = VBPTypeCodec.encodeText("hi");
        assertEquals(4 + 2, b.length);
        assertEquals(2, b[0]); // length
        assertEquals('h', b[4]);
        assertEquals('i', b[5]);
    }

    @Test
    void encodeDecodeText() {
        assertEquals("hello", VBPTypeCodec.decodeText(VBPTypeCodec.encodeText("hello")));
    }

    @Test
    void encodeEmptyText() {
        byte[] b = VBPTypeCodec.encodeText("");
        assertEquals(4, b.length);
        assertEquals(0, b[0]);
    }

    @Test
    void encodeByteaRoundTrip() {
        byte[] raw = {1, 2, 3, 4, 5};
        assertArrayEquals(raw, VBPTypeCodec.decodeBytea(VBPTypeCodec.encodeBytea(raw)));
    }

    @Test
    void encodeUuidIsSixteenBytes() {
        UUID u = UUID.fromString("12345678-1234-5678-1234-567812345678");
        byte[] b = VBPTypeCodec.encodeUuid(u);
        assertEquals(16, b.length);
        assertEquals(u, VBPTypeCodec.decodeUuid(b));
    }

    @Test
    void encodeTimestamp() {
        byte[] b = VBPTypeCodec.encodeTimestamp(0L);
        assertEquals(8, b.length);
        assertEquals(0L, VBPTypeCodec.decodeTimestamp(b));
    }

    @Test
    void encodeInterval() {
        byte[] b = VBPTypeCodec.encodeInterval(123_456L, 7, 3);
        assertEquals(16, b.length);
    }

    @Test
    void encodeMoney() {
        byte[] b = VBPTypeCodec.encodeMoney(100L);
        assertEquals(8, b.length);
    }

    @Test
    void inputEnvelopeNull() {
        byte[] env = VBPTypeCodec.inputEnvelopeNull(VBPOpcodes.T_INT4);
        assertEquals(3, env.length);
        assertEquals(1, env[0]); // NULL_TAG
        assertEquals(23, env[1] & 0xFF);
        assertEquals(0, env[2] & 0xFF);
    }

    @Test
    void inputEnvelopeNotNull() {
        byte[] body = VBPTypeCodec.encodeInt4(42);
        byte[] env = VBPTypeCodec.inputEnvelope(VBPOpcodes.T_INT4, body);
        assertEquals(3 + 4 + body.length, env.length);
        assertEquals(0, env[0]); // NOT_NULL tag
        assertEquals(23, env[1] & 0xFF);
    }

    @Test
    void outputEnvelopeRow() {
        byte[] body = VBPTypeCodec.encodeInt4(99);
        byte[] env = VBPTypeCodec.outputEnvelopeRow(new int[]{VBPOpcodes.T_INT4}, new byte[][]{body}, (byte) 0);
        assertTrue(env.length >= 4 + 4 + 2 + 1 + body.length);
    }

    @Test
    void selectOneRowIsValid() {
        byte[] b = VBPTypeCodec.selectOneRow();
        VBPTypeCodec.DataChunk dc = VBPTypeCodec.parseDataChunk(b);
        assertEquals(1, dc.nColumns);
        assertEquals(1, dc.rowValues.size());
        assertEquals(1, dc.rowValues.get(0));
    }

    @Test
    void rowsFinishedBody() {
        byte[] b = VBPTypeCodec.rowsFinished(5, 2, new int[]{23, 25});
        assertEquals(4 + 4 + 4, b.length);
    }

    @Test
    void commandCompleteBody() {
        byte[] b = VBPTypeCodec.commandComplete("INSERT 0 1", 1);
        assertEquals(4 + "INSERT 0 1".length() + 8, b.length);
    }

    @Test
    void errorBodyRoundTrip() {
        byte[] b = VBPTypeCodec.errorBody("42P01", "undefined table", "no detail", "use CREATE");
        VBPTypeCodec.ErrorParts ep = VBPTypeCodec.parseErrorBody(b);
        assertEquals("42P01", ep.sqlstate);
        assertEquals("undefined table", ep.message);
        assertEquals("no detail", ep.detail);
        assertEquals("use CREATE", ep.hint);
    }

    @Test
    void clientHelloBodyParsesBack() {
        byte[] b = VBPTypeCodec.clientHelloBody(1, 0, "admin", "main", (byte) 0, "admin");
        // Length: 2+2+4+5+4+4+1+4+5 = 31
        assertEquals(31, b.length);
    }

    @Test
    void serverReadyParse() {
        java.nio.ByteBuffer bb = java.nio.ByteBuffer.allocate(13).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        bb.putInt(0x000A0000); // v10.0.0
        bb.putInt(0x0000001F); // caps
        bb.put((byte) 0); // auth_required
        bb.putInt(0); // nonce_len
        VBPTypeCodec.ServerReadyParts sr = VBPTypeCodec.parseServerReady(bb.array());
        assertEquals(0x000A0000, sr.serverVersion);
        assertEquals(0x0000001F, sr.serverCaps);
        assertFalse(sr.authRequired);
    }

    @Test
    void serverReadyParseAuthRequired() {
        java.nio.ByteBuffer bb = java.nio.ByteBuffer.allocate(21).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        bb.putInt(0x000A0000);
        bb.putInt(0x0000001F);
        bb.put((byte) 1); // auth_required
        bb.putInt(8);
        byte[] nonce = {1,2,3,4,5,6,7,8};
        bb.put(nonce);
        VBPTypeCodec.ServerReadyParts sr = VBPTypeCodec.parseServerReady(bb.array());
        assertTrue(sr.authRequired);
        assertEquals(8, sr.nonce.length);
    }

    @Test
    void authOkParse() {
        java.nio.ByteBuffer bb = java.nio.ByteBuffer.allocate(20).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        bb.putLong(0xC0FFEE);
        bb.putLong(0x123456789ABCDEF0L);
        bb.putInt(0);
        VBPTypeCodec.AuthOkParts ok = VBPTypeCodec.parseAuthOk(bb.array());
        assertEquals(0xC0FFEE, ok.sessionTokenLo);
        assertEquals(0x123456789ABCDEF0L, ok.sessionTokenHi);
    }

    @Test
    void queryBodyParse() {
        byte[] body = VBPTypeCodec.queryBody(7, "SELECT 1", java.util.Collections.emptyList());
        VBPTypeCodec.QueryParts qp = VBPTypeCodec.parseQuery(body);
        assertEquals(7, qp.queryId);
        assertEquals("SELECT 1", qp.sql);
        assertEquals(0, qp.nParams);
    }
}
