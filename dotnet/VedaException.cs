namespace VedaDB;

/// <summary>
/// Base exception for all VedaDB errors.
/// </summary>
public class VedaException : Exception
{
    public VedaException(string message) : base(message) { }
    public VedaException(string message, Exception inner) : base(message, inner) { }
}

/// <summary>
/// Thrown when a connection to VedaDB fails or is lost.
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

/// <summary>
/// Thrown when a circuit breaker is open.
/// </summary>
public class VedaCircuitBreakerOpenException : VedaException
{
    public VedaCircuitBreakerOpenException(string message) : base(message) { }
}

/// <summary>
/// Thrown when all retries are exhausted.
/// </summary>
public class VedaRetryExhaustedException : VedaException
{
    public VedaRetryExhaustedException(string message) : base(message) { }
    public VedaRetryExhaustedException(string message, Exception inner) : base(message, inner) { }
}

/// <summary>
/// Thrown when a failover operation fails.
/// </summary>
public class VedaFailoverException : VedaException
{
    public VedaFailoverException(string message) : base(message) { }
    public VedaFailoverException(string message, Exception inner) : base(message, inner) { }
}

/// <summary>
/// Thrown when the connection pool is exhausted.
/// </summary>
public class VedaPoolExhaustedException : VedaException
{
    public VedaPoolExhaustedException(string message) : base(message) { }
}

/// <summary>
/// Thrown when a bulk insert operation fails.
/// </summary>
public class VedaBulkInsertException : VedaException
{
    public VedaBulkInsertException(string message) : base(message) { }
    public List<int>? FailedBatchIndices { get; init; }
}

/// <summary>
/// Thrown when a URI parse operation fails.
/// </summary>
public class VedaUriParseException : VedaException
{
    public VedaUriParseException(string message) : base(message) { }
}

/// <summary>
/// Thrown when an interceptor rejects an operation.
/// </summary>
public class VedaInterceptorException : VedaException
{
    public VedaInterceptorException(string message) : base(message) { }
}
