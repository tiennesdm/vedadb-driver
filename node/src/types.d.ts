/**
 * VedaDB Node.js Driver - Complete TypeScript Definitions
 *
 * Full type definitions for all 20 driver features.
 */

import { EventEmitter } from 'events';
import { Readable } from 'stream';

// ============================================================================
// Configuration
// ============================================================================

export interface VedaConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  database?: string;
  timeout?: number;
  tls?: boolean;
  tlsOptions?: TLSConfig;
  retry?: RetryConfig;
  pool?: PoolConfig;
  autoReconnect?: boolean;
  [key: string]: any;
}

export interface PoolConfig {
  minSize?: number;
  maxSize?: number;
  acquireTimeout?: number;
  idleTimeout?: number;
  healthCheckInterval?: number;
  warmup?: boolean;
}

export interface TLSConfig {
  ca?: string;
  cert?: string;
  key?: string;
  rejectUnauthorized?: boolean;
  minVersion?: string;
}

export interface RetryConfig {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
}

// ============================================================================
// Result Types
// ============================================================================

export interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  message: string;
  status: string;
  duration: number;
  command: string;
}

export class Result implements QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  message: string;
  status: string;
  duration: number;
  command: string;

  constructor(data: Partial<QueryResult>);
  toObjects(): Record<string, any>[];
  first(): Record<string, any> | null;
  pluck(column: string): any[];
}

// ============================================================================
// Error Classes
// ============================================================================

export class VedaDBError extends Error {
  code: string;
  details?: any;
  constructor(message?: string, code?: string, details?: any);
}

export class ConnectionError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class QueryError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class TimeoutError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class AuthError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class PoolExhaustedError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class PoolClosedError extends VedaDBError {
  constructor(message?: string);
}

export class ProtocolError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class TLSError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class CircuitOpenError extends VedaDBError {
  constructor(message?: string);
}

export class FailoverError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class ValidationError extends VedaDBError {
  constructor(message?: string, details?: any);
}

export class BulkError extends VedaDBError {
  errors: Array<{ index: number; error: Error }>;
  constructor(message?: string, errors?: Array<{ index: number; error: Error }>);
}

// ============================================================================
// VedaClient (Core)
// ============================================================================

export declare interface VedaClientEventMap {
  connect: { host: string; port: number };
  disconnect: { host: string; port: number };
  error: Error;
  query: { sql: string; duration: number };
}

export class VedaClient extends EventEmitter {
  readonly connected: boolean;
  readonly host: string;
  readonly port: number;
  readonly config: VedaConfig;
  readonly interceptors: InterceptorRegistry;

  constructor(config?: VedaConfig);

  connect(): Promise<VedaClient>;
  close(): Promise<void>;
  query(sql: string, params?: any[]): Promise<Result>;
  execute(sql: string, params?: any[]): Promise<string>;
  prepared(template: string, params?: any[]): Promise<Result>;
  ping(): Promise<boolean>;
  reconnect(maxRetries?: number): Promise<void>;

  // CRUD Helpers
  select(table: string, options?: SelectOptions): Promise<Result>;
  insert(table: string, data: Record<string, any>): Promise<string>;
  insertMany(table: string, rows: Record<string, any>[]): Promise<string>;
  update(table: string, set: Record<string, any>, where?: Record<string, any>): Promise<string>;
  delete(table: string, where?: Record<string, any>): Promise<string>;

  // Transactions
  begin(): Promise<string>;
  commit(): Promise<string>;
  rollback(): Promise<string>;
  transaction<T>(fn: (client: VedaClient) => Promise<T>): Promise<T>;

  // Pipeline
  pipelineQueries(queries: string[]): Promise<Result[]>;
  preparedPipeline(template: string, paramSets: any[][]): Promise<Result[]>;

  // Prepared Statements
  prepare(name: string, query: string): Promise<Result>;
  executePrepared(name: string, ...args: any[]): Promise<Result>;
  deallocate(name: string): Promise<Result>;

  // Cache API
  readonly cache: CacheAPI;

