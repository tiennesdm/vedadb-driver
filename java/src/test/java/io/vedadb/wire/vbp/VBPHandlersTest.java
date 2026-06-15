package io.vedadb.wire.vbp;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class VBPHandlersTest {

    @Test
    void allMandatoryOpcodesHaveHandlers() {
        VBPHandlers.assertAllMandatoryRegistered();
    }

    @Test
    void handlerCountMatchesMandatory() {
        // 23 mandatory + a few extra (server-only ack handlers we still register)
        assertTrue(VBPHandlers.registeredCount() >= 23);
    }

    @Test
    void clientHelloHandlerReturnsFrame() {
        VBPFrame f = VBPHandlers.HANDLERS.get(VBPOpcodes.OP_CLIENT_HELLO).apply(null, new byte[0], 0);
        assertNotNull(f);
    }

    @Test
    void pingHandlerReturnsPong() {
        VBPFrame f = VBPHandlers.HANDLERS.get(VBPOpcodes.OP_PING).apply(null, new byte[0], 7);
        assertEquals(VBPOpcodes.OP_PONG, f.op);
        assertEquals(7, f.seq);
    }

    @Test
    void closeHandlerReturnsCommandComplete() {
        VBPFrame f = VBPHandlers.HANDLERS.get(VBPOpcodes.OP_CLOSE).apply(null, new byte[0], 9);
        assertEquals(VBPOpcodes.OP_COMMAND_COMPLETE, f.op);
    }

    @Test
    void authResponseHandlerReturnsAuthOk() {
        VBPFrame f = VBPHandlers.HANDLERS.get(VBPOpcodes.OP_AUTH_RESPONSE).apply(null, new byte[0], 3);
        assertEquals(VBPOpcodes.OP_AUTH_OK, f.op);
    }

    @Test
    void queryHandlerReturnsCommandComplete() {
        VBPFrame f = VBPHandlers.HANDLERS.get(VBPOpcodes.OP_QUERY).apply(null, new byte[0], 5);
        assertEquals(VBPOpcodes.OP_COMMAND_COMPLETE, f.op);
    }

    @Test
    void parseHandlerReturnsCommandComplete() {
        VBPFrame f = VBPHandlers.HANDLERS.get(VBPOpcodes.OP_PARSE).apply(null, new byte[0], 1);
        assertEquals(VBPOpcodes.OP_COMMAND_COMPLETE, f.op);
    }

    @Test
    void bindHandlerReturnsCommandComplete() {
        VBPFrame f = VBPHandlers.HANDLERS.get(VBPOpcodes.OP_BIND).apply(null, new byte[0], 1);
        assertEquals(VBPOpcodes.OP_COMMAND_COMPLETE, f.op);
    }

    @Test
    void extQueryHandlerIsStub() {
        VBPFrame f = VBPHandlers.HANDLERS.get(VBPOpcodes.OP_EXT_QUERY).apply(null, new byte[0], 1);
        assertEquals(VBPOpcodes.OP_ERROR, f.op);
    }

    @Test
    void serverOnlyHandlersAreStubs() {
        for (int op : new int[]{VBPOpcodes.OP_DATA_CHUNK, VBPOpcodes.OP_ROWS_FINISHED,
                VBPOpcodes.OP_COMMAND_COMPLETE, VBPOpcodes.OP_ERROR,
                VBPOpcodes.OP_PONG, VBPOpcodes.OP_AUTH_OK,
                VBPOpcodes.OP_SERVER_READY, VBPOpcodes.OP_AUTH_CHALLENGE}) {
            VBPFrame f = VBPHandlers.HANDLERS.get(op).apply(null, new byte[0], 0);
            assertEquals(VBPOpcodes.OP_ERROR, f.op, "opcode 0x" + Integer.toHexString(op));
        }
    }
}
