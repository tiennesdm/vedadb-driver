/**
 * VedaDB ORM Utilities
 */

import { FieldType, formatValue } from './types';

/**
 * Escape a string value for safe inclusion in SQL literals.
 */
export function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Escape an identifier (table name, column name) by wrapping in double-quotes.
 */
export function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Convert snake_case to camelCase.
 */
export function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Convert camelCase to snake_case.
 */
export function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

/**
 * Format a value for inclusion in a WHERE clause, respecting field type.
 */
export function formatWhereValue(value: any, fieldType: FieldType): string {
  if (value === null || value === undefined) return 'NULL';
  if (Array.isArray(value) && fieldType !== FieldType.VECTOR && fieldType !== FieldType.ARRAY) {
    return `(${value.map((v) => formatValue(v, fieldType)).join(', ')})`;
  }
  return formatValue(value, fieldType);
}

/**
 * Escape a generic value for SQL.
 */
export function escapeValue(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `'${escapeString(v)}'`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Buffer.isBuffer(v)) return `'${v.toString('base64')}'`;
  if (typeof v === 'object') return `'${escapeString(JSON.stringify(v))}'`;
  return String(v);
}

/**
 * Build a simple SET clause from a record.
 */
export function buildSetClause(data: Record<string, any>): string {
  return Object.entries(data)
    .map(([k, v]) => `${escapeIdentifier(k)} = ${escapeValue(v)}`)
    .join(', ');
}

/**
 * Deep clone a plain object.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
