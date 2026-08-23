const ReadyResource = require('ready-resource')
const Game = require('./game/index.js')

module.exports = class WorkerTask extends ReadyResource {
  constructor(
    pipe,
    storage,
    { bootstrapKey = undefined, network = true, gameFactory = null } = {}
  ) {
    super()

    this.pipe = pipe
    this.storage = storage
    this.bootstrapKey = bootstrapKey
    this.network = network
    this.gameFactory = gameFactory
    this.game = null
    this.gameReady = false
    this.latestState = null
    this.commandQueue = Promise.resolve()

    this._onData = this._onData.bind(this)
    this._onGameState = this._onGameState.bind(this)
    this._onGameError = this._onGameError.bind(this)
    this._onGameWarning = this._onGameWarning.bind(this)
  }

  async _open() {
    this.pipe.on('data', this._onData)

    const options = { network: this.network }
    if (this.bootstrapKey !== undefined) options.bootstrapKey = this.bootstrapKey

    this.game = this.gameFactory
      ? this.gameFactory(this.storage, options)
      : new Game(this.storage, options)

    this.game.on('state', this._onGameState)
    this.game.on('error', this._onGameError)
    this.game.on('warning', this._onGameWarning)

    await this.game.ready()

    this.gameReady = true
    this._send({ type: 'game:ready' })
    this._sendState(this.latestState || this.game.state)
  }

  async _close() {
    this.pipe.removeListener('data', this._onData)
    await this.commandQueue.catch(() => {})

    if (this.game !== null) {
      this.game.removeListener('state', this._onGameState)
      this.game.removeListener('error', this._onGameError)
      this.game.removeListener('warning', this._onGameWarning)
      await this.game.close()
      this.game = null
    }

    this.gameReady = false
  }

  _onData(data) {
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

    const command = this.commandQueue.then(() => this._handleCommand(message))
    this.commandQueue = command.catch((err) => {
      this._sendError(message, 'COMMAND_FAILED', err.message)
    })
  }

  async _handleCommand(message) {
    if (message.type === 'game:ping') {
      this._send({ type: 'game:pong', requestId: message.requestId })
      return
    }

    if (message.type === 'game:open') {
      this._sendState(this.game.state, message.requestId)
      return
    }

    if (message.type === 'game:submit') {
      const result = await this.game.submit(message.program)
      this._send({
        type: 'game:submit-result',
        requestId: message.requestId,
        ...result
      })
      return
    }

    this._sendError(message, 'UNKNOWN_COMMAND', `Unknown game command: ${message.type}`)
  }

  _onGameState(state) {
    this.latestState = state
    if (this.gameReady) this._sendState(state)
  }

  _onGameError(err) {
    this._sendError(null, 'GAME_FAILURE', err.message)
  }

  _onGameWarning(err) {
    this._send({ type: 'game:warning', warning: err.message })
  }

  _sendState(state, requestId = undefined) {
    this._send({
      type: 'game:state',
      requestId,
      playerKey: state.playerKey,
      peers: state.peers,
      leaderboard: state.leaderboard
    })
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
    return this.pipe.write(JSON.stringify(message))
  }
}
