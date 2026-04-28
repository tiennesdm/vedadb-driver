/**
 * VedaDB Node.js Driver
 *
 * Usage:
 *   const { VedaDB, createClient, VedaPool } = require('vedadb');
 *
 *   // Quick connect
 *   const db = await createClient({ host: 'localhost', port: 6380 });
 *   const result = await db.query('SELECT * FROM users;');
 *   console.log(result.toObjects());
 *   db.close();
 *
 *   // Connection pool
 *   const pool = new VedaPool({ host: 'localhost', port: 6380, max: 20 });
 *   const res = await pool.query('SELECT COUNT(*) FROM orders;');
 *   pool.close();
 */

const {
  VedaDB,
  VedaDBError,
  ConnectionError,
  QueryError,
  TimeoutError,
  Result,
  createClient,
  escapeValue,
  escapeSqlValue,
} = require('./src/client');

const { VedaPool } = require('./src/pool');

module.exports = {
  // Client
  VedaDB,
  createClient,
  Result,

  // Pool
  VedaPool,

  // Errors
  VedaDBError,
  ConnectionError,
  QueryError,
  TimeoutError,

  // Utilities
  escapeValue,
  escapeSqlValue,
};
