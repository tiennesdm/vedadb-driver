/**
 * VedaDB NestJS Module
 *
 * Provides VedaDB as a NestJS injectable service with
 * connection pooling and transaction support.
 *
 * @example
 * import { VedaDBModule } from 'vedadb/frameworks/nestjs';
 *
 * @Module({
 *   imports: [VedaDBModule.forRoot({ host: 'localhost', port: 6380 })],
 *   controllers: [UsersController],
 * })
 * export class AppModule {}
 */

'use strict';

const { VedaClient } = require('../client');
const { ConnectionPool } = require('../pool');

const VEDADB_CONFIG = Symbol('VEDADB_CONFIG');
const VEDADB_CLIENT = Symbol('VEDADB_CLIENT');
const VEDADB_POOL = Symbol('VEDADB_POOL');

/**
 * VedaDB Service for NestJS dependency injection.
 */
class VedaDBService {
  constructor(config) {
    this.config = config;
    this.client = new VedaClient(config);
    this.pool = config.pool ? new ConnectionPool(config.pool) : null;
  }

  async onModuleInit() {
    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.close();
    if (this.pool) await this.pool.close();
  }

  getClient() {
    return this.client;
  }

  async query(sql, params) {
    return this.client.query(sql, params);
  }

  async execute(sql, params) {
    return this.client.execute(sql, params);
  }

  async transaction(fn) {
    await this.client.begin();
    try {
      const result = await fn(this.client);
      await this.client.commit();
      return result;
    } catch (err) {
      await this.client.rollback().catch(() => {});
      throw err;
    }
  }

  table(name) {
    return this.client.table(name);
  }

  async acquireFromPool() {
    if (!this.pool) throw new Error('Pool not configured');
    return this.pool.acquire();
  }
}

/**
 * Create the VedaDB module for NestJS.
 */
class VedaDBModule {
  static forRoot(config) {
    return {
      module: VedaDBModule,
      providers: [
        {
          provide: VEDADB_CONFIG,
          useValue: config,
        },
        {
          provide: VedaDBService,
          useFactory: (cfg) => new VedaDBService(cfg),
          inject: [VEDADB_CONFIG],
        },
      ],
      exports: [VedaDBService],
    };
  }

  static forRootAsync(configProvider) {
    return {
      module: VedaDBModule,
      imports: configProvider.imports || [],
      providers: [
        {
          provide: VEDADB_CONFIG,
          useFactory: configProvider.useFactory,
          inject: configProvider.inject || [],
        },
        {
          provide: VedaDBService,
          useFactory: (cfg) => new VedaDBService(cfg),
          inject: [VEDADB_CONFIG],
        },
      ],
      exports: [VedaDBService],
    };
  }
}

module.exports = {
  VedaDBModule,
  VedaDBService,
  VEDADB_CONFIG,
  VEDADB_CLIENT,
  VEDADB_POOL,
};
