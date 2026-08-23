'use strict'

const Autobase = require('autobase')
const Corestore = require('corestore')
const ReadyResource = require('ready-resource')

const CHALLENGES = require('./challenges.js')
const { GAME_BOOTSTRAP_KEY } = require('./constants.js')
const {
  bitmapId,
  createSubmission,
  decodeSubmission,
  encodeSubmission,
  isValidSubmission
} = require('./protocol.js')
const { verifySubmission } = require('./verifier.js')
const { reduceEvents } = require('./reducer.js')
const GameNetwork = require('./network.js')

const EVENT_VIEW_NAME = 'events'
const CURRENT_CHALLENGE = CHALLENGES[CHALLENGES.length - 1]
const CURRENT_CHALLENGE_ID = bitmapId(CURRENT_CHALLENGE.target)

module.exports = class Game extends ReadyResource {
  constructor(
    storage,
    {
      bootstrapKey = GAME_BOOTSTRAP_KEY,
      challengeId = CURRENT_CHALLENGE_ID,
      network = true,
      swarm = null,
      autobase = {}
    } = {}
  ) {
    super()

    this.storage = storage
    this.bootstrapKey = bootstrapKey
    this.challengeId = challengeId
    this.networkEnabled = network !== false
    this.swarm = swarm
    this.autobaseOptions = autobase

    this.store = null
    this.base = null
    this.network = null
    this.state = {
      playerKey: null,
      peers: 0,
      ...reduceEvents([])
    }

    this._refreshTail = Promise.resolve()
    this._onBaseUpdate = this._onBaseUpdate.bind(this)
    this._onBaseError = this._onBaseError.bind(this)
    this._onPeers = this._onPeers.bind(this)
    this._onNetworkError = this._onNetworkError.bind(this)
  }

  async _open() {
    try {
      const bootstrap = normalizeBootstrapKey(this.bootstrapKey)
      this.store =
        bootstrap === null
          ? new Corestore(this.storage)
          : new Corestore(this.storage, { namespace: bootstrap })

      this.base = new Autobase(this.store, bootstrap, {
        optimistic: true,
        open: openEventView,
        apply: applyGameEvents,
        ...pickAutobaseOptions(this.autobaseOptions)
      })
      this.base.on('update', this._onBaseUpdate)
      this.base.on('error', this._onBaseError)

      await this.base.ready()
      await this._deriveState(false)

      if (this.networkEnabled) {
        this.network = new GameNetwork(this.base, { swarm: this.swarm })
        this.network.on('peers', this._onPeers)
        this.network.on('error', this._onNetworkError)
        this.network.on('connection-error', this._onNetworkError)
        await this.network.ready()
      }

      this.emit('state', this.state)
    } catch (err) {
      await this._closeResources()
      throw err
    }
  }

  async _close() {
    await this._refreshTail.catch(() => {})
    await this._closeResources()
  }

  async submit(program, challengeId = this.challengeId) {
    let event

    try {
      event = createSubmission(program, challengeId)
    } catch {
      return { valid: false, score: 0, challenge: challengeId }
    }

    const result = verifySubmission(event)

    if (!result.valid || !isValidSubmission(event)) {
      return {
        valid: false,
        score: result.valid ? null : result.score,
        challenge: event.challenge
      }
    }

    await this.base.append(encodeSubmission(event), { optimistic: true })
    await this.refresh()

    return { ...result, challenge: event.challenge }
  }

  refresh() {
    const refresh = this._refreshTail.then(() => this._deriveState(true))
    this._refreshTail = refresh.catch(() => {})
    return refresh
  }

  async _deriveState(emit) {
    const events = await this._readEvents()
    const game = reduceEvents(events)

    const state = {
      playerKey: this.base.local.key.toString('hex'),
      peers: this.network === null ? 0 : this.network.peers,
      ...game
    }
    const changed = !sameState(this.state, state)

    this.state = state
    if (emit && changed) this.emit('state', this.state)
    return this.state
  }

  async _readEvents() {
    await this.base.update()

    const snapshot = this.base.view.snapshot({ valueEncoding: 'json' })
    let events

    try {
      await snapshot.ready()
      events = new Array(snapshot.length)
      for (let i = 0; i < snapshot.length; i++) events[i] = await snapshot.get(i)
    } finally {
      await snapshot.close()
    }

    return events
  }

  async _closeResources() {
    if (this.network !== null) {
      this.network.removeListener('peers', this._onPeers)
      this.network.removeListener('error', this._onNetworkError)
      this.network.removeListener('connection-error', this._onNetworkError)
      await this.network.close().catch(() => {})
      this.network = null
    }

    if (this.base !== null) {
      this.base.removeListener('update', this._onBaseUpdate)
      this.base.removeListener('error', this._onBaseError)
      await this.base.close().catch(() => {})
      this.base = null
      this.store = null
    } else if (this.store !== null) {
      await this.store.close().catch(() => {})
      this.store = null
    }
  }

  _onBaseUpdate() {
    if (this.closing !== null || this.closed) return
    this.refresh().catch(this._onBaseError)
  }

  _onBaseError(err) {
    if (this.closing !== null || this.closed) return
    this.emit('error', err)
  }

  _onPeers(peers) {
    this.state = { ...this.state, peers }
    this.emit('state', this.state)
  }

  _onNetworkError(err) {
    if (this.closing !== null || this.closed) return
    this.emit('warning', err)
  }
}

function openEventView(store) {
  return store.get({ name: EVENT_VIEW_NAME, valueEncoding: 'json' })
}

async function applyGameEvents(nodes, view, host) {
  for (const node of nodes) {
    const event = decodeSubmission(node.value)
    if (!isValidSubmission(event)) continue

    const result = verifySubmission(event)
    if (!result.valid) continue

    await host.ackWriter(node.from.key)
    await view.append({
      ...event,
      author: node.from.key.toString('hex')
    })
  }
}

function normalizeBootstrapKey(key) {
  if (key === null || key === undefined || key === '') return null

  if (typeof key === 'string') {
    if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new TypeError('Invalid Autobase bootstrap key')
    return Buffer.from(key, 'hex')
  }

  if (typeof key.byteLength !== 'number' || key.byteLength !== 32) {
    throw new TypeError('Invalid Autobase bootstrap key')
  }

  return key
}

function pickAutobaseOptions(options) {
  const picked = {}
  const names = ['ackInterval', 'ackThreshold', 'fastForward', 'bigBatches', 'wakeup', 'backoff']

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(options, name)) picked[name] = options[name]
  }

  return picked
}

function sameState(a, b) {
  if (a.playerKey !== b.playerKey || a.peers !== b.peers) return false
  const leftIds = Object.keys(a.leaderboards)
  const rightIds = Object.keys(b.leaderboards)

  if (leftIds.length !== rightIds.length) return false

  for (const id of leftIds) {
    if (!Object.prototype.hasOwnProperty.call(b.leaderboards, id)) return false
    if (!sameLeaderboard(a.leaderboards[id], b.leaderboards[id])) return false
  }

  return true
}

function sameLeaderboard(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]

    if (
      left.program !== right.program ||
      left.author !== right.author ||
      left.score !== right.score
    ) {
      return false
    }
  }

  return true
}
