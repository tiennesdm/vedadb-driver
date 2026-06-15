// VedaDB .NET SDK — VBP wire layer

using System;

namespace VedaDB.Wire.Vbp
{
    /// <summary>
    /// High-level VBP error decoded from an ERROR frame body.
    /// Carries SQLSTATE plus optional detail and hint.
    /// </summary>
    public class VBPErrorException : Exception
    {
        public string SqlState { get; }
        public string Detail { get; }
        public string Hint { get; }

        public VBPErrorException(string sqlState, string message)
            : this(sqlState, message, "", "")
        {
        }

        public VBPErrorException(string sqlState, string message, string detail, string hint)
            : base("[" + sqlState + "] " + message)
        {
            SqlState = sqlState;
            Detail = detail ?? "";
            Hint = hint ?? "";
        }
    }

    /// <summary>
    /// Wraps a SQLSTATE for callers that want typed exception access.
    /// </summary>
    public class VBPException : Exception
    {
        public string SqlState { get; }
        public VBPException(string sqlState, string message) : base("[" + sqlState + "] " + message)
        {
            SqlState = sqlState;
        }
    }
}