  // Graph API
  graphAddNode(id: string, label: string, props?: Record<string, any>): Promise<Result>;
  graphAddEdge(from: string, to: string, relation: string, props?: Record<string, any>): Promise<Result>;
  graphBFS(start: string, depth?: number): Promise<Result>;

  // Search
  search(table: string, query: string, fuzzy?: number): Promise<Result>;

  // Factory Methods
  pipeline(): Pipeline;
  newBulkInserter(table: string, batchSize?: number): BulkInserter;
  cursor(sql: string, params?: any[]): Cursor;
  pubsub(): PubSub;
  watch(table: string): ChangeStream;
  table(name: string): QueryBuilder;

  // Static Factory Methods
  static connect(uri: string): Promise<VedaClient>;
  static fromURI(uri: string): VedaClient;
}

export interface SelectOptions {
  columns?: string[];
  where?: Record<string, any>;
  orderBy?: string;
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export interface CacheAPI {
  set(key: string, value: any, ttl?: number): Promise<Result>;
  get(key: string): Promise<Result>;
  del(key: string): Promise<Result>;
  incr(key: string): Promise<Result>;
  keys(pattern: string): Promise<Result>;
  flush(): Promise<Result>;
  stats(): Promise<Result>;
}

export function createClient(config?: VedaConfig): Promise<VedaClient>;

// ============================================================================
// Connection Pool
// ============================================================================

export class ConnectionPool extends EventEmitter {
  readonly total: number;
  readonly available: number;
  readonly inUse: number;
  readonly waiting: number;
  readonly stats: PoolStats;

  constructor(config?: PoolConfig & VedaConfig);

  connect(): Promise<VedaClient>;
  acquire(): Promise<VedaClient>;
  release(client: VedaClient): void;
  withConnection<T>(fn: (client: VedaClient) => Promise<T>): Promise<T>;
  query(sql: string, params?: any[]): Promise<Result>;
  execute(sql: string): Promise<string>;
  pipeline(queries: string[]): Promise<Result[]>;
  prepared(template: string, params?: any[]): Promise<Result>;
  ping(): Promise<boolean>;
  warmup(): Promise<void>;
  drain(): Promise<void>;
  close(): void;
}

export interface PoolStats {
  total: number;
  available: number;
  inUse: number;
  waiting: number;
  maxSize: number;
  minSize: number;
  closed: boolean;
}

// ============================================================================
// Protocol
// ============================================================================

export class ProtocolHandler extends EventEmitter {
  readonly connected: boolean;
  readonly pending: number;

  constructor(options?: { timeout?: number; maxQueueSize?: number });
  attach(socket: any): void;
  send(command: string, options?: { timeout?: number }): Promise<Result>;
  pipeline(commands: string[], options?: { timeout?: number }): Promise<Result[]>;
  ping(): Promise<boolean>;
  close(): void;
}

export const FrameType: {
  REQUEST: 'REQUEST';
  RESPONSE: 'RESPONSE';
  ERROR: 'ERROR';
  EVENT: 'EVENT';
  PING: 'PING';
  PONG: 'PONG';
};

export const PROTOCOL_VERSION: string;

// ============================================================================
// URI Parser
// ============================================================================

export function parseURI(uri: string): VedaConfig;
export function buildURI(config: VedaConfig): string;
export function configFromEnv(): VedaConfig | null;
export function validateConfig(config: VedaConfig): string[];

// ============================================================================
// TLS
// ============================================================================

export function upgradeToTLS(socket: any, options: TLSConfig & { host: string; timeout?: number }): Promise<any>;
export function createTLSConnection(options: TLSConfig & { host: string; port: number; timeout?: number }): Promise<any>;
export function isTLSSocket(socket: any): boolean;
export function getTLSInfo(socket: any): TLSInfo | null;
export const DEFAULT_TLS_OPTIONS: TLSConfig;

export interface TLSInfo {
  protocol: string;
  cipher: any;
  certificate: any;
  peerCertificate: any;
  authorized: boolean;
  authorizationError: string | null;
}

// ============================================================================
// Retry
// ============================================================================

export function withRetry<T>(fn: () => Promise<T>, options?: Partial<RetryOptions>): Promise<T>;
export function isRetryable(err: Error): boolean;
export function backoffMs(n: number, opts: RetryOptions): number;
export const RetryDefaults: RetryOptions;

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: boolean;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export const CircuitState: {
  CLOSED: 'CLOSED';
  OPEN: 'OPEN';
  HALF_OPEN: 'HALF_OPEN';
};

export class CircuitBreaker extends EventEmitter {
  readonly state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  readonly failureCount: number;
  readonly allowsRequests: boolean;
  readonly stats: CircuitStats;

