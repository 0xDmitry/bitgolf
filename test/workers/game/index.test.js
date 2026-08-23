'use strict'

const { test } = require('brittle')

const { createSubmission, encodeSubmission } = require('../../../workers/game/protocol.js')
const { generateBootstrapKey } = require('../../../scripts/generate-bootstrap-key.js')
const { createTestGame, replicateAndSync } = require('../../helpers/game.js')

test('Game peers replicate submissions and derive the same leaderboard', async (t) => {
  const alice = await createTestGame(t)
  const bob = await createTestGame(t, { bootstrapKey: alice.base.key })

  await replicateAndSync([alice, bob])
  await alice.submit('abc&^')
  await replicateAndSync([alice, bob])

  t.alike(alice.state.leaderboard, bob.state.leaderboard)
  t.alike(alice.state.leaderboard, [{ program: 'abc&^', author: alice.state.playerKey, score: 5 }])

  await bob.submit('a')
  await replicateAndSync([alice, bob])

  const expected = [
    { program: 'a', author: bob.state.playerKey, score: 1 },
    { program: 'abc&^', author: alice.state.playerKey, score: 5 }
  ]

  t.alike(alice.state.leaderboard, expected)
  t.alike(bob.state.leaderboard, expected)
})

test('Game ignores decoded submissions that fail validation', async (t) => {
  const game = await createTestGame(t)
  const invalid = { ...createSubmission('a'), type: 'move' }

  await game.base.append(Buffer.from(JSON.stringify(invalid)), { optimistic: true })
  await game.refresh()

  t.alike(game.state.leaderboard, [])
})

test('Game accepts complete Bit Golf programs and rejects malformed syntax', async (t) => {
  const game = await createTestGame(t)

  for (const [program, score] of [
    ['a', 1],
    ['ab&', 3],
    ['cf^', 3]
  ]) {
    t.alike(await game.submit(program), { valid: true, score })
  }

  for (const program of ['', '&', 'a&', 'ab', 'c^f', 'hello']) {
    t.alike(await game.submit(program), { valid: false, score: 0 })
  }

  t.alike(
    game.state.leaderboard.map(({ program, score }) => ({ program, score })),
    [
      { program: 'a', score: 1 },
      { program: 'ab&', score: 3 }
    ]
  )
})

test('replicated peers independently reject syntax and derive token scores', async (t) => {
  const alice = await createTestGame(t)
  const bob = await createTestGame(t, { bootstrapKey: alice.base.key })

  await replicateAndSync([alice, bob])

  for (const program of ['&', 'a&', 'ab', 'c^f', 'hello']) {
    await alice.base.append(encodeSubmission(createSubmission(program)), { optimistic: true })
  }
  await replicateAndSync([alice, bob])

  t.alike(await alice._readEvents(), [])
  t.alike(await bob._readEvents(), [])
  t.alike(alice.state.leaderboard, [])
  t.alike(bob.state.leaderboard, [])

  const program = 'a b &'
  await alice.base.append(encodeSubmission(createSubmission(program)), { optimistic: true })
  await replicateAndSync([alice, bob])

  const accepted = { ...createSubmission(program), author: alice.state.playerKey }
  const expected = [{ program, author: alice.state.playerKey, score: 3 }]
  t.alike(await alice._readEvents(), [accepted])
  t.alike(await bob._readEvents(), [accepted])
  t.alike(alice.state.leaderboard, expected)
  t.alike(bob.state.leaderboard, expected)
})

test('a non-member writer can make repeated accepted optimistic submissions', async (t) => {
  const alice = await createTestGame(t)
  const bob = await createTestGame(t, { bootstrapKey: alice.base.key })

  await replicateAndSync([alice, bob])
  t.absent(bob.base.writable)

  try {
    await bob.base.append(encodeSubmission(createSubmission('ab&')))
    t.fail('a non-member ordinary append must be rejected')
  } catch (err) {
    t.is(err.message, 'Not writable')
  }

  await bob.submit('abc&^')
  await replicateAndSync([alice, bob])

  let expected = [{ program: 'abc&^', author: bob.state.playerKey, score: 5 }]
  t.alike(alice.state.leaderboard, expected)
  t.alike(bob.state.leaderboard, expected)
  t.absent(bob.base.writable)

  await bob.submit('a')
  await replicateAndSync([alice, bob])

  expected = [
    { program: 'a', author: bob.state.playerKey, score: 1 },
    { program: 'abc&^', author: bob.state.playerKey, score: 5 }
  ]
  t.alike(alice.state.leaderboard, expected)
  t.alike(bob.state.leaderboard, expected)
  t.absent(bob.base.writable)
})

