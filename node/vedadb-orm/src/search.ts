/**
 * VedaDB ORM SearchProxy
 *
 * Provides full-text search capabilities via VedaDB SEARCH commands.
 */

import { DriverResult } from './types';
import { SchemaDefinition } from './schema';
import { escapeIdentifier, escapeValue } from './utils';

export interface SearchOptions {
  fields?: string[];
  limit?: number;
  offset?: number;
  highlight?: boolean;
  fuzzy?: boolean;
}

export class SearchProxy<T = any> {
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
   * Full-text search across searchable fields.
   */
  async query(text: string, options: SearchOptions = {}): Promise<T[]> {
    const table = escapeIdentifier(this.schema.tableName);
    const safeText = text.replace(/'/g, "''");

    let sql: string;
    if (options.fields && options.fields.length > 0) {
      const fields = options.fields.map(escapeIdentifier).join(', ');
      sql = `SEARCH ${table} FIELDS (${fields}) FOR '${safeText}'`;
    } else {
      sql = `SEARCH ${table} FOR '${safeText}'`;
    }

    if (options.fuzzy) sql += ' FUZZY';
    if (options.highlight) sql += ' HIGHLIGHT';
    if (options.limit !== undefined) sql += ` LIMIT ${options.limit}`;
    if (options.offset !== undefined) sql += ` OFFSET ${options.offset}`;
    sql += ';';

    const result = await this.executor(sql);
    return this.hydrator(result);
  }

  /**
   * Suggest / autocomplete.
   */
  async suggest(prefix: string, field?: string, limit: number = 10): Promise<string[]> {
    const table = escapeIdentifier(this.schema.tableName);
    const safePrefix = prefix.replace(/'/g, "''");
    let sql = `SEARCH SUGGEST ${table} '${safePrefix}'`;
    if (field) sql += ` FIELD ${escapeIdentifier(field)}`;
    sql += ` LIMIT ${limit};`;

    const result = await this.executor(sql);
    return result.toObjects().map((row) => {
      return row['suggestion'] || row[Object.keys(row)[0]] || '';
    });
  }
}
