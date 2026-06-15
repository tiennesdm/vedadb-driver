package io.vedadb.wire.vbp;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class VBPFrameTest {

    @Test
    void roundTripEmptyBody() {
        VBPFrame f = new VBPFrame(1, VBPOpcodes.OP_PING, 0, new byte[0]);
        byte[] enc = f.encode();
        VBPFrame dec = VBPFrame.decode(enc, 0);
        assertEquals(1, dec.seq);
        assertEquals(VBPOpcodes.OP_PING, dec.op);
        assertEquals(0, dec.flags);
        assertEquals(0, dec.body.length);
    }

    @Test
    void roundTripWithBody() {
        byte[] body = {0x01, 0x02, 0x03, 0x04, 0x05};
        VBPFrame f = new VBPFrame(42, VBPOpcodes.OP_QUERY, 0, body);
        byte[] enc = f.encode();
        VBPFrame dec = VBPFrame.decode(enc, 0);
        assertEquals(42, dec.seq);
        assertEquals(VBPOpcodes.OP_QUERY, dec.op);
        assertArrayEquals(body, dec.body);
    }

    @Test
    void magicIsVDB() {
        assertEquals('V', VBPFrame.MAGIC[0]);
        assertEquals('D', VBPFrame.MAGIC[1]);
        assertEquals('B', VBPFrame.MAGIC[2]);
        assertEquals(3, VBPFrame.MAGIC.length);
    }

    @Test
    void headerIsEightBytes() {
        assertEquals(8, VBPFrame.HDR_LEN);
    }

    @Test
    void payloadLengthIsOpFlagsPlusBody() {
        VBPFrame f = new VBPFrame(1, VBPOpcodes.OP_QUERY, 0, new byte[10]);
        assertEquals(2 + 10, f.payloadLength());
    }

    @Test
    void totalLengthIsHeaderPlusPayload() {
        VBPFrame f = new VBPFrame(1, VBPOpcodes.OP_QUERY, 0, new byte[10]);
        assertEquals(8 + 2 + 10, f.totalLength());
    }

    @Test
    void badMagicThrows() {
        byte[] bad = new byte[20];
        bad[0] = 'X'; bad[1] = 'Y'; bad[2] = 'Z';
        assertThrows(VBPBadMagic.class, () -> VBPFrame.decode(bad, 0));
    }

    @Test
    void payloadTooShortThrows() {
        byte[] buf = new byte[10];
        buf[0] = 'V'; buf[1] = 'D'; buf[2] = 'B';
        // payload_length = 0
        assertThrows(VBPFrameTooShort.class, () -> VBPFrame.decode(buf, 0));
    }

    @Test
    void payloadTooLargeThrows() {
        byte[] buf = new byte[20];
        buf[0] = 'V'; buf[1] = 'D'; buf[2] = 'B';
        int pl = VBPFrame.MAX_FRAME_LEN + 1;
        buf[3] = (byte) (pl & 0xFF);
        buf[4] = (byte) ((pl >>> 8) & 0xFF);
        buf[5] = (byte) ((pl >>> 16) & 0xFF);
        buf[6] = (byte) ((pl >>> 24) & 0xFF);
        assertThrows(VBPFrameTooLarge.class, () -> VBPFrame.decode(buf, 0));
    }

    @Test
    void seqOutOfRangeThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> new VBPFrame(256, VBPOpcodes.OP_PING, 0, new byte[0]));
        assertThrows(IllegalArgumentException.class,
                () -> new VBPFrame(-1, VBPOpcodes.OP_PING, 0, new byte[0]));
    }

    @Test
    void opOutOfRangeThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> new VBPFrame(0, 256, 0, new byte[0]));
    }

    @Test
    void flagsOutOfRangeThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> new VBPFrame(0, 0, 256, new byte[0]));
    }

    @Test
    void encodeToBufferAtOffset() {
        VBPFrame f = new VBPFrame(7, VBPOpcodes.OP_PING, 0, new byte[]{1, 2, 3});
        byte[] buf = new byte[20];
        int n = f.encodeTo(buf, 5);
        assertEquals(f.totalLength(), n);
        VBPFrame dec = VBPFrame.decode(buf, 5);
        assertEquals(7, dec.seq);
        assertArrayEquals(new byte[]{1, 2, 3}, dec.body);
    }

    @Test
    void equalsAndHashCode() {
        VBPFrame a = new VBPFrame(1, VBPOpcodes.OP_PING, 0, new byte[]{1});
        VBPFrame b = new VBPFrame(1, VBPOpcodes.OP_PING, 0, new byte[]{1});
        VBPFrame c = new VBPFrame(1, VBPOpcodes.OP_PING, 0, new byte[]{2});
        assertEquals(a, b);
        assertNotEquals(a, c);
        assertEquals(a.hashCode(), b.hashCode());
    }

    @Test
    void toStringContainsFields() {
        VBPFrame f = new VBPFrame(0x10, VBPOpcodes.OP_QUERY, 0, new byte[100]);
        String s = f.toString();
        assertTrue(s.contains("seq=16"));
        assertTrue(s.contains("body_len=100"));
    }
}
