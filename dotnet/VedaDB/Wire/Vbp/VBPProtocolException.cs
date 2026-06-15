// VedaDB .NET SDK — VBP wire layer
// Port of the Java/Python/Node VBP v1 transport POC.
// See VBP_SPEC.md for the normative protocol contract.

using System;

namespace VedaDB.Wire.Vbp
{
    /// <summary>
    /// Base for all protocol-level errors (bad magic, truncation, oversize, etc.).
    /// Mirrors the Python POC's frame.py error hierarchy.
    /// </summary>
    public class VBPProtocolException : Exception
    {
        public VBPProtocolError Code { get; }
        public VBPProtocolException(VBPProtocolError code, string message) : base(message)
        {
            Code = code;
        }
        public VBPProtocolException(VBPProtocolError code, string message, Exception inner) : base(message, inner)
        {
            Code = code;
        }
    }

    public sealed class VBPBadMagicException : VBPProtocolException
    {
        public VBPBadMagicException(string message) : base(VBPProtocolError.BadMagic, message) { }
    }

    public sealed class VBPTruncatedException : VBPProtocolException
    {
        public VBPTruncatedException(string message) : base(VBPProtocolError.Truncated, message) { }
    }

    public sealed class VBPOversizeException : VBPProtocolException
    {
        public VBPOversizeException(string message) : base(VBPProtocolError.Oversize, message) { }
    }

    public sealed class VBPConnectionClosedException : VBPProtocolException
    {
        public VBPConnectionClosedException(string message) : base(VBPProtocolError.ConnectionClosed, message) { }
        public VBPConnectionClosedException(string message, Exception inner) : base(VBPProtocolError.ConnectionClosed, message, inner) { }
    }
}
