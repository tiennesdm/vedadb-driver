package io.vedadb.wire.vbp;

/** Wraps a sqlstate for callers that want typed exception access. */
public class VBPException extends RuntimeException {
    public final String sqlstate;
    public VBPException(String sqlstate, String message) {
        super("[" + sqlstate + "] " + message);
        this.sqlstate = sqlstate;
    }
}
