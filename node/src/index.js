/**
 * VedaDB Node.js Driver - Main Exports
 *
 * Complete database client library with Promise-based APIs,
 * connection pooling, streaming, pub/sub, and more.
 *
 * @example
 *   const { VedaClient } = require('vedadb');
 *   const client = await VedaClient.connect('vedadb://localhost:6380');
 *   const result = await client.query('SELECT * FROM users;');
 *   console.log(result.toObjects());
 *   await client.close();
 *
 * @example
 *   const { ConnectionPool } = require('vedadb');
 *   const pool = new ConnectionPool({ host: 'localhost', port: 6380, maxSize: 10 });
 *   const result = await pool.query('SELECT 1;');
 *   await pool.drain();
 */

'use strict';

// ---------------------------------------------------------------------------
// Core Client & Pool
// ---------------------------------------------------------------------------

const { VedaClient, createClient } = require('./client');
const { ConnectionPool } = require('./pool');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const {
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
} = require('./errors');

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

const { ProtocolHandler, Result, FrameType, PROTOCOL_VERSION } = require('./protocol');

// ---------------------------------------------------------------------------
// URI Parsing
// ---------------------------------------------------------------------------

const { parseURI, buildURI, configFromEnv, validateConfig } = require('./uri');

// ---------------------------------------------------------------------------
// TLS
// ---------------------------------------------------------------------------

const { upgradeToTLS, createTLSConnection, isTLSSocket, getTLSInfo, DEFAULT_TLS_OPTIONS } = require('./tls');

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

const { withRetry, isRetryable, backoffMs, DEFAULTS: RetryDefaults } = require('./retry');

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

const { CircuitBreaker, CircuitState } = require('./circuit');

// ---------------------------------------------------------------------------
// Health Checker
// ---------------------------------------------------------------------------

const { HealthChecker, HealthStatus, CheckType } = require('./health');

// ---------------------------------------------------------------------------
// Bulk / Pipeline
// ---------------------------------------------------------------------------

const { BulkInserter, Pipeline } = require('./bulk');

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

const { Cursor } = require('./cursor');

// ---------------------------------------------------------------------------
// Pub/Sub
// ---------------------------------------------------------------------------

const { PubSub, Message } = require('./pubsub');

// ---------------------------------------------------------------------------
// Change Streams
// ---------------------------------------------------------------------------

const { ChangeStream, ChangeEvent, ChangeType } = require('./streams');

// ---------------------------------------------------------------------------
// Query Builder
// ---------------------------------------------------------------------------

const { QueryBuilder, esc } = require('./query_builder');

// ---------------------------------------------------------------------------
// Query Cache
// ---------------------------------------------------------------------------

const { QueryCache } = require('./cache');

// ---------------------------------------------------------------------------
// Read/Write Splitting
// ---------------------------------------------------------------------------

const { ReadWriteSplitter, classifyQuery, QueryType } = require('./rw_split');

// ---------------------------------------------------------------------------
// Load Balancer
// ---------------------------------------------------------------------------

const { LoadBalancer, Backend, Strategy } = require('./load_balance');

// ---------------------------------------------------------------------------
// Failover
// ---------------------------------------------------------------------------

const { FailoverManager, FailoverNode, FailoverStrategy } = require('./failover');

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const { MetricsRegistry, MetricType, Counter, Gauge, Histogram } = require('./metrics');

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------

const { InterceptorRegistry, BuiltinInterceptors } = require('./interceptor');

// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Core
  VedaClient,
  createClient,
  ConnectionPool,

  // Errors
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

  // Protocol
  ProtocolHandler,
  Result,
  FrameType,
  PROTOCOL_VERSION,

  // URI
  parseURI,
  buildURI,
  configFromEnv,
  validateConfig,

  // TLS
  upgradeToTLS,
  createTLSConnection,
  isTLSSocket,
  getTLSInfo,
  DEFAULT_TLS_OPTIONS,

  // Retry
  withRetry,
  isRetryable,
  backoffMs,
  RetryDefaults,

  // Circuit Breaker
  CircuitBreaker,
  CircuitState,

  // Health
  HealthChecker,
  HealthStatus,
  CheckType,

  // Bulk
  BulkInserter,
  Pipeline,

  // Cursor
  Cursor,

  // Pub/Sub
  PubSub,
  Message,

  // Change Streams
  ChangeStream,
  ChangeEvent,
  ChangeType,

  // Query Builder
  QueryBuilder,
  esc,

  // Cache
  QueryCache,

  // R/W Split
  ReadWriteSplitter,
  classifyQuery,
  QueryType,

  // Load Balance
  LoadBalancer,
  Backend,
  Strategy,

  // Failover
  FailoverManager,
  FailoverNode,
  FailoverStrategy,

  // Metrics
  MetricsRegistry,
  MetricType,
  Counter,
  Gauge,
  Histogram,

  // Interceptors
  InterceptorRegistry,
  BuiltinInterceptors,

  // Default export
  default: {
    VedaClient,
    createClient,
    ConnectionPool,
  },
};
