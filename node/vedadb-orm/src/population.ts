/**
 * VedaDB ORM Population (Eager / Lazy loading)
 */

import { DriverResult } from './types';
import { SchemaDefinition } from './schema';
import { RelationshipDefinition, RelationType, LazyRelation } from './relationships';
import { escapeIdentifier, escapeValue } from './utils';

// ---------------------------------------------------------------------------
// Eager loader
// ---------------------------------------------------------------------------

export interface PopulationContext {
  executor: (sql: string) => Promise<DriverResult>;
  getSchema: (modelName: string) => SchemaDefinition | undefined;
  getRelationships: (modelName: string) => Record<string, RelationshipDefinition>;
  hydrateRows: (schemaName: string, result: DriverResult) => any[];
}

/**
 * Eagerly load relationships for a set of already-fetched model instances.
 */
export async function eagerLoad<T>(
  items: T[],
  relations: string[],
  schema: SchemaDefinition<T>,
  ctx: PopulationContext
): Promise<T[]> {
  if (items.length === 0 || relations.length === 0) return items;

  const allRelationships = ctx.getRelationships(schema.name);

  for (const relationName of relations) {
    const relDef = allRelationships[relationName];
    if (!relDef) continue;

    const relatedSchema = ctx.getSchema(relDef.model);
    if (!relatedSchema) continue;

    switch (relDef.type) {
      case RelationType.HAS_ONE:
        await loadHasOne(items, relationName, relDef, schema, relatedSchema, ctx);
        break;
      case RelationType.HAS_MANY:
        await loadHasMany(items, relationName, relDef, schema, relatedSchema, ctx);
        break;
      case RelationType.BELONGS_TO:
        await loadBelongsTo(items, relationName, relDef, schema, relatedSchema, ctx);
        break;
      case RelationType.BELONGS_TO_MANY:
        await loadBelongsToMany(items, relationName, relDef, schema, relatedSchema, ctx);
        break;
    }
  }

  return items;
}

async function loadHasOne<T>(
  items: T[],
  relationName: string,
  relDef: RelationshipDefinition,
  parentSchema: SchemaDefinition,
  relatedSchema: SchemaDefinition,
  ctx: PopulationContext
): Promise<void> {
  const localKeys = items.map((item: any) => item[relDef.localKey]).filter(Boolean);
  if (localKeys.length === 0) return;

  const inVals = localKeys.map(escapeValue).join(', ');
  const sql = `SELECT * FROM ${escapeIdentifier(relatedSchema.tableName)} WHERE ${escapeIdentifier(relDef.foreignKey)} IN (${inVals});`;
  const result = await ctx.executor(sql);
  const related = ctx.hydrateRows(relDef.model, result);

  const relMap = new Map<any, any>();
  for (const r of related) {
    relMap.set((r as any)[relDef.foreignKey], r);
  }

  for (const item of items) {
    (item as any)[relationName] = relMap.get((item as any)[relDef.localKey]) || null;
  }
}

async function loadHasMany<T>(
  items: T[],
  relationName: string,
  relDef: RelationshipDefinition,
  parentSchema: SchemaDefinition,
  relatedSchema: SchemaDefinition,
  ctx: PopulationContext
): Promise<void> {
  const localKeys = items.map((item: any) => item[relDef.localKey]).filter(Boolean);
  if (localKeys.length === 0) return;

  const inVals = localKeys.map(escapeValue).join(', ');
  const sql = `SELECT * FROM ${escapeIdentifier(relatedSchema.tableName)} WHERE ${escapeIdentifier(relDef.foreignKey)} IN (${inVals});`;
  const result = await ctx.executor(sql);
  const related = ctx.hydrateRows(relDef.model, result);

  const relMap = new Map<any, any[]>();
  for (const r of related) {
    const key = (r as any)[relDef.foreignKey];
    if (!relMap.has(key)) relMap.set(key, []);
    relMap.get(key)!.push(r);
  }

  for (const item of items) {
    (item as any)[relationName] = relMap.get((item as any)[relDef.localKey]) || [];
  }
}

