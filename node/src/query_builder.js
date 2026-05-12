/**
 * VedaDB Node.js Driver - Fluent Query Builder
 *
 * Chainable API for constructing SQL queries programmatically.
 * Supports SELECT, INSERT, UPDATE, DELETE with conditions, joins,
 * ordering, pagination, and aggregations.
 */

'use strict';

/**
 * Escape a value for safe SQL inclusion.
 * @param {*} v
 * @returns {string}
 */
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return String(v);
}

/**
 * Build a WHERE condition string.
 * @param {string} column
 * @param {string} operator
 * @param {*} value
 * @returns {string}
 */
function buildCondition(column, operator, value) {
  switch (operator.toUpperCase()) {
    case 'IS NULL':
    case 'ISNULL':
      return `${column} IS NULL`;
    case 'IS NOT NULL':
    case 'NOTNULL':
      return `${column} IS NOT NULL`;
    case 'IN':
      if (!Array.isArray(value) || value.length === 0) return '1=0';
      return `${column} IN (${value.map(esc).join(', ')})`;
    case 'NOT IN':
      if (!Array.isArray(value) || value.length === 0) return '1=1';
      return `${column} NOT IN (${value.map(esc).join(', ')})`;
    case 'BETWEEN':
      if (!Array.isArray(value) || value.length !== 2) return '1=0';
      return `${column} BETWEEN ${esc(value[0])} AND ${esc(value[1])}`;
    case 'LIKE':
      return `${column} LIKE ${esc(value)}`;
    default:
      return `${column} ${operator} ${esc(value)}`;
  }
}

/**
 * Fluent query builder for VedaDB.
 */
class QueryBuilder {
  /**
   * @param {Object} client - VedaDB client instance
   * @param {string} table - Table name
   */
  constructor(client, table) {
    this._client = client;
    this._table = table;
    this._columns = ['*'];
    this._where = [];
    this._orderBy = [];
    this._groupBy = [];
    this._having = [];
    this._limit = null;
    this._offset = null;
    this._joins = [];
    this._distinct = false;
    this._forUpdate = false;
    this._aggregate = null;
  }

  // -- Column Selection -----------------------------------------------------

  /**
   * Specify columns to select.
   * @param {...string} columns
   * @returns {QueryBuilder}
   */
  select(...columns) {
    if (columns.length === 1 && Array.isArray(columns[0])) {
      this._columns = columns[0];
    } else {
      this._columns = columns;
    }
    return this;
  }

  /**
   * Select distinct rows.
   * @returns {QueryBuilder}
   */
  distinct() {
    this._distinct = true;
    return this;
  }

  /**
   * Add a COUNT(*) aggregation.
   * @param {string} [alias='count']
   * @returns {QueryBuilder}
   */
  count(alias = 'count') {
    this._aggregate = `COUNT(*) AS ${alias}`;
    return this;
  }

  // -- WHERE Conditions -----------------------------------------------------

  /**
   * Add a WHERE condition.
   * @param {string} column
   * @param {string} [operator='=']
   * @param {*} [value]
   * @returns {QueryBuilder}
   */
  where(column, operator, value) {
    if (value === undefined && operator !== undefined) {
      // Two-arg form: where('name', 'Alice') => name = 'Alice'
      value = operator;
      operator = '=';
    }
    this._where.push({ condition: buildCondition(column, operator, value), type: 'AND' });
    return this;
  }

  /**
   * Add an OR WHERE condition.
   * @param {string} column
   * @param {string} [operator='=']
   * @param {*} [value]
   * @returns {QueryBuilder}
   */
  orWhere(column, operator, value) {
    if (value === undefined && operator !== undefined) {
      value = operator;
      operator = '=';
    }
    this._where.push({ condition: buildCondition(column, operator, value), type: 'OR' });
    return this;
  }

  /**
   * Add a WHERE IN condition.
   * @param {string} column
   * @param {Array} values
   * @returns {QueryBuilder}
   */
  whereIn(column, values) {
    this._where.push({ condition: buildCondition(column, 'IN', values), type: 'AND' });
    return this;
  }

  /**
   * Add a WHERE BETWEEN condition.
   * @param {string} column
   * @param {*} start
   * @param {*} end
   * @returns {QueryBuilder}
   */
  whereBetween(column, start, end) {
    this._where.push({ condition: buildCondition(column, 'BETWEEN', [start, end]), type: 'AND' });
    return this;
  }

  /**
   * Add a raw WHERE condition.
   * @param {string} raw
   * @returns {QueryBuilder}
   */
  whereRaw(raw) {
    this._where.push({ condition: raw, type: 'AND' });
    return this;
  }

  // -- Joins ----------------------------------------------------------------

  /**
   * Add an INNER JOIN.
   * @param {string} table
   * @param {string} leftColumn
   * @param {string} rightColumn
   * @returns {QueryBuilder}
   */
  join(table, leftColumn, rightColumn) {
    this._joins.push(`INNER JOIN ${table} ON ${leftColumn} = ${rightColumn}`);
    return this;
  }

  /**
   * Add a LEFT JOIN.
   * @param {string} table
   * @param {string} leftColumn
   * @param {string} rightColumn
   * * @returns {QueryBuilder}
   */
  leftJoin(table, leftColumn, rightColumn) {
    this._joins.push(`LEFT JOIN ${table} ON ${leftColumn} = ${rightColumn}`);
    return this;
  }

