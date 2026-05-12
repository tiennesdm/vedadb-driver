/**
 * VedaDB Node.js Driver - Middleware / Interceptors
 *
 * Pre/post hook system for query execution, connection lifecycle,
 and error handling. Allows users to register middleware that can
 * modify, log, or short-circuit operations.
 */

'use strict';

/**
 * @typedef {Object} Context
 * @property {string} type - Operation type: 'query' | 'execute' | 'connect' | 'close' | 'pool_acquire' | 'pool_release'
 * @property {string} [sql] - SQL statement
 * @property {Array} [params] - Query parameters
 * @property {*} [result] - Operation result (post-hook only)
 * @property {Error} [error] - Operation error (post-hook only)
 * @property {number} [duration] - Execution time in ms
 * @property {Object} [meta] - Additional metadata
 */

/**
 * @typedef {function(Context): Promise<Context|void>} Interceptor
 */

/**
 * Interceptor registry for the VedaDB driver.
 * Supports pre-hooks (before operation) and post-hooks (after operation).
 */
class InterceptorRegistry {
  constructor() {
    this._pre = [];
    this._post = [];
    this._error = [];
  }

  /**
   * Register a pre-hook interceptor.
   * Called before the operation. Can modify context or throw to cancel.
   *
   * @param {Interceptor} fn
   * @returns {function()} Unsubscribe function
   */
  usePre(fn) {
    this._pre.push(fn);
    return () => {
      const idx = this._pre.indexOf(fn);
      if (idx !== -1) this._pre.splice(idx, 1);
    };
  }

  /**
   * Register a post-hook interceptor.
   * Called after successful operation. Can modify the result.
   *
   * @param {Interceptor} fn
   * @returns {function()} Unsubscribe function
   */
  usePost(fn) {
    this._post.push(fn);
    return () => {
      const idx = this._post.indexOf(fn);
      if (idx !== -1) this._post.splice(idx, 1);
    };
  }

  /**
   * Register an error interceptor.
   * Called when an error occurs. Can transform or swallow errors.
   *
   * @param {Interceptor} fn
   * @returns {function()} Unsubscribe function
   */
  useError(fn) {
    this._error.push(fn);
    return () => {
      const idx = this._error.indexOf(fn);
      if (idx !== -1) this._error.splice(idx, 1);
    };
  }

  /**
   * Register a combined pre+post interceptor.
   *
   * @param {Object} hooks
   * @param {Interceptor} [hooks.pre]
   * @param {Interceptor} [hooks.post]
   * @param {Interceptor} [hooks.error]
   * @returns {function()} Unsubscribe function
   */
  use(hooks) {
    const unsubscribes = [];
    if (hooks.pre) unsubscribes.push(this.usePre(hooks.pre));
    if (hooks.post) unsubscribes.push(this.usePost(hooks.post));
    if (hooks.error) unsubscribes.push(this.useError(hooks.error));
    return () => unsubscribes.forEach(fn => fn());
  }

  /**
   * Run all pre-hooks sequentially.
   *
   * @param {Context} context
   * @returns {Promise<Context>} Modified context
   */
  async runPre(context) {
    let ctx = context;
    for (const hook of this._pre) {
      const result = await hook(ctx);
      if (result !== undefined) ctx = result;
    }
    return ctx;
  }

  /**
   * Run all post-hooks sequentially.
   *
   * @param {Context} context
   * @returns {Promise<Context>} Modified context
   */
  async runPost(context) {
    let ctx = context;
    for (const hook of this._post) {
      const result = await hook(ctx);
      if (result !== undefined) ctx = result;
    }
    return ctx;
  }

  /**
   * Run all error hooks sequentially.
   * If any hook returns a non-error result, the error is swallowed.
   *
   * @param {Context} context
   * @returns {Promise<Context>} Modified context or throws
   */
  async runError(context) {
    let ctx = context;
    for (const hook of this._error) {
      const result = await hook(ctx);
      if (result !== undefined) ctx = result;
      if (ctx.error === null || ctx.error === undefined) break;
    }
    if (ctx.error) throw ctx.error;
    return ctx;
  }

  /** Clear all registered interceptors. */
  clear() {
    this._pre = [];
    this._post = [];
    this._error = [];
  }

  /** Get interceptor counts. */
  get stats() {
    return {
      pre: this._pre.length,
      post: this._post.length,
      error: this._error.length,
      total: this._pre.length + this._post.length + this._error.length,
    };
  }
}

/**
 * Built-in interceptors.
 */
const BuiltinInterceptors = {
  /**
   * Create a logging interceptor.
   *
   * @param {Object} [logger=console]
   * @returns {Object} Hook object for use()
   */
  logger(logger = console) {
    return {
      pre: async (ctx) => {
        logger.log(`[vedadb] ${ctx.type}: ${ctx.sql || ''}`, ctx.params ? { params: ctx.params } : '');
        return ctx;
      },
      post: async (ctx) => {
        logger.log(`[vedadb] ${ctx.type} done: ${ctx.duration}ms`);
        return ctx;
      },
      error: async (ctx) => {
        logger.error(`[vedadb] ${ctx.type} error:`, ctx.error?.message);
        return ctx;
      },
    };
  },

  /**
   * Create a timing interceptor that tracks query durations.
   *
   * @param {Object} [metrics] - Metrics collector (must have timing(label, value) method)
   * @returns {Object}
   */
  timing(metrics) {
    return {
      post: async (ctx) => {
        if (ctx.duration != null && metrics?.timing) {
          metrics.timing(`vedadb.${ctx.type}.duration`, ctx.duration);
        }
        return ctx;
      },
    };
  },

  /**
   * Create a query sanitization interceptor.
   * Strips comments and normalizes whitespace.
   *
   * @returns {Object}
   */
  sanitize() {
    return {
      pre: async (ctx) => {
        if (ctx.sql) {
          ctx.sql = ctx.sql
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/--.*$/gm, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
        return ctx;
      },
    };
  },

  /**
   * Create a query timeout interceptor.
   *
   * @param {number} defaultTimeoutMs
   * @returns {Object}
   */
  timeout(defaultTimeoutMs) {
    return {
      pre: async (ctx) => {
        if (!ctx.meta) ctx.meta = {};
        ctx.meta.timeout = ctx.meta?.timeout || defaultTimeoutMs;
        return ctx;
      },
    };
  },
};

module.exports = {
  InterceptorRegistry,
  BuiltinInterceptors,
};
