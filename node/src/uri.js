/**
 * VedaDB Node.js Driver - Connection URI Parser
 *
 * Parses VedaDB connection URIs into configuration objects.
 * Supports: vedadb://user:pass@host:port/database?option=value
 * Also supports standard options parsing from environment variables.
 */

'use strict';

const { ValidationError } = require('./errors');

/**
 * Parse a VedaDB connection URI into a configuration object.
 *
 * Format: vedadb://[username[:password]@]host[:port][/database][?param1=val1&...]
 * Also supports: vedadbs:// for TLS-enabled connections.
 *
 * @param {string} uri - Connection URI
 * @returns {Object} Parsed configuration
 * @throws {ValidationError} If URI is malformed
 */
function parseURI(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new ValidationError('URI must be a non-empty string');
  }

  let url;
  try {
    url = new URL(uri);
  } catch (e) {
    throw new ValidationError(`Invalid URI: ${e.message}`);
  }

  const scheme = url.protocol.replace(':', '');
  const isTls = scheme === 'vedadbs' || scheme === 'vedadb+tls' || scheme === 'vedadb+ssl';

  if (!['vedadb', 'vedadbs', 'vedadb+tls', 'vedadb+ssl'].includes(scheme)) {
    throw new ValidationError(`Unsupported protocol: ${scheme}. Expected vedadb:// or vedadbs://`);
  }

  const config = {
    host: url.hostname || 'localhost',
    port: parseInt(url.port, 10) || 6380,
    database: url.pathname ? url.pathname.replace(/^\//, '') : undefined,
    tls: isTls,
  };

  // Authentication
  if (url.username) {
    config.user = decodeURIComponent(url.username);
  }
  if (url.password) {
    config.password = decodeURIComponent(url.password);
  }

  // Query parameters
  url.searchParams.forEach((value, key) => {
    const numValue = Number(value);
    switch (key) {
      case 'timeout':
        config.timeout = numValue;
        break;
      case 'pool_min':
        config.pool = config.pool || {};
        config.pool.min = numValue;
        break;
      case 'pool_max':
        config.pool = config.pool || {};
        config.pool.max = numValue;
        break;
      case 'pool_acquireTimeout':
        config.pool = config.pool || {};
        config.pool.acquireTimeout = numValue;
        break;
      case 'pool_idleTimeout':
        config.pool = config.pool || {};
        config.pool.idleTimeout = numValue;
        break;
      case 'retry_maxAttempts':
        config.retry = config.retry || {};
        config.retry.maxAttempts = numValue;
        break;
      case 'retry_baseDelayMs':
        config.retry = config.retry || {};
        config.retry.baseDelayMs = numValue;
        break;
      case 'ca':
        config.tlsOptions = config.tlsOptions || {};
        config.tlsOptions.ca = value;
        break;
      case 'cert':
        config.tlsOptions = config.tlsOptions || {};
        config.tlsOptions.cert = value;
        break;
      case 'key':
        config.tlsOptions = config.tlsOptions || {};
        config.tlsOptions.key = value;
        break;
      case 'rejectUnauthorized':
        config.tlsOptions = config.tlsOptions || {};
        config.tlsOptions.rejectUnauthorized = value === 'true';
        break;
      default:
        // Pass through unknown params
        config[key] = numValue || value;
    }
  });

  return config;
}

/**
 * Build a connection URI from a configuration object.
 *
 * @param {Object} config
 * @param {string} config.host
 * @param {number} config.port
 * @param {string} [config.user]
 * @param {string} [config.password]
 * @param {string} [config.database]
 * @param {boolean} [config.tls]
 * @returns {string}
 */
function buildURI(config) {
  const scheme = config.tls ? 'vedadbs' : 'vedadb';
  let uri = `${scheme}://`;

  if (config.user) {
    uri += encodeURIComponent(config.user);
    if (config.password) {
      uri += ':' + encodeURIComponent(config.password);
    }
    uri += '@';
  }

  uri += config.host || 'localhost';
  if (config.port && config.port !== 6380) {
    uri += ':' + config.port;
  }

  if (config.database) {
    uri += '/' + config.database;
  }

  return uri;
}

/**
 * Load configuration from environment variables.
 * Looks for VEDADB_URL, then falls back to individual VEDADB_* vars.
 *
 * @returns {Object|null} Configuration object or null if not found
 */
function configFromEnv() {
  if (process.env.VEDADB_URL) {
    return parseURI(process.env.VEDADB_URL);
  }

  const env = process.env;
  if (!env.VEDADB_HOST && !env.VEDADB_PORT) {
    return null;
  }

  const config = {
    host: env.VEDADB_HOST || 'localhost',
    port: parseInt(env.VEDADB_PORT, 10) || 6380,
  };

  if (env.VEDADB_USER) config.user = env.VEDADB_USER;
  if (env.VEDADB_PASSWORD) config.password = env.VEDADB_PASSWORD;
  if (env.VEDADB_DATABASE) config.database = env.VEDADB_DATABASE;
  if (env.VEDADB_TIMEOUT) config.timeout = parseInt(env.VEDADB_TIMEOUT, 10);
  if (env.VEDADB_TLS === 'true') config.tls = true;

  return config;
}

/**
 * Validate a configuration object.
 *
 * @param {Object} config
 * @returns {string[]} Array of validation errors (empty if valid)
 */
function validateConfig(config) {
  const errors = [];

  if (!config.host) errors.push('host is required');
  if (!config.port || config.port < 1 || config.port > 65535) {
    errors.push('port must be between 1 and 65535');
  }
  if (config.timeout != null && config.timeout < 0) {
    errors.push('timeout must be >= 0');
  }
  if (config.pool) {
    if (config.pool.min != null && config.pool.min < 0) {
      errors.push('pool.min must be >= 0');
    }
    if (config.pool.max != null && config.pool.max < 1) {
      errors.push('pool.max must be >= 1');
    }
    if (config.pool.min != null && config.pool.max != null && config.pool.min > config.pool.max) {
      errors.push('pool.min cannot exceed pool.max');
    }
  }

  return errors;
}

module.exports = {
  parseURI,
  buildURI,
  configFromEnv,
  validateConfig,
};
