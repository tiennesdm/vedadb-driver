# frozen_string_literal: true

module VedaDB
  # Base error class for all VedaDB errors.
  class Error < StandardError; end

  # Connection-level errors.
  class ConnectionError < Error; end

  # Query/execution errors returned by the server.
  class QueryError < Error; end

  # Socket timeout errors.
  class TimeoutError < Error; end

  # Authentication failures.
  class AuthError < Error; end

  # TLS/SSL handshake or certificate errors.
  class TLSError < Error; end

  # Pool exhausted or pool is closed.
  class PoolError < Error; end

  # Circuit breaker is open.
  class CircuitOpenError < Error; end

  # Retry exhaustion.
  class RetryExhaustedError < Error; end

  # Invalid URI configuration.
  class URIError < Error; end

  # Failover-related errors.
  class FailoverError < Error; end

  # Metrics collection errors.
  class MetricsError < Error; end
end
