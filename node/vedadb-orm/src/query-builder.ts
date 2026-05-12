/**
 * VedaDB ORM QueryBuilder
 *
 * Immutable, chainable query builder that produces SQL and executes it.
 */

import { FieldType, WhereClause, WhereOperator, OrderDirection, DriverResult } from './types';
import { escapeIdentifier, escapeValue, deepClone } from './utils';
import { FieldDefinition, SchemaDefinition } from './schema';
import { QueryError } from './errors';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface WhereCondition {
  sql: string;
  conjunction: 'AND' | 'OR';
}

interface QueryState<T> {
  table: string;
  schema: SchemaDefinition<T>;
  selectedFields: string[] | null;
  whereConditions: WhereCondition[];
  orderClauses: { field: string; direction: OrderDirection }[];
  limitValue: number | null;
  offsetValue: number | null;
  includeRelations: string[];
  cacheTTL: number | null;
  softDeleteEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Operator helpers
// ---------------------------------------------------------------------------

function buildOperatorClause(field: string, op: WhereOperator<any>, fieldDef?: FieldDefinition): string {
  const esc = escapeIdentifier(field);
  const parts: string[] = [];

  if (op.eq !== undefined) parts.push(`${esc} = ${escapeValue(op.eq)}`);
  if (op.neq !== undefined) parts.push(`${esc} != ${escapeValue(op.neq)}`);
  if (op.gt !== undefined) parts.push(`${esc} > ${escapeValue(op.gt)}`);
  if (op.gte !== undefined) parts.push(`${esc} >= ${escapeValue(op.gte)}`);
  if (op.lt !== undefined) parts.push(`${esc} < ${escapeValue(op.lt)}`);
  if (op.lte !== undefined) parts.push(`${esc} <= ${escapeValue(op.lte)}`);
  if (op.in !== undefined) {
    const vals = op.in.map((v: any) => escapeValue(v)).join(', ');
    parts.push(`${esc} IN (${vals})`);
  }
  if (op.notIn !== undefined) {
    const vals = op.notIn.map((v: any) => escapeValue(v)).join(', ');
    parts.push(`${esc} NOT IN (${vals})`);
  }
  if (op.like !== undefined) parts.push(`${esc} LIKE ${escapeValue(op.like)}`);
  if (op.between !== undefined) {
    parts.push(`${esc} BETWEEN ${escapeValue(op.between[0])} AND ${escapeValue(op.between[1])}`);
  }
  if (op.isNull === true) parts.push(`${esc} IS NULL`);
  if (op.isNull === false) parts.push(`${esc} IS NOT NULL`);

  return parts.join(' AND ');
}

function isOperatorObject(value: any): value is WhereOperator<any> {
  if (value === null || value === undefined || typeof value !== 'object') return false;
  if (value instanceof Date || Buffer.isBuffer(value) || Array.isArray(value)) return false;
  const opKeys = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'between', 'isNull'];
  return Object.keys(value).some((k) => opKeys.includes(k));
}

function buildWhereFromClause<T>(conditions: WhereClause<T>, schema: SchemaDefinition<T>): string {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(conditions)) {
    const fieldDef = schema.fields[field];
    if (isOperatorObject(value)) {
      parts.push(buildOperatorClause(field, value as WhereOperator<any>, fieldDef));
    } else if (value === null) {
      parts.push(`${escapeIdentifier(field)} IS NULL`);
    } else {
      parts.push(`${escapeIdentifier(field)} = ${escapeValue(value)}`);
    }
  }
  return parts.join(' AND ');
}

// ---------------------------------------------------------------------------
// QueryBuilder
// ---------------------------------------------------------------------------

export class QueryBuilder<T = any> {
  private state: QueryState<T>;
  private executor: (sql: string) => Promise<DriverResult>;
  private hydrator: (result: DriverResult) => T[];
  private populateFn: ((items: T[], relations: string[]) => Promise<T[]>) | null;

  constructor(
    schema: SchemaDefinition<T>,
    executor: (sql: string) => Promise<DriverResult>,
    hydrator: (result: DriverResult) => T[],
    populateFn?: (items: T[], relations: string[]) => Promise<T[]>
  ) {
    this.state = {
      table: schema.tableName,
      schema,
      selectedFields: null,
      whereConditions: [],
      orderClauses: [],
      limitValue: null,
      offsetValue: null,
      includeRelations: [],
      cacheTTL: null,
      softDeleteEnabled: schema.options.softDelete || false,
    };
    this.executor = executor;
    this.hydrator = hydrator;
    this.populateFn = populateFn || null;
  }

  /**
   * Clone the builder to maintain immutability.
   */
  private clone(): QueryBuilder<T> {
    const qb = new QueryBuilder<T>(this.state.schema, this.executor, this.hydrator, this.populateFn ?? undefined);
    qb.state = {
      ...this.state,
      selectedFields: this.state.selectedFields ? [...this.state.selectedFields] : null,
      whereConditions: [...this.state.whereConditions],
      orderClauses: [...this.state.orderClauses],
      includeRelations: [...this.state.includeRelations],
    };
    return qb;
  }

  // ---- WHERE chain -------------------------------------------------------

