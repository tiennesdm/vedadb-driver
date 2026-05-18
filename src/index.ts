/**
 * VedaDB TCP Driver for Node.js
 *
 * Provides a full-featured database client that connects over TCP (port 6380)
 * using the native Node.js `net` module. Supports querying, inserting,
 * transactions, and an in-memory cache.
 *
 * @example
 * ```ts
 * import { createClient } from "vedadb-driver";
 *
 * const client = createClient({ host: "localhost", port: 6380 });
 * await client.connect();
 * const result = await client.select("users", { where: { active: true } });
 * console.log(result.toObjects());
 * await client.disconnect();
 * ```
 *
 * @module
 */

import * as net from "node:net";
import type {
  ConnectionConfig,
  Result,
  SelectOptions,
  CacheAPI,
  VedaClient,
  VedaDBStatus,
} from "./types";
import {
  createResult,
  createMemoryCache,
  buildSqlSelect,
  buildSqlInsert,
  buildSqlUpdate,
  buildSqlDelete,
  DEFAULT_HOST,
  DEFAULT_TCP_PORT,
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
  buildSqlSelect,
  buildSqlInsert,
  buildSqlUpdate,
  buildSqlDelete,
  matchesWhere,
  parseWhereClause,
  parseSetClause,
  createMemoryCache,
  DEFAULT_HOST,
  DEFAULT_TCP_PORT,
  DEFAULT_HTTP_PORT,
  DEFAULT_TIMEOUT,
  toObjects,
  firstRow,
} from "./utils";

export { QueryBuilder, sql, query, select, insert, update, del as deleteFrom } from "./sql";

// ── Internal helpers ──────────────────────────────────────────────────────

function applyDefaults(config?: Partial<ConnectionConfig>): ConnectionConfig {
  return {
    host: config?.host ?? DEFAULT_HOST,
    port: config?.port ?? DEFAULT_TCP_PORT,
    timeout: config?.timeout ?? DEFAULT_TIMEOUT,
    apiKey: config?.apiKey,
    database: config?.database,
  };
}

/**
 * Create a TCP-connected VedaDB client.
 *
 * @param config - Partial connection configuration. Defaults: host=localhost, port=6380.
 * @returns VedaClient implementation.
 */