  constructor(options?: CircuitBreakerOptions);
  execute<T>(fn: () => Promise<T>): Promise<T>;
  forceClose(): void;
  forceOpen(): void;
  destroy(): void;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxCalls?: number;
  successThreshold?: number;
  isRetryable?: (err: Error) => boolean;
}

export interface CircuitStats {
  state: string;
  failures: number;
  successes: number;
  halfOpenCalls: number;
  lastFailureTime: number | null;
  allowsRequests: boolean;
}

// ============================================================================
// Health Checker
// ============================================================================

export const HealthStatus: {
  HEALTHY: 'healthy';
  DEGRADED: 'degraded';
  UNHEALTHY: 'unhealthy';
  UNKNOWN: 'unknown';
};

export const CheckType: {
  PING: 'ping';
  QUERY: 'query';
  CUSTOM: 'custom';
};

export class HealthChecker extends EventEmitter {
  readonly status: string;
  readonly results: Record<string, CheckResult>;
  readonly stats: HealthStats;

  constructor(options?: HealthCheckerOptions);
  addCheck(name: string, fn: () => Promise<boolean>, options?: { type?: string; weight?: number }): void;
  removeCheck(name: string): void;
  check(): Promise<HealthStats>;
  start(): void;
  stop(): void;
  destroy(): void;
}

export interface HealthCheckerOptions {
  intervalMs?: number;
  timeoutMs?: number;
  unhealthyThreshold?: number;
  healthyThreshold?: number;
}

export interface CheckResult {
  status: string;
  lastRun: number | null;
  error: string | null;
  consecutive: number;
}

export interface HealthStats {
  status: string;
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  checks: Record<string, CheckResult>;
}

// ============================================================================
// Bulk Inserter / Pipeline
// ============================================================================

export class BulkInserter extends EventEmitter {
  readonly buffered: number;
  readonly totalInserted: number;
  readonly stats: BulkStats;

  constructor(client: VedaClient, table: string, batchSize?: number, options?: BulkOptions);
  add(row: Record<string, any>): Promise<number | undefined>;
  addMany(rows: Record<string, any>[]): Promise<number>;
  flush(): Promise<number>;
  close(): Promise<number>;
  destroy(): void;
}

export class Pipeline extends EventEmitter {
  readonly length: number;

  constructor(client: VedaClient);
  query(sql: string): Pipeline;
  insert(table: string, data: Record<string, any>): Pipeline;
  update(table: string, data: Record<string, any>, where: Record<string, any>): Pipeline;
  delete(table: string, where: Record<string, any>): Pipeline;
  execute(): Promise<Result[]>;
  clear(): void;
}

export interface BulkOptions {
  usePipeline?: boolean;
  ignoreDuplicates?: boolean;
  flushIntervalMs?: number;
}

export interface BulkStats {
  table: string;
  buffered: number;
  batchSize: number;
  totalInserted: number;
  pending: number;
}

// ============================================================================
// Cursor
// ============================================================================

export class Cursor extends EventEmitter {
  readonly closed: boolean;
  readonly totalRows: number;
  readonly isDone: boolean;

  constructor(client: VedaClient, sql: string, params?: any[], options?: CursorOptions);
  next(): Promise<Record<string, any> | null>;
  readAll(): Promise<Record<string, any>[]>;
  close(): void;
  toStream(options?: any): Readable;
  [Symbol.asyncIterator](): AsyncGenerator<Record<string, any>>;
}

export interface CursorOptions {
  batchSize?: number;
  prefetch?: number;
}

// ============================================================================
// Pub/Sub
// ============================================================================

export class Message {
  readonly channel: string;
  readonly payload: string;
  readonly pattern: string | null;
  readonly timestamp: number;

