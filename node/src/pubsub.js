/**
 * VedaDB Node.js Driver - Pub/Sub Messaging
 *
 * Publish/subscribe messaging over VedaDB connections.
 * Supports channel subscription, pattern matching, and message handlers.
 */

'use strict';

const { EventEmitter } = require('events');
const { ConnectionError } = require('./errors');

/**
 * Message received from a subscribed channel.
 */
class Message {
  /**
   * @param {string} channel
   * @param {string} payload
   * @param {string|null} [pattern] - Matched pattern (for pattern subscriptions)
   */
  constructor(channel, payload, pattern = null) {
    this.channel = channel;
    this.payload = payload;
    this.pattern = pattern;
    this.timestamp = Date.now();
  }
}

/**
 * Pub/Sub client for VedaDB messaging.
 */
class PubSub extends EventEmitter {
  /**
   * @param {Object} client - VedaDB client (uses its socket for subscriptions)
   * @param {Object} [options]
   * @param {boolean} [options.autoReconnect=true] - Reconnect on disconnect
   * @param {number} [options.reconnectDelayMs=5000] - Delay between reconnects
   */
  constructor(client, options = {}) {
    super();
    this._client = client;
    this._options = options;
    this._autoReconnect = options.autoReconnect !== false;
    this._reconnectDelayMs = options.reconnectDelayMs || 5000;
    this._subscriptions = new Map(); // channel -> { handler, isPattern }
    this._connected = false;
    this._reconnectTimer = null;
    this._messageHandler = null;
  }

  /** Currently subscribed channels. */
  get channels() {
    return Array.from(this._subscriptions.keys());
  }

  /** Number of active subscriptions. */
  get subscriptionCount() {
    return this._subscriptions.size;
  }

  /** Whether connected. */
  get connected() {
    return this._connected;
  }

  /**
   * Subscribe to a channel.
   *
   * @param {string} channel - Channel name
   * @param {function(Message):void} [handler] - Message handler
   * @returns {Promise<void>}
   */
  async subscribe(channel, handler) {
    if (!this._client.connected) {
      throw new ConnectionError('Client not connected');
    }

    await this._client.query(`SUBSCRIBE ${channel}`);
    this._subscriptions.set(channel, { handler, isPattern: false });
    this._connected = true;

    this._startListening();
    this.emit('subscribe', { channel });
  }

  /**
   * Subscribe to channels matching a pattern.
   *
   * @param {string} pattern - Pattern (e.g., 'events.*')
   * @param {function(Message):void} [handler]
   * @returns {Promise<void>}
   */
  async psubscribe(pattern, handler) {
    if (!this._client.connected) {
      throw new ConnectionError('Client not connected');
    }

    await this._client.query(`PSUBSCRIBE ${pattern}`);
    this._subscriptions.set(pattern, { handler, isPattern: true });
    this._connected = true;

    this._startListening();
    this.emit('psubscribe', { pattern });
  }

  /**
   * Unsubscribe from a channel.
   * @param {string} channel
   * @returns {Promise<void>}
   */
  async unsubscribe(channel) {
    this._subscriptions.delete(channel);
    if (this._client.connected) {
      await this._client.query(`UNSUBSCRIBE ${channel}`);
    }
    this.emit('unsubscribe', { channel });
  }

  /**
   * Unsubscribe from all channels.
   * @returns {Promise<void>}
   */
  async unsubscribeAll() {
    const channels = Array.from(this._subscriptions.keys());
    this._subscriptions.clear();
    for (const channel of channels) {
      if (this._client.connected) {
        await this._client.query(`UNSUBSCRIBE ${channel}`).catch(() => {});
      }
    }
    this.emit('unsubscribeAll', { count: channels.length });
  }

  /**
   * Publish a message to a channel.
   *
   * @param {string} channel
   * @param {string|Object} message
   * @returns {Promise<number>} Number of subscribers that received the message
   */
  async publish(channel, message) {
    if (!this._client.connected) {
      throw new ConnectionError('Client not connected');
    }

    const payload = typeof message === 'object' ? JSON.stringify(message) : String(message);
    const result = await this._client.query(`PUBLISH ${channel} '${payload.replace(/'/g, "''")}'`);
    return result.rowCount || 0;
  }

  /**
   * List all active channels.
   * @returns {Promise<string[]>}
   */
  async listChannels() {
    const result = await this._client.query('PUBSUB CHANNELS');
    return result.rows?.map(r => r[0]) || [];
  }

  /**
   * Get subscriber count for a channel.
   * @param {string} channel
   * @returns {Promise<number>}
   */
  async numSub(channel) {
    const result = await this._client.query(`PUBSUB NUMSUB ${channel}`);
    return parseInt(result.rows?.[0]?.[0] || '0', 10);
  }

  /** Close all subscriptions. */
  async close() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    await this.unsubscribeAll();
    this._connected = false;
    this.removeAllListeners();
  }

  // -- internal -------------------------------------------------------------

  _startListening() {
    // Hook into the client's protocol to intercept pub/sub messages
    if (this._client._protocol) {
      this._client._protocol.on('event', (event) => {
        this._handleMessage(event);
      });
    }
  }

  _handleMessage(event) {
    const { channel, payload, pattern } = event;
    const msg = new Message(channel, payload, pattern);

    // Match direct subscriptions
    const sub = this._subscriptions.get(channel);
    if (sub && sub.handler) {
      sub.handler(msg);
    }

    // Match pattern subscriptions
    for (const [pat, info] of this._subscriptions) {
      if (info.isPattern && this._matchPattern(channel, pat)) {
        if (info.handler) info.handler(msg);
      }
    }

    this.emit('message', msg);
  }

  _matchPattern(channel, pattern) {
    // Simple glob matching: * matches any sequence, ? matches one char
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return regex.test(channel);
  }
}

module.exports = { PubSub, Message };
