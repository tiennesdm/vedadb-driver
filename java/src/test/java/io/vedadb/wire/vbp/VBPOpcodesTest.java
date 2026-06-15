package io.vedadb.wire.vbp;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class VBPOpcodesTest {

    @Test
    void mandatoryOpcodesCountIs23() {
        assertEquals(23, VBPOpcodes.MANDATORY_OPCODES.length);
    }

    @Test
    void clientHelloIsOne() {
        assertEquals(0x01, VBPOpcodes.OP_CLIENT_HELLO);
    }

    @Test
    void serverReadyIsTwo() {
        assertEquals(0x02, VBPOpcodes.OP_SERVER_READY);
    }

    @Test
    void closeIs0x18() {
        assertEquals(0x18, VBPOpcodes.OP_CLOSE);
    }

    @Test
    void pingPongAre0x16_0x17() {
        assertEquals(0x16, VBPOpcodes.OP_PING);
        assertEquals(0x17, VBPOpcodes.OP_PONG);
    }

    @Test
    void opcodeNameKnown() {
        assertEquals("CLIENT_HELLO", VBPOpcodes.opcodeName(0x01));
        assertEquals("PING", VBPOpcodes.opcodeName(0x16));
    }

    @Test
    void opcodeNameUnknown() {
        String n = VBPOpcodes.opcodeName(0xFE);
        assertTrue(n.startsWith("OP_0x"));
    }

    @Test
    void allTypeIdsCountIs38() {
        // 36 per VBP_SPEC.md §5.10 (the spec text "27" is a typo). We add 2
        // additional Postgres-compatible types (BPCHAR, NAME) for a total of 38.
        assertEquals(38, VBPOpcodes.ALL_TYPE_IDS.length);
    }

    @Test
    void typeNamesAreKnown() {
        assertEquals("INT4", VBPOpcodes.typeName(23));
        assertEquals("TEXT", VBPOpcodes.typeName(25));
        assertEquals("BOOL", VBPOpcodes.typeName(16));
    }

    @Test
    void isKnownTypePositive() {
        assertTrue(VBPOpcodes.isKnownType(23));
        assertTrue(VBPOpcodes.isKnownType(5000));
    }

    @Test
    void isKnownTypeNegative() {
        assertFalse(VBPOpcodes.isKnownType(9999));
    }

    @Test
    void typeIdByName() {
        assertEquals(23, VBPOpcodes.typeIdByName("INT4"));
        assertEquals(25, VBPOpcodes.typeIdByName("TEXT"));
    }

    @Test
    void typeIdByNameUnknownThrows() {
        assertThrows(IllegalArgumentException.class, () -> VBPOpcodes.typeIdByName("BOGUS"));
    }
}