  constructor(channel: string, payload: string, pattern?: string | null);
}

export class PubSub extends EventEmitter {
  readonly channels: string[];
  readonly subscriptionCount: number;
  readonly connected: boolean;

  constructor(client: VedaClient, options?: PubSubOptions);
  subscribe(channel: string, handler?: (msg: Message) => void): Promise<void>;
  psubscribe(pattern: string, handler?: (msg: Message) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  unsubscribeAll(): Promise<void>;
  publish(channel: string, message: string | object): Promise<number>;
  listChannels(): Promise<string[]>;
  numSub(channel: string): Promise<number>;
  close(): Promise<void>;
}

export interface PubSubOptions {
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
}

// ============================================================================
// Change Streams
// ============================================================================

export const ChangeType: {
  INSERT: 'insert';
  UPDATE: 'update';
  DELETE: 'delete';
  DDL: 'ddl';
  ALL: 'all';
};

export class ChangeEvent {
  readonly type: string;
  readonly table: string;
  readonly before: Record<string, any> | null;
  readonly after: Record<string, any> | null;
  readonly timestamp: string;
  readonly lsn: number;

  constructor(data: Partial<ChangeEventData>);
}

export interface ChangeEventData {
  type: string;
  table: string;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  timestamp: string;
  lsn: number;
}

export class ChangeStream extends EventEmitter {
  readonly isRunning: boolean;
  readonly lsn: number;
  readonly stats: ChangeStreamStats;

  constructor(client: VedaClient, table: string, options?: ChangeStreamOptions);
  watch(): ChangeStream;
  stop(): ChangeStream;
  next(): Promise<ChangeEvent | null>;
  getBuffered(): ChangeEvent[];
  toStream(): Readable;
  [Symbol.asyncIterator](): AsyncGenerator<ChangeEvent>;
  destroy(): void;
}

export interface ChangeStreamOptions {
  operations?: string[];
  includeBefore?: boolean;
  pollIntervalMs?: number;
  resumeLSN?: number;
}

export interface ChangeStreamStats {
  table: string;
  running: boolean;
  lastLSN: number;
  buffered: number;
  operations: string[];
}

// ============================================================================
// Query Builder
// ============================================================================

export class QueryBuilder {
  constructor(client: VedaClient, table: string);

  select(...columns: string[]): QueryBuilder;
  distinct(): QueryBuilder;
  count(alias?: string): QueryBuilder;

  where(column: string, operator?: string, value?: any): QueryBuilder;
  orWhere(column: string, operator?: string, value?: any): QueryBuilder;
  whereIn(column: string, values: any[]): QueryBuilder;
  whereBetween(column: string, start: any, end: any): QueryBuilder;
  whereRaw(raw: string): QueryBuilder;

  join(table: string, leftColumn: string, rightColumn: string): QueryBuilder;
  leftJoin(table: string, leftColumn: string, rightColumn: string): QueryBuilder;

  orderBy(column: string, direction?: 'ASC' | 'DESC'): QueryBuilder;
  orderByDesc(column: string): QueryBuilder;
  groupBy(...columns: string[]): QueryBuilder;
  having(raw: string): QueryBuilder;
  limit(n: number): QueryBuilder;
  offset(n: number): QueryBuilder;

  toSQL(): string;
  execute(): Promise<Result>;
  all(): Promise<Record<string, any>[]>;
  first(): Promise<Record<string, any> | null>;
  pluck(column: string): Promise<any[]>;

  insert(data: Record<string, any>): Promise<Result>;
  insertMany(rows: Record<string, any>[]): Promise<Result>;
  update(data: Record<string, any>): Promise<Result>;
  delete(): Promise<Result>;
}

export function esc(v: any): string;

// ============================================================================
// Query Cache
// ============================================================================

export class QueryCache extends EventEmitter {
  readonly size: number;
  readonly hitRate: number;
  readonly stats: CacheStats;

