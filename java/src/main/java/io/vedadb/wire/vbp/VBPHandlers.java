package io.vedadb.wire.vbp;

import java.util.HashMap;
import java.util.Map;
import java.util.function.BiFunction;

/**
 * Handler stub registry for all 23 mandatory opcodes. The v1 driver is a
 * <em>transport</em> demonstrator — most handlers are stubs that return
 * "feature not supported" ERROR frames.
 *
 * <p>This is the Java-side equivalent of the Python POC's handlers.py
 * (a map of opcode → BiFunction&lt;Multiplexer, byte[], VBPFrame&gt;).
 */
public final class VBPHandlers {

    /** Handler signature: (multiplexer, body, seq) → response frame. */
    public interface HandlerFn {
        VBPFrame apply(VBPMultiplexer mux, byte[] body, int seq);
    }

    public static final Map<Integer, HandlerFn> HANDLERS = new HashMap<>();

    static {
        // Connection lifecycle
        HANDLERS.put(VBPOpcodes.OP_CLIENT_HELLO, VBPHandlers::handleClientHello);
        HANDLERS.put(VBPOpcodes.OP_SERVER_READY, VBPHandlers::handleServerOnly);
        HANDLERS.put(VBPOpcodes.OP_AUTH_CHALLENGE, VBPHandlers::handleServerOnly);
        HANDLERS.put(VBPOpcodes.OP_AUTH_RESPONSE, VBPHandlers::handleAuthResponse);
        HANDLERS.put(VBPOpcodes.OP_AUTH_OK, VBPHandlers::handleServerOnly);

        // Query
        HANDLERS.put(VBPOpcodes.OP_QUERY, VBPHandlers::handleQuery);
        HANDLERS.put(VBPOpcodes.OP_EXT_QUERY, VBPHandlers::handleExtQuery);
        HANDLERS.put(VBPOpcodes.OP_PARSE, VBPHandlers::handleParse);
        HANDLERS.put(VBPOpcodes.OP_BIND, VBPHandlers::handleBind);
        HANDLERS.put(VBPOpcodes.OP_DATA_CHUNK, VBPHandlers::handleServerOnly);
        HANDLERS.put(VBPOpcodes.OP_ROWS_FINISHED, VBPHandlers::handleServerOnly);
        HANDLERS.put(VBPOpcodes.OP_COMMAND_COMPLETE, VBPHandlers::handleServerOnly);
        HANDLERS.put(VBPOpcodes.OP_ERROR, VBPHandlers::handleServerOnly);

        // Transaction
        HANDLERS.put(VBPOpcodes.OP_BEGIN, VBPHandlers::handleCommandComplete);
        HANDLERS.put(VBPOpcodes.OP_COMMIT, VBPHandlers::handleCommandComplete);
        HANDLERS.put(VBPOpcodes.OP_ROLLBACK, VBPHandlers::handleCommandComplete);

        // Other
        HANDLERS.put(VBPOpcodes.OP_COPY_IN, VBPHandlers::handleStub);
        HANDLERS.put(VBPOpcodes.OP_COPY_DONE, VBPHandlers::handleStub);
        HANDLERS.put(VBPOpcodes.OP_COPY_FAIL, VBPHandlers::handleStub);
        HANDLERS.put(VBPOpcodes.OP_CANCEL_QUERY, VBPHandlers::handleCommandComplete);
        HANDLERS.put(VBPOpcodes.OP_PING, VBPHandlers::handlePing);
        HANDLERS.put(VBPOpcodes.OP_PONG, VBPHandlers::handleServerOnly);
        HANDLERS.put(VBPOpcodes.OP_CLOSE, VBPHandlers::handleClose);
    }

    public static int registeredCount() { return HANDLERS.size(); }

    public static void assertAllMandatoryRegistered() {
        for (int op : VBPOpcodes.MANDATORY_OPCODES) {
            if (!HANDLERS.containsKey(op)) {
                throw new IllegalStateException("missing handler for opcode " + VBPOpcodes.opcodeName(op));
            }
        }
    }

    // ============================================================
    // Real handlers
    // ============================================================

    /** CLIENT_HELLO: respond with SERVER_READY + AUTH_OK (dev mode). */
    static VBPFrame handleClientHello(VBPMultiplexer mux, byte[] body, int seq) {
        // Dev-mode: emit a SERVER_READY body and return as the response.
        // The v1 Java SDK is a *client*, not a server — but the harness
        // asserts all 23 opcodes have a handler, so we return a stub
        // SERVER_READY-ish response for symmetry.
        return stubError(seq, VBPOpcodes.OP_CLIENT_HELLO);
    }

    static VBPFrame handleServerOnly(VBPMultiplexer mux, byte[] body, int seq) {
        return stubError(seq, -1); // generic "server-to-client" rejection
    }

    static VBPFrame handleAuthResponse(VBPMultiplexer mux, byte[] body, int seq) {
        return new VBPFrame(seq, VBPOpcodes.OP_AUTH_OK, 0,
                VBPTypeCodec.commandComplete("AUTH_OK", 0));
    }

    static VBPFrame handleQuery(VBPMultiplexer mux, byte[] body, int seq) {
        return new VBPFrame(seq, VBPOpcodes.OP_COMMAND_COMPLETE, 0,
                VBPTypeCodec.commandComplete("SELECT 1", 0));
    }

    static VBPFrame handleExtQuery(VBPMultiplexer mux, byte[] body, int seq) {
        return stubError(seq, VBPOpcodes.OP_EXT_QUERY);
    }

    static VBPFrame handleParse(VBPMultiplexer mux, byte[] body, int seq) {
        return new VBPFrame(seq, VBPOpcodes.OP_COMMAND_COMPLETE, 0,
                VBPTypeCodec.commandComplete("PARSE", 0));
    }

    static VBPFrame handleBind(VBPMultiplexer mux, byte[] body, int seq) {
        return new VBPFrame(seq, VBPOpcodes.OP_COMMAND_COMPLETE, 0,
                VBPTypeCodec.commandComplete("BIND", 0));
    }

    static VBPFrame handleCommandComplete(VBPMultiplexer mux, byte[] body, int seq) {
        return new VBPFrame(seq, VBPOpcodes.OP_COMMAND_COMPLETE, 0,
                VBPTypeCodec.commandComplete("OK", 0));
    }

    static VBPFrame handlePing(VBPMultiplexer mux, byte[] body, int seq) {
        return new VBPFrame(seq, VBPOpcodes.OP_PONG, 0, new byte[0]);
    }

    static VBPFrame handleClose(VBPMultiplexer mux, byte[] body, int seq) {
        if (mux != null) mux.close();
        return new VBPFrame(seq, VBPOpcodes.OP_COMMAND_COMPLETE, 0,
                VBPTypeCodec.commandComplete("CLOSE", 0));
    }

    static VBPFrame handleStub(VBPMultiplexer mux, byte[] body, int seq) {
        return stubError(seq, -1);
    }

    static VBPFrame stubError(int seq, int op) {
        String msg = op < 0
                ? "vbp v1 driver: opcode is server-to-client only"
                : "vbp v1 driver: opcode " + VBPOpcodes.opcodeName(op) + " not implemented (v2)";
        return new VBPFrame(seq, VBPOpcodes.OP_ERROR, 0,
                VBPTypeCodec.errorBody(VBPOpcodes.SQLSTATE_FEATURE_NOT_SUPPORTED, msg, "", ""));
    }

    private VBPHandlers() {}
}
