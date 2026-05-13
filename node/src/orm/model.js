/**
 * VedaDB ORM - Base Model class with CRUD operations.
 *
 * @example
 * const { Model } = require('vedadb/orm/model');
 *
 * class User extends Model {
 *   static get tableName() { return 'users'; }
 *   static get schema() {
 *     return {
 *       id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
 *       name: { type: 'TEXT', nullable: false },
 *       email: { type: 'TEXT', nullable: false, unique: true },
 *       age: { type: 'INTEGER', default: 0 },
 *     };
 *   }
 * }
 *
 * await User.create({ name: 'Alice', email: 'alice@example.com', age: 30 });
 * const user = await User.findById(1);
 * await user.update({ age: 31 });
 * await user.destroy();
 */

'use strict';

const { QueryBuilder } = require('./query');

/**
 * Validation error thrown when model validation fails.
 */
class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Base Model class for VedaDB ORM.
 */
class Model {
  constructor(data = {}) {
    this._data = { ...data };
    this._original = { ...data };
    this._isNew = !data[this.constructor.primaryKey];
    this._errors = {};
  }

  // ---- Schema Definition ----

  static get tableName() {
    throw new Error('Subclasses must define tableName');
  }

  static get schema() {
    return {};
  }

  static get primaryKey() {
    const schema = this.schema;
    for (const [name, defn] of Object.entries(schema)) {
      if (defn.primaryKey) return name;
    }
    return 'id';
  }

  static get client() {
    if (!this._client) {
      throw new Error('Model.setClient() must be called before using Model');
    }
    return this._client;
  }

  static setClient(client) {
    this._client = client;
  }

  // ---- CRUD Operations ----

  /**
   * Create a new record.
   */
  static async create(data) {
    const instance = new this(data);
    await instance.save();
    return instance;
  }

  /**
   * Find by primary key.
   */
  static async findById(id) {
    const pk = this.primaryKey;
    const result = await this.client.query(
      `SELECT * FROM ${this.tableName} WHERE ${pk} = $1;`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return new this(result.toDicts()[0]);
  }

  /**
   * Find one record matching conditions.
   */
  static async findOne(where) {
    const results = await this.findAll({ where, limit: 1 });
    return results[0] || null;
  }

  /**
   * Find all records matching conditions.
   */
  static async findAll(options = {}) {
    const qb = new QueryBuilder(this.client, this.tableName);
    if (options.where) qb.where(options.where);
    if (options.orderBy) qb.order(options.orderBy, options.desc);
    if (options.limit) qb.limit(options.limit);
    if (options.offset) qb.offset(options.offset);
    const result = await qb.select().execute();
    return result.toDicts().map(row => new this(row));
  }

  /**
   * Count records.
   */
  static async count(where) {
    let sql = `SELECT COUNT(*) AS count FROM ${this.tableName}`;
    const values = [];
    if (where && Object.keys(where).length > 0) {
      const conditions = Object.entries(where).map(([k, v], i) => {
        values.push(v);
        return `${k} = $${i + 1}`;
      });
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ';';
    const result = await this.client.query(sql, values);
    return parseInt(result.rows[0][0], 10);
  }

  /**
   * Update records matching where clause.
   */
  static async updateAll(set, where) {
    const setEntries = Object.entries(set);
    const setClause = setEntries.map(([k, v], i) => `${k} = $${i + 1}`).join(', ');
    const values = setEntries.map(([, v]) => v);
    let sql = `UPDATE ${this.tableName} SET ${setClause}`;
    if (where && Object.keys(where).length > 0) {
      const whereEntries = Object.entries(where);
      const whereClause = whereEntries.map(([k, v]) => {
        values.push(v);
        return `${k} = $${values.length}`;
      }).join(' AND ');
      sql += ` WHERE ${whereClause}`;
    }
    sql += ';';
    return this.client.execute(sql, values);
  }

  /**
   * Delete records matching where clause.
   */
  static async destroyAll(where) {
    let sql = `DELETE FROM ${this.tableName}`;
    const values = [];
    if (where && Object.keys(where).length > 0) {
      const entries = Object.entries(where);
      const clauses = entries.map(([k, v], i) => {
        values.push(v);
        return `${k} = $${i + 1}`;
      }).join(' AND ');
      sql += ` WHERE ${clauses}`;
    }
    sql += ';';
    return this.client.execute(sql, values);
  }

  // ---- Instance Methods ----

  /**
   * Save the instance (insert if new, update if existing).
   */
  async save() {
    this._runValidations();
    this._runHook('beforeSave');
    if (this._isNew) {
      this._runHook('beforeCreate');
      const result = await this.constructor.client.insert(
        this.constructor.tableName,
        this._data
      );
      this._isNew = false;
      this._original = { ...this._data };
      this._runHook('afterCreate');
    } else {
      this._runHook('beforeUpdate');
      const pk = this.constructor.primaryKey;
      const changes = {};
      for (const key of Object.keys(this._data)) {
        if (this._data[key] !== this._original[key]) {
          changes[key] = this._data[key];
        }
      }
      if (Object.keys(changes).length > 0) {
        await this.constructor.updateAll(changes, { [pk]: this._data[pk] });
      }
      this._original = { ...this._data };
      this._runHook('afterUpdate');
    }
    this._runHook('afterSave');
    return this;
  }

  /**
   * Update specific fields.
   */
  async update(attrs) {
    Object.assign(this._data, attrs);
    return this.save();
  }

  /**
   * Delete this record.
   */
  async destroy() {
    this._runHook('beforeDestroy');
    const pk = this.constructor.primaryKey;
    await this.constructor.destroyAll({ [pk]: this._data[pk] });
    this._runHook('afterDestroy');
  }

  /**
   * Reload from database.
   */
  async reload() {
    const pk = this.constructor.primaryKey;
    const fresh = await this.constructor.findById(this._data[pk]);
    if (fresh) {
      this._data = fresh._data;
      this._original = { ...fresh._data };
    }
    return this;
  }

  /**
   * Convert to plain object.
   */
  toJSON() {
    return { ...this._data };
  }

  toString() {
    return `${this.constructor.name} ${JSON.stringify(this._data)}`;
  }

  // ---- Hooks ----

  _runHook(name) {
    if (typeof this[name] === 'function') {
      this[name]();
    }
  }

  // ---- Validations ----

  _runValidations() {
    const schema = this.constructor.schema;
    this._errors = {};
    for (const [field, defn] of Object.entries(schema)) {
      const value = this._data[field];
      if (!defn.nullable && (value === undefined || value === null)) {
        this._errors[field] = `${field} is required`;
      }
      if (defn.unique) {
        // Unique check would require a query — simplified here
      }
      if (defn.validate && typeof defn.validate === 'function') {
        const valid = defn.validate(value);
        if (!valid) {
          this._errors[field] = `${field} validation failed`;
        }
      }
    }
    if (Object.keys(this._errors).length > 0) {
      const firstError = Object.entries(this._errors)[0];
      throw new ValidationError(firstError[1], firstError[0]);
    }
  }

  get errors() {
    return { ...this._errors };
  }

  // ---- Attribute Access ----

  get(key) {
    return this._data[key];
  }

  set(key, value) {
    this._data[key] = value;
  }

  get changed() {
    const changed = {};
    for (const key of Object.keys(this._data)) {
      if (this._data[key] !== this._original[key]) {
        changed[key] = this._data[key];
      }
    }
    return changed;
  }

  get isNew() {
    return this._isNew;
  }
}

module.exports = { Model, ValidationError };
