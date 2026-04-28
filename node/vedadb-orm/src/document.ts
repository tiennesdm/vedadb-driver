/**
 * VedaDB ORM DocumentProxy
 *
 * Provides document-mode access for models with DOCUMENT fields.
 */

import { DriverResult } from './types';
import { SchemaDefinition } from './schema';
import { escapeIdentifier, escapeValue } from './utils';

export class DocumentProxy<T = any> {
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
   * Insert a document into the collection.
   */
  async insert(doc: Record<string, any>): Promise<void> {
    const table = escapeIdentifier(this.schema.tableName);
    const json = JSON.stringify(doc).replace(/'/g, "''");
    await this.executor(`INSERT INTO ${table} DOCUMENT '${json}';`);
  }

  /**
   * Insert multiple documents.
   */
  async insertMany(docs: Record<string, any>[]): Promise<void> {
    const table = escapeIdentifier(this.schema.tableName);
    const values = docs.map((d) => `'${JSON.stringify(d).replace(/'/g, "''")}'`).join(', ');
    await this.executor(`INSERT INTO ${table} DOCUMENTS ${values};`);
  }

  /**
   * Find documents matching a query object (JSON path filtering).
   */
  async find(query: Record<string, any>, limit?: number): Promise<T[]> {
    const table = escapeIdentifier(this.schema.tableName);
    const json = JSON.stringify(query).replace(/'/g, "''");
    let sql = `SELECT * FROM ${table} WHERE DOCUMENT MATCHES '${json}'`;
    if (limit) sql += ` LIMIT ${limit}`;
    sql += ';';

    const result = await this.executor(sql);
    return this.hydrator(result);
  }

  /**
   * Find a single document matching a query.
   */
  async findOne(query: Record<string, any>): Promise<T | null> {
    const results = await this.find(query, 1);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Update documents matching a query.
   */
  async update(query: Record<string, any>, update: Record<string, any>): Promise<void> {
    const table = escapeIdentifier(this.schema.tableName);
    const queryJson = JSON.stringify(query).replace(/'/g, "''");
    const updateJson = JSON.stringify(update).replace(/'/g, "''");
    await this.executor(`UPDATE ${table} SET DOCUMENT = MERGE(DOCUMENT, '${updateJson}') WHERE DOCUMENT MATCHES '${queryJson}';`);
  }

  /**
   * Delete documents matching a query.
   */
  async delete(query: Record<string, any>): Promise<void> {
    const table = escapeIdentifier(this.schema.tableName);
    const json = JSON.stringify(query).replace(/'/g, "''");
    await this.executor(`DELETE FROM ${table} WHERE DOCUMENT MATCHES '${json}';`);
  }

  /**
   * Get a value at a JSON path within a document.
   */
  async getPath(id: any, path: string): Promise<any> {
    const table = escapeIdentifier(this.schema.tableName);
    const pk = escapeIdentifier(this.schema.primaryKeyField);
    const sql = `SELECT JSON_EXTRACT(DOCUMENT, '${path.replace(/'/g, "''")}') AS value FROM ${table} WHERE ${pk} = ${escapeValue(id)};`;
    const result = await this.executor(sql);
    const row = result.first();
    return row ? row['value'] : null;
  }
}
