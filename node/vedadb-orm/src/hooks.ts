/**
 * VedaDB ORM Hook System
 */

import { HookError } from './errors';

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export enum HookType {
  BEFORE_CREATE = 'beforeCreate',
  AFTER_CREATE = 'afterCreate',
  BEFORE_UPDATE = 'beforeUpdate',
  AFTER_UPDATE = 'afterUpdate',
  BEFORE_DELETE = 'beforeDelete',
  AFTER_DELETE = 'afterDelete',
  BEFORE_FIND = 'beforeFind',
  AFTER_FIND = 'afterFind',
  BEFORE_VALIDATE = 'beforeValidate',
  AFTER_VALIDATE = 'afterValidate',
}

// ---------------------------------------------------------------------------
// Hook context
// ---------------------------------------------------------------------------

export interface HookContext<T = any> {
  /** The model instance (or data to be created). */
  instance: Partial<T>;
  /** The operation type. */
  operation: HookType;
  /** Extra data passed by the caller. */
  meta?: Record<string, any>;
  /** Whether to abort the operation. */
  abort?: boolean;
}

export type HookFn<T = any> = (ctx: HookContext<T>) => Promise<void> | void;

// ---------------------------------------------------------------------------
// HookRegistry
// ---------------------------------------------------------------------------

export class HookRegistry<T = any> {
  private hooks: Map<HookType, HookFn<T>[]> = new Map();

  /**
   * Register a hook function for a given event type.
   */
  register(type: HookType, fn: HookFn<T>): void {
    const list = this.hooks.get(type) || [];
    list.push(fn);
    this.hooks.set(type, list);
  }

  /**
   * Execute all hooks for a given event type sequentially.
   */
  async execute(type: HookType, ctx: HookContext<T>): Promise<void> {
    const list = this.hooks.get(type);
    if (!list || list.length === 0) return;

    for (const fn of list) {
      try {
        await fn(ctx);
      } catch (err: any) {
        throw new HookError(type, err.message || String(err));
      }
      if (ctx.abort) {
        throw new HookError(type, 'Operation aborted by hook');
      }
    }
  }

  /**
   * Remove all hooks for a given type, or all hooks if no type is specified.
   */
  clear(type?: HookType): void {
    if (type) {
      this.hooks.delete(type);
    } else {
      this.hooks.clear();
    }
  }

  /**
   * Return the number of hooks registered for a type.
   */
  count(type: HookType): number {
    return this.hooks.get(type)?.length || 0;
  }
}

// ---------------------------------------------------------------------------
// Built-in hooks
// ---------------------------------------------------------------------------

/**
 * Automatically sets created_at and updated_at timestamps.
 */
export function TimestampHook<T>(): {
  beforeCreate: HookFn<T>;
  beforeUpdate: HookFn<T>;
} {
  return {
    beforeCreate: (ctx: HookContext<T>) => {
      const now = new Date();
      (ctx.instance as any)['created_at'] = now;
      (ctx.instance as any)['updated_at'] = now;
    },
    beforeUpdate: (ctx: HookContext<T>) => {
      (ctx.instance as any)['updated_at'] = new Date();
    },
  };
}

/**
 * Converts DELETE to a soft-delete (sets deleted_at).
 */
export function SoftDeleteHook<T>(): {
  beforeDelete: HookFn<T>;
} {
  return {
    beforeDelete: (ctx: HookContext<T>) => {
      (ctx.instance as any)['deleted_at'] = new Date();
      // Signal the model to do an UPDATE instead of DELETE
      ctx.meta = ctx.meta || {};
      ctx.meta['softDelete'] = true;
    },
  };
}

/**
 * Runs field-level validators from the schema.
 */
export function ValidationHook<T>(
  fieldsWithValidators: Record<string, { validators?: Array<{ validate: (v: any) => boolean; message: string }> }>
): { beforeCreate: HookFn<T>; beforeUpdate: HookFn<T> } {
  const validate = (ctx: HookContext<T>) => {
    for (const [field, def] of Object.entries(fieldsWithValidators)) {
      if (!def.validators) continue;
      const value = (ctx.instance as any)[field];
      // Skip validation if value is not set (for partial updates)
      if (value === undefined) continue;
      for (const v of def.validators) {
        if (!v.validate(value)) {
          const { ValidationError } = require('./errors');
          throw new ValidationError(field, v.message, value);
        }
      }
    }
  };

  return {
    beforeCreate: validate,
    beforeUpdate: validate,
  };
}
