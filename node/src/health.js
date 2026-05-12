/**
 * VedaDB Node.js Driver - Health Checker
 *
 * Periodic health monitoring with configurable checks,
 * status tracking, and liveness/readiness probes.
 */

'use strict';

const { EventEmitter } = require('events');

/**
 * Health status levels.
 */
const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown',
};

/**
 * Health check types.
 */
const CheckType = {
  PING: 'ping',
  QUERY: 'query',
  CUSTOM: 'custom',
};

/**
 * Health checker for VedaDB connections and pools.
 */
class HealthChecker extends EventEmitter {
  /**
   * @param {Object} options
   * @param {number} [options.intervalMs=10000] - Check interval
   * @param {number} [options.timeoutMs=5000] - Per-check timeout
   * @param {number} [options.unhealthyThreshold=3] - Failures before unhealthy
   * @param {number} [options.healthyThreshold=2] - Successes to recover
   */
  constructor(options = {}) {
    super();
    this.intervalMs = options.intervalMs || 10000;
    this.timeoutMs = options.timeoutMs || 5000;
    this.unhealthyThreshold = options.unhealthyThreshold || 3;
    this.healthyThreshold = options.healthyThreshold || 2;

    this._checks = new Map();   // name -> { fn, type, weight }
    this._results = new Map();  // name -> { status, lastRun, error, consecutive }
    this._overall = HealthStatus.UNKNOWN;
    this._timer = null;
    this._running = false;
  }

  /** Overall health status. */
  get status() {
    return this._overall;
  }

  /** Detailed check results. */
  get results() {
    const out = {};
    this._results.forEach((val, key) => {
      out[key] = { ...val };
    });
    return out;
  }

  /** Summary stats. */
  get stats() {
    const results = Array.from(this._results.values());
    return {
      status: this._overall,
      total: this._checks.size,
      healthy: results.filter(r => r.status === HealthStatus.HEALTHY).length,
      degraded: results.filter(r => r.status === HealthStatus.DEGRADED).length,
      unhealthy: results.filter(r => r.status === HealthStatus.UNHEALTHY).length,
      checks: this.results,
    };
  }

  /**
   * Register a health check.
   *
   * @param {string} name - Check name
   * @param {function(): Promise<boolean>} fn - Check function
   * @param {Object} [options]
   * @param {string} [options.type='custom']
   * @param {number} [options.weight=1] - Importance weight (1-10)
   */
  addCheck(name, fn, options = {}) {
    this._checks.set(name, {
      fn,
      type: options.type || CheckType.CUSTOM,
      weight: options.weight || 1,
    });
    this._results.set(name, {
      status: HealthStatus.UNKNOWN,
      lastRun: null,
      error: null,
      consecutive: 0,
    });
  }

  /**
   * Remove a health check.
   * @param {string} name
   */
  removeCheck(name) {
    this._checks.delete(name);
    this._results.delete(name);
  }

  /**
   * Run all checks once.
   * @returns {Promise<Object>} Stats
   */
  async check() {
    const promises = [];
    for (const [name, check] of this._checks) {
      promises.push(this._runCheck(name, check));
    }
    await Promise.all(promises);
    this._updateOverall();
    return this.stats;
  }

  /**
   * Start periodic health checks.
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._tick();
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    this.emit('start');
  }

  /**
   * Stop periodic health checks.
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.emit('stop');
  }

  /** Destroy the health checker. */
  destroy() {
    this.stop();
    this.removeAllListeners();
  }

  /** @private */
  async _tick() {
    const previous = this._overall;
    await this.check();
    if (this._overall !== previous) {
      this.emit('statusChange', { from: previous, to: this._overall, stats: this.stats });
    }
    this.emit('check', this.stats);
  }

  /** @private */
  async _runCheck(name, check) {
    const result = this._results.get(name);
    const start = Date.now();

    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.timeoutMs);
      });
      await Promise.race([check.fn(), timeoutPromise]);

      result.lastRun = Date.now();
      result.error = null;

      if (result.status !== HealthStatus.HEALTHY) {
        result.consecutive = (result.consecutive || 0) + 1;
        if (result.consecutive >= this.healthyThreshold) {
          result.status = HealthStatus.HEALTHY;
          result.consecutive = 0;
        }
      }
    } catch (err) {
      result.lastRun = Date.now();
      result.error = err.message;
      result.consecutive = (result.consecutive || 0) + 1;

      if (result.consecutive >= this.unhealthyThreshold) {
        result.status = HealthStatus.UNHEALTHY;
      } else if (result.consecutive >= Math.ceil(this.unhealthyThreshold / 2)) {
        result.status = HealthStatus.DEGRADED;
      }
    }

    this.emit('checkResult', { name, result: { ...result }, duration: Date.now() - start });
  }

  /** @private */
  _updateOverall() {
    const results = Array.from(this._results.values());
    if (results.length === 0) {
      this._overall = HealthStatus.UNKNOWN;
      return;
    }
    if (results.some(r => r.status === HealthStatus.UNHEALTHY)) {
      this._overall = HealthStatus.UNHEALTHY;
    } else if (results.some(r => r.status === HealthStatus.DEGRADED)) {
      this._overall = HealthStatus.DEGRADED;
    } else {
      this._overall = HealthStatus.HEALTHY;
    }
  }
}

module.exports = {
  HealthChecker,
  HealthStatus,
  CheckType,
};