test('two non-members synchronize through an unowned bootstrap key', async (t) => {
  const bootstrapKey = generateBootstrapKey()
  const alice = await createTestGame(t, { bootstrapKey })
  const bob = await createTestGame(t, { bootstrapKey })

  t.absent(alice.base.writable)
  t.absent(bob.base.writable)

  await replicateAndSync([alice, bob])
  await alice.submit('abc&^')
  await replicateAndSync([alice, bob])
  await bob.submit('a')
  await replicateAndSync([alice, bob])

  const expected = [
    { program: 'a', author: bob.state.playerKey, score: 1 },
    { program: 'abc&^', author: alice.state.playerKey, score: 5 }
  ]
  t.alike(alice.state.leaderboard, expected)
  t.alike(bob.state.leaderboard, expected)
})

test('disconnected concurrent submissions converge', async (t) => {
  const bootstrapKey = generateBootstrapKey()
  const alice = await createTestGame(t, { bootstrapKey })
  const bob = await createTestGame(t, { bootstrapKey })

  await replicateAndSync([alice, bob])

  await Promise.all([alice.submit('abc&^'), bob.submit('a')])
  await replicateAndSync([alice, bob])

  const expected = [
    { program: 'a', author: bob.state.playerKey, score: 1 },
    { program: 'abc&^', author: alice.state.playerKey, score: 5 }
  ]
  t.alike(alice.state.leaderboard, expected)
  t.alike(bob.state.leaderboard, expected)
})

test('persistent storage retains local identity and leaderboard', async (t) => {
  const alice = await createTestGame(t)
  const bobStorage = await t.tmp()
  const bootstrapKey = Buffer.from(alice.base.key)
  const bob = await createTestGame(t, { storage: bobStorage, bootstrapKey })

  await replicateAndSync([alice, bob])
  await alice.submit('abc&^')
  await replicateAndSync([alice, bob])
  await bob.submit('a')
  await replicateAndSync([alice, bob])

  const playerKey = bob.state.playerKey
  const leaderboard = bob.state.leaderboard

  await bob.close()

  const reopened = await createTestGame(t, { storage: bobStorage, bootstrapKey })

  t.is(reopened.state.playerKey, playerKey)
  t.alike(reopened.state.leaderboard, leaderboard)
})

test('changing the bootstrap key isolates persisted game state', async (t) => {
  const storage = await t.tmp()
  const firstBootstrapKey = generateBootstrapKey()
  const first = await createTestGame(t, { storage, bootstrapKey: firstBootstrapKey })

  await first.submit('a')

  const firstPlayerKey = first.state.playerKey
  t.is(first.state.leaderboard.length, 1)

  await first.close()

  const secondBootstrapKey = generateBootstrapKey()
  const second = await createTestGame(t, { storage, bootstrapKey: secondBootstrapKey })

  t.is(second.base.key.toString('hex'), secondBootstrapKey.toString('hex'))
  t.not(second.state.playerKey, firstPlayerKey)
  t.alike(second.state.leaderboard, [])

  await second.close()

  const reopenedFirst = await createTestGame(t, {
    storage,
    bootstrapKey: firstBootstrapKey.toString('hex')
  })

  t.is(reopenedFirst.state.playerKey, firstPlayerKey)
  t.alike(reopenedFirst.state.leaderboard, [{ program: 'a', author: firstPlayerKey, score: 1 }])
})

test('a remote Autobase update emits newly derived game state', async (t) => {
  const alice = await createTestGame(t)
  const bob = await createTestGame(t, { bootstrapKey: alice.base.key })

  await replicateAndSync([alice, bob])

  const remoteState = new Promise((resolve) => {
    bob.on('state', (state) => {
      if (state.leaderboard.length === 1) resolve(state)
    })
  })

  await alice.submit('abc&^')
  await replicateAndSync([alice, bob])

  const state = await remoteState
  t.is(state.leaderboard[0].program, 'abc&^')
  t.is(state.leaderboard[0].author, alice.state.playerKey)
})