  // -- Ordering / Grouping / Pagination -------------------------------------

  /**
   * Add ORDER BY.
   * @param {string} column
   * @param {string} [direction='ASC']
   * @returns {QueryBuilder}
   */
  orderBy(column, direction = 'ASC') {
    this._orderBy.push(`${column} ${direction.toUpperCase()}`);
    return this;
  }

  /**
   * ORDER BY ... DESC shortcut.
   * @param {string} column
   * @returns {QueryBuilder}
   */
  orderByDesc(column) {
    return this.orderBy(column, 'DESC');
  }

  /**
   * Add GROUP BY.
   * @param {...string} columns
   * @returns {QueryBuilder}
   */
  groupBy(...columns) {
    this._groupBy.push(...columns);
    return this;
  }

  /**
   * Add HAVING condition.
   * @param {string} raw
   * @returns {QueryBuilder}
   */
  having(raw) {
    this._having.push(raw);
    return this;
  }

  /**
   * Set LIMIT.
   * @param {number} n
   * @returns {QueryBuilder}
   */
  limit(n) {
    this._limit = n;
    return this;
  }

  /**
   * Set OFFSET.
   * @param {number} n
   * @returns {QueryBuilder}
   */
  offset(n) {
    this._offset = n;
    return this;
  }

  // -- Query Building -------------------------------------------------------

  /**
   * Build the SELECT SQL string.
   * @returns {string}
   */
  toSQL() {
    let sql = 'SELECT ';
    if (this._distinct) sql += 'DISTINCT ';
    if (this._aggregate) {
      sql += this._aggregate;
    } else {
      sql += this._columns.join(', ');
    }
    sql += ` FROM ${this._table}`;

    for (const join of this._joins) {
      sql += ' ' + join;
    }

    if (this._where.length > 0) {
      sql += ' WHERE ';
      sql += this._where.map((w, i) => (i > 0 ? `${w.type} ` : '') + w.condition).join(' ');
    }

    if (this._groupBy.length > 0) {
      sql += ' GROUP BY ' + this._groupBy.join(', ');
    }

    if (this._having.length > 0) {
      sql += ' HAVING ' + this._having.join(' AND ');
    }

    if (this._orderBy.length > 0) {
      sql += ' ORDER BY ' + this._orderBy.join(', ');
    }

    if (this._limit != null) {
      sql += ` LIMIT ${this._limit}`;
    }

    if (this._offset != null) {
      sql += ` OFFSET ${this._offset}`;
    }

    sql += ';';
    return sql;
  }

  // -- Execution ------------------------------------------------------------

  /**
   * Execute the built SELECT query.
   * @returns {Promise<Result>}
   */
  async execute() {
    return this._client.query(this.toSQL());
  }

  /**
   * Execute and return all rows as objects.
   * @returns {Promise<Object[]>}
   */
  async all() {
    const result = await this.execute();
    return result.toObjects();
  }

  /**
   * Execute and return the first row as an object.
   * @returns {Promise<Object|null>}
   */
  async first() {
    const result = await this.limit(1).execute();
    return result.first();
  }

  /**
   * Execute and return a single column's values.
   * @param {string} column
   * @returns {Promise<any[]>}
   */
  async pluck(column) {
    const result = await this.execute();
    return result.pluck(column);
  }

  // -- INSERT / UPDATE / DELETE ---------------------------------------------

  /**
   * Build and execute an INSERT.
   * @param {Object} data - { column: value }
   * @returns {Promise<Result>}
   */
  async insert(data) {
    const cols = Object.keys(data);
    const vals = cols.map(c => esc(data[c]));
    const sql = `INSERT INTO ${this._table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
    return this._client.query(sql);
  }

  /**
   * Build and execute a batch INSERT.
   * @param {Object[]} rows
   * @returns {Promise<Result>}
   */
  async insertMany(rows) {
    if (!rows || rows.length === 0) return { rowCount: 0 };
    const cols = Object.keys(rows[0]);
    const values = rows.map(row =>
      '(' + cols.map(c => esc(row[c])).join(', ') + ')'
    ).join(', ');
    const sql = `INSERT INTO ${this._table} (${cols.join(', ')}) VALUES ${values};`;
    return this._client.query(sql);
  }

  /**
   * Build and execute an UPDATE.
   * @param {Object} data - { column: newValue }
   * @returns {Promise<Result>}
   */
  async update(data) {
    const setClause = Object.entries(data)
      .map(([k, v]) => `${k} = ${esc(v)}`)
      .join(', ');
    let sql = `UPDATE ${this._table} SET ${setClause}`;
    if (this._where.length > 0) {
      sql += ' WHERE ' + this._where.map((w, i) => (i > 0 ? `${w.type} ` : '') + w.condition).join(' ');
    }
    sql += ';';
    return this._client.query(sql);
  }

  /**
   * Build and execute a DELETE.
   * @returns {Promise<Result>}
   */
  async delete() {
    let sql = `DELETE FROM ${this._table}`;
    if (this._where.length > 0) {
      sql += ' WHERE ' + this._where.map((w, i) => (i > 0 ? `${w.type} ` : '') + w.condition).join(' ');
    }
    sql += ';';
    return this._client.query(sql);
  }
}

module.exports = { QueryBuilder, esc };
