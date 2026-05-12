/**
 * VedaDB ORM AggregationBuilder
 */

import { escapeIdentifier, escapeValue } from './utils';
import { SchemaDefinition } from './schema';
import { DriverResult } from './types';

// ---------------------------------------------------------------------------
// AggregationBuilder
// ---------------------------------------------------------------------------

interface AggregateExpression {
  sql: string;
  alias: string;
}

interface HavingCondition {
  sql: string;
}

export class AggregationBuilder<T = any> {
  private table: string;
  private schema: SchemaDefinition<T>;
  private executor: (sql: string) => Promise<DriverResult>;

  private groupByFields: string[] = [];
  private havingConditions: HavingCondition[] = [];
  private aggregates: AggregateExpression[] = [];
  private whereSQL: string | null = null;

  constructor(
    schema: SchemaDefinition<T>,
    executor: (sql: string) => Promise<DriverResult>,
    whereSQL?: string
  ) {
    this.table = schema.tableName;
    this.schema = schema;
    this.executor = executor;
    this.whereSQL = whereSQL || null;
  }

  /**
   * Group results by one or more fields.
   */
  groupBy(...fields: (keyof T & string)[]): AggregationBuilder<T> {
    this.groupByFields.push(...fields);
    return this;
  }

  /**
   * Add a HAVING condition.
   */
  having(field: string, op: string, value: any): AggregationBuilder<T> {
    this.havingConditions.push({
      sql: `${field} ${op} ${escapeValue(value)}`,
    });
    return this;
  }

  /**
   * COUNT aggregate.
   */
  count(field: string = '*', alias: string = 'count'): AggregationBuilder<T> {
    const col = field === '*' ? '*' : escapeIdentifier(field);
    this.aggregates.push({ sql: `COUNT(${col})`, alias });
    return this;
  }

  /**
   * SUM aggregate.
   */
  sum(field: keyof T & string, alias?: string): AggregationBuilder<T> {
    this.aggregates.push({
      sql: `SUM(${escapeIdentifier(field)})`,
      alias: alias || `sum_${field}`,
    });
    return this;
  }

  /**
   * AVG aggregate.
   */
  avg(field: keyof T & string, alias?: string): AggregationBuilder<T> {
    this.aggregates.push({
      sql: `AVG(${escapeIdentifier(field)})`,
      alias: alias || `avg_${field}`,
    });
    return this;
  }

  /**
   * MIN aggregate.
   */
  min(field: keyof T & string, alias?: string): AggregationBuilder<T> {
    this.aggregates.push({
      sql: `MIN(${escapeIdentifier(field)})`,
      alias: alias || `min_${field}`,
    });
    return this;
  }

  /**
   * MAX aggregate.
   */
  max(field: keyof T & string, alias?: string): AggregationBuilder<T> {
    this.aggregates.push({
      sql: `MAX(${escapeIdentifier(field)})`,
      alias: alias || `max_${field}`,
    });
    return this;
  }

  /**
   * Generate the SQL.
   */
  toSQL(): string {
    const selectParts: string[] = [];

    // Group by fields go in SELECT
    for (const f of this.groupByFields) {
      selectParts.push(escapeIdentifier(f));
    }

    // Aggregate expressions
    for (const agg of this.aggregates) {
      selectParts.push(`${agg.sql} AS ${escapeIdentifier(agg.alias)}`);
    }

    if (selectParts.length === 0) {
      selectParts.push('COUNT(*) AS "count"');
    }

    let sql = `SELECT ${selectParts.join(', ')} FROM ${escapeIdentifier(this.table)}`;

    if (this.whereSQL) {
      sql += ` WHERE ${this.whereSQL}`;
    }

    if (this.groupByFields.length > 0) {
      sql += ' GROUP BY ' + this.groupByFields.map(escapeIdentifier).join(', ');
    }

    if (this.havingConditions.length > 0) {
      sql += ' HAVING ' + this.havingConditions.map((h) => h.sql).join(' AND ');
    }

    sql += ';';
    return sql;
  }

  /**
   * Execute the aggregation query.
   */
  async exec(): Promise<Record<string, any>[]> {
    const sql = this.toSQL();
    const result = await this.executor(sql);
    return result.toObjects();
  }
}
