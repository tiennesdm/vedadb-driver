/**
 * VedaDB ORM Query Builder
 *
 * Provides a fluent, chainable interface for building queries.
 *
 * @example
 * const { QueryBuilder } = require('vedadb/orm/query');
 * const users = await new QueryBuilder(client, 'users')
 *   .where({ age: { $gt: 18 }, active: true })
 *   .order('name')
 *   .limit(10)
 *   .offset(0)
 *   .execute();
 */

'use strict';

/**
 * Query Builder for fluent SQL construction.
 */
class QueryBuilder {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this._select = '*';
    this._where = [];
    this._order = null;
    this._limit = null;
    this._offset = null;
    this._joins = [];
    this._values = [];
  }

  /**
   * Set SELECT columns.
   */
  select(columns) {
    if (Array.isArray(columns)) {
      this._select = columns.join(', ');
    } else {
      this._select = columns || '*';
    }
    return this;
  }

  /**
   * Add WHERE conditions. Supports:
   * - Simple equality: { name: 'Alice' }
   * - Operators: { age: { $gt: 18, $lt: 65 } }
   * - $in, $like, $ne, $gte, $lte
   */
  where(conditions) {
    if (!conditions) return this;
    const entries = Object.entries(conditions);
    for (const [key, value] of entries) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Operator conditions
        for (const [op, val] of Object.entries(value)) {
          this._addOperatorCondition(key, op, val);
        }
      } else if (Array.isArray(value)) {
        // IN condition
        const placeholders = value.map(() => {
          this._values.push(value[this._values.length - this._where.length] || value);
          return `$${this._values.length}`;
        });
        // Correct IN handling
        const inPlaceholders = value.map((v, i) => {
          this._values.push(v);
          return `$${this._values.length}`;
        });
        this._where.push(`${key} IN (${inPlaceholders.join(', ')})`);
      } else {
        this._values.push(value);
        this._where.push(`${key} = $${this._values.length}`);
      }
    }
    return this;
  }

  _addOperatorCondition(key, op, value) {
    const opMap = {
      $eq: '=', $ne: '!=', $gt: '>', $gte: '>=',
      $lt: '<', $lte: '<=', $like: 'LIKE',
    };
    const sqlOp = opMap[op] || '=';
    this._values.push(value);
    this._where.push(`${key} ${sqlOp} $${this._values.length}`);
  }

  /**
   * Add an INNER JOIN.
   */
  join(table, on, alias) {
    const joinTable = alias ? `${table} AS ${alias}` : table;
    this._joins.push(`INNER JOIN ${joinTable} ON ${on}`);
    return this;
  }

  /**
   * Add a LEFT JOIN.
   */
  leftJoin(table, on, alias) {
    const joinTable = alias ? `${table} AS ${alias}` : table;
    this._joins.push(`LEFT JOIN ${joinTable} ON ${on}`);
    return this;
  }

  /**
   * Set ORDER BY.
   */
  order(column, desc = false) {
    this._order = `${column}${desc ? ' DESC' : ''}`;
    return this;
  }

  /**
   * Set LIMIT.
   */
  limit(n) {
    this._limit = n;
    return this;
  }

  /**
   * Set OFFSET.
   */
  offset(n) {
    this._offset = n;
    return this;
  }

  /**
   * Build and execute the query.
   */
  async execute() {
    const sql = this.build();
    return this.client.query(sql, this._values);
  }

  /**
   * Build the SQL string without executing.
   */
  build() {
    let sql = `SELECT ${this._select} FROM ${this.table}`;
    for (const join of this._joins) {
      sql += ` ${join}`;
    }
    if (this._where.length > 0) {
      sql += ` WHERE ${this._where.join(' AND ')}`;
    }
    if (this._order) {
      sql += ` ORDER BY ${this._order}`;
    }
    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    }
    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`;
    }
    sql += ';';
    return sql;
  }

  /**
   * Get the bound parameter values.
   */
  get values() {
    return [...this._values];
  }
}

module.exports = { QueryBuilder };
