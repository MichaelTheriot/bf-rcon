'use strict';

const net = require('net');
const crypto = require('crypto');
const Task = require('promise-task');
const RconError = require('./rconerror');

const store = new WeakMap();

const term = '\n\x04';
const drgxp = /^### Digest seed: (.{16})\n\n$/;
const errMap = [
  [/^error: not authenticated:/,                        RconError.ERR_NOT_AUTHENTICATED],
  [/^Restricted:/,                                      RconError.ERR_COMMAND_RESTRICTED],
  [/^Failed to process command/,                        RconError.ERR_COMMAND_FAILED],
  [/^error: you are not authorised to use the command/, RconError.ERR_COMMAND_UNAUTHORIZED],
  [/^rcon: unknown command:/,                           RconError.ERR_COMMAND_UNKNOWN]
];
const ergxp = new RegExp('(?:' + errMap.map(pair => `(${pair[0].source})`).join('|') + ')');
const testCommand = (message) => {
  const matches = message.match(ergxp);
  return matches ? errMap[matches.findIndex((e, i) => i > 0 && e) - 1][1] : -1;
};

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

    this.removeListener('data', handlers.onDataAuth);

    const msg = s.buffer + data.substring(0, data.length - term.length);
    s.buffer = '';

    if (!msg.startsWith('Authentication success')) {
      this.destroy(new RconError(`Expected "Authentication success" from ${this.remoteAddress}:${this.remotePort} but received "${msg}"\n`, RconError.ERR_AUTHENTICATION_FAILED));
    } else {
      s.authenticated = true;
      this.emit('authenticated', msg);
    }
  },

  onDataCommand(data) {
    if (this.authenticated) {
      const s = store.get(this);

      if (!s.queue.length) {
        return this.destroy(new RconError(`Unrequested data received from server: ${data}`, RconError.ERR_UNKNOWN));
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
      const err = new RconError('Connection closed before response', RconError.ERR_CLOSED);
      s.queue.forEach(t => t.reject(err));
      s.queue.length = 0;
    }

    this.removeListener('data', handlers.onDataDigest);
    this.removeListener('data', handlers.onDataAuth);
  }

};

const RconConnection = class extends net.Socket {
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

  connect(port, host, password) {
    store.get(this).password = password;
    return super.connect({port, host});
  }

  async send(data) {
    if (!this.authenticated) {
      this.destroy();
      throw new RconError('Not yet connected and authenticated', RconError.ERR_NOT_READY);
    }

    this.write(`\x02${data}\n`);

    const task = new Task();
    store.get(this).queue.push(task);

    let msg;
    try {
      msg = await task;
    } catch (err) {
      this.destroy();
      throw err;
    }

    const errID = testCommand(msg);

    switch (errID) {
      case -1:
        return msg;
      default:
        throw new RconError(msg, errID);
    }
  }
};

module.exports = RconConnection;
