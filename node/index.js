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
  substitutePlaceholders,
} = require('./src/client');

const { ConnectionPool: VedaPool } = require('./src/pool');

// VBP v1 binary transport (opt-in).  Default is still HTTP/JSON-lines
// for backward compat.  Import VBPConnection / createVBPClient
// directly to use the v1 binary wire.
const vbp = require('./src/wire/vbp');

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
  substitutePlaceholders,

  // VBP v1 binary transport
  VBPConnection: vbp.VBPConnection,
  VBPError: vbp.VBPError,
  VBPResult: vbp.VBPResult,
  // (No createVBPClient transport flag in v1; use VBPConnection
  // directly. The existing createClient continues to return the
  // HTTP/JSON-lines client unless transport='vbp' is passed AND
  // a future v2 wires that up. The flag is reserved.)
};