  constructor(options?: CacheOptions);
  key(sql: string, params?: any[]): string;
  get(sql: string, params?: any[]): any | undefined;
  set(sql: string, params: any[] | undefined, value: any, ttlMs?: number): void;
  has(sql: string, params?: any[]): boolean;
  delete(sql: string, params?: any[]): boolean;
  invalidate(pattern: RegExp | string): number;
  invalidateTable(tableName: string): number;
  clear(): void;
  cleanup(): void;
  destroy(): void;
}

export interface CacheOptions {
  maxSize?: number;
  defaultTTLMs?: number;
  checkIntervalMs?: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
}

// ============================================================================
// Read/Write Splitting
// ============================================================================

export const QueryType: {
  READ: 'read';
  WRITE: 'write';
  UNKNOWN: 'unknown';
};

export class ReadWriteSplitter extends EventEmitter {
  readonly stats: RWSplitStats;

  constructor(options: RWSplitterOptions);
  route(sql: string): RouteTarget;
  addReplica(config: NodeConfig): void;
  removeReplica(host: string, port: number): void;
}

export function classifyQuery(sql: string): 'read' | 'write' | 'unknown';

export interface RWSplitterOptions {
  primary: NodeConfig;
  replicas?: NodeConfig[];
  replicaReads?: boolean;
  unknownRouting?: 'primary' | 'replica';
  classifier?: (sql: string) => 'read' | 'write' | 'unknown';
}

export interface NodeConfig {
  host: string;
  port: number;
}

export interface RouteTarget extends NodeConfig {
  role: 'primary' | 'replica';
}

export interface RWSplitStats {
  primary: NodeConfig;
  replicaCount: number;
  replicaReads: boolean;
  unknownRouting: string;
}

// ============================================================================
// Load Balancer
// ============================================================================

export const Strategy: {
  ROUND_ROBIN: 'round_robin';
  LEAST_CONNECTIONS: 'least_connections';
  RANDOM: 'random';
  WEIGHTED_ROUND_ROBIN: 'weighted_round_robin';
  FIRST_AVAILABLE: 'first_available';
};

export class Backend {
  readonly host: string;
  readonly port: number;
  readonly weight: number;
  readonly id: string;
  connections: number;
  healthy: boolean;
  lastCheck: number | null;

  constructor(config: BackendConfig);
}

export class LoadBalancer extends EventEmitter {
  readonly backendCount: number;
  readonly healthyCount: number;
  readonly stats: LBStats;

  constructor(options?: LBOptions);
  addBackend(config: BackendConfig): Backend;
  removeBackend(id: string): void;
  select(): Backend;
  acquire(backend: Backend): void;
  release(backend: Backend): void;
  setHealth(id: string, healthy: boolean): void;
  startHealthChecks(checkFn: (backend: Backend) => Promise<boolean>): void;
  stopHealthChecks(): void;
  destroy(): void;
}

export interface BackendConfig {
  host: string;
  port?: number;
  weight?: number;
  options?: Record<string, any>;
}

export interface LBOptions {
  strategy?: string;
  healthCheckIntervalMs?: number;
  maxConnectionsPerBackend?: number;
}

export interface LBStats {
  strategy: string;
  totalBackends: number;
  healthyBackends: number;
  backends: Array<{
    id: string;
    host: string;
    port: number;
    weight: number;
    connections: number;
    healthy: boolean;
  }>;
}

// ============================================================================
// Failover
// ============================================================================

export const FailoverStrategy: {
  ORDERED: 'ordered';
  PRIORITY: 'priority';
  DYNAMIC: 'dynamic';
};

export class FailoverNode {
  readonly host: string;
  readonly port: number;
  readonly priority: number;
  readonly id: string;
  healthy: boolean;
  failCount: number;
  lastFailure: number | null;
  connectionCount: number;

  constructor(config: FailoverNodeConfig);
}

export class FailoverManager extends EventEmitter {
  readonly nodeCount: number;
  readonly healthyCount: number;
  readonly current: FailoverNode | null;
  readonly stats: FailoverStats;

