/**
 * VedaDB ORM VectorProxy
 *
 * Provides vector similarity search via VedaDB VECTOR commands.
 */

import { DriverResult } from './types';
import { SchemaDefinition } from './schema';
import { escapeIdentifier } from './utils';

export interface VectorSearchOptions {
  field?: string;
  topK?: number;
  threshold?: number;
  filter?: Record<string, any>;
}

export class VectorProxy<T = any> {
  private schema: SchemaDefinition<T>;
  private executor: (sql: string) => Promise<DriverResult>;
  private hydrator: (result: DriverResult) => T[];

  constructor(
    schema: SchemaDefinition<T>,
    executor: (sql: string) => Promise<DriverResult>,
    hydrator: (result: DriverResult) => T[]
  ) {
    this.schema = schema;
    this.executor = executor;
    this.hydrator = hydrator;
  }

  /**
   * Find nearest neighbors for a given vector.
   */
  async search(vector: number[], options: VectorSearchOptions = {}): Promise<(T & { _distance?: number })[]> {
    const table = escapeIdentifier(this.schema.tableName);
    const vectorStr = `[${vector.join(', ')}]`;
    const topK = options.topK || 10;

    // Determine vector field
    let field = options.field;
    if (!field) {
      for (const [name, def] of Object.entries(this.schema.fields)) {
        if (def.type.toString() === 'VECTOR') {
          field = name;
          break;
        }
      }
    }
    if (!field) field = 'embedding';

    let sql = `SELECT *, VECTOR_DISTANCE(${escapeIdentifier(field)}, '${vectorStr}') AS _distance FROM ${table}`;

    // Optional filter
    if (options.filter && Object.keys(options.filter).length > 0) {
      const conditions = Object.entries(options.filter)
        .map(([k, v]) => {
          if (v === null) return `${escapeIdentifier(k)} IS NULL`;
          if (typeof v === 'string') return `${escapeIdentifier(k)} = '${v.replace(/'/g, "''")}'`;
          return `${escapeIdentifier(k)} = ${v}`;
        })
        .join(' AND ');
      sql += ` WHERE ${conditions}`;
    }

    if (options.threshold !== undefined) {
      const whereOrAnd = sql.includes('WHERE') ? 'AND' : 'WHERE';
      sql += ` ${whereOrAnd} VECTOR_DISTANCE(${escapeIdentifier(field)}, '${vectorStr}') <= ${options.threshold}`;
    }

    sql += ` ORDER BY _distance ASC LIMIT ${topK};`;

    const result = await this.executor(sql);
    return this.hydrator(result) as (T & { _distance?: number })[];
  }

  /**
   * Upsert a vector for a given record id.
   */
  async upsert(id: any, vector: number[], field?: string): Promise<void> {
    const table = escapeIdentifier(this.schema.tableName);
    const pk = escapeIdentifier(this.schema.primaryKeyField);
    const vecField = escapeIdentifier(field || 'embedding');
    const vectorStr = `[${vector.join(', ')}]`;

    await this.executor(
      `UPDATE ${table} SET ${vecField} = '${vectorStr}' WHERE ${pk} = '${String(id).replace(/'/g, "''")}';`
    );
  }
}
