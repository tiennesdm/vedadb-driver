/**
 * VedaDB Node.js Driver - Prometheus Metrics
 *
 * Metrics collection and Prometheus-compatible exposition format.
 * Tracks queries, connections, pool stats, errors, and latencies.
 */

'use strict';

const { EventEmitter } = require('events');

/**
 * Supported metric types.
 */
const MetricType = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
  SUMMARY: 'summary',
};

/**
 * Metrics registry for VedaDB driver.
 */
class MetricsRegistry extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} [options.prefix='vedadb'] - Metric name prefix
   * @param {string[]} [options.defaultLabels=[]] - Default label pairs ['key:value']
   */
  constructor(options = {}) {
    super();
    this.prefix = options.prefix || 'vedadb';
    this.defaultLabels = options.defaultLabels || [];
    this._metrics = new Map();
    this._histogramBuckets = options.histogramBuckets ||
      [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  }

  // -- Metric Registration --------------------------------------------------

  /**
   * Create or get a counter metric.
   * @param {string} name - Metric name (without prefix)
   * @param {string} help - Help text
   * @param {string[]} [labelNames] - Label names
   * @returns {Counter}
   */
  counter(name, help, labelNames) {
    const key = `${this.prefix}_${name}`;
    if (!this._metrics.has(key)) {
      this._metrics.set(key, new Counter(key, help, labelNames, this.defaultLabels));
    }
    return this._metrics.get(key);
  }

  /**
   * Create or get a gauge metric.
   * @param {string} name
   * @param {string} help
   * @param {string[]} [labelNames]
   * @returns {Gauge}
   */
  gauge(name, help, labelNames) {
    const key = `${this.prefix}_${name}`;
    if (!this._metrics.has(key)) {
      this._metrics.set(key, new Gauge(key, help, labelNames, this.defaultLabels));
    }
    return this._metrics.get(key);
  }

  /**
   * Create or get a histogram metric.
   * @param {string} name
   * @param {string} help
   * @param {string[]} [labelNames]
   * @param {number[]} [buckets]
   * @returns {Histogram}
   */
  histogram(name, help, labelNames, buckets) {
    const key = `${this.prefix}_${name}`;
    if (!this._metrics.has(key)) {
      this._metrics.set(key, new Histogram(key, help, labelNames, this.defaultLabels,
        buckets || this._histogramBuckets));
    }
    return this._metrics.get(key);
  }

  // -- Convenience Methods --------------------------------------------------

  /**
   * Increment a counter.
   * @param {string} name
   * @param {number} [value=1]
   * @param {Object} [labels]
   */
  inc(name, value = 1, labels) {
    const metric = this._metrics.get(`${this.prefix}_${name}`);
    if (metric && metric instanceof Counter) {
      metric.inc(value, labels);
    }
  }

  /**
   * Set a gauge.
   * @param {string} name
   * @param {number} value
   * @param {Object} [labels]
   */
  set(name, value, labels) {
    const metric = this._metrics.get(`${this.prefix}_${name}`);
    if (metric && metric instanceof Gauge) {
      metric.set(value, labels);
    }
  }

  /**
   * Observe a histogram value.
   * @param {string} name
   * @param {number} value - Duration in seconds
   * @param {Object} [labels]
   */
  observe(name, value, labels) {
    const metric = this._metrics.get(`${this.prefix}_${name}`);
    if (metric && metric instanceof Histogram) {
      metric.observe(value, labels);
    }
  }

  /**
   * Time an async operation and record its duration.
   * @param {string} name - Histogram name
   * @param {function(): Promise<T>} fn - Operation to time
   * @param {Object} [labels]
   * @returns {Promise<T>}
   * @template T
   */
  async time(name, fn, labels) {
    const start = process.hrtime.bigint();
    try {
      const result = await fn();
      const duration = Number(process.hrtime.bigint() - start) / 1e9;
      this.observe(name, duration, { ...labels, status: 'success' });
      return result;
    } catch (err) {
      const duration = Number(process.hrtime.bigint() - start) / 1e9;
      this.observe(name, duration, { ...labels, status: 'error' });
      throw err;
    }
  }

  // -- Exposition -----------------------------------------------------------

  /**
   * Export all metrics in Prometheus text format.
   * @returns {string}
   */
  expose() {
    const lines = [];
    for (const metric of this._metrics.values()) {
      lines.push(...metric.expose());
      lines.push('');
    }
    return lines.join('\n');
  }

  /** Clear all metrics. */
  clear() {
    this._metrics.clear();
  }

  /** Get all metric names. */
  get names() {
    return Array.from(this._metrics.keys());
  }
}

