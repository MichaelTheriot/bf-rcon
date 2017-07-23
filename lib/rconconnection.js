'use strict';

const net = require('net');
const crypto = require('crypto');
const Task = require('promise-task');
const RCONError = require('./rconerror');

const store = new WeakMap();

const drgxp = /^### Digest seed: (.{16})\n\n$/;
const term = '\n\x04';

const handlers = {

  onConnect() {
    this.on('data', handlers.onDataDigest);
  },

  onDataDigest(data) {
    const matches = data.match(drgxp);

    if (matches) {
      this.removeListener('data', handlers.onDataDigest);

      const seed = matches[1];
      const hash = crypto.createHash('md5').update(seed + store.get(this).password).digest('hex');
      this.write(`\x02login ${hash}\n`);
      this.on('data', handlers.onDataAuth);
    }
  },

  onDataAuth(data) {
    const s = store.get(this);

    if (!data.endsWith(term)) {
      return s.buffer += data;
    }

    const msg = s.buffer + data.substring(0, data.length - term.length);
    s.buffer = '';

    if (!msg.startsWith('Authentication success')) {
      this.destroy(new RCONError(`Expected "Authentication success" from ${this.remoteAddress}:${this.remotePort} but received "${msg}"\n`, RCONError.ERR_AUTHENTICATION_FAILED));
    } else {
      s.authenticated = true;
      this.removeListener('data', handlers.onDataAuth);
      this.emit('authenticated', msg);
    }
  },

  onDataCommand(data) {
    if (this.authenticated) {
      const s = store.get(this);

      if (!s.queue.length) {
        return this.destroy(new RCONError(`Unrequested data received from server: ${data}`, RCONError.ERR_UNKNOWN));
      }

      if (!data.endsWith(term)) {
        return s.buffer += data;
      }

      const task = s.queue.shift();
      const msg = s.buffer + data.substring(0, data.length - term.length);
      s.buffer = '';

      task.resolve(msg);
    }
  },

  onClose() {
    const s = store.get(this);
    s.authenticated = false;
    s.password = null;
    s.buffer = '';

    if (s.queue.length) {
      const err = new RCONError('Connection closed before response', RCONError.ERR_CLOSED);
      s.queue.forEach(t => t.reject(err));
      s.queue.length = 0;
    }

    this.removeListener('data', handlers.onDataDigest);
    this.removeListener('data', handlers.onDataAuth);
  }

};

const RCONConnection = class extends net.Socket {
  constructor() {
    super();
    store.set(this, {
      authenticated: false,
      password: null,
      queue: [],
      buffer: ''
    });
    this.setEncoding('utf8');
    this.on('connect', handlers.onConnect);
    this.on('close', handlers.onClose);
    this.on('data', handlers.onDataCommand);
  }

  get authenticated() {
    return !this.connecting && !this.destroyed && store.get(this).authenticated;
  }

  connect(host, port, password) {
    store.get(this).password = password;
    return super.connect({host, port});
  }

  async send(data) {
    if (!this.authenticated) {
      this.destroy();
      throw new RCONError('Not yet connected and authenticated', RCONError.ERR_NOT_READY);
    }

    this.write(`\x02${data}\n`);

    const task = new Task();
    store.get(this).queue.push(task);

    try {
      const msg = await task;
      return msg;
    } catch (err) {
      this.destroy();
      throw err;
    }
  }
};

module.exports = RCONConnection;
