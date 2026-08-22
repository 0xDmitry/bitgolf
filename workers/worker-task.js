const ReadyResource = require('ready-resource')

module.exports = class WorkerTask extends ReadyResource {
  constructor(pipe, storage) {
    super()

    this.pipe = pipe
    this.storage = storage
    this._ondata = this._ondata.bind(this)
  }

  _open() {
    this.pipe.on('data', this._ondata)
    this._send({ type: 'game:ready' })
  }

  _close() {
    this.pipe.removeListener('data', this._ondata)
  }

  _ondata(data) {
    let message

    try {
      message = JSON.parse(data.toString())
    } catch {
      this._sendError(null, 'INVALID_JSON', 'Game command must be valid JSON')
      return
    }

    if (
      message === null ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      typeof message.type !== 'string' ||
      message.type.length === 0
    ) {
      this._sendError(message, 'INVALID_COMMAND', 'Game command must have a type')
      return
    }

    // This health check proves the worker boundary without defining game rules yet.
    // Add authoritative game commands and state transitions here.
    if (message.type === 'game:ping') {
      this._send({ type: 'game:pong', requestId: message.requestId })
      return
    }

    this._sendError(message, 'UNKNOWN_COMMAND', `Unknown game command: ${message.type}`)
  }

  _sendError(message, code, error) {
    this._send({
      type: 'game:error',
      requestId: message?.requestId,
      code,
      error
    })
  }

  _send(message) {
    this.pipe.write(JSON.stringify(message))
  }
}
