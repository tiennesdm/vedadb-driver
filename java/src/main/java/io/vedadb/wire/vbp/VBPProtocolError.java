package io.vedadb.wire.vbp;

/**
 * VBP v1 protocol errors. Mirrors the Python POC's frame.py error hierarchy.
 */
public class VBPProtocolError extends RuntimeException {
    public VBPProtocolError(String message) { super(message); }
    public VBPProtocolError(String message, Throwable cause) { super(message, cause); }
}

final class VBPBadMagic extends VBPProtocolError {
    VBPBadMagic(String message) { super(message); }
}

final class VBPFrameTooShort extends VBPProtocolError {
    VBPFrameTooShort(String message) { super(message); }
}

final class VBPFrameTooLarge extends VBPProtocolError {
    VBPFrameTooLarge(String message) { super(message); }
}

final class VBPConnectionClosed extends VBPProtocolError {
    VBPConnectionClosed(String message) { super(message); }
    VBPConnectionClosed(String message, Throwable cause) { super(message, cause); }
}