  where(conditions: WhereClause<T>): QueryBuilder<T> {
    const qb = this.clone();
    const sql = buildWhereFromClause(conditions, this.state.schema);
    if (sql) qb.state.whereConditions.push({ sql, conjunction: 'AND' });
    return qb;
  }

  orWhere(conditions: WhereClause<T>): QueryBuilder<T> {
    const qb = this.clone();
    const sql = buildWhereFromClause(conditions, this.state.schema);
    if (sql) qb.state.whereConditions.push({ sql, conjunction: 'OR' });
    return qb;
  }

  whereIn(field: keyof T & string, values: any[]): QueryBuilder<T> {
    const qb = this.clone();
    const vals = values.map((v) => escapeValue(v)).join(', ');
    qb.state.whereConditions.push({
      sql: `${escapeIdentifier(field)} IN (${vals})`,
      conjunction: 'AND',
    });
    return qb;
  }

  whereNull(field: keyof T & string): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.whereConditions.push({
      sql: `${escapeIdentifier(field)} IS NULL`,
      conjunction: 'AND',
    });
    return qb;
  }

  whereNotNull(field: keyof T & string): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.whereConditions.push({
      sql: `${escapeIdentifier(field)} IS NOT NULL`,
      conjunction: 'AND',
    });
    return qb;
  }

  whereBetween(field: keyof T & string, low: any, high: any): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.whereConditions.push({
      sql: `${escapeIdentifier(field)} BETWEEN ${escapeValue(low)} AND ${escapeValue(high)}`,
      conjunction: 'AND',
    });
    return qb;
  }

  // ---- SELECT / ORDER / LIMIT -------------------------------------------

  select(...fields: (keyof T & string)[]): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.selectedFields = fields;
    return qb;
  }

  orderBy(field: keyof T & string, direction: OrderDirection = 'ASC'): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.orderClauses.push({ field, direction });
    return qb;
  }

  limit(n: number): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.limitValue = n;
    return qb;
  }

  offset(n: number): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.offsetValue = n;
    return qb;
  }

  // ---- Relations / Cache -------------------------------------------------

  include(...relations: string[]): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.includeRelations.push(...relations);
    return qb;
  }

  cache(ttl: number): QueryBuilder<T> {
    const qb = this.clone();
    qb.state.cacheTTL = ttl;
    return qb;
  }

  // ---- SQL generation ----------------------------------------------------

  toSQL(): string {
    const cols = this.state.selectedFields
      ? this.state.selectedFields.map(escapeIdentifier).join(', ')
      : '*';

    let sql = `SELECT ${cols} FROM ${escapeIdentifier(this.state.table)}`;

    // Build WHERE clause
    const conditions = [...this.state.whereConditions];

    // Inject soft-delete filter
    if (this.state.softDeleteEnabled) {
      conditions.unshift({ sql: `${escapeIdentifier('deleted_at')} IS NULL`, conjunction: 'AND' });
    }

    if (conditions.length > 0) {
      const parts: string[] = [];
      for (let i = 0; i < conditions.length; i++) {
        if (i === 0) {
          parts.push(conditions[i].sql);
        } else {
          parts.push(`${conditions[i].conjunction} ${conditions[i].sql}`);
        }
      }
      sql += ' WHERE ' + parts.join(' ');
    }

    // ORDER BY
    if (this.state.orderClauses.length > 0) {
      const orders = this.state.orderClauses.map(
        (o) => `${escapeIdentifier(o.field)} ${o.direction}`
      );
      sql += ' ORDER BY ' + orders.join(', ');
    }

    // LIMIT / OFFSET
    if (this.state.limitValue !== null) sql += ` LIMIT ${this.state.limitValue}`;
    if (this.state.offsetValue !== null) sql += ` OFFSET ${this.state.offsetValue}`;

    sql += ';';
    return sql;
  }

  // ---- Execution ---------------------------------------------------------

  async all(): Promise<T[]> {
    const sql = this.toSQL();
    const result = await this.executor(sql);
    let items = this.hydrator(result);

    // Eager load relations
    if (this.state.includeRelations.length > 0 && this.populateFn) {
      items = await this.populateFn(items, this.state.includeRelations);
    }

    return items;
  }

  async first(): Promise<T | null> {
    const qb = this.limit(1);
    const items = await qb.all();
    return items.length > 0 ? items[0] : null;
  }

  async count(): Promise<number> {
    let sql = `SELECT COUNT(*) AS "count" FROM ${escapeIdentifier(this.state.table)}`;

    const conditions = [...this.state.whereConditions];
    if (this.state.softDeleteEnabled) {
      conditions.unshift({ sql: `${escapeIdentifier('deleted_at')} IS NULL`, conjunction: 'AND' });
    }

    if (conditions.length > 0) {
      const parts: string[] = [];
      for (let i = 0; i < conditions.length; i++) {
        if (i === 0) parts.push(conditions[i].sql);
        else parts.push(`${conditions[i].conjunction} ${conditions[i].sql}`);
      }
      sql += ' WHERE ' + parts.join(' ');
    }
    sql += ';';

    const result = await this.executor(sql);
    const row = result.first();
    return row ? Number(row['count'] || row['COUNT(*)'] || 0) : 0;
  }

  async exists(): Promise<boolean> {
    const c = await this.count();
    return c > 0;
  }
}
