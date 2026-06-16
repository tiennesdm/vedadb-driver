// VedaDB .NET SDK — VBP wire layer

namespace VedaDB.Wire.Vbp
{
    /// <summary>
    /// VBP v1 protocol error codes. Mirrors the Java POC's VBPProtocolError.
    /// </summary>
    public enum VBPProtocolError
    {
        BadMagic = 1,
        Truncated = 2,
        Oversize = 3,
        ConnectionClosed = 4,
        Timeout = 5,
        Interrupted = 6,
        SeqExhausted = 7,
    }
}
