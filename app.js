const FramedStream = require('framed-stream')
const PearRuntime = require('pear-runtime')
const ReadyResource = require('ready-resource')

const GAME_READY_TIMEOUT = 10000

module.exports = class App extends ReadyResource {
  constructor({ dir, app, updates, version, upgrade, name }) {
    super()

    this.dir = dir
    this.app = app
    this.updates = updates
    this.version = version
    this.upgrade = upgrade
    this.name = name

    this.updaterIPC = null
    this.updaterPipe = null
    this.gameIPC = null
    this.gamePipe = null
    this.stoppingWorkers = false
    this.updaterStopped = false
    this.gameStopped = false
    this.gameReady = false
  }

  async _open() {
    this.stoppingWorkers = false

    try {
      this._openUpdater()
      await this._openGame()
    } catch (err) {
      this._destroyWorkers()
      throw err
    }
  }

  _close() {
    this._destroyWorkers()
  }

  _openUpdater() {
    this.updaterStopped = false
    this.updaterIPC = PearRuntime.run(require.resolve('./workers/main.js'), [
      String(this.updates),
      this.version,
      this.upgrade,
      this.name,
      this.dir,
      this.app || ''
    ])
    this.updaterPipe = new FramedStream(this.updaterIPC)

    this.updaterPipe.on('data', (data) => this._onUpdaterMessage(data))
    this.updaterPipe.on('error', (err) => this._onWorkerError('updater', err))
    this.updaterPipe.on('end', () => this._onWorkerStop('updater'))
    this.updaterPipe.on('close', () => this._onWorkerStop('updater'))
    this.updaterIPC.on('exit', (code) => this._onWorkerStop('updater', code))
  }

  _openGame() {
    this.gameStopped = false
    this.gameReady = false
    this.gameIPC = PearRuntime.run(require.resolve('./workers/index.js'), [this.dir])
    this.gamePipe = new FramedStream(this.gameIPC)

    this.gamePipe.on('data', (data) => this._onGameMessage(data))

    const ready = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        this.removeListener('game-ready', onready)
        this.gamePipe?.removeListener('error', onerror)
        this.gamePipe?.removeListener('end', onend)
        this.gamePipe?.removeListener('close', onclose)
        this.gameIPC?.removeListener('exit', onexit)
      }
      const onready = () => {
        cleanup()
        resolve()
      }
      const onerror = (err) => {
        cleanup()
        reject(err)
      }
      const onend = () => {
        cleanup()
        reject(new Error('Game worker ended before it was ready'))
      }
      const onclose = () => {
        cleanup()
        reject(new Error('Game worker closed before it was ready'))
      }
      const onexit = (code) => {
        cleanup()
        reject(new Error(`Game worker exited before ready with code ${code}`))
      }
      const ontimeout = () => {
        cleanup()
        reject(new Error('Game worker did not become ready in time'))
      }
      const timeout = setTimeout(ontimeout, GAME_READY_TIMEOUT)

      this.once('game-ready', onready)
      this.gamePipe.once('error', onerror)
      this.gamePipe.once('end', onend)
      this.gamePipe.once('close', onclose)
      this.gameIPC.once('exit', onexit)
    })

    this.gamePipe.on('error', (err) => {
      this._onWorkerError('game', err)
    })
    this.gamePipe.on('end', () => this._onWorkerStop('game'))
    this.gamePipe.on('close', () => this._onWorkerStop('game'))
    this.gameIPC.on('exit', (code) => this._onWorkerStop('game', code))

    return ready
  }

  _destroyWorkers() {
    this.stoppingWorkers = true
    this.gameReady = false

    const updaterPipe = this.updaterPipe
    const updaterIPC = this.updaterIPC
    const gamePipe = this.gamePipe
    const gameIPC = this.gameIPC

    this.updaterPipe = null
    this.updaterIPC = null
    this.gamePipe = null
    this.gameIPC = null

    updaterPipe?.destroy()
    updaterIPC?.destroy()
    gamePipe?.destroy()
    gameIPC?.destroy()
  }

  _onWorkerStop(worker, code) {
    const stopped = worker === 'updater' ? 'updaterStopped' : 'gameStopped'

    if (
      this[stopped] ||
      this.stoppingWorkers ||
      this.closing !== null ||
      this.closed ||
      (worker === 'game' && this.gameReady === false)
    ) {
      return
    }

    this[stopped] = true
    if (worker === 'game') this.gameReady = false

    const name = worker === 'updater' ? 'Updater' : 'Game'
    const suffix = code === undefined ? '' : ` with code ${code}`
    this.emit('error', new Error(`${name} worker stopped unexpectedly${suffix}`))
  }

  _onWorkerError(worker, err) {
    const stopped = worker === 'updater' ? 'updaterStopped' : 'gameStopped'

    if (
      this[stopped] ||
      this.stoppingWorkers ||
      this.closing !== null ||
      this.closed ||
      (worker === 'game' && this.gameReady === false)
    ) {
      return
    }

    this[stopped] = true
    if (worker === 'game') this.gameReady = false
    this.emit('error', err)
  }

  _onUpdaterMessage(data) {
    const message = data.toString()

    if (message === 'updating') {
      this.emit('updating')
      return
    }

    if (message === 'updated') {
      this.emit('updated')
      this._sendUpdater('pear:applyUpdate')
      return
    }

    if (message === 'pear:updateApplied') {
      this.emit('update-applied')
      return
    }

    this.emit('message', message)
  }

  _onGameMessage(data) {
    let message

    try {
      message = JSON.parse(data.toString())
    } catch {
      this.emit('error', new Error('Game worker sent invalid JSON'))
      return
    }

    if (
      message === null ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      typeof message.type !== 'string' ||
      message.type.length === 0
    ) {
      this.emit('error', new Error('Game worker sent an invalid message'))
      return
    }

    if (message.type === 'game:ready') this.gameReady = true

    this.emit('game-message', message)

    if (message.type === 'game:ready') this.emit('game-ready')
    if (message.type === 'game:error') this.emit('game-error', message)
  }

  _sendUpdater(message) {
    if (this.updaterPipe === null) return false
    return this.updaterPipe.write(message)
  }

  sendGame(message) {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      throw new TypeError('Game message must be an object')
    }
    if (typeof message.type !== 'string' || message.type.length === 0) {
      throw new TypeError('Game message type must be a non-empty string')
    }
    if (this.gamePipe === null || this.gameReady === false || this.gameStopped) {
      throw new Error('Game worker is not ready')
    }
    return this.gamePipe.write(JSON.stringify(message))
  }

  async exit(code = 0) {
    Bare.exitCode = code
    await this.close()
  }
}
