/**
 * Core type definitions for the VedaDB driver.
 *
 * @module
 */

/** Configuration for establishing a connection to a VedaDB server. */
export interface ConnectionConfig {
  /** Hostname or IP address of the VedaDB server. */
  host: string;
  /** Port number the server is listening on. */
  port: number;
  /** Connection timeout in milliseconds (default: 30000). */
  timeout?: number;
  /** Optional API key for authenticated endpoints. */
  apiKey?: string;
  /** Optional default database name. */
  database?: string;
}

/** Represents the result of a database query with typed helpers. */
export interface Result<T = Record<string, unknown>> {
  /** Column names returned by the query. */
  columns: string[];
  /** Row data as an array of arrays. */
  rows: unknown[][];
  /** Number of rows affected or returned. */
  rowCount: number;
  /** Status or informational message from the server. */
  message: string;
  /** Convert rows to an array of plain objects. */
  toObjects: () => T[];
  /** Return the first row as an object, or null if empty. */
  first: () => T | null;
  /** Extract a single column as an array of values. */
  pluck: (column: string) => unknown[];
}

/** Options for building a SELECT statement. */
export interface SelectOptions {
  /** Specific columns to select (default: all). */
  columns?: string[];
  /** WHERE conditions as key-value pairs (AND-joined). */
  where?: Record<string, unknown>;
  /** Raw SQL WHERE clause (overrides `where`). */
  whereRaw?: string;
  /** ORDER BY expression (e.g. "id DESC"). */
  orderBy?: string;
  /** Maximum number of rows to return. */
  limit?: number;
  /** Number of rows to skip. */
  offset?: number;
}

/** Simple in-memory cache interface. */
export interface CacheAPI {
  /** Store a value with an optional TTL in seconds. */
  set: (key: string, value: string, ttl?: number) => void;
  /** Retrieve a value by key, or null if missing/expired. */
  get: (key: string) => string | null;
  /** Remove a key from the cache. */
  del: (key: string) => void;
  /** Atomically increment a numeric key. Returns the new value. */
  incr: (key: string) => number;
}

/** Raw query result shape returned by the HTTP API. */
export interface QueryResult {
  /** Column names. */
  columns: string[];
  /** Row data as string arrays. */
  rows: string[][];
  /** Row count. */
  rowCount: number;
  /** Server message. */
  message: string;
}

/** Connection status information. */
export interface VedaDBStatus {
  /** Whether the driver considers itself connected. */
  connected: boolean;
  /** Hostname of the server. */
  host: string;
  /** Port of the server. */
  port: number;
  /** Last measured latency in milliseconds. */
  latency: number;
  /** Error message if the last connection attempt failed. */
  error?: string;
}

/** Full VedaDB client interface. */
export interface VedaClient {
  /** Execute a raw SQL query and return rows. */
  query: (sql: string) => Promise<Result>;
  /** Execute a SQL statement (INSERT/UPDATE/DELETE/DDL). */
  exec: (sql: string) => Promise<Result>;
  /** Insert a single row into a table. */
  insert: (table: string, data: Record<string, unknown>) => Promise<Result>;
  /** Select rows from a table with optional filtering. */
  select: (table: string, options?: SelectOptions) => Promise<Result>;
  /** Update rows matching WHERE conditions. */
  update: (table: string, set: Record<string, unknown>, where: Record<string, unknown>) => Promise<Result>;
  /** Delete rows matching WHERE conditions. */
  deleteFrom: (table: string, where: Record<string, unknown>) => Promise<Result>;
  /** Execute operations within a transaction boundary. */
  transaction: <T>(fn: (trx: VedaClient) => Promise<T>) => Promise<T>;
  /** In-memory cache API. */
  cache: CacheAPI;
  /** Establish the underlying connection. */
  connect: () => Promise<void>;
  /** Close the underlying connection. */
  disconnect: () => Promise<void>;
  /** Whether the client is currently connected. */
  isConnected: boolean;
  /** Connection metadata. */
  connectionInfo: { host: string; port: number; latency: number };
}

/** Configuration specific to the HTTP API client. */
export interface ApiClientConfig extends ConnectionConfig {
  /** Optional fetch implementation override (useful for testing or polyfills). */
  fetch?: typeof fetch;
}

/** HTTP API client interface. */
export interface VedaApiClient {
  /** Execute a SQL query via HTTP POST. */
  query: (sql: string, database?: string) => Promise<Result>;
  /** Test whether the API server is reachable. */
  testConnection: () => Promise<boolean>;
  /** Insert a row via the REST endpoint. */
  insert: (table: string, values: Record<string, unknown>) => Promise<{ message: string }>;
  /** Update rows via the REST endpoint. */
  update: (
    table: string,
    column: string,
    value: unknown,
    where: Record<string, unknown>
  ) => Promise<{ message: string; affected: number }>;
  /** Delete rows via the REST endpoint. */
  delete: (table: string, where: Record<string, unknown>) => Promise<{ message: string; affected: number }>;
  /** Execute arbitrary SQL via the REST endpoint. */
  exec: (sql: string) => Promise<{ message: string; rowCount: number }>;
  /** Perform a typed select via the REST endpoint. */
  select: (table: string, options?: SelectOptions) => Promise<Result>;
  /** List all tables in the database. */
  listTables: () => Promise<string[]>;
  /** Get schema information for a table. */
  schema: (table: string) => Promise<Record<string, unknown>>;
  /** Get current connection status. */
  getStatus: () => VedaDBStatus;
}
