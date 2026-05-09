/**
 * VedaDB Node.js Driver - TypeScript Definitions
 *
 * Full TypeScript support for the VedaDB TCP client.
 */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface VedaDBOptions {
  host?: string;
  port?: number;
  timeout?: number;
  ssl?: boolean;
  rejectUnauthorized?: boolean;
}

export interface PoolOptions extends VedaDBOptions {
  min?: number;
  max?: number;
  idleTimeout?: number;
  acquireTimeout?: number;
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: string[];
  rows: string[][];
  row_count: number;
  message: string;
  error: string;
}

export interface RowDict {
  [column: string]: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class VedaDBError extends Error {
  constructor(message?: string);
}

export class ConnectionError extends VedaDBError {
  constructor(message?: string);
}

export class QueryError extends VedaDBError {
  constructor(message?: string);
}

export class TimeoutError extends VedaDBError {
  constructor(message?: string);
}

export class AuthError extends VedaDBError {
  constructor(message?: string);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class VedaDB {
  constructor(options?: VedaDBOptions);

  /** Connect to the VedaDB server. */
  connect(): Promise<void>;

  /** Close the connection. */
  close(): Promise<void>;

  /** Execute a query and return the result. */
  query(sql: string): Promise<QueryResult>;

  /** Execute a statement (INSERT, UPDATE, DELETE). */
  execute(sql: string): Promise<QueryResult>;

  /** Authenticate with username and password. */
  authenticate(username: string, password: string): Promise<QueryResult>;

  /** Check if the connection is alive. */
  ping(): Promise<boolean>;

  /** Connection state. */
  readonly connected: boolean;
  readonly host: string;
  readonly port: number;
}

// ---------------------------------------------------------------------------
// Connection Pool
// ---------------------------------------------------------------------------

export class VedaPool {
  constructor(options?: PoolOptions);

  /** Get a connection from the pool. */
  acquire(): Promise<VedaDB>;

  /** Release a connection back to the pool. */
  release(client: VedaDB): void;

  /** Execute a query using a pooled connection. */
  query(sql: string): Promise<QueryResult>;

  /** Execute a statement using a pooled connection. */
  execute(sql: string): Promise<QueryResult>;

  /** Close all connections in the pool. */
  close(): Promise<void>;

  /** Pool statistics. */
  stats(): PoolStats;
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

// ---------------------------------------------------------------------------
// Retry Wrapper
// ---------------------------------------------------------------------------

export interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  backoffMultiplier?: number;
  maxDelay?: number;
  retryableErrors?: string[];
}

export class VedaRetryClient {
  constructor(options?: VedaDBOptions, retryOptions?: RetryOptions);

  connect(): Promise<void>;
  close(): Promise<void>;
  query(sql: string): Promise<QueryResult>;
  execute(sql: string): Promise<QueryResult>;
}

// ---------------------------------------------------------------------------
// Prepared Statement (Server-side)
// ---------------------------------------------------------------------------

export class PreparedStatement {
  constructor(client: VedaDB, name: string, sql: string);

  /** Execute with parameters. */
  execute(params?: (string | number | boolean | null)[]): Promise<QueryResult>;

  /** Drop the prepared statement on the server. */
  close(): Promise<QueryResult>;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/** Escape a string value for use in SQL. */
export function escape(value: string): string;

/** Format a SQL template with values. */
export function format(sql: string, values: any[]): string;

// ---------------------------------------------------------------------------
// Module Export
// ---------------------------------------------------------------------------

declare const _default: {
  VedaDB: typeof VedaDB;
  VedaPool: typeof VedaPool;
  VedaRetryClient: typeof VedaRetryClient;
  PreparedStatement: typeof PreparedStatement;
  VedaDBError: typeof VedaDBError;
  ConnectionError: typeof ConnectionError;
  QueryError: typeof QueryError;
  TimeoutError: typeof TimeoutError;
  AuthError: typeof AuthError;
  escape: typeof escape;
  format: typeof format;
};

export default _default;
