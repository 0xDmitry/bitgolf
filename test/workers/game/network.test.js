'use strict'

const { test } = require('brittle')
const ReadyResource = require('ready-resource')

const GameNetwork = require('../../../workers/game/network.js')

test('game network joins, replicates connections, and tracks peer count', async (t) => {
  const swarm = new FakeSwarm()
  const replicated = []
  const base = {
    discoveryKey: Buffer.alloc(32, 1),
    replicate(connection) {
      replicated.push(connection)
    }
  }
  const network = new GameNetwork(base, { swarm })
  const counts = []
  network.on('peers', (count) => counts.push(count))
  t.teardown(() => network.close(), { force: true })

  await network.ready()

  t.is(swarm.topic, base.discoveryKey)
  t.alike(swarm.joinOptions, { client: true, server: true })

  const connection = new ReadyResource()
  swarm.emit('connection', connection)

  t.is(network.peers, 1)
  t.alike(replicated, [connection])

  connection.emit('end')
  t.is(network.peers, 0)
  t.alike(counts, [1, 0])

  await network.close()
  t.ok(swarm.discoveryDestroyed)
  t.ok(swarm.destroyed)
})

class FakeSwarm extends ReadyResource {
  constructor() {
    super()
    this.topic = null
    this.joinOptions = null
    this.discoveryDestroyed = false
    this.destroyed = false
  }

  join(topic, options) {
    this.topic = topic
    this.joinOptions = options

    return {
      destroy: () => {
        this.discoveryDestroyed = true
      }
    }
  }

  destroy() {
    this.destroyed = true
  }
}
