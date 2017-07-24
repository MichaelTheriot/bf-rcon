'use strict';

const Task = require('promise-task');
const RconConnection = require('./rconconnection');

const store = new WeakMap();

const handlers = {

  onAuthenticate() {
    const s = store.get(this);
    s.stage = 2;
    s.ready.resolve();
  },

  onError(err) {
    store.get(this).ready.reject(err);
  },

  onClose() {
    const s = store.get(this);
    s.stage = 0;
    s.ready = new Task();
  }

};

const RconClient = class {
  constructor(host, port, password) {
    const socket = new RconConnection();
    const s = {
      host,
      port,
      password,
      socket,
      stage: 0,
      ready: new Task()
    };
    store
      .set(this, s)
      .set(socket, s);
    socket.on('authenticate', handlers.onAuthenticate);
    socket.on('error', handlers.onError);
    socket.on('close', handlers.onClose);
  }

  async send(data) {
    const s = store.get(this);
    if (s.stage === 0) {
      s.stage = 1;
      s.socket.connect(s.port, s.host, s.password);
    }
    await s.ready;
    return await s.socket.send(data);
  }
};

module.exports = RconClient;
