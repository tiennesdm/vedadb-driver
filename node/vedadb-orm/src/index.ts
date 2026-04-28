/**
 * VedaDB ORM - Public API
 *
 * TypeScript ORM for VedaDB with schemas, models, query builder,
 * hooks, relationships, migrations, and multi-model proxy APIs.
 */

// ---- Core ORM class -------------------------------------------------------
export { VedaORM, VedaORMOptions } from './connection';

// ---- Errors ---------------------------------------------------------------
export {
  VedaORMError,
  ConnectionError,
  ValidationError,
  SchemaError,
  QueryError,
  HookError,
  RelationshipError,
  MigrationError,
  SessionError,
} from './errors';

// ---- Type system ----------------------------------------------------------
export {
  FieldType,
  VedaTypeMap,
  InferModelType,
  WhereClause,
  WhereOperator,
  OrderDirection,
  OrderClause,
  DriverResult,
  DriverClient,
  DriverPool,
  castValue,
  formatValue,
  fieldTypeToDDL,
  FieldDefinitionLike,
} from './types';

// ---- Schema ---------------------------------------------------------------
export {
  FieldDefinition,
  SchemaOptions,
  SchemaDefinition,
  IndexDefinition,
  defineSchema,
  toCreateSQL,
} from './schema';

// ---- Model ----------------------------------------------------------------
export { Model } from './model';

// ---- QueryBuilder ---------------------------------------------------------
export { QueryBuilder } from './query-builder';

// ---- AggregationBuilder ---------------------------------------------------
export { AggregationBuilder } from './aggregation';

// ---- Hooks ----------------------------------------------------------------
export {
  HookType,
  HookContext,
  HookFn,
  HookRegistry,
  TimestampHook,
  SoftDeleteHook,
  ValidationHook,
} from './hooks';

// ---- Relationships --------------------------------------------------------
export {
  RelationType,
  RelationshipDefinition,
  hasOne,
  hasMany,
  belongsTo,
  belongsToMany,
  LazyRelation,
} from './relationships';

// ---- Validators -----------------------------------------------------------
export {
  Validator,
  required,
  minLength,
  maxLength,
  minValue,
  maxValue,
  regex,
  isEmail,
  oneOf,
  custom,
} from './validators';

// ---- Session / Transaction ------------------------------------------------
export { Session } from './session';

// ---- Proxies --------------------------------------------------------------
export { CacheProxy } from './cache';
export { SearchProxy, SearchOptions } from './search';
export { VectorProxy, VectorSearchOptions } from './vector';
export { GraphProxy, GraphTraversalOptions } from './graph';
export { DocumentProxy } from './document';

// ---- Population -----------------------------------------------------------
export { PopulationContext, eagerLoad, createLazyLoader } from './population';

// ---- Migration ------------------------------------------------------------
export {
  MigrationRunner,
  MigrationDefinition,
  MigrationAction,
  MigrationRecord,
  defineMigration,
} from './migration';

// ---- Utilities ------------------------------------------------------------
export {
  escapeString,
  escapeIdentifier,
  snakeToCamel,
  camelToSnake,
  formatWhereValue,
  escapeValue,
  buildSetClause,
  deepClone,
} from './utils';

// ---- Factory helper -------------------------------------------------------

import { VedaORM, VedaORMOptions } from './connection';

/**
 * Create and connect a VedaORM instance in one call.
 *
 * @example
 * ```ts
 * const orm = await createORM({ connection: { host: 'localhost', port: 6380 } });
 * const User = orm.register(userSchema);
 * const users = await User.findMany();
 * ```
 */
export async function createORM(options: VedaORMOptions): Promise<VedaORM> {
  const orm = new VedaORM(options);
  await orm.connect();
  return orm;
}