  constructor(options?: FailoverOptions);
  addNode(config: FailoverNodeConfig): FailoverNode;
  addNodes(configs: FailoverNodeConfig[]): void;
  removeNode(id: string): void;
  selectNode(): FailoverNode;
  execute<T>(fn: (node: FailoverNode) => Promise<T>): Promise<T>;
  markHealthy(id: string): void;
  markUnhealthy(id: string): void;
  destroy(): void;
}

export interface FailoverNodeConfig {
  host: string;
  port?: number;
  priority?: number;
  options?: Record<string, any>;
  isPrimary?: boolean;
}

export interface FailoverOptions {
  strategy?: string;
  retryIntervalMs?: number;
  maxFailCount?: number;
  autoReconnect?: boolean;
}

export interface FailoverStats {
  strategy: string;
  totalNodes: number;
  healthyNodes: number;
  currentNode: string | null;
  nodes: Array<{
    id: string;
    host: string;
    port: number;
    priority: number;
    healthy: boolean;
    failCount: number;
    connectionCount: number;
  }>;
}

// ============================================================================
// Metrics
// ============================================================================

export const MetricType: {
  COUNTER: 'counter';
  GAUGE: 'gauge';
  HISTOGRAM: 'histogram';
  SUMMARY: 'summary';
};

export class Counter {
  constructor(name: string, help: string, labelNames?: string[], defaultLabels?: string[]);
  inc(value?: number, labels?: Record<string, string>): void;
  expose(): string[];
}

export class Gauge {
  constructor(name: string, help: string, labelNames?: string[], defaultLabels?: string[]);
  set(value: number, labels?: Record<string, string>): void;
  inc(value?: number, labels?: Record<string, string>): void;
  dec(value?: number, labels?: Record<string, string>): void;
  expose(): string[];
}

export class Histogram {
  constructor(name: string, help: string, labelNames?: string[], defaultLabels?: string[], buckets?: number[]);
  observe(value: number, labels?: Record<string, string>): void;
  expose(): string[];
}

export class MetricsRegistry extends EventEmitter {
  readonly names: string[];

  constructor(options?: { prefix?: string; defaultLabels?: string[]; histogramBuckets?: number[] });
  counter(name: string, help: string, labelNames?: string[]): Counter;
  gauge(name: string, help: string, labelNames?: string[]): Gauge;
  histogram(name: string, help: string, labelNames?: string[], buckets?: number[]): Histogram;
  inc(name: string, value?: number, labels?: Record<string, string>): void;
  set(name: string, value: number, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
  time<T>(name: string, fn: () => Promise<T>, labels?: Record<string, string>): Promise<T>;
  expose(): string;
  clear(): void;
}

// ============================================================================
// Interceptors
// ============================================================================

export interface InterceptorContext {
  type: string;
  sql?: string;
  params?: any[];
  result?: any;
  error?: Error | null;
  duration?: number;
  meta?: Record<string, any>;
}

export type InterceptorFn = (ctx: InterceptorContext) => Promise<InterceptorContext | void>;

export class InterceptorRegistry {
  readonly stats: { pre: number; post: number; error: number; total: number };

  usePre(fn: InterceptorFn): () => void;
  usePost(fn: InterceptorFn): () => void;
  useError(fn: InterceptorFn): () => void;
  use(hooks: { pre?: InterceptorFn; post?: InterceptorFn; error?: InterceptorFn }): () => void;
  runPre(ctx: InterceptorContext): Promise<InterceptorContext>;
  runPost(ctx: InterceptorContext): Promise<InterceptorContext>;
  runError(ctx: InterceptorContext): Promise<InterceptorContext>;
  clear(): void;
}

export const BuiltinInterceptors: {
  logger(logger?: any): { pre: InterceptorFn; post: InterceptorFn; error: InterceptorFn };
  timing(metrics?: any): { post: InterceptorFn };
  sanitize(): { pre: InterceptorFn };
  timeout(defaultTimeoutMs: number): { pre: InterceptorFn };
};

// ============================================================================
// Default Export
// ============================================================================

declare const _default: {
  VedaClient: typeof VedaClient;
  createClient: typeof createClient;
  ConnectionPool: typeof ConnectionPool;
};

export default _default;
