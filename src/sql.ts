/**
 * Fluent SQL query builder and tagged template helpers.
 *
 * @module
 */

import { buildSqlSelect, parseWhereClause, escapeValue, escapeIdentifier } from "./utils";
import type { SelectOptions } from "./types";

/**
 * Fluent SQL query builder for SELECT statements.
 *
 * @example
 * ```ts
 * const sql = new QueryBuilder()
 *   .select("id", "name")
 *   .from("users")
 *   .where({ status: "active" })
 *   .orderBy("created_at DESC")
 *   .limit(10)
 *   .build();
 * ```
 */
export class QueryBuilder {
  private _columns: string[] = ["*"];
  private _table = "";
  private _where: Record<string, unknown> | null = null;
  private _whereRaw = "";
  private _orderBy = "";
  private _limit = -1;
  private _offset = -1;

  /**
   * Set the columns to select.
   * @param cols - Column names. Pass none for all columns.
   */
  select(...cols: string[]): this {
    this._columns = cols.length > 0 ? cols : ["*"];
    return this;
  }

  /** Set the target table. */
  from(table: string): this {
    this._table = table;
    return this;
  }

  /** Add WHERE conditions as key-value pairs. */
  where(conditions: Record<string, unknown>): this {
    this._where = conditions;
    return this;
  }

  /** Add a raw SQL WHERE clause (overrides key-value where). */
  whereRaw(clause: string): this {
    this._whereRaw = clause;
    return this;
  }

  /** Set ORDER BY clause. */
  orderBy(expr: string): this {
    this._orderBy = expr;
    return this;
  }

  /** Set LIMIT. */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /** Set OFFSET. */
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /**
   * Assemble and return the final SQL string.
   * @throws If no table has been specified.
   */
  build(): string {
    if (!this._table) {
      throw new Error("QueryBuilder: no table specified. Call .from(table) before .build()");
    }
    return buildSqlSelect(this._table, {
      columns: this._columns,
      where: this._where ?? undefined,
      whereRaw: this._whereRaw || undefined,
      orderBy: this._orderBy || undefined,
      limit: this._limit >= 0 ? this._limit : undefined,
      offset: this._offset >= 0 ? this._offset : undefined,
    });
  }

  /** Reset all builder state. */
  reset(): this {
    this._columns = ["*"];
    this._table = "";
    this._where = null;
    this._whereRaw = "";
    this._orderBy = "";
    this._limit = -1;
    this._offset = -1;
    return this;
  }
}

/**
 * A tagged template literal that safely escapes interpolated values
 * to help prevent SQL injection.
 *
 * @example
 * ```ts
 * const id = 42;
 * const name = "O'Brien";
 * const query = sql`SELECT * FROM users WHERE id = ${id} AND name = ${name}`;
 * // => "SELECT * FROM users WHERE id = 42 AND name = 'O''Brien'"
 * ```
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    result += escapeValue(values[i]);
    result += strings[i + 1];
  }
  return result;
}

/**
 * Create a QueryBuilder instance (factory function).
 *
 * @example
 * ```ts
 * const q = query().select("*").from("posts").where({ published: true }).build();
 * ```
 */
export function query(): QueryBuilder {
  return new QueryBuilder();
}

/**
 * Build a SELECT statement from options.
 *
 * @param table - Table name.
 * @param options - Selection options.
 * @returns SQL SELECT string.
 */
export function select(table: string, options: SelectOptions = {}): string {
  return buildSqlSelect(table, options);
}

/**
 * Build an INSERT statement.
 *
 * @param table - Target table.
 * @param data - Row data.
 * @returns SQL INSERT string.
 */
export function insert(table: string, data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  const values = Object.values(data).map(escapeValue);
  return `INSERT INTO ${escapeIdentifier(table)} (${keys.map(escapeIdentifier).join(", ")}) VALUES (${values.join(", ")})`;
}

/**
 * Build an UPDATE statement.
 *
 * @param table - Target table.
 * @param set - Columns to update.
 * @param where - WHERE conditions.
 * @returns SQL UPDATE string.
 */
export function update(
  table: string,
  set: Record<string, unknown>,
  where: Record<string, unknown>
): string {
  const setClause = Object.entries(set)
    .map(([k, v]) => `${escapeIdentifier(k)} = ${escapeValue(v)}`)
    .join(", ");
  return `UPDATE ${escapeIdentifier(table)} SET ${setClause} WHERE ${parseWhereClause(where)}`;
}

/**
 * Build a DELETE statement.
 *
 * @param table - Target table.
 * @param where - WHERE conditions.
 * @returns SQL DELETE string.
 */
export function del(table: string, where: Record<string, unknown>): string {
  return `DELETE FROM ${escapeIdentifier(table)} WHERE ${parseWhereClause(where)}`;
}

/**
 * Re-export identifier and value escapers for advanced use.
 */
export { escapeIdentifier, escapeValue };