// -- Metric Classes ---------------------------------------------------------

class Counter {
  constructor(name, help, labelNames, defaultLabels) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames || [];
    this.defaultLabels = defaultLabels || [];
    this._values = new Map(); // serializedLabels -> value
    this._values.set('', 0);
  }

  inc(value = 1, labels) {
    const key = this._serializeLabels(labels);
    const current = this._values.get(key) || 0;
    this._values.set(key, current + value);
  }

  expose() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this._values) {
      const labelStr = key ? `{${key}}` : '';
      lines.push(`${this.name}${labelStr} ${value}`);
    }
    return lines;
  }

  _serializeLabels(labels) {
    if (!labels) return '';
    const parts = this.defaultLabels.slice();
    for (const name of this.labelNames) {
      if (labels[name] !== undefined) {
        parts.push(`${name}="${labels[name]}"`);
      }
    }
    return parts.join(',');
  }
}

class Gauge {
  constructor(name, help, labelNames, defaultLabels) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames || [];
    this.defaultLabels = defaultLabels || [];
    this._values = new Map();
    this._values.set('', 0);
  }

  set(value, labels) {
    const key = this._serializeLabels(labels);
    this._values.set(key, value);
  }

  inc(value = 1, labels) {
    const key = this._serializeLabels(labels);
    const current = this._values.get(key) || 0;
    this._values.set(key, current + value);
  }

  dec(value = 1, labels) {
    this.inc(-value, labels);
  }

  expose() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this._values) {
      const labelStr = key ? `{${key}}` : '';
      lines.push(`${this.name}${labelStr} ${value}`);
    }
    return lines;
  }

  _serializeLabels(labels) {
    if (!labels) return '';
    const parts = this.defaultLabels.slice();
    for (const name of this.labelNames) {
      if (labels[name] !== undefined) {
        parts.push(`${name}="${labels[name]}"`);
      }
    }
    return parts.join(',');
  }
}

class Histogram {
  constructor(name, help, labelNames, defaultLabels, buckets) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames || [];
    this.defaultLabels = defaultLabels || [];
    this.buckets = buckets;
    this._values = new Map(); // key -> { sum, count, buckets }
    this._initKey('');
  }

  observe(value, labels) {
    const key = this._serializeLabels(labels);
    if (!this._values.has(key)) this._initKey(key);
    const entry = this._values.get(key);
    entry.sum += value;
    entry.count++;
    for (const bucket of this.buckets) {
      if (value <= bucket) {
        entry.buckets[bucket] = (entry.buckets[bucket] || 0) + 1;
      }
    }
    // +Inf bucket
    entry.buckets['+Inf'] = (entry.buckets['+Inf'] || 0) + 1;
  }

  _initKey(key) {
    const buckets = {};
    for (const b of this.buckets) buckets[b] = 0;
    buckets['+Inf'] = 0;
    this._values.set(key, { sum: 0, count: 0, buckets });
  }

  expose() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, entry] of this._values) {
      const labelStr = key ? `{${key},` : '{';
      const baseLabel = key ? `,` : '';
      for (const bucket of [...this.buckets, '+Inf']) {
        const bLabel = key ? `{${key},le="${bucket}"}` : `{le="${bucket}"}`;
        lines.push(`${this.name}_bucket${bLabel} ${entry.buckets[bucket] || 0}`);
      }
      const sumLabel = key ? `{${key}}` : '';
      lines.push(`${this.name}_sum${sumLabel} ${entry.sum}`);
      lines.push(`${this.name}_count${sumLabel} ${entry.count}`);
    }
    return lines;
  }

  _serializeLabels(labels) {
    if (!labels) return '';
    const parts = this.defaultLabels.slice();
    for (const name of this.labelNames) {
      if (labels[name] !== undefined) {
        parts.push(`${name}="${labels[name]}"`);
      }
    }
    return parts.join(',');
  }
}

module.exports = {
  MetricsRegistry,
  MetricType,
  Counter,
  Gauge,
  Histogram,
};