async function loadBelongsTo<T>(
  items: T[],
  relationName: string,
  relDef: RelationshipDefinition,
  parentSchema: SchemaDefinition,
  relatedSchema: SchemaDefinition,
  ctx: PopulationContext
): Promise<void> {
  const foreignKeys = items.map((item: any) => item[relDef.foreignKey]).filter(Boolean);
  if (foreignKeys.length === 0) return;

  const inVals = [...new Set(foreignKeys)].map(escapeValue).join(', ');
  const sql = `SELECT * FROM ${escapeIdentifier(relatedSchema.tableName)} WHERE ${escapeIdentifier(relDef.localKey)} IN (${inVals});`;
  const result = await ctx.executor(sql);
  const related = ctx.hydrateRows(relDef.model, result);

  const relMap = new Map<any, any>();
  for (const r of related) {
    relMap.set((r as any)[relDef.localKey], r);
  }

  for (const item of items) {
    (item as any)[relationName] = relMap.get((item as any)[relDef.foreignKey]) || null;
  }
}

async function loadBelongsToMany<T>(
  items: T[],
  relationName: string,
  relDef: RelationshipDefinition,
  parentSchema: SchemaDefinition,
  relatedSchema: SchemaDefinition,
  ctx: PopulationContext
): Promise<void> {
  if (!relDef.pivotTable || !relDef.foreignPivotKey || !relDef.relatedPivotKey) return;

  const localKeys = items.map((item: any) => item[relDef.localKey]).filter(Boolean);
  if (localKeys.length === 0) return;

  const inVals = localKeys.map(escapeValue).join(', ');

  // Get pivot rows
  const pivotSQL = `SELECT * FROM ${escapeIdentifier(relDef.pivotTable)} WHERE ${escapeIdentifier(relDef.foreignPivotKey)} IN (${inVals});`;
  const pivotResult = await ctx.executor(pivotSQL);
  const pivotRows = pivotResult.toObjects();

  // Get related IDs
  const relatedIds = [...new Set(pivotRows.map((p) => p[relDef.relatedPivotKey!]))].filter(Boolean);
  if (relatedIds.length === 0) {
    for (const item of items) (item as any)[relationName] = [];
    return;
  }

  const relInVals = relatedIds.map(escapeValue).join(', ');
  const relSQL = `SELECT * FROM ${escapeIdentifier(relatedSchema.tableName)} WHERE ${escapeIdentifier(relatedSchema.primaryKeyField)} IN (${relInVals});`;
  const relResult = await ctx.executor(relSQL);
  const related = ctx.hydrateRows(relDef.model, relResult);

  // Build lookup
  const relLookup = new Map<any, any>();
  for (const r of related) {
    relLookup.set((r as any)[relatedSchema.primaryKeyField], r);
  }

  // Build mapping: localKey -> related items
  const mapping = new Map<any, any[]>();
  for (const pivot of pivotRows) {
    const parentKey = pivot[relDef.foreignPivotKey!];
    const relItem = relLookup.get(pivot[relDef.relatedPivotKey!]);
    if (!relItem) continue;
    if (!mapping.has(parentKey)) mapping.set(parentKey, []);
    mapping.get(parentKey)!.push(relItem);
  }

  for (const item of items) {
    (item as any)[relationName] = mapping.get((item as any)[relDef.localKey]) || [];
  }
}

/**
 * Create a LazyRelation loader for a single instance.
 */
export function createLazyLoader<T>(
  instance: any,
  relationName: string,
  relDef: RelationshipDefinition,
  schema: SchemaDefinition,
  ctx: PopulationContext
): LazyRelation<T> {
  return new LazyRelation<T>(async () => {
    const items = [instance];
    await eagerLoad(items, [relationName], schema, ctx);
    return (instance as any)[relationName];
  });
}