export function createClient(config?: Partial<ConnectionConfig>): VedaClient {
  const cfg = applyDefaults(config);
  let socket: net.Socket | null = null;
  let connected = false;
  let currentLatency = 0;
  const cache: CacheAPI = createMemoryCache();

  /**
   * Send a command over the TCP socket and parse the JSON response.
   */
  async function sendCommand(command: string): Promise<Result> {
    if (!socket || !connected) {
      throw new Error("VedaDB: not connected. Call connect() first.");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`VedaDB: command timed out after ${cfg.timeout}ms`));
      }, cfg.timeout);

      let buffer = "";

      const onData = (data: Buffer) => {
        buffer += data.toString("utf-8");
        // VedaDB terminates responses with a newline
        if (buffer.includes("\n")) {
          cleanup();
          clearTimeout(timeout);
          try {
            const raw = JSON.parse(buffer.trim());
            const result = createResult(
              raw.columns ?? [],
              raw.rows ?? [],
              raw.message ?? "OK"
            );
            resolve(result);
          } catch {
            // Non-JSON response (e.g. OK confirmation)
            resolve(createResult([], [], buffer.trim()));
          }
        }
      };

      const onError = (err: Error) => {
        cleanup();
        clearTimeout(timeout);
        reject(err);
      };

      const onClose = () => {
        cleanup();
        clearTimeout(timeout);
        reject(new Error("VedaDB: connection closed unexpectedly"));
      };

      function cleanup() {
        socket?.off("data", onData);
        socket?.off("error", onError);
        socket?.off("close", onClose);
      }

      socket!.on("data", onData);
      socket!.on("error", onError);
      socket!.on("close", onClose);

      // Send command with trailing newline
      socket!.write(command + "\n", "utf-8");
    });
  }

  const client: VedaClient = {
    get isConnected() {
      return connected;
    },

    get connectionInfo() {
      return { host: cfg.host, port: cfg.port, latency: currentLatency };
    },

    cache,

    async connect(): Promise<void> {
      if (connected && socket) return;

      return new Promise((resolve, reject) => {
        const start = Date.now();
        const newSocket = new net.Socket();

        const timeout = setTimeout(() => {
          newSocket.destroy();
          reject(new Error(`VedaDB: connection timed out after ${cfg.timeout}ms`));
        }, cfg.timeout);

        newSocket.once("connect", () => {
          clearTimeout(timeout);
          connected = true;
          currentLatency = Date.now() - start;
          socket = newSocket;

          // Handle unexpected disconnects
          newSocket.on("close", () => {
            connected = false;
            socket = null;
          });

          newSocket.on("error", (err: Error) => {
            if (!connected) {
              reject(err);
            }
          });

          resolve();
        });

        newSocket.once("error", (err: Error) => {
          clearTimeout(timeout);
          newSocket.destroy();
          reject(err);
        });

        newSocket.connect(cfg.port, cfg.host);
      });
    },

    async disconnect(): Promise<void> {
      connected = false;
      if (socket) {
        socket.end();
        socket = null;
      }
    },

    async query(sql: string): Promise<Result> {
      return sendCommand(sql);
    },

    async exec(sql: string): Promise<Result> {
      return sendCommand(sql);
    },

    async insert(table: string, data: Record<string, unknown>): Promise<Result> {
      const sql = buildSqlInsert(table, data);
      return sendCommand(sql);
    },

    async select(table: string, options?: SelectOptions): Promise<Result> {
      const sql = buildSqlSelect(table, options);
      return sendCommand(sql);
    },

    async update(
      table: string,
      set: Record<string, unknown>,
      where: Record<string, unknown>
    ): Promise<Result> {
      const sql = buildSqlUpdate(table, set, where);
      return sendCommand(sql);
    },

    async deleteFrom(table: string, where: Record<string, unknown>): Promise<Result> {
      const sql = buildSqlDelete(table, where);
      return sendCommand(sql);
    },

    async transaction<T>(fn: (trx: VedaClient) => Promise<T>): Promise<T> {
      await sendCommand("BEGIN TRANSACTION");
      try {
        const result = await fn(client);
        await sendCommand("COMMIT");
        return result;
      } catch (err) {
        await sendCommand("ROLLBACK").catch(() => {
          // Best-effort rollback; ignore failure
        });
        throw err;
      }
    },
  };

  return client;
}

// ── Singleton default client ──────────────────────────────────────────────

let _defaultClient: VedaClient | null = null;

/**
 * Get or create the default singleton client.
 *
 * @returns The shared VedaClient instance.
 */
export function getDefaultClient(): VedaClient {
  if (!_defaultClient) {
    _defaultClient = createClient();
  }
  return _defaultClient;
}

/**
 * Reset the singleton client (useful for testing).
 */
export function resetDefaultClient(): void {
  _defaultClient = null;
}

// ── Connection status helper ──────────────────────────────────────────────

/**
 * Test a TCP connection to a VedaDB server.
 *
 * @param config - Connection configuration.
 * @returns Status with connected flag and latency.
 */
export async function testTcpConnection(
  config?: Partial<ConnectionConfig>
): Promise<VedaDBStatus> {
  const cfg = applyDefaults(config);
  const start = Date.now();

  return new Promise((resolve) => {
    const testSocket = new net.Socket();
    const timeout = setTimeout(() => {
      testSocket.destroy();
      resolve({
        connected: false,
        host: cfg.host,
        port: cfg.port,
        latency: -1,
        error: "Connection timed out",
      });
    }, cfg.timeout);

    testSocket.once("connect", () => {
      clearTimeout(timeout);
      const latency = Date.now() - start;
      testSocket.end();
      resolve({ connected: true, host: cfg.host, port: cfg.port, latency });
    });

    testSocket.once("error", (err: Error) => {
      clearTimeout(timeout);
      testSocket.destroy();
      resolve({
        connected: false,
        host: cfg.host,
        port: cfg.port,
        latency: -1,
        error: err.message,
      });
    });

    testSocket.connect(cfg.port, cfg.host);
  });
}
