<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * Base exception for all VedaDB driver errors.
 */
class VedaException extends \RuntimeException
{
    private ?string $sqlState;
    private ?int $errorCode;

    public function __construct(
        string $message = '',
        ?int $errorCode = null,
        ?string $sqlState = null,
        ?\Throwable $previous = null
    ) {
        parent::__construct($message, 0, $previous);
        $this->errorCode = $errorCode;
        $this->sqlState = $sqlState;
    }

    public function getErrorCode(): ?int
    {
        return $this->errorCode;
    }

    public function getSqlState(): ?string
    {
        return $this->sqlState;
    }
}

/**
 * Thrown on TCP connection failures.
 */
class ConnectionException extends VedaException {}

/**
 * Thrown when the server returns a query error.
 */
class QueryException extends VedaException {}

/**
 * Thrown on socket timeout.
 */
class TimeoutException extends VedaException {}

/**
 * Thrown on authentication failures.
 */
class AuthException extends VedaException {}

/**
 * Thrown when the circuit breaker is open.
 */
class CircuitOpenException extends VedaException {}

/**
 * Thrown on failover exhaustion.
 */
class FailoverException extends VedaException {}

/**
 * Thrown on pool exhaustion.
 */
class PoolExhaustedException extends VedaException {}

/**
 * Thrown on TLS/SSL errors.
 */
class TLSSException extends VedaException {}

/**
 * Thrown on protocol errors.
 */
class ProtocolException extends VedaException {}

/**
 * Thrown on validation errors.
 */
class ValidationException extends VedaException {}
