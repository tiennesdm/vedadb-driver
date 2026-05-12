/**
 * VedaDB Node.js Driver - TLS/SSL Support
 *
 * Handles TLS socket upgrades and secure connection management.
 * Supports STARTTLS upgrade and direct TLS connection.
 */

'use strict';

const tls = require('tls');
const net = require('net');
const { TLSError, ConnectionError } = require('./errors');

/**
 * Default TLS options.
 */
const DEFAULT_TLS_OPTIONS = {
  rejectUnauthorized: true,
  minVersion: 'TLSv1.2',
};

/**
 * Upgrade an existing TCP socket to TLS using STARTTLS.
 *
 * @param {net.Socket} socket - Existing TCP socket
 * @param {Object} options - TLS options
 * @param {string} options.host - Server hostname for SNI
 * @param {string} [options.ca] - CA certificate
 * @param {string} [options.cert] - Client certificate
 * @param {string} [options.key] - Client private key
 * @param {boolean} [options.rejectUnauthorized=true] - Reject unauthorized certs
 * @returns {Promise<tls.TLSSocket>}
 */
function upgradeToTLS(socket, options) {
  return new Promise((resolve, reject) => {
    const tlsOpts = {
      ...DEFAULT_TLS_OPTIONS,
      ...options,
      socket: socket,
      servername: options.host || 'localhost',
    };

    const tlsSocket = tls.connect(tlsOpts, () => {
      if (!tlsSocket.authorized && tlsOpts.rejectUnauthorized !== false) {
        tlsSocket.end();
        return reject(new TLSError(
          `TLS certificate verification failed: ${tlsSocket.authorizationError}`,
          { authorizationError: tlsSocket.authorizationError }
        ));
      }
      resolve(tlsSocket);
    });

    tlsSocket.on('error', (err) => {
      reject(new TLSError(`TLS upgrade failed: ${err.message}`, { code: err.code }));
    });

    tlsSocket.setTimeout(options.timeout || 30000);
  });
}

/**
 * Create a direct TLS connection to a VedaDB server.
 *
 * @param {Object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {string} [options.ca]
 * @param {string} [options.cert]
 * @param {string} [options.key]
 * @param {boolean} [options.rejectUnauthorized=true]
 * @param {number} [options.timeout=30000]
 * @returns {Promise<tls.TLSSocket>}
 */
function createTLSConnection(options) {
  return new Promise((resolve, reject) => {
    const tlsOpts = {
      ...DEFAULT_TLS_OPTIONS,
      ...options,
      host: options.host,
      port: options.port,
      servername: options.host,
    };

    const socket = tls.connect(tlsOpts, () => {
      if (!socket.authorized && tlsOpts.rejectUnauthorized !== false) {
        socket.end();
        return reject(new TLSError(
          `TLS certificate verification failed: ${socket.authorizationError}`,
          { authorizationError: socket.authorizationError }
        ));
      }
      resolve(socket);
    });

    socket.on('error', (err) => {
      reject(new TLSError(`TLS connection failed: ${err.message}`, { code: err.code }));
    });

    socket.setTimeout(options.timeout || 30000, () => {
      socket.destroy();
      reject(new ConnectionError('TLS connection timeout'));
    });
  });
}

/**
 * Check if a socket is a TLS socket.
 *
 * @param {net.Socket|tls.TLSSocket} socket
 * @returns {boolean}
 */
function isTLSSocket(socket) {
  return socket instanceof tls.TLSSocket;
}

/**
 * Get TLS connection info from a TLS socket.
 *
 * @param {tls.TLSSocket} socket
 * @returns {Object|null}
 */
function getTLSInfo(socket) {
  if (!isTLSSocket(socket)) return null;
  return {
    protocol: socket.getProtocol(),
    cipher: socket.getCipher(),
    certificate: socket.getCertificate(),
    peerCertificate: socket.getPeerCertificate(),
    authorized: socket.authorized,
    authorizationError: socket.authorizationError,
  };
}

module.exports = {
  upgradeToTLS,
  createTLSConnection,
  isTLSSocket,
  getTLSInfo,
  DEFAULT_TLS_OPTIONS,
};
