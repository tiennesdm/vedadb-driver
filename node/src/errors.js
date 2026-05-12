/**
 * VedaDB Node.js Driver - Error Classes
 *
 * Comprehensive error hierarchy for all driver operations.
 * All errors extend VedaDBError for easy instanceof checks.
 */

'use strict';

/**
 * Base error class for all VedaDB operations.
 */
class VedaDBError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} [code] - Error code
   * @param {*} [details] - Additional error details
   */
  constructor(message, code, details) {
    super(message);
    this.name = 'VedaDBError';
    this.code = code || 'VEDA_ERROR';
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Connection-level errors (network, TCP, TLS).
 */
class ConnectionError extends VedaDBError {
  constructor(message, details) {
    super(message || 'Connection failed', 'VEDA_CONN_ERROR', details);
    this.name = 'ConnectionError';
  }
}

/**
 * Query execution errors (SQL parsing, execution failures).
 */
class QueryError extends VedaDBError {
  constructor(message, details) {
    super(message || 'Query failed', 'VEDA_QUERY_ERROR', details);
    this.name = 'QueryError';
  }
}

/**
 * Timeout errors (socket timeout, query timeout, acquire timeout).
 */
class TimeoutError extends VedaDBError {
  constructor(message, details) {
    super(message || 'Operation timed out', 'VEDA_TIMEOUT', details);
    this.name = 'TimeoutError';
  }
}

/**
 * Authentication failures.
 */
class AuthError extends VedaDBError {
  constructor(message, details) {
    super(message || 'Authentication failed', 'VEDA_AUTH_ERROR', details);
    this.name = 'AuthError';
  }
}

/**
 * Pool exhaustion errors.
 */
class PoolExhaustedError extends VedaDBError {
  constructor(message, details) {
    super(message || 'Connection pool exhausted', 'VEDA_POOL_EXHAUSTED', details);
    this.name = 'PoolExhaustedError';
  }
}

/**
 * Pool closed errors.
 */
class PoolClosedError extends VedaDBError {
  constructor(message) {
    super(message || 'Pool is closed', 'VEDA_POOL_CLOSED');
    this.name = 'PoolClosedError';
  }
}

/**
 * Protocol errors (malformed responses, version mismatches).
 */
class ProtocolError extends VedaDBError {
  constructor(message, details) {
    super(message || 'Protocol error', 'VEDA_PROTOCOL_ERROR', details);
    this.name = 'ProtocolError';
  }
}

/**
 * TLS/SSL errors.
 */
class TLSError extends VedaDBError {
  constructor(message, details) {
    super(message || 'TLS error', 'VEDA_TLS_ERROR', details);
    this.name = 'TLSError';
  }
}

/**
 * Circuit breaker open error.
 */
class CircuitOpenError extends VedaDBError {
  constructor(message) {
    super(message || 'Circuit breaker is OPEN', 'VEDA_CIRCUIT_OPEN');
    this.name = 'CircuitOpenError';
  }
}

/**
 * Failover errors (all nodes unavailable).
 */
class FailoverError extends VedaDBError {
  constructor(message, details) {
    super(message || 'All failover nodes unavailable', 'VEDA_FAILOVER_ERROR', details);
    this.name = 'FailoverError';
  }
}

/**
 * Validation errors (bad parameters, invalid config).
 */
class ValidationError extends VedaDBError {
  constructor(message, details) {
    super(message || 'Validation failed', 'VEDA_VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * Bulk operation errors (partial failures in batch operations).
 */
class BulkError extends VedaDBError {
  /**
   * @param {string} message
   * @param {Array<{index:number,error:Error}>} [errors] - Per-item errors
   */
  constructor(message, errors) {
    super(message || 'Bulk operation partially failed', 'VEDA_BULK_ERROR');
    this.name = 'BulkError';
    this.errors = errors || [];
  }
}

module.exports = {
  VedaDBError,
  ConnectionError,
  QueryError,
  TimeoutError,
  AuthError,
  PoolExhaustedError,
  PoolClosedError,
  ProtocolError,
  TLSError,
  CircuitOpenError,
  FailoverError,
  ValidationError,
  BulkError,
};
