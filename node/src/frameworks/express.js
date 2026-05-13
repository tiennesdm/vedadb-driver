/**
 * VedaDB Express.js Middleware
 *
 * Provides connection pool injection, transaction wrapper, and
 * query builder access for Express applications.
 *
 * @example
 * const express = require('express');
 * const { expressVedaDB } = require('vedadb/frameworks/express');
 *
 * const app = express();
 * app.use(expressVedaDB({ host: 'localhost', port: 6380 }));
 *
 * app.get('/users', async (req, res) => {
 *   const result = await req.vedadb.query('SELECT * FROM users;');
 *   res.json(result.toDicts());
 * });
 */

'use strict';

const { VedaClient } = require('../client');
const { ConnectionPool } = require('../pool');

/**
 * Create Express middleware that injects VedaDB into requests.
 * @param {Object} config - VedaDB connection configuration
 * @returns {Function} Express middleware
 */
function expressVedaDB(config = {}) {
  const client = new VedaClient(config);
  let pool = null;

  // Initialize connection pool if configured
  if (config.pool) {
    pool = new ConnectionPool(config.pool);
  }

  return async function vedadbMiddleware(req, res, next) {
    // Attach client to request
    req.vedadb = client;
    req.vedadbPool = pool;

    /**
     * Transaction wrapper - executes fn within a transaction.
     * Auto-commits on success, rolls back on error.
     */
    req.vedadbTransaction = async function vedadbTransaction(fn) {
      await client.begin();
      try {
        const result = await fn(client);
        await client.commit();
        return result;
      } catch (err) {
        await client.rollback().catch(() => {});
        throw err;
      }
    };

    /**
     * Get a query builder for a table.
     */
    req.vedadbTable = function vedadbTable(name) {
      return client.table(name);
    };

    /**
     * Acquire a connection from the pool.
     */
    req.vedadbAcquire = async function vedadbAcquire() {
      if (!pool) throw new Error('Connection pool not configured');
      return pool.acquire();
    };

    next();
  };
}

/**
 * Create an Express router with CRUD endpoints for a table.
 * @param {string} table - Table name
 * @param {Object} options - Router options
 * @returns {Object} Express router
 */
function createCRUDRouter(table, options = {}) {
  const express = require('express');
  const router = express.Router();

  // LIST / READ ALL
  router.get('/', async (req, res) => {
    try {
      const result = await req.vedadb.query(`SELECT * FROM ${table};`);
      res.json({ success: true, data: result.toDicts() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // READ ONE
  router.get('/:id', async (req, res) => {
    try {
      const result = await req.vedadb.query(
        `SELECT * FROM ${table} WHERE id = $1;`,
        [req.params.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      res.json({ success: true, data: result.toDicts()[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // CREATE
  router.post('/', async (req, res) => {
    try {
      const result = await req.vedadb.insert(table, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // UPDATE
  router.put('/:id', async (req, res) => {
    try {
      const result = await req.vedadb.update(table, req.body, { id: req.params.id });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE
  router.delete('/:id', async (req, res) => {
    try {
      const result = await req.vedadb.delete(table, { id: req.params.id });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { expressVedaDB, createCRUDRouter };
