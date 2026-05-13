/**
 * VedaDB Fastify Plugin
 *
 * Provides connection pool injection, transaction wrapper, and
 * query builder access for Fastify applications.
 *
 * @example
 * const fastify = require('fastify')();
 * const vedadbFastify = require('vedadb/frameworks/fastify');
 *
 * fastify.register(vedadbFastify, { host: 'localhost', port: 6380 });
 *
 * fastify.get('/users', async (request, reply) => {
 *   const result = await fastify.vedadb.query('SELECT * FROM users;');
 *   return result.toDicts();
 * });
 */

'use strict';

const fp = require('fastify-plugin');
const { VedaClient } = require('../client');
const { ConnectionPool } = require('../pool');

async function vedadbFastify(fastify, options = {}) {
  const client = new VedaClient(options);
  await client.connect();

  let pool = null;
  if (options.pool) {
    pool = new ConnectionPool(options.pool);
  }

  // Decorate fastify with vedadb
  fastify.decorate('vedadb', client);
  fastify.decorate('vedadbPool', pool);

  // Transaction wrapper
  fastify.decorate('vedadbTransaction', async function vedadbTransaction(fn) {
    await client.begin();
    try {
      const result = await fn(client);
      await client.commit();
      return result;
    } catch (err) {
      await client.rollback().catch(() => {});
      throw err;
    }
  });

  // Query builder access
  fastify.decorate('vedadbTable', function vedadbTable(name) {
    return client.table(name);
  });

  // Pool acquire
  fastify.decorate('vedadbAcquire', async function vedadbAcquire() {
    if (!pool) throw new Error('Connection pool not configured');
    return pool.acquire();
  });

  // Close on shutdown
  fastify.addHook('onClose', async () => {
    await client.close();
    if (pool) await pool.close();
  });
}

module.exports = fp(vedadbFastify, { name: 'vedadb-fastify' });
