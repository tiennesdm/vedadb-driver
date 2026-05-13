/**
 * VedaDB ORM Relationships
 *
 * Defines HasMany, BelongsTo, and ManyToMany relationships
 * between models.
 *
 * @example
 * class User extends Model {
 *   static get relationships() {
 *     return {
 *       posts: hasMany('Post', 'user_id'),
 *       profile: belongsTo('Profile', 'user_id'),
 *       roles: manyToMany('Role', 'user_roles', 'user_id', 'role_id'),
 *     };
 *   }
 * }
 */

'use strict';

const { Model } = require('./model');

/**
 * HasMany relationship - one-to-many.
 * @param {string} relatedModelName - Name of the related model
 * @param {string} foreignKey - Foreign key in the related table
 * @returns {Object} Relationship definition
 */
function hasMany(relatedModelName, foreignKey) {
  return {
    type: 'hasMany',
    related: relatedModelName,
    foreignKey,
    async load(client, parentId, primaryKey = 'id') {
      const sql = `SELECT * FROM ${toTableName(relatedModelName)} WHERE ${foreignKey} = $1;`;
      const result = await client.query(sql, [parentId]);
      return result.toDicts();
    },
    async create(client, parentId, data, primaryKey = 'id') {
      const insertData = { ...data, [foreignKey]: parentId };
      const entries = Object.entries(insertData);
      const cols = entries.map(([k]) => k).join(', ');
      const placeholders = entries.map((_, i) => `$${i + 1}`).join(', ');
      const values = entries.map(([, v]) => v);
      const sql = `INSERT INTO ${toTableName(relatedModelName)} (${cols}) VALUES (${placeholders});`;
      return client.query(sql, values);
    },
  };
}

/**
 * BelongsTo relationship - many-to-one.
 * @param {string} relatedModelName - Name of the parent model
 * @param {string} foreignKey - Foreign key in this model's table
 * @returns {Object} Relationship definition
 */
function belongsTo(relatedModelName, foreignKey) {
  return {
    type: 'belongsTo',
    related: relatedModelName,
    async load(client, foreignId) {
      const sql = `SELECT * FROM ${toTableName(relatedModelName)} WHERE id = $1;`;
      const result = await client.query(sql, [foreignId]);
      return result.toDicts()[0] || null;
    },
  };
}

/**
 * ManyToMany relationship via a junction table.
 * @param {string} relatedModelName - Name of the related model
 * @param {string} junctionTable - Junction table name
 * @param {string} localKey - Foreign key for this model in junction table
 * @param {string} foreignKey - Foreign key for related model in junction table
 * @returns {Object} Relationship definition
 */
function manyToMany(relatedModelName, junctionTable, localKey, foreignKey) {
  return {
    type: 'manyToMany',
    related: relatedModelName,
    junctionTable,
    localKey,
    foreignKey,
    async load(client, parentId) {
      const relatedTable = toTableName(relatedModelName);
      const sql = `
        SELECT r.* FROM ${relatedTable} r
        INNER JOIN ${junctionTable} j ON r.id = j.${foreignKey}
        WHERE j.${localKey} = $1;
      `;
      const result = await client.query(sql, [parentId]);
      return result.toDicts();
    },
    async attach(client, parentId, relatedId) {
      const sql = `INSERT INTO ${junctionTable} (${localKey}, ${foreignKey}) VALUES ($1, $2);`;
      return client.query(sql, [parentId, relatedId]);
    },
    async detach(client, parentId, relatedId) {
      const sql = `DELETE FROM ${junctionTable} WHERE ${localKey} = $1 AND ${foreignKey} = $2;`;
      return client.query(sql, [parentId, relatedId]);
    },
  };
}

/**
 * Convert a model name to a table name (CamelCase -> snake_case + s).
 */
function toTableName(modelName) {
  const snake = modelName.replace(/([A-Z])/g, '_$1').toLowerCase();
  return (snake.startsWith('_') ? snake.slice(1) : snake) + 's';
}

module.exports = { hasMany, belongsTo, manyToMany };
