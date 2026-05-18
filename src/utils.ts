/**
 * Shared utilities used across TCP and HTTP clients.
 *
 * @module
 */

import type { Result, QueryResult, SelectOptions, CacheAPI } from "./types";

/** Default connection values. */
export const DEFAULT_HOST = "localhost";
export const DEFAULT_TCP_PORT = 6380;
export const DEFAULT_HTTP_PORT = 9090;
export const DEFAULT_TIMEOUT = 30000;

/**
 * Promise-based delay.
 * @param ms - Milliseconds to wait.
 * @returns A promise that resolves after the delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a fully-featured Result object from raw data.
 *
 * @param columns - Column names.
 * @param rows - Row values.
 * @param message - Optional status message.
 * @returns A Result with toObjects, first, and pluck helpers.
 */
export function createResult<T = Record<string, unknown>>(
  columns: string[],
  rows: unknown[][],
  message = "OK"
): Result<T> {
  return {
    columns,
    rows,
    rowCount: rows.length,
    message,

    toObjects(): T[] {
      return rows.map((row) => {
        const obj = {} as Record<string, unknown>;
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj as T;
      });
    },

    first(): T | null {
      if (rows.length === 0) return null;
      const obj = {} as Record<string, unknown>;
      columns.forEach((col, i) => {
        obj[col] = rows[0][i];
      });
      return obj as T;
    },

    pluck(column: string): unknown[] {
      const idx = columns.indexOf(column);
      if (idx === -1) return [];
      return rows.map((row) => row[idx]);
    },
  };
}

/**
 * Convert a raw HTTP QueryResult into a rich Result.
 *
 * @param result - Raw result from the HTTP API.
 * @returns Enriched Result object.
 */
export function enrichResult<T = Record<string, unknown>>(result: QueryResult): Result<T> {
  const typedRows: unknown[][] = result.rows.map((row) => row.map((cell) => castValue(cell)));
  return createResult<T>(result.columns, typedRows, result.message);
}

/**
 * Convert rows from a QueryResult into plain objects.
 *
 * @param result - Raw QueryResult.
 * @returns Array of objects.
 */
export function toObjects(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = castValue(row[i]);
    });
    return obj;
  });
}

/**
 * Get the first row from a QueryResult as an object.
 *
 * @param result - Raw QueryResult.
 * @returns First row object, or null.
 */
export function firstRow(result: QueryResult): Record<string, unknown> | null {
  if (!result.rows || result.rows.length === 0) return null;
  const obj: Record<string, unknown> = {};
  result.columns.forEach((col, i) => {
    obj[col] = castValue(result.rows[0][i]);
  });
  return obj;
}

/**
 * Attempt to cast a string value back to its likely original type.
 */
function castValue(value: string): unknown {
  if (value === "null" || value === "NULL" || value === undefined) return null;
  if (value === "true" || value === "TRUE") return true;
  if (value === "false" || value === "FALSE") return false;
  const num = Number(value);
  if (!Number.isNaN(num) && String(num) === value) return num;
  // ISO date detection
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

/**
 * Check whether a row matches simple WHERE conditions.
 *
 * @param row - Object representing the row.
 * @param where - Key-value conditions (AND-joined).
 * @returns True if the row matches all conditions.
 */
export function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (row[key] !== expected) return false;
  }
  return true;
}

/**
 * Build a SQL SELECT string from components.
 *
 * @param table - Table name.
 * @param options - Select options (columns, where, order, limit, offset).
 * @returns Complete SQL SELECT statement.
 */
export function buildSqlSelect(table: string, options: SelectOptions = {}): string {
  const {
    columns = ["*"],
    where,
    whereRaw,
    orderBy,
    limit,
    offset,
  } = options;

  const cols = columns.join(", ");
  let sql = `SELECT ${cols} FROM ${escapeIdentifier(table)}`;

  if (whereRaw) {
    sql += ` WHERE ${whereRaw}`;
  } else if (where && Object.keys(where).length > 0) {
    sql += ` WHERE ${parseWhereClause(where)}`;
  }

  if (orderBy) {
    sql += ` ORDER BY ${orderBy}`;
  }
  if (typeof limit === "number") {
    sql += ` LIMIT ${limit}`;
  }
  if (typeof offset === "number") {
    sql += ` OFFSET ${offset}`;
  }

  return sql;
}

/**
 * Convert a record into a SQL WHERE clause string.
 *
 * @param where - Key-value pairs.
 * @returns SQL WHERE fragment (e.g. `id = 1 AND name = 'x'`).
 */
export function parseWhereClause(where: Record<string, unknown>): string {
  return Object.entries(where)
    .map(([key, value]) => {
      return `${escapeIdentifier(key)} = ${escapeValue(value)}`;
    })
    .join(" AND ");
}

/**
 * Convert a record into a SQL SET clause string.
 *
 * @param set - Key-value pairs.
 * @returns SQL SET fragment (e.g. `name = 'x', age = 20`).
 */
export function parseSetClause(set: Record<string, unknown>): string {
  return Object.entries(set)
    .map(([key, value]) => {
      return `${escapeIdentifier(key)} = ${escapeValue(value)}`;
    })
    .join(", ");
}

/**
 * Build a SQL INSERT statement.
 *
 * @param table - Target table.
 * @param data - Row data.
 * @returns SQL INSERT string.
 */
export function buildSqlInsert(table: string, data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  const values = Object.values(data).map(escapeValue);
  return `INSERT INTO ${escapeIdentifier(table)} (${keys.map(escapeIdentifier).join(", ")}) VALUES (${values.join(", ")})`;
}

/**
 * Build a SQL UPDATE statement.
 *
 * @param table - Target table.
 * @param set - Columns to update.
 * @param where - WHERE conditions.
 * @returns SQL UPDATE string.
 */
export function buildSqlUpdate(
  table: string,
  set: Record<string, unknown>,
  where: Record<string, unknown>
): string {
  return `UPDATE ${escapeIdentifier(table)} SET ${parseSetClause(set)} WHERE ${parseWhereClause(where)}`;
}

/**
 * Build a SQL DELETE statement.
 *
 * @param table - Target table.
 * @param where - WHERE conditions.
 * @returns SQL DELETE string.
 */
export function buildSqlDelete(table: string, where: Record<string, unknown>): string {
  return `DELETE FROM ${escapeIdentifier(table)} WHERE ${parseWhereClause(where)}`;
}

/**
 * Escape a SQL identifier (table/column name).
 */
export function escapeIdentifier(name: string): string {
  // Simple escaping: wrap in double quotes, escape embedded double quotes
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Escape a SQL value for use in a query string.
 */
export function escapeValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  // String: escape single quotes
  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

/**
 * Create an in-memory cache implementation.
 *
 * @returns CacheAPI instance.
 */
export function createMemoryCache(): CacheAPI {
  const store = new Map<string, { value: string; expires: number }>();

  return {
    set(key: string, value: string, ttl?: number): void {
      const expires = typeof ttl === "number" ? Date.now() + ttl * 1000 : Number.POSITIVE_INFINITY;
      store.set(key, { value, expires });
    },

    get(key: string): string | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expires) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },

    del(key: string): void {
      store.delete(key);
    },

    incr(key: string): number {
      const current = this.get(key);
      const num = current === null ? 0 : Number.parseInt(current, 10) || 0;
      const next = num + 1;
      this.set(key, String(next));
      return next;
    },
  };
}
