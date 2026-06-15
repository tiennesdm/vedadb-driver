package io.vedadb.wire.vbp;

/** High-level VBP error decoded from an ERROR frame body. */
public class VBPError extends RuntimeException {
    public final String sqlstate;
    public final String detail;
    public final String hint;

    public VBPError(String sqlstate, String message) {
        this(sqlstate, message, "", "");
    }

    public VBPError(String sqlstate, String message, String detail, String hint) {
        super("[" + sqlstate + "] " + message);
        this.sqlstate = sqlstate;
        this.detail = detail;
        this.hint = hint;
    }
}
