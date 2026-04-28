namespace VedaDB;

/// <summary>
/// Base exception for VedaDB errors.
/// </summary>
public class VedaException : Exception
{
    public VedaException(string message) : base(message) { }
    public VedaException(string message, Exception inner) : base(message, inner) { }
}

/// <summary>
/// Thrown when a connection to VedaDB fails.
/// </summary>
public class VedaConnectionException : VedaException
{
    public VedaConnectionException(string message) : base(message) { }
    public VedaConnectionException(string message, Exception inner) : base(message, inner) { }
}

/// <summary>
/// Thrown when VedaDB returns a query error.
/// </summary>
public class VedaQueryException : VedaException
{
    public VedaQueryException(string message) : base(message) { }
}
