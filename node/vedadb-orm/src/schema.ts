/**
 * VedaDB ORM Schema System
 */

import { FieldType, fieldTypeToDDL } from './types';
import { Validator } from './validators';
import { SchemaError } from './errors';
import { escapeIdentifier } from './utils';

// ---------------------------------------------------------------------------
// Field definition
// ---------------------------------------------------------------------------

export interface FieldDefinition {
  type: FieldType;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  unique?: boolean;
  nullable?: boolean;
  default?: any;
  references?: { model: string; field: string };
  validators?: Validator[];
  searchable?: boolean;
  vectorDimensions?: number;
  index?: boolean;
}

// ---------------------------------------------------------------------------
// Schema options
// ---------------------------------------------------------------------------

export interface IndexDefinition {
  fields: string[];
  unique?: boolean;
  name?: string;
}

export interface SchemaOptions {
  cache?: { enabled: boolean; ttl?: number };
  search?: { enabled: boolean; fields?: string[] };
  vector?: { enabled: boolean; field?: string; dimensions?: number };
  timestamps?: boolean;
  softDelete?: boolean;
  engine?: string;
  indexes?: IndexDefinition[];
}

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

export interface SchemaDefinition<T = any> {
  name: string;
  tableName: string;
  fields: Record<string, FieldDefinition>;
  options: SchemaOptions;
  primaryKeyField: string;
}

// ---------------------------------------------------------------------------
// defineSchema helper
// ---------------------------------------------------------------------------

export function defineSchema<T = any>(
  name: string,
  fields: Record<string, FieldDefinition>,
  options: SchemaOptions = {}
): SchemaDefinition<T> {
  // Find primary key
  let primaryKeyField: string | null = null;
  for (const [fieldName, def] of Object.entries(fields)) {
    if (def.primaryKey) {
      if (primaryKeyField) {
        throw new SchemaError(`Schema '${name}' has multiple primary keys: '${primaryKeyField}' and '${fieldName}'`);
      }
      primaryKeyField = fieldName;
    }
  }

  if (!primaryKeyField) {
    throw new SchemaError(`Schema '${name}' must have a primary key field`);
  }

  // Inject timestamp fields if enabled
  if (options.timestamps) {
    if (!fields['created_at']) {
      fields['created_at'] = { type: FieldType.TIMESTAMP, nullable: true };
    }
    if (!fields['updated_at']) {
      fields['updated_at'] = { type: FieldType.TIMESTAMP, nullable: true };
    }
  }

  // Inject soft-delete field if enabled
  if (options.softDelete) {
    if (!fields['deleted_at']) {
      fields['deleted_at'] = { type: FieldType.TIMESTAMP, nullable: true };
    }
  }

  // Table name defaults to schema name in snake_case plural
  const tableName = name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') + 's';

  return {
    name,
    tableName,
    fields,
    options,
    primaryKeyField,
  };
}

// ---------------------------------------------------------------------------
// DDL generation
// ---------------------------------------------------------------------------

export function toCreateSQL(schema: SchemaDefinition): string {
  const lines: string[] = [];

  for (const [fieldName, def] of Object.entries(schema.fields)) {
    let col = `  ${escapeIdentifier(fieldName)} ${fieldTypeToDDL(def.type, { vectorDimensions: def.vectorDimensions })}`;

    if (def.primaryKey) col += ' PRIMARY KEY';
    if (def.autoIncrement) col += ' AUTOINCREMENT';
    if (def.unique && !def.primaryKey) col += ' UNIQUE';
    if (!def.nullable && !def.primaryKey) col += ' NOT NULL';
    if (def.default !== undefined) {
      if (typeof def.default === 'string') {
        col += ` DEFAULT '${def.default}'`;
      } else if (typeof def.default === 'boolean') {
        col += ` DEFAULT ${def.default ? 'TRUE' : 'FALSE'}`;
      } else if (def.default === null) {
        col += ' DEFAULT NULL';
      } else {
        col += ` DEFAULT ${def.default}`;
      }
    }

    lines.push(col);
  }

  // Foreign key constraints
  for (const [fieldName, def] of Object.entries(schema.fields)) {
    if (def.references) {
      const refTable = def.references.model.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') + 's';
      lines.push(`  FOREIGN KEY (${escapeIdentifier(fieldName)}) REFERENCES ${escapeIdentifier(refTable)}(${escapeIdentifier(def.references.field)})`);
    }
  }

  let sql = `CREATE TABLE IF NOT EXISTS ${escapeIdentifier(schema.tableName)} (\n`;
  sql += lines.join(',\n');
  sql += '\n)';

  if (schema.options.engine) {
    sql += ` ENGINE=${schema.options.engine}`;
  }

  sql += ';';

  // Index statements
  const indexStatements: string[] = [];
  if (schema.options.indexes) {
    for (const idx of schema.options.indexes) {
      const idxName = idx.name || `idx_${schema.tableName}_${idx.fields.join('_')}`;
      const unique = idx.unique ? 'UNIQUE ' : '';
      const cols = idx.fields.map(escapeIdentifier).join(', ');
      indexStatements.push(
        `CREATE ${unique}INDEX IF NOT EXISTS ${escapeIdentifier(idxName)} ON ${escapeIdentifier(schema.tableName)} (${cols});`
      );
    }
  }

  // Searchable field indexes
  for (const [fieldName, def] of Object.entries(schema.fields)) {
    if (def.searchable) {
      indexStatements.push(
        `CREATE SEARCH INDEX IF NOT EXISTS ${escapeIdentifier(`si_${schema.tableName}_${fieldName}`)} ON ${escapeIdentifier(schema.tableName)} (${escapeIdentifier(fieldName)});`
      );
    }
  }

  if (indexStatements.length > 0) {
    sql += '\n' + indexStatements.join('\n');
  }

  return sql;
}
