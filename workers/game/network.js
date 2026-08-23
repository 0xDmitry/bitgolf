'use strict'

const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')

module.exports = class GameNetwork extends ReadyResource {
  constructor(base, { swarm = null } = {}) {
    super()

    this.base = base
    this.swarm = swarm || new Hyperswarm()
    this.discovery = null
    this.connections = new Set()

    this._onConnection = this._onConnection.bind(this)
    this._onSwarmError = this._onSwarmError.bind(this)
  }

  get peers() {
    return this.connections.size
  }

  _open() {
    this.swarm.on('connection', this._onConnection)
    this.swarm.on('error', this._onSwarmError)
    this.discovery = this.swarm.join(this.base.discoveryKey, {
      client: true,
      server: true
    })
  }

  async _close() {
    this.swarm.removeListener('connection', this._onConnection)
    this.swarm.removeListener('error', this._onSwarmError)

    if (this.discovery !== null) {
      await this.discovery.destroy()
      this.discovery = null
    }

    await this.swarm.destroy()
    this.connections.clear()
  }

  _onConnection(connection) {
    if (this.connections.has(connection)) return

    this.connections.add(connection)
    this.emit('peers', this.peers)

    let disconnected = false
    const onDisconnect = () => {
      if (disconnected) return
      disconnected = true
      connection.removeListener('close', onDisconnect)
      connection.removeListener('end', onDisconnect)
      connection.removeListener('error', onError)
      this.connections.delete(connection)
      this.emit('peers', this.peers)
    }
    const onError = (err) => {
      this.emit('connection-error', err)
      onDisconnect()
    }

    connection.once('close', onDisconnect)
    connection.once('end', onDisconnect)
    connection.once('error', onError)

    // This also registers Autobase's wakeup protocol on the replication stream.
    this.base.replicate(connection)
  }

  _onSwarmError(err) {
    this.emit('error', err)
  }
}
