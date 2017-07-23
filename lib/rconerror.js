const RconError = class extends Error {
  constructor(message = undefined, code = RconError.ERR_UNKNOWN) {
    super(message);
    this.code = code;
  }

  static get ERR_UNKNOWN() {
    return 0;
  }

  static get ERR_NOT_READY() {
    return 1;
  }

  static get ERR_CLOSED() {
    return 2;
  }

  static get ERR_UNREQUESTED() {
    return 3;
  }

  static get ERR_AUTHENTICATION_FAILED() {
    return 4;
  }

  static get ERR_NOT_AUTHENTICATED() {
    return 5;
  }

  static get ERR_COMMAND_RESTRICTED() {
    return 6;
  }

  static get ERR_COMMAND_FAILED() {
    return 7;
  }

  static get ERR_COMMAND_UNAUTHORIZED() {
    return 8;
  }

  static get ERR_COMMAND_UNKNOWN() {
    return 9;
  }
};

module.exports = RconError;
