/**
 * VedaDB HTTP REST API Driver (Universal)
 *
 * Works in Node.js, Bun, Deno, and browsers. Uses the global `fetch` API.
 *
 * @example
 * ```ts
 * import { createApiClient } from "vedadb-driver/api";
 *
 * const api = createApiClient({ host: "localhost", port: 9090 });
 * const users = await api.select("users", { where: { active: true } });
 * console.log(users.toObjects());
 * ```
 *
 * @module
 */

import type {
  ConnectionConfig,
  Result,
  SelectOptions,
  VedaDBStatus,
  QueryResult,
  ApiClientConfig,
  VedaApiClient,
} from "./types";
import {
  enrichResult,
  buildSqlSelect,
  DEFAULT_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_TIMEOUT,
} from "./utils";

// ── Re-exports ────────────────────────────────────────────────────────────

export type {
  ConnectionConfig,
  Result,
  SelectOptions,
  CacheAPI,
  VedaClient,
  VedaDBStatus,
  QueryResult,
  ApiClientConfig,
  VedaApiClient,
} from "./types";

export {
  createResult,
  delay,
  buildSqlSelect,
  buildSqlInsert,
  buildSqlUpdate,
  buildSqlDelete,
  matchesWhere,
  parseWhereClause,
  parseSetClause,
  createMemoryCache,
  toObjects,
  firstRow,
  DEFAULT_HOST,
  DEFAULT_TCP_PORT,
  DEFAULT_HTTP_PORT,
  DEFAULT_TIMEOUT,
} from "./utils";

export { QueryBuilder, sql, query, select, insert, update, del as deleteFrom } from "./sql";

// ── Internal helpers ──────────────────────────────────────────────────────

function buildApiBase(config: ConnectionConfig): string {
  return `http://${config.host}:${config.port}`;
}

