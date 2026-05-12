/**
 * VedaDB Node.js Driver - Multi-Node Failover
 *
 * Automatic failover across multiple VedaDB nodes with configurable
 * strategies: ordered, priority, and dynamic (health-based).
 */

'use strict';

const { EventEmitter } = require('events');
const { FailoverError, ConnectionError, TimeoutError } = require('./errors');

/**
 * Failover strategies.
 */
const FailoverStrategy = {
  ORDERED: 'ordered',       // Try nodes in order
  PRIORITY: 'priority',     // Priority-based with weights
  DYNAMIC: 'dynamic',       // Health-based selection
};

/**
 * Represents a failover node.
 */
class FailoverNode {
  /**
   * @param {Object} config
   * @param {string} config.host
   * @param {number} config.port
   * @param {number} [config.priority=1] - Priority (lower = higher priority)
   * @param {Object} [config.options] - Additional connection options
   */
  constructor(config) {
    this.host = config.host;
    this.port = config.port || 6380;
    this.priority = config.priority || 1;
    this.options = config.options || {};
    this.healthy = true;
    this.failCount = 0;
    this.lastFailure = null;
    this.connectionCount = 0;
  }

  get id() {
    return `${this.host}:${this.port}`;
  }
}

/**
 * Multi-node failover manager for VedaDB.
 */
class FailoverManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {FailoverStrategy} [options.strategy='ordered']
   * @param {number} [options.retryIntervalMs=5000] - Time before retrying a failed node
   * @param {number} [options.maxFailCount=3] - Max failures before marking unhealthy
   * @param {boolean} [options.autoReconnect=true] - Auto-reconnect to primary
   */
  constructor(options = {}) {
    super();
    this.strategy = options.strategy || FailoverStrategy.ORDERED;
    this.retryIntervalMs = options.retryIntervalMs || 5000;
    this.maxFailCount = options.maxFailCount || 3;
    this.autoReconnect = options.autoReconnect !== false;
    this._nodes = [];
    this._currentIndex = 0;
    this._primary = null; // Preferred primary node
  }

  /** Number of registered nodes. */
  get nodeCount() {
    return this._nodes.length;
  }

  /** Number of healthy nodes. */
  get healthyCount() {
    return this._nodes.filter(n => n.healthy).length;
  }

  /** Currently selected node. */
  get current() {
    return this._nodes[this._currentIndex] || null;
  }

  /** Stats snapshot. */
  get stats() {
    return {
      strategy: this.strategy,
      totalNodes: this._nodes.length,
      healthyNodes: this.healthyCount,
      currentNode: this.current?.id || null,
      nodes: this._nodes.map(n => ({
        id: n.id,
        host: n.host,
        port: n.port,
        priority: n.priority,
        healthy: n.healthy,
        failCount: n.failCount,
        connectionCount: n.connectionCount,
      })),
    };
  }

  /**
   * Register a failover node.
   * @param {Object} config
   */
  addNode(config) {
    const node = new FailoverNode(config);
    this._nodes.push(node);
    if (this._nodes.length === 1 || config.isPrimary) {
      this._primary = node;
    }
    this.emit('node:add', { id: node.id, host: node.host, port: node.port });
    return node;
  }

  /**
   * Register multiple nodes at once.
   * @param {Object[]} configs
   */
  addNodes(configs) {
    for (const config of configs) {
      this.addNode(config);
    }
  }

  /**
   * Remove a node by ID.
   * @param {string} id
   */
  removeNode(id) {
    const idx = this._nodes.findIndex(n => n.id === id);
    if (idx !== -1) {
      const node = this._nodes.splice(idx, 1)[0];
      if (this._primary === node) this._primary = this._nodes[0] || null;
      this.emit('node:remove', { id: node.id });
    }
  }

  /**
   * Select the best node for connection.
   * @returns {FailoverNode}
   * @throws {FailoverError} If no nodes are available
   */
  selectNode() {
    if (this._nodes.length === 0) {
      throw new FailoverError('No failover nodes configured');
    }

    let candidates;
    switch (this.strategy) {
      case FailoverStrategy.PRIORITY:
        candidates = this._byPriority();
        break;
      case FailoverStrategy.DYNAMIC:
        candidates = this._byHealth();
        break;
      case FailoverStrategy.ORDERED:
      default:
        candidates = this._byOrder();
        break;
    }

    const healthy = candidates.filter(n => n.healthy);
    if (healthy.length === 0) {
      // Try to revive nodes that have been down for retryIntervalMs
      const now = Date.now();
      for (const node of candidates) {
        if (node.lastFailure && (now - node.lastFailure) > this.retryIntervalMs) {
          node.healthy = true;
          node.failCount = 0;
        }
      }
      const revived = candidates.filter(n => n.healthy);
      if (revived.length === 0) {
        throw new FailoverError('All failover nodes are unavailable', this.stats);
      }
      return revived[0];
    }

    return healthy[0];
  }

  /**
   * Execute a function with automatic failover.
   * Tries each healthy node until one succeeds.
   *
   * @template T
   * @param {function(FailoverNode): Promise<T>} fn - Function to execute
   * @returns {Promise<T>}
   */
  async execute(fn) {
    const errors = [];
    const tried = new Set();

    // Try healthy nodes first
    const nodes = this._getNodeOrder();
    for (const node of nodes) {
      if (tried.has(node.id)) continue;
      tried.add(node.id);

      try {
        const result = await fn(node);
        this._onSuccess(node);
        return result;
      } catch (err) {
        this._onFailure(node, err);
        errors.push({ node: node.id, error: err.message });
      }
    }

    throw new FailoverError(
      `All ${tried.size} failover nodes failed. Last error: ${errors[errors.length - 1]?.error}`,
      { errors }
    );
  }

  /**
   * Mark a node as healthy.
   * @param {string} id
   */
  markHealthy(id) {
    const node = this._nodes.find(n => n.id === id);
    if (node) {
      node.healthy = true;
      node.failCount = 0;
      this.emit('node:healthy', { id: node.id });
    }
  }

  /**
   * Mark a node as unhealthy.
   * @param {string} id
   */
  markUnhealthy(id) {
    const node = this._nodes.find(n => n.id === id);
    if (node) {
      node.healthy = false;
      node.lastFailure = Date.now();
      this.emit('node:unhealthy', { id: node.id, failCount: node.failCount });
    }
  }

  /** Destroy the failover manager. */
  destroy() {
    this._nodes = [];
    this.removeAllListeners();
  }

  // -- internal -------------------------------------------------------------

  _getNodeOrder() {
    switch (this.strategy) {
      case FailoverStrategy.PRIORITY:
        return this._byPriority();
      case FailoverStrategy.DYNAMIC:
        return this._byHealth();
      default:
        return [...this._nodes];
    }
  }

  _byPriority() {
    return [...this._nodes].sort((a, b) => a.priority - b.priority);
  }

  _byHealth() {
    return [...this._nodes].sort((a, b) => {
      if (a.healthy && !b.healthy) return -1;
      if (!a.healthy && b.healthy) return 1;
      return a.failCount - b.failCount;
    });
  }

  _byOrder() {
    return [...this._nodes];
  }

  _onSuccess(node) {
    if (node.failCount > 0) {
      node.failCount = 0;
      node.healthy = true;
    }
    node.connectionCount++;
  }

  _onFailure(node, err) {
    node.failCount++;
    node.lastFailure = Date.now();
    if (node.failCount >= this.maxFailCount) {
      node.healthy = false;
    }
  }
}

module.exports = {
  FailoverManager,
  FailoverNode,
  FailoverStrategy,
};
