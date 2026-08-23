'use strict'

const Game = require('../../workers/game/index.js')

const TEST_AUTOBASE_OPTIONS = {
  ackInterval: 0,
  ackThreshold: 0,
  fastForward: false
}

async function createTestGame(t, options = {}) {
  const storage = options.storage || (await t.tmp())
  const bootstrapKey = options.bootstrapKey ?? null
  const game = new Game(storage, {
    bootstrapKey,
    network: false,
    autobase: {
      ...TEST_AUTOBASE_OPTIONS,
      ...options.autobase
    }
  })

  game.on('error', (err) => t.fail(err.message))
  t.teardown(() => game.close(), { order: 1, force: true })
  await game.ready()

  return game
}

async function replicateAndSync(games, options = {}) {
  const streams = connectAll(games.map((game) => game.base))

  try {
    await waitForConvergence(games, options)
  } finally {
    await closeStreams(streams)
  }
}

async function waitForConvergence(games, { timeout = 15_000 } = {}) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    await Promise.all(games.map((game) => game.refresh()))

    if (sameHeads(games) && sameLeaderboards(games)) return

    await delay(10)
  }

  const heads = games.map((game) =>
    game.base.heads().map((head) => ({ key: head.key.toString('hex'), length: head.length }))
  )
  throw new Error(`Game peers did not converge: ${JSON.stringify(heads)}`)
}

function connectAll(bases) {
  const streams = []

  for (let i = 0; i < bases.length; i++) {
    for (let j = i + 1; j < bases.length; j++) {
      const left = bases[i].replicate(true)
      const right = bases[j].replicate(false)

      left.pipe(right).pipe(left)
      streams.push(left, right)
    }
  }

  return streams
}

async function closeStreams(streams) {
  const closed = streams.map(
    (stream) =>
      new Promise((resolve) => {
        if (stream.destroyed) return resolve()
        stream.once('close', resolve)
      })
  )

  for (const stream of streams) stream.destroy()
  await Promise.all(closed)
}

function sameHeads(games) {
  const expected = encodeHeads(games[0].base.heads())

  for (let i = 1; i < games.length; i++) {
    if (encodeHeads(games[i].base.heads()) !== expected) return false
  }

  return true
}

function encodeHeads(heads) {
  return heads
    .map((head) => `${head.key.toString('hex')}:${head.length}`)
    .sort()
    .join(',')
}

function sameLeaderboards(games) {
  const expected = JSON.stringify(games[0].state.leaderboard)

  for (let i = 1; i < games.length; i++) {
    if (JSON.stringify(games[i].state.leaderboard) !== expected) return false
  }

  return true
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
  createTestGame,
  replicateAndSync
}