function getFetch(customFetch?: typeof fetch): typeof fetch {
  if (customFetch) return customFetch;
  if (typeof globalThis !== "undefined" && globalThis.fetch) {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error(
    "VedaDB: fetch is not available. Provide a fetch implementation in config, " +
      "or use Node.js 18+, Deno, Bun, or a fetch polyfill."
  );
}

/**
 * Create an HTTP API client for VedaDB.
 *
 * @param config - Partial connection configuration. Defaults: host=localhost, port=9090.
 * @returns VedaApiClient implementation.
 */
export function createApiClient(config?: Partial<ApiClientConfig>): VedaApiClient {
  const cfg: Required<Pick<ConnectionConfig, "host" | "port" | "timeout">> & {
    apiKey?: string;
    database?: string;
    fetch: typeof fetch;
  } = {
    host: config?.host ?? DEFAULT_HOST,
    port: config?.port ?? DEFAULT_HTTP_PORT,
    timeout: config?.timeout ?? DEFAULT_TIMEOUT,
    apiKey: config?.apiKey,
    database: config?.database,
    fetch: getFetch(config?.fetch),
  };

  const apiBase = buildApiBase(cfg);
  let currentLatency = 0;

  /**
   * Build request headers, including auth when configured.
   */
  function headers(contentType = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (contentType) h["Content-Type"] = "application/json";
    if (cfg.apiKey) h["X-API-Key"] = cfg.apiKey;
    if (cfg.database) h["X-Database"] = cfg.database;
    return h;
  }

  /**
   * Wrapper around fetch with timeout support.
   */
  async function fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), cfg.timeout);

    try {
      const response = await cfg.fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`VedaDB: request timed out after ${cfg.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const client: VedaApiClient = {
    getStatus(): VedaDBStatus {
      return {
        connected: currentLatency > 0,
        host: cfg.host,
        port: cfg.port,
        latency: currentLatency,
      };
    },

    async query(sql: string, database?: string): Promise<Result> {
      const h = headers(true);
      if (database) h["X-Database"] = database;

      const start = Date.now();
      const response = await fetchWithTimeout(`${apiBase}/api/query`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ sql }),
      });
      currentLatency = Date.now() - start;

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`VedaDB HTTP ${response.status}: ${text}`);
      }

      const raw: QueryResult = await response.json();
      return enrichResult(raw);
    },

    async testConnection(): Promise<boolean> {
      try {
        const start = Date.now();
        const response = await fetchWithTimeout(`${apiBase}/health`, {
          method: "GET",
          headers: headers(),
        });
        currentLatency = Date.now() - start;
        return response.ok;
      } catch {
        currentLatency = -1;
        return false;
      }
    },

    async insert(
      table: string,
      values: Record<string, unknown>
    ): Promise<{ message: string }> {
      const response = await fetchWithTimeout(`${apiBase}/api/data/insert`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ table, values }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`VedaDB HTTP ${response.status}: ${text}`);
      }

      return response.json() as Promise<{ message: string }>;
    },

    async update(
      table: string,
      column: string,
      value: unknown,
      where: Record<string, unknown>
    ): Promise<{ message: string; affected: number }> {
      const response = await fetchWithTimeout(`${apiBase}/api/data/update`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ table, column, value, where }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`VedaDB HTTP ${response.status}: ${text}`);
      }

      return response.json() as Promise<{ message: string; affected: number }>;
    },

    async delete(
      table: string,
      where: Record<string, unknown>
    ): Promise<{ message: string; affected: number }> {
      const response = await fetchWithTimeout(`${apiBase}/api/data/delete`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ table, where }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`VedaDB HTTP ${response.status}: ${text}`);
      }

      return response.json() as Promise<{ message: string; affected: number }>;
    },

    async exec(sql: string): Promise<{ message: string; rowCount: number }> {
      // The exec endpoint maps to the query endpoint for HTTP
      const result = await this.query(sql);
      return {
        message: result.message,
        rowCount: result.rowCount,
      };
    },

    async select(table: string, options?: SelectOptions): Promise<Result> {
      const sql = buildSqlSelect(table, options);
      return this.query(sql);
    },

    async listTables(): Promise<string[]> {
      const response = await fetchWithTimeout(`${apiBase}/api/tables`, {
        method: "GET",
        headers: headers(),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`VedaDB HTTP ${response.status}: ${text}`);
      }

      const data = (await response.json()) as { tables?: string[] } | string[];
      if (Array.isArray(data)) return data;
      return data.tables ?? [];
    },

    async schema(table: string): Promise<Record<string, unknown>> {
      const response = await fetchWithTimeout(
        `${apiBase}/api/schema?table=${encodeURIComponent(table)}`,
        {
          method: "GET",
          headers: headers(),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`VedaDB HTTP ${response.status}: ${text}`);
      }

      return response.json() as Promise<Record<string, unknown>>;
    },
  };

  return client;
}

// ── Standalone helpers ────────────────────────────────────────────────────

/**
 * Standalone: execute a SQL query against the VedaDB HTTP API.
 *
 * @param sql - SQL statement.
 * @param database - Optional database name override.
 * @param config - Connection configuration.
 * @returns Typed Result.
 */
export async function vedaQuery(
  sql: string,
  database?: string,
  config?: Partial<ConnectionConfig>
): Promise<Result> {
  const client = createApiClient(config);
  return client.query(sql, database);
}

/**
 * Standalone: test if the VedaDB HTTP API is reachable.
 *
 * @param config - Connection configuration.
 * @returns True if the health endpoint responds with 200.
 */
export async function vedaTestConnection(config?: Partial<ConnectionConfig>): Promise<boolean> {
  const client = createApiClient(config);
  return client.testConnection();
}

/**
 * Standalone: insert a row via the REST API.
 *
 * @param table - Target table.
 * @param values - Row data.
 * @param config - Connection configuration.
 */
export async function vedaInsert(
  table: string,
  values: Record<string, unknown>,
  config?: Partial<ConnectionConfig>
): Promise<{ message: string }> {
  const client = createApiClient(config);
  return client.insert(table, values);
}

/**
 * Standalone: update rows via the REST API.
 *
 * @param table - Target table.
 * @param column - Column to update.
 * @param value - New value.
 * @param where - WHERE conditions.
 * @param config - Connection configuration.
 */
export async function vedaUpdate(
  table: string,
  column: string,
  value: unknown,
  where: Record<string, unknown>,
  config?: Partial<ConnectionConfig>
): Promise<{ message: string; affected: number }> {
  const client = createApiClient(config);
  return client.update(table, column, value, where);
}

/**
 * Standalone: delete rows via the REST API.
 *
 * @param table - Target table.
 * @param where - WHERE conditions.
 * @param config - Connection configuration.
 */
export async function vedaDelete(
  table: string,
  where: Record<string, unknown>,
  config?: Partial<ConnectionConfig>
): Promise<{ message: string; affected: number }> {
  const client = createApiClient(config);
  return client.delete(table, where);
}

/**
 * Standalone: execute SQL via the REST API.
 *
 * @param sql - SQL statement.
 * @param config - Connection configuration.
 */
export async function vedaExec(
  sql: string,
  config?: Partial<ConnectionConfig>
): Promise<{ message: string; rowCount: number }> {
  const client = createApiClient(config);
  return client.exec(sql);
}

/**
 * Standalone: select rows via the REST API.
 *
 * @param table - Target table.
 * @param options - Select options.
 * @param config - Connection configuration.
 */
export async function vedaSelect(
  table: string,
  options?: SelectOptions,
  config?: Partial<ConnectionConfig>
): Promise<Result> {
  const client = createApiClient(config);
  return client.select(table, options);
}

/**
 * Standalone: list all tables.
 *
 * @param config - Connection configuration.
 */
export async function vedaListTables(config?: Partial<ConnectionConfig>): Promise<string[]> {
  const client = createApiClient(config);
  return client.listTables();
}

/**
 * Standalone: get table schema.
 *
 * @param table - Table name.
 * @param config - Connection configuration.
 */
export async function vedaSchema(
  table: string,
  config?: Partial<ConnectionConfig>
): Promise<Record<string, unknown>> {
  const client = createApiClient(config);
  return client.schema(table);
}

// ── Backward-compatible module-level state ────────────────────────────────

let _globalApiBase = "";
let _globalApiKey = "";

/** Set the global API base URL (used by standalone helpers when no config given). */
export function setApiBase(url: string): void {
  _globalApiBase = url;
}

/** Get the global API base URL. */
export function getApiBase(): string {
  return _globalApiBase;
}

/** Set the global API key. */
export function setApiKey(key: string): void {
  _globalApiKey = key;
}

/** Get the global API key. */
export function getApiKey(): string {
  return _globalApiKey;
}
