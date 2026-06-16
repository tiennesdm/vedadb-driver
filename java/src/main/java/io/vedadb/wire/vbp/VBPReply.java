package io.vedadb.wire.vbp;

import java.util.Collections;
import java.util.List;

/**
 * Result of a VBP multiplexer {@link VBPMultiplexer#callCollect(int, byte[], int, int)}
 * call. Holds the terminal frame (e.g. COMMAND_COMPLETE) plus the full
 * ordered list of non-terminal frames received before it (e.g. all
 * DATA_CHUNKs in the response, plus the ROWS_FINISHED frame that arrived
 * before COMMAND_COMPLETE).
 *
 * <p>The v2 streaming fix is the reason this class exists. v1 callers
 * only ever saw the terminal frame and lost every preceding DATA_CHUNK.
 */
public final class VBPReply {
    public final VBPFrame terminal;
    public final List<VBPFrame> frames;

    public VBPReply(VBPFrame terminal, List<VBPFrame> frames) {
        this.terminal = terminal;
        this.frames = Collections.unmodifiableList(frames);
    }

    /** Convenience: op of the terminal frame. */
    public int op() { return terminal.op; }

    /** Convenience: body of the terminal frame. */
    public byte[] body() { return terminal.body; }

    @Override
    public String toString() {
        return "VBPReply(terminal=" + terminal
                + ", accumulated_frames=" + frames.size() + ")";
    }
}
