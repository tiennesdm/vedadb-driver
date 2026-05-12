/**
 * VedaDB ORM Relationships
 */

import { RelationshipError } from './errors';

// ---------------------------------------------------------------------------
// Relationship types
// ---------------------------------------------------------------------------

export enum RelationType {
  HAS_ONE = 'hasOne',
  HAS_MANY = 'hasMany',
  BELONGS_TO = 'belongsTo',
  BELONGS_TO_MANY = 'belongsToMany',
}

export interface RelationshipDefinition {
  type: RelationType;
  model: string;
  foreignKey: string;
  localKey: string;
  pivotTable?: string;
  foreignPivotKey?: string;
  relatedPivotKey?: string;
}

// ---------------------------------------------------------------------------
// Relationship definition helpers
// ---------------------------------------------------------------------------

export function hasOne(model: string, foreignKey: string, localKey: string = 'id'): RelationshipDefinition {
  return {
    type: RelationType.HAS_ONE,
    model,
    foreignKey,
    localKey,
  };
}

export function hasMany(model: string, foreignKey: string, localKey: string = 'id'): RelationshipDefinition {
  return {
    type: RelationType.HAS_MANY,
    model,
    foreignKey,
    localKey,
  };
}

export function belongsTo(model: string, foreignKey: string, ownerKey: string = 'id'): RelationshipDefinition {
  return {
    type: RelationType.BELONGS_TO,
    model,
    foreignKey,
    localKey: ownerKey,
  };
}

export function belongsToMany(
  model: string,
  pivotTable: string,
  foreignPivotKey: string,
  relatedPivotKey: string
): RelationshipDefinition {
  return {
    type: RelationType.BELONGS_TO_MANY,
    model,
    foreignKey: foreignPivotKey,
    localKey: 'id',
    pivotTable,
    foreignPivotKey,
    relatedPivotKey,
  };
}

// ---------------------------------------------------------------------------
// LazyRelation — a wrapper that defers loading until accessed
// ---------------------------------------------------------------------------

export class LazyRelation<T> {
  private _loaded: boolean = false;
  private _value: T | T[] | null = null;
  private _loader: () => Promise<T | T[] | null>;

  constructor(loader: () => Promise<T | T[] | null>) {
    this._loader = loader;
  }

  /**
   * Whether the relation has been loaded.
   */
  get loaded(): boolean {
    return this._loaded;
  }

  /**
   * Get the loaded value. Throws if not yet loaded.
   */
  get value(): T | T[] | null {
    if (!this._loaded) {
      throw new RelationshipError('Relation has not been loaded. Call load() first or use include() on the query.');
    }
    return this._value;
  }

  /**
   * Load the relation from the database.
   */
  async load(): Promise<T | T[] | null> {
    if (!this._loaded) {
      this._value = await this._loader();
      this._loaded = true;
    }
    return this._value;
  }

  /**
   * Force reload the relation.
   */
  async reload(): Promise<T | T[] | null> {
    this._loaded = false;
    return this.load();
  }

  /**
   * Set the value directly (used by eager loading).
   */
  set(value: T | T[] | null): void {
    this._value = value;
    this._loaded = true;
  }
}
