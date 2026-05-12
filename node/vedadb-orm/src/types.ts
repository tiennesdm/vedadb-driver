/**
 * VedaDB ORM Type System
 */

import { SchemaError } from './errors';

// ---------------------------------------------------------------------------
// Field type enum
// ---------------------------------------------------------------------------

export enum FieldType {
  INT = 'INT',
  FLOAT = 'FLOAT',
  STRING = 'STRING',
  BOOL = 'BOOL',
  TIMESTAMP = 'TIMESTAMP',
  DOCUMENT = 'DOCUMENT',
  VECTOR = 'VECTOR',
  POINT = 'POINT',
  UUID = 'UUID',
  DATE = 'DATE',
  DECIMAL = 'DECIMAL',
  ARRAY = 'ARRAY',
  JSON = 'JSON',
  BYTES = 'BYTES',
}

// ---------------------------------------------------------------------------
// Type mapping: FieldType -> TypeScript type
// ---------------------------------------------------------------------------

export interface VedaTypeMap {
  [FieldType.INT]: number;
  [FieldType.FLOAT]: number;
  [FieldType.STRING]: string;
  [FieldType.BOOL]: boolean;
  [FieldType.TIMESTAMP]: Date;
  [FieldType.DOCUMENT]: Record<string, any>;
  [FieldType.VECTOR]: number[];
  [FieldType.POINT]: { x: number; y: number };
  [FieldType.UUID]: string;
  [FieldType.DATE]: Date;
  [FieldType.DECIMAL]: string;
  [FieldType.ARRAY]: any[];
  [FieldType.JSON]: Record<string, any>;
  [FieldType.BYTES]: Buffer;
}

// ---------------------------------------------------------------------------
// Schema inference utility types
// ---------------------------------------------------------------------------

export type FieldDefinitionLike = {
  type: FieldType;
  nullable?: boolean;
  primaryKey?: boolean;
  default?: any;
};

/**
 * Infer the TypeScript type of a model from its schema field definitions.
 */
export type InferModelType<T extends Record<string, FieldDefinitionLike>> = {
  [K in keyof T]: T[K]['nullable'] extends true
    ? VedaTypeMap[T[K]['type']] | null
    : VedaTypeMap[T[K]['type']];
};

// ---------------------------------------------------------------------------
// Where clause operators
// ---------------------------------------------------------------------------

export type WhereOperator<V> = {
  eq?: V;
  neq?: V;
  gt?: V;
  gte?: V;
  lt?: V;
  lte?: V;
  in?: V[];
  notIn?: V[];
  like?: string;
  between?: [V, V];
  isNull?: boolean;
};

export type WhereClause<T> = {
  [K in keyof T]?: T[K] | WhereOperator<T[K]>;
};

export type OrderDirection = 'ASC' | 'DESC';

export interface OrderClause<T> {
  field: keyof T & string;
  direction: OrderDirection;
}

// ---------------------------------------------------------------------------
// Result type from driver (re-declared to avoid hard dependency at compile time)
// ---------------------------------------------------------------------------

export interface DriverResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  message: string;
  toObjects(): Record<string, any>[];
  first(): Record<string, any> | null;
  pluck(column: string): any[];
}

export interface DriverClient {
  query(sql: string): Promise<DriverResult>;
  exec(sql: string): Promise<string>;
  begin?(): Promise<string>;
  commit?(): Promise<string>;
  rollback?(): Promise<string>;
  transaction?<T>(fn: (client: DriverClient) => Promise<T>): Promise<T>;
  close(): void;
  connect(): Promise<any>;
  connected?: boolean;
  cache?: {
    set(key: string, value: any, ttl?: number): Promise<any>;
    get(key: string): Promise<any>;
    del(key: string): Promise<any>;
  };
}

export interface DriverPool {
  query(sql: string): Promise<DriverResult>;
  exec(sql: string): Promise<string>;
  acquire(): Promise<DriverClient>;
  release(client: DriverClient): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// Value casting & formatting
// ---------------------------------------------------------------------------

export function castValue(value: string | null | undefined, fieldType: FieldType): any {
  if (value === null || value === undefined) return null;

  switch (fieldType) {
    case FieldType.INT:
      return parseInt(value, 10);
    case FieldType.FLOAT:
    case FieldType.DECIMAL:
      return parseFloat(value);
    case FieldType.BOOL:
      return value === 'true' || value === '1' || value === 'TRUE';
    case FieldType.TIMESTAMP:
    case FieldType.DATE:
      return new Date(value);
    case FieldType.DOCUMENT:
    case FieldType.JSON:
      return typeof value === 'string' ? JSON.parse(value) : value;
    case FieldType.VECTOR:
    case FieldType.ARRAY:
      return typeof value === 'string' ? JSON.parse(value) : value;
    case FieldType.POINT:
      if (typeof value === 'string') {
        const parts = value.replace(/[()]/g, '').split(',').map(Number);
        return { x: parts[0], y: parts[1] };
      }
      return value;
    case FieldType.BYTES:
      return Buffer.from(value, 'base64');
    case FieldType.STRING:
    case FieldType.UUID:
    default:
      return value;
  }
}

export function formatValue(value: any, fieldType: FieldType): string {
  if (value === null || value === undefined) return 'NULL';

  switch (fieldType) {
    case FieldType.INT:
    case FieldType.FLOAT:
    case FieldType.DECIMAL:
      return String(value);
    case FieldType.BOOL:
      return value ? 'TRUE' : 'FALSE';
    case FieldType.TIMESTAMP:
    case FieldType.DATE:
      if (value instanceof Date) {
        return `'${value.toISOString()}'`;
      }
      return `'${String(value)}'`;
    case FieldType.DOCUMENT:
    case FieldType.JSON:
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    case FieldType.VECTOR:
    case FieldType.ARRAY:
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    case FieldType.POINT:
      if (typeof value === 'object' && 'x' in value) {
        return `POINT(${value.x}, ${value.y})`;
      }
      return `'${String(value)}'`;
    case FieldType.BYTES:
      if (Buffer.isBuffer(value)) {
        return `'${value.toString('base64')}'`;
      }
      return `'${String(value)}'`;
    case FieldType.STRING:
    case FieldType.UUID:
    default:
      return `'${String(value).replace(/'/g, "''")}'`;
  }
}

/**
 * Map FieldType to VedaDB DDL type name.
 */
export function fieldTypeToDDL(ft: FieldType, opts?: { vectorDimensions?: number }): string {
  switch (ft) {
    case FieldType.INT: return 'INT';
    case FieldType.FLOAT: return 'FLOAT';
    case FieldType.STRING: return 'TEXT';
    case FieldType.BOOL: return 'BOOLEAN';
    case FieldType.TIMESTAMP: return 'TIMESTAMP';
    case FieldType.DOCUMENT: return 'DOCUMENT';
    case FieldType.VECTOR:
      return opts?.vectorDimensions ? `VECTOR(${opts.vectorDimensions})` : 'VECTOR';
    case FieldType.POINT: return 'POINT';
    case FieldType.UUID: return 'UUID';
    case FieldType.DATE: return 'DATE';
    case FieldType.DECIMAL: return 'DECIMAL';
    case FieldType.ARRAY: return 'ARRAY';
    case FieldType.JSON: return 'JSON';
    case FieldType.BYTES: return 'BYTES';
    default:
      throw new SchemaError(`Unknown field type: ${ft}`);
  }
}
