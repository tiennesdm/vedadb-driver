/**
 * VedaDB ORM Error Hierarchy
 */

export class VedaORMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VedaORMError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConnectionError extends VedaORMError {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export class ValidationError extends VedaORMError {
  public readonly field: string;
  public readonly value: unknown;

  constructor(field: string, message: string, value?: unknown) {
    super(`Validation failed for '${field}': ${message}`);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

export class SchemaError extends VedaORMError {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

export class QueryError extends VedaORMError {
  public readonly sql?: string;

  constructor(message: string, sql?: string) {
    super(message);
    this.name = 'QueryError';
    this.sql = sql;
  }
}

export class HookError extends VedaORMError {
  public readonly hookType: string;

  constructor(hookType: string, message: string) {
    super(`Hook '${hookType}' failed: ${message}`);
    this.name = 'HookError';
    this.hookType = hookType;
  }
}

export class RelationshipError extends VedaORMError {
  constructor(message: string) {
    super(message);
    this.name = 'RelationshipError';
  }
}

export class MigrationError extends VedaORMError {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export class SessionError extends VedaORMError {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}
