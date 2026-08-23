const FramedStream = require('framed-stream')
const PearRuntime = require('pear-runtime')
const ReadyResource = require('ready-resource')

const GAME_READY_TIMEOUT = 10000
const UPDATER_READY_TIMEOUT = 30000
const UPDATE_INSTALL_TIMEOUT = 5 * 60 * 1000

module.exports = class App extends ReadyResource {
  constructor({ dir, app, updates, version, upgrade, name, gameBootstrapKey, gameNetwork = true }) {
    super()

    this.dir = dir
    this.app = app
    this.updates = updates
    this.version = version
    this.upgrade = upgrade
    this.name = name
    this.gameBootstrapKey = gameBootstrapKey
    this.gameNetwork = gameNetwork

    this.updaterIPC = null
    this.updaterPipe = null
    this.gameIPC = null
    this.gamePipe = null
    this.stoppingWorkers = false
    this.updaterStopped = false
    this.gameStopped = false
    this.gameReady = false
    this.updateRequired = false
    this.updateApplied = false
    this.updateError = null
    this.updateApplyRequested = false
    this.updaterGate = null
    this.updateWaiter = null
    this.updateTimeout = null
    this.openCancellationError = null
  }

  async _open() {
    this.stoppingWorkers = false
    this.openCancellationError = null

    try {
      if (this.updates !== false) {
        const current = await this._openUpdater()
        if (current === false) return
      }

      if (this.updateRequired) {
        await this._waitForUpdate()
        return
      }

      try {
        await this._openGame()
      } catch (err) {
        if (!this.updateRequired) throw err
        await this._waitForUpdate()
      }

      if (this.updateRequired && !this.updateApplied) await this._waitForUpdate()
    } catch (err) {
      this._destroyWorkers()
      throw err
    }
  }

  close() {
    if (!this.opened && this.opening !== null) {
      const err = new Error('App closed during startup')
      this.openCancellationError = err
      this._rejectUpdaterGate(err)
      this._rejectUpdateWaiter(err)
      this._destroyWorkers()
    }

    return super.close()
  }

  _close() {
    this._destroyWorkers()
  }

  _openUpdater() {
    const gate = this._createUpdaterGate()

    this.updaterStopped = false
    try {
      this.updaterIPC = PearRuntime.run(require.resolve('./workers/main.js'), [
        this.version,
        this.upgrade,
        this.name,
        this.dir,
        this.app || ''
      ])
    } catch (err) {
      this._rejectUpdaterGate(err)
      return gate
    }
    this.updaterPipe = new FramedStream(this.updaterIPC)

    this.updaterPipe.on('data', (data) => this._onUpdaterMessage(data))
    this.updaterPipe.on('error', (err) => this._onWorkerError('updater', err))
    this.updaterPipe.on('end', () => this._onWorkerStop('updater'))
    this.updaterPipe.on('close', () => this._onWorkerStop('updater'))
    this.updaterIPC.on('exit', (code) => this._onWorkerStop('updater', code))

    return gate
  }

  _openGame() {
    this.gameStopped = false
    this.gameReady = false
    this.gameIPC = PearRuntime.run(require.resolve('./workers/index.js'), [
      this.dir,
      this.gameBootstrapKey || '',
      String(this.gameNetwork !== false)
    ])
    this.gamePipe = new FramedStream(this.gameIPC)

    this.gamePipe.on('data', (data) => this._onGameMessage(data))

    const ready = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        this.removeListener('game-ready', onReady)
        this.gamePipe?.removeListener('error', onError)
        this.gamePipe?.removeListener('end', onEnd)
        this.gamePipe?.removeListener('close', onClose)
        this.gameIPC?.removeListener('exit', onExit)
      }
      const onReady = () => {
        cleanup()
        resolve()
      }
      const onError = (err) => {
        cleanup()
        reject(err)
      }
      const onEnd = () => {
        cleanup()
        reject(new Error('Game worker ended before it was ready'))
      }
      const onClose = () => {
        cleanup()
        reject(new Error('Game worker closed before it was ready'))
      }
      const onExit = (code) => {
        cleanup()
        reject(new Error(`Game worker exited before ready with code ${code}`))
      }
      const onTimeout = () => {
        cleanup()
        reject(new Error('Game worker did not become ready in time'))
      }
      const timeout = setTimeout(onTimeout, GAME_READY_TIMEOUT)

      this.once('game-ready', onReady)
      this.gamePipe.once('error', onError)
      this.gamePipe.once('end', onEnd)
      this.gamePipe.once('close', onClose)
      this.gameIPC.once('exit', onExit)
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
    this._clearUpdateTimeout()

    const updaterPipe = this.updaterPipe
    const updaterIPC = this.updaterIPC

    this.updaterPipe = null
    this.updaterIPC = null

    updaterPipe?.destroy()
    updaterIPC?.destroy()
    this._destroyGame()
  }

  _destroyGame() {
    this.gameReady = false
    this.gameStopped = true

    const gamePipe = this.gamePipe
    const gameIPC = this.gameIPC

    this.gamePipe = null
    this.gameIPC = null

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
    const err = new Error(`${name} worker stopped unexpectedly${suffix}`)

    if (worker === 'updater') {
      this._onUpdaterFailure(err)
      return
    }
    this.emit('error', err)
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

    if (worker === 'updater') {
      this._onUpdaterFailure(err)
      return
    }
    this.emit('error', err)
  }

  _onUpdaterMessage(data) {
    let message

    try {
      message = JSON.parse(data.toString())
    } catch {
      this._onUpdaterFailure(new Error('Updater worker sent invalid JSON'))
      return
    }

    if (
      message === null ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      typeof message.type !== 'string'
    ) {
      this._onUpdaterFailure(new Error('Updater worker sent an invalid message'))
      return
    }

    if (message.type === 'updater:current') {
      if (!this.updateRequired) this._resolveUpdaterGate(true)
      return
    }

    if (message.type === 'updater:required') {
      this._requireUpdate()
      return
    }

    if (message.type === 'updater:updating') {
      this._requireUpdate()
      this.emit('updating')
      return
    }

    if (message.type === 'updater:downloaded') {
      this._requireUpdate()
      this.emit('updated')
      if (!this.updateApplyRequested) {
        this.updateApplyRequested = true
        this._sendUpdater({ type: 'updater:apply' })
      }
      return
    }

    if (message.type === 'updater:applied') {
      this._requireUpdate()
      this.updateApplied = true
      this._clearUpdateTimeout()
      this._resolveUpdateWaiter()
      this.emit('update-applied', message.version)
      this._resolveUpdaterGate(false)
      return
    }

    if (message.type === 'updater:error') {
      this._onUpdaterFailure(new Error(message.error || 'OTA update failed'))
      return
    }

    this._onUpdaterFailure(new Error(`Unknown updater message: ${message.type}`))
  }

  _onGameMessage(data) {
    if (this.updateRequired) return

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

  _createUpdaterGate() {
    let resolve
    let reject
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    const timeout = setTimeout(() => {
      this._rejectUpdaterGate(new Error('Updater did not finish its initial check in time'))
    }, UPDATER_READY_TIMEOUT)

    this.updaterGate = { promise, resolve, reject, timeout }
    return promise
  }

  _resolveUpdaterGate(current) {
    const gate = this.updaterGate
    if (gate === null) return false

    this.updaterGate = null
    if (gate.timeout !== null) clearTimeout(gate.timeout)
    gate.resolve(current)
    return true
  }

  _rejectUpdaterGate(err) {
    const gate = this.updaterGate
    if (gate === null) return false

    this.updaterGate = null
    if (gate.timeout !== null) clearTimeout(gate.timeout)
    gate.reject(err)
    return true
  }

  _pauseUpdaterTimeout() {
    const gate = this.updaterGate
    if (gate === null || gate.timeout === null) return

    clearTimeout(gate.timeout)
    gate.timeout = null
  }

  _requireUpdate() {
    if (this.updateRequired) return

    this.updateRequired = true
    this._pauseUpdaterTimeout()
    this._startUpdateTimeout()
    this._destroyGame()
    this.emit('update-required')
  }

  _onUpdaterFailure(err) {
    this.updateError = err
    this._clearUpdateTimeout()
    this._rejectUpdaterGate(err)
    this._rejectUpdateWaiter(err)

    this.emit('update-error', err)
  }

  _startUpdateTimeout() {
    if (this.updateTimeout !== null) return

    this.updateTimeout = setTimeout(() => {
      this.updateTimeout = null
      this._onUpdaterFailure(new Error('OTA update did not finish in time'))
    }, UPDATE_INSTALL_TIMEOUT)
  }

  _clearUpdateTimeout() {
    if (this.updateTimeout === null) return

    clearTimeout(this.updateTimeout)
    this.updateTimeout = null
  }

  _waitForUpdate() {
    if (this.updateApplied) return Promise.resolve()
    if (this.updateError !== null) return Promise.reject(this.updateError)
    if (this.openCancellationError !== null) return Promise.reject(this.openCancellationError)
    if (this.updateWaiter !== null) return this.updateWaiter.promise

    let resolve
    let reject
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })

    this.updateWaiter = { promise, resolve, reject }
    return promise
  }

  _resolveUpdateWaiter() {
    const waiter = this.updateWaiter
    if (waiter === null) return false

    this.updateWaiter = null
    waiter.resolve()
    return true
  }

  _rejectUpdateWaiter(err) {
    const waiter = this.updateWaiter
    if (waiter === null) return false

    this.updateWaiter = null
    waiter.reject(err)
    return true
  }

  _sendUpdater(message) {
    if (this.updaterPipe === null) return false
    return this.updaterPipe.write(JSON.stringify(message))
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
