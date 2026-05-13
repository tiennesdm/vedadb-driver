/**
 * TypeScript type definitions for VedaDB ORM.
 */

import { VedaClient, Result } from '../client';

export interface SchemaField {
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  unique?: boolean;
  default?: any;
  validate?: (value: any) => boolean;
}

export interface Schema {
  [fieldName: string]: SchemaField;
}

export interface ModelSchema {
  tableName: string;
  schema: Schema;
  relationships?: Record<string, RelationshipDef>;
}

export interface RelationshipDef {
  type: 'hasMany' | 'belongsTo' | 'manyToMany';
  related: string;
  foreignKey?: string;
  junctionTable?: string;
  localKey?: string;
}

export interface FindOptions {
  where?: Record<string, any>;
  orderBy?: string;
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export class Model {
  static tableName: string;
  static schema: Schema;
  static relationships?: Record<string, RelationshipDef>;
  static primaryKey: string;

  static setClient(client: VedaClient): void;
  static create(data: Record<string, any>): Promise<Model>;
  static findById(id: any): Promise<Model | null>;
  static findOne(where: Record<string, any>): Promise<Model | null>;
  static findAll(options?: FindOptions): Promise<Model[]>;
  static count(where?: Record<string, any>): Promise<number>;
  static updateAll(set: Record<string, any>, where: Record<string, any>): Promise<string>;
  static destroyAll(where: Record<string, any>): Promise<string>;

  constructor(data?: Record<string, any>);
  save(): Promise<this>;
  update(attrs: Record<string, any>): Promise<this>;
  destroy(): Promise<void>;
  reload(): Promise<this>;
  toJSON(): Record<string, any>;
  get(key: string): any;
  set(key: string, value: any): void;
  readonly changed: Record<string, any>;
  readonly isNew: boolean;
  readonly errors: Record<string, string>;
}

export class ValidationError extends Error {
  field: string | null;
  constructor(message: string, field?: string);
}

export class QueryBuilder {
  constructor(client: VedaClient, table: string);
  select(columns: string | string[]): this;
  where(conditions: Record<string, any>): this;
  join(table: string, on: string, alias?: string): this;
  leftJoin(table: string, on: string, alias?: string): this;
  order(column: string, desc?: boolean): this;
  limit(n: number): this;
  offset(n: number): this;
  execute(): Promise<Result>;
  build(): string;
  readonly values: any[];
}

export function hasMany(relatedModel: string, foreignKey: string): RelationshipDef;
export function belongsTo(relatedModel: string, foreignKey: string): RelationshipDef;
export function manyToMany(
  relatedModel: string,
  junctionTable: string,
  localKey: string,
  foreignKey: string
): RelationshipDef;

export class MigrationRunner {
  constructor(client: VedaClient, migrationsDir: string);
  up(): Promise<number>;
  down(count?: number): Promise<number>;
  status(): Promise<Array<{ version: string; name: string; applied: boolean }>>;
  createMigration(name: string): string;
}
