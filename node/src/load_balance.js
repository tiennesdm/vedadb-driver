/**
 * VedaDB Node.js Driver - Load Balancer
 *
 * Distributes connections across multiple VedaDB nodes using
 * configurable strategies: round-robin, least-connections, random,
 * and weighted round-robin.
 */

'use strict';

const { EventEmitter } = require('events');
const { ValidationError, ConnectionError } = require('./errors');

/**
 * Load balancing strategies.
 */
const Strategy = {
  ROUND_ROBIN: 'round_robin',
  LEAST_CONNECTIONS: 'least_connections',
  RANDOM: 'random',
  WEIGHTED_ROUND_ROBIN: 'weighted_round_robin',
  FIRST_AVAILABLE: 'first_available',
};

/**
 * Represents a backend node.
 */
class Backend {
  /**
   * @param {Object} config
   * @param {string} config.host
   * @param {number} config.port
   * @param {number} [config.weight=1] - For weighted strategies
   * @param {Object} [config.options] - Additional client options
   */
  constructor(config) {
    this.host = config.host;
    this.port = config.port || 6380;
    this.weight = config.weight || 1;
    this.options = config.options || {};
    this.connections = 0;
    this.healthy = true;
    this.lastCheck = null;
  }

  /** Unique identifier for this backend. */
  get id() {
    return `${this.host}:${this.port}`;
  }
}

/**
 * Load balancer for distributing across VedaDB nodes.
 */
class LoadBalancer extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} [options.strategy='round_robin']
   * @param {number} [options.healthCheckIntervalMs=30000]
   * @param {number} [options.maxConnectionsPerBackend=50]
   */
  constructor(options = {}) {
    super();
    this.strategy = options.strategy || Strategy.ROUND_ROBIN;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs || 30000;
    this.maxConnectionsPerBackend = options.maxConnectionsPerBackend || 50;
    this._backends = [];
    this._rrIndex = 0;
    this._wrrIndex = 0;
    this._wrrCurrentWeight = 0;
    this._healthTimer = null;
  }

  /** Number of registered backends. */
  get backendCount() {
    return this._backends.length;
  }

  /** Number of healthy backends. */
  get healthyCount() {
    return this._backends.filter(b => b.healthy).length;
  }

  /** Stats snapshot. */
  get stats() {
    return {
      strategy: this.strategy,
      totalBackends: this._backends.length,
      healthyBackends: this.healthyCount,
      backends: this._backends.map(b => ({
        id: b.id,
        host: b.host,
        port: b.port,
        weight: b.weight,
        connections: b.connections,
        healthy: b.healthy,
      })),
    };
  }

  /**
   * Register a backend node.
   * @param {Object} config
   */
  addBackend(config) {
    const backend = new Backend(config);
    this._backends.push(backend);
    this.emit('backend:add', { id: backend.id, host: backend.host, port: backend.port });
    return backend;
  }

  /**
   * Remove a backend by ID.
   * @param {string} id - host:port
   */
  removeBackend(id) {
    const idx = this._backends.findIndex(b => b.id === id);
    if (idx !== -1) {
      const backend = this._backends.splice(idx, 1)[0];
      this.emit('backend:remove', { id: backend.id });
    }
  }

  /**
   * Select the next backend according to the strategy.
   * @returns {Backend|null}
   * @throws {ConnectionError} If no healthy backends available
   */
  select() {
    const healthy = this._backends.filter(b => b.healthy);
    if (healthy.length === 0) {
      throw new ConnectionError('No healthy backends available');
    }

    switch (this.strategy) {
      case Strategy.ROUND_ROBIN:
        return this._roundRobin(healthy);
      case Strategy.LEAST_CONNECTIONS:
        return this._leastConnections(healthy);
      case Strategy.RANDOM:
        return this._random(healthy);
      case Strategy.WEIGHTED_ROUND_ROBIN:
        return this._weightedRoundRobin(this._backends);
      case Strategy.FIRST_AVAILABLE:
        return healthy[0] || null;
      default:
        return this._roundRobin(healthy);
    }
  }

  /**
   * Mark a backend as having a new connection.
   * @param {Backend} backend
   */
  acquire(backend) {
    backend.connections++;
  }

  /**
   * Mark a backend as having released a connection.
   * @param {Backend} backend
   */
  release(backend) {
    if (backend.connections > 0) backend.connections--;
  }

  /**
   * Mark a backend's health status.
   * @param {string} id
   * @param {boolean} healthy
   */
  setHealth(id, healthy) {
    const backend = this._backends.find(b => b.id === id);
    if (backend && backend.healthy !== healthy) {
      backend.healthy = healthy;
      backend.lastCheck = Date.now();
      this.emit('healthChange', { id, healthy, backend });
    }
  }

  /**
   * Start periodic health checks.
   * @param {function(Backend): Promise<boolean>} checkFn
   */
  startHealthChecks(checkFn) {
    if (this._healthTimer) return;
    this._healthTimer = setInterval(async () => {
      for (const backend of this._backends) {
        try {
          const healthy = await checkFn(backend);
          this.setHealth(backend.id, healthy);
        } catch {
          this.setHealth(backend.id, false);
        }
      }
    }, this.healthCheckIntervalMs);
  }

  /** Stop health checks. */
  stopHealthChecks() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }

  /** Clean up. */
  destroy() {
    this.stopHealthChecks();
    this._backends = [];
    this.removeAllListeners();
  }

  // -- Strategy implementations ---------------------------------------------

  _roundRobin(healthy) {
    const selected = healthy[this._rrIndex % healthy.length];
    this._rrIndex = (this._rrIndex + 1) % healthy.length;
    return selected;
  }

  _leastConnections(healthy) {
    return healthy.reduce((best, current) =>
      current.connections < best.connections ? current : best
    );
  }

  _random(healthy) {
    return healthy[Math.floor(Math.random() * healthy.length)];
  }

  _weightedRoundRobin(backends) {
    const healthy = backends.filter(b => b.healthy);
    if (healthy.length === 0) return null;

    let maxWeight = 0;
    let best = null;

    for (const backend of healthy) {
      if (backend.weight > maxWeight) {
        maxWeight = backend.weight;
        best = backend;
      }
    }

    return best || healthy[0];
  }
}

module.exports = {
  LoadBalancer,
  Backend,
  Strategy,
};
