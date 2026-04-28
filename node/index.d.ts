declare module 'vedadb' {
  import { TlsOptions } from 'tls';

  // ---- Options ------------------------------------------------------------

  interface VedaDBOptions {
    host?: string;
    port?: number;
    timeout?: number;
    /** Enable STARTTLS upgrade for encrypted connections. */
    tls?: boolean;
    /** Options passed to Node.js tls.connect (e.g. ca, rejectUnauthorized). */
    tlsOptions?: TlsOptions;
    /** Username for AUTH authentication. */
    user?: string;
    /** Password for AUTH authentication. */
    password?: string;
  }

  interface VedaPoolOptions {
    host?: string;
    port?: number;
    min?: number;
    max?: number;
    timeout?: number;
    idleTimeout?: number;
    acquireTimeout?: number;
  }

  interface SelectOptions {
    columns?: string[];
    where?: Record<string, any>;
    orderBy?: string;
    desc?: boolean;
    limit?: number;
    offset?: number;
  }

  // ---- Errors -------------------------------------------------------------

  class VedaDBError extends Error {
    name: 'VedaDBError';
  }

  class ConnectionError extends VedaDBError {
    name: 'ConnectionError';
  }

  class QueryError extends VedaDBError {
    name: 'QueryError';
  }

  class TimeoutError extends VedaDBError {
    name: 'TimeoutError';
  }

  class AuthError extends VedaDBError {
    name: 'AuthError';
  }

  // ---- Result -------------------------------------------------------------

  class Result {
    columns: string[];
    rows: any[][];
    rowCount: number;
    message: string;

    /** Convert rows to an array of plain objects keyed by column name. */
    toObjects(): Record<string, any>[];

    /** Return the first row as an object, or null. */
    first(): Record<string, any> | null;

    /** Pluck a single column from every row. */
    pluck(column: string): any[];
  }

  // ---- Client -------------------------------------------------------------

  class VedaDB {
    constructor(options?: VedaDBOptions);

    readonly connected: boolean;

    connect(): Promise<VedaDB>;
    query(sql: string): Promise<Result>;
    exec(sql: string): Promise<string>;
    ping(): Promise<boolean>;

    createTable(sql: string): Promise<string>;
    insert(table: string, data: Record<string, any>): Promise<string>;
    insertMany(table: string, rows: Record<string, any>[]): Promise<string>;
    select(table: string, options?: SelectOptions): Promise<Result>;
    update(table: string, set: Record<string, any>, where?: Record<string, any>): Promise<string>;
    deleteFrom(table: string, where?: Record<string, any>): Promise<string>;

    begin(): Promise<string>;
    commit(): Promise<string>;
    rollback(): Promise<string>;
    transaction<T>(fn: (client: VedaDB) => Promise<T>): Promise<T>;

    /** Prepare a named statement on the server. */
    prepare(name: string, query: string): Promise<Result>;

    /** Execute a previously prepared statement with parameter values. */
    executePrepared(name: string, ...args: any[]): Promise<Result>;

    /** Deallocate (remove) a previously prepared statement. */
    deallocate(name: string): Promise<Result>;

    /** Client-side parameterized query with $1, $2, ... placeholders. */
    prepared(template: string, params?: any[]): Promise<Result>;

    /** Pipeline version of prepared: run the same template with multiple param sets. */
    preparedPipeline(template: string, paramSets: any[][]): Promise<Result[]>;

    /** Send multiple queries in a single TCP write (pipelining). */
    pipeline(queries: string[]): Promise<Result[]>;

    /** Pipeline INSERT: insert multiple rows using pipeline. */
    pipelineInsert(table: string, rows: Record<string, any>[], batchSize?: number): Promise<number>;

    /** Pipeline SELECT: run multiple SELECT queries concurrently. */
    pipelineSelect(queries: string[]): Promise<Result[]>;

    cache: {
      set(key: string, value: any, ttl?: number): Promise<Result>;
      get(key: string): Promise<Result>;
      del(key: string): Promise<Result>;
      incr(key: string): Promise<Result>;
      keys(pattern: string): Promise<Result>;
      flush(): Promise<Result>;
      stats(): Promise<Result>;
    };

    /** Disconnect and reconnect with exponential backoff. */
    reconnect(maxRetries?: number): Promise<void>;

    /** Full-text search on a table. */
    search(table: string, query: string, fuzzy?: number): Promise<Result>;

    /** Add a node to the graph. */
    graphAddNode(id: string, label: string, props?: Record<string, any>): Promise<Result>;

    /** Add an edge between two nodes. */
    graphAddEdge(from: string, to: string, relation: string, props?: Record<string, any>): Promise<Result>;

    /** Breadth-first traversal from a starting node. */
    graphBFS(start: string, depth?: number): Promise<Result>;

    close(): void;
  }

  // ---- Pool ---------------------------------------------------------------

  class VedaPool {
    constructor(options?: VedaPoolOptions);

    readonly size: number;
    readonly idleCount: number;
    readonly activeCount: number;
    readonly waitingCount: number;

    warmup(): Promise<void>;
    acquire(): Promise<VedaDB>;
    release(client: VedaDB): void;
    query(sql: string): Promise<Result>;
    exec(sql: string): Promise<string>;
    close(): void;
  }

  // ---- Factory ------------------------------------------------------------

  function createClient(options?: VedaDBOptions): Promise<VedaDB>;
  function escapeValue(value: any): string;

  export {
    VedaDB,
    VedaDBError,
    ConnectionError,
    QueryError,
    TimeoutError,
    AuthError,
    Result,
    VedaPool,
    VedaDBOptions,
    VedaPoolOptions,
    SelectOptions,
    createClient,
    escapeValue,
  };
}
