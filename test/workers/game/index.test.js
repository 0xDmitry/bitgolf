'use strict'

const { test } = require('brittle')

const { TARGET_PROGRAM, targetProgram } = require('../../helpers/programs.js')
const CHALLENGES = require('../../../workers/game/challenges.js')
const {
  bitmapId,
  createSubmission,
  encodeSubmission
} = require('../../../workers/game/protocol.js')
const { generateBootstrapKey } = require('../../../scripts/generate-bootstrap-key.js')
const { createTestGame, replicateAndSync } = require('../../helpers/game.js')

const CHALLENGE_ID = bitmapId(CHALLENGES[0].target)

test('Game peers replicate submissions and derive the same leaderboard', async (t) => {
  const alice = await createTestGame(t)
  const bob = await createTestGame(t, { bootstrapKey: alice.base.key })

  await replicateAndSync([alice, bob])
  await alice.submit(targetProgram(1))
  await replicateAndSync([alice, bob])

  t.alike(leaderboard(alice), leaderboard(bob))
  t.alike(leaderboard(alice), [
    {
      program: targetProgram(1),
      author: alice.state.playerKey,
      score: TARGET_PROGRAM.length + 2
    }
  ])

  await bob.submit(TARGET_PROGRAM)
  await replicateAndSync([alice, bob])

  const expected = [
    { program: TARGET_PROGRAM, author: bob.state.playerKey, score: TARGET_PROGRAM.length },
    {
      program: targetProgram(1),
      author: alice.state.playerKey,
      score: TARGET_PROGRAM.length + 2
    }
  ]

  t.alike(leaderboard(alice), expected)
  t.alike(leaderboard(bob), expected)
})

test('Game rejects structurally invalid submissions from the shared view', async (t) => {
  const game = await createTestGame(t)
  const invalid = { ...createSubmission(TARGET_PROGRAM), type: 'move' }

  await game.base.append(Buffer.from(JSON.stringify(invalid)), { optimistic: true })
  await game.refresh()

  t.alike(await game._readEvents(), [])
  t.alike(leaderboard(game), [])
})

test('Game rejects malformed submissions from the shared view', async (t) => {
  const game = await createTestGame(t)
  const malformed = { ...createSubmission(TARGET_PROGRAM), program: '' }

  await game.base.append(Buffer.from(JSON.stringify(malformed)), { optimistic: true })
  await game.refresh()

  t.alike(await game._readEvents(), [])
  t.alike(leaderboard(game), [])
})

test('Game retains historical content-derived challenge events in the stable Autobase view', async (t) => {
  const game = await createTestGame(t)
  const historical = {
    v: 1,
    type: 'submission',
    challenge: CHALLENGE_ID,
    program: TARGET_PROGRAM
  }

  await game.base.append(encodeSubmission(historical), { optimistic: true })
  await game.refresh()

  t.alike(await game._readEvents(), [{ ...historical, author: game.state.playerKey }])
})

test('Game rejects unsupported protocol events', async (t) => {
  const game = await createTestGame(t)
  const future = {
    v: 2,
    type: 'submission',
    challenge: CHALLENGE_ID,
    program: 'a',
    futureField: true
  }

  await game.base.append(Buffer.from(JSON.stringify(future)), { optimistic: true })
  await game.refresh()

  t.alike(await game._readEvents(), [])
  t.alike(leaderboard(game), [])
})

test('Game rejects unknown challenge events', async (t) => {
  const game = await createTestGame(t)
  const future = {
    v: 1,
    type: 'submission',
    challenge: 'ffffffffffffffff',
    program: 'a'
  }

  await game.base.append(Buffer.from(JSON.stringify(future)), { optimistic: true })
  await game.refresh()

  t.alike(await game._readEvents(), [])
  t.alike(leaderboard(game), [])
})

test('Game accepts target programs and rejects non-target or malformed programs', async (t) => {
  const game = await createTestGame(t)

  for (const [program, score] of [
    [TARGET_PROGRAM, TARGET_PROGRAM.length],
    [targetProgram(1), TARGET_PROGRAM.length + 2],
    [` ${TARGET_PROGRAM} `, TARGET_PROGRAM.length]
  ]) {
    t.alike(await game.submit(program), { valid: true, score, challenge: CHALLENGE_ID })
  }

  for (const program of ['a', 'ab&', 'cf^', '', '&', 'a&', 'ab', 'c^f', 'hello']) {
    t.alike(await game.submit(program), {
      valid: false,
      score: 0,
      challenge: CHALLENGE_ID
    })
  }
  t.alike(await game.submit(TARGET_PROGRAM, 'missing-v1'), {
    valid: false,
    score: 0,
    challenge: 'missing-v1'
  })

  t.alike(
    leaderboard(game).map(({ program, score }) => ({ program, score })),
    [
      { program: TARGET_PROGRAM, score: TARGET_PROGRAM.length },
      { program: targetProgram(1), score: TARGET_PROGRAM.length + 2 }
    ]
  )
})

test('replicated peers independently verify the target and derive token scores', async (t) => {
  const alice = await createTestGame(t)
  const bob = await createTestGame(t, { bootstrapKey: alice.base.key })

  await replicateAndSync([alice, bob])

  const invalidPrograms = ['a', 'ab&', '&', 'a&', 'ab', 'c^f', 'hello']

  for (const program of invalidPrograms) {
    await alice.base.append(encodeSubmission(createSubmission(program)), { optimistic: true })
  }
  await replicateAndSync([alice, bob])

  t.alike(await alice._readEvents(), [])
  t.alike(await bob._readEvents(), [])
  t.alike(leaderboard(alice), [])
  t.alike(leaderboard(bob), [])

  const program = ` ${TARGET_PROGRAM} `
  await alice.base.append(encodeSubmission(createSubmission(program)), { optimistic: true })
  await replicateAndSync([alice, bob])

  const accepted = { ...createSubmission(program), author: alice.state.playerKey }
  const expected = [{ program, author: alice.state.playerKey, score: TARGET_PROGRAM.length }]
  t.alike(await alice._readEvents(), [accepted])
  t.alike(await bob._readEvents(), [accepted])
  t.alike(leaderboard(alice), expected)
  t.alike(leaderboard(bob), expected)
})

test('a non-member writer can make repeated accepted optimistic submissions', async (t) => {
  const alice = await createTestGame(t)
  const bob = await createTestGame(t, { bootstrapKey: alice.base.key })

  await replicateAndSync([alice, bob])
  t.absent(bob.base.writable)

  try {
    await bob.base.append(encodeSubmission(createSubmission(TARGET_PROGRAM)))
    t.fail('a non-member ordinary append must be rejected')
  } catch (err) {
    t.is(err.message, 'Not writable')
  }

  await bob.submit(targetProgram(1))
  await replicateAndSync([alice, bob])

  let expected = [
    {
      program: targetProgram(1),
      author: bob.state.playerKey,
      score: TARGET_PROGRAM.length + 2
    }
  ]
  t.alike(leaderboard(alice), expected)
  t.alike(leaderboard(bob), expected)
  t.absent(bob.base.writable)

  await bob.submit(TARGET_PROGRAM)
  await replicateAndSync([alice, bob])

  expected = [
    { program: TARGET_PROGRAM, author: bob.state.playerKey, score: TARGET_PROGRAM.length },
    {
      program: targetProgram(1),
      author: bob.state.playerKey,
      score: TARGET_PROGRAM.length + 2
    }
  ]
  t.alike(leaderboard(alice), expected)
  t.alike(leaderboard(bob), expected)
  t.absent(bob.base.writable)
})

test('two non-members synchronize through an unowned bootstrap key', async (t) => {
  const bootstrapKey = generateBootstrapKey()
  const alice = await createTestGame(t, { bootstrapKey })
  const bob = await createTestGame(t, { bootstrapKey })

  t.absent(alice.base.writable)
  t.absent(bob.base.writable)

  await replicateAndSync([alice, bob])
  await alice.submit(targetProgram(1))
  await replicateAndSync([alice, bob])
  await bob.submit(TARGET_PROGRAM)
  await replicateAndSync([alice, bob])

  const expected = [
    { program: TARGET_PROGRAM, author: bob.state.playerKey, score: TARGET_PROGRAM.length },
    {
      program: targetProgram(1),
      author: alice.state.playerKey,
      score: TARGET_PROGRAM.length + 2
    }
  ]
  t.alike(leaderboard(alice), expected)
  t.alike(leaderboard(bob), expected)
})

test('disconnected concurrent submissions converge', async (t) => {
  const bootstrapKey = generateBootstrapKey()
  const alice = await createTestGame(t, { bootstrapKey })
  const bob = await createTestGame(t, { bootstrapKey })

  await replicateAndSync([alice, bob])

  await Promise.all([alice.submit(targetProgram(1)), bob.submit(TARGET_PROGRAM)])
  await replicateAndSync([alice, bob])

  const expected = [
    { program: TARGET_PROGRAM, author: bob.state.playerKey, score: TARGET_PROGRAM.length },
    {
      program: targetProgram(1),
      author: alice.state.playerKey,
      score: TARGET_PROGRAM.length + 2
    }
  ]
  t.alike(leaderboard(alice), expected)
  t.alike(leaderboard(bob), expected)
})

test('persistent storage retains local identity and leaderboard', async (t) => {
  const alice = await createTestGame(t)
  const bobStorage = await t.tmp()
  const bootstrapKey = Buffer.from(alice.base.key)
  const bob = await createTestGame(t, { storage: bobStorage, bootstrapKey })

  await replicateAndSync([alice, bob])
  await alice.submit(targetProgram(1))
  await replicateAndSync([alice, bob])
  await bob.submit(TARGET_PROGRAM)
  await replicateAndSync([alice, bob])

  const playerKey = bob.state.playerKey
  const entries = leaderboard(bob)

  await bob.close()

  const reopened = await createTestGame(t, { storage: bobStorage, bootstrapKey })

  t.is(reopened.state.playerKey, playerKey)
  t.alike(leaderboard(reopened), entries)
})

test('changing the bootstrap key isolates persisted game state', async (t) => {
  const storage = await t.tmp()
  const firstBootstrapKey = generateBootstrapKey()
  const first = await createTestGame(t, { storage, bootstrapKey: firstBootstrapKey })

  await first.submit(TARGET_PROGRAM)

  const firstPlayerKey = first.state.playerKey
  t.is(leaderboard(first).length, 1)

  await first.close()

  const secondBootstrapKey = generateBootstrapKey()
  const second = await createTestGame(t, { storage, bootstrapKey: secondBootstrapKey })

  t.is(second.base.key.toString('hex'), secondBootstrapKey.toString('hex'))
  t.not(second.state.playerKey, firstPlayerKey)
  t.alike(leaderboard(second), [])

  await second.close()

  const reopenedFirst = await createTestGame(t, {
    storage,
    bootstrapKey: firstBootstrapKey.toString('hex')
  })

  t.is(reopenedFirst.state.playerKey, firstPlayerKey)
  t.alike(leaderboard(reopenedFirst), [
    { program: TARGET_PROGRAM, author: firstPlayerKey, score: TARGET_PROGRAM.length }
  ])
})

test('a remote Autobase update emits newly derived game state', async (t) => {
  const alice = await createTestGame(t)
  const bob = await createTestGame(t, { bootstrapKey: alice.base.key })

  await replicateAndSync([alice, bob])

  const remoteState = new Promise((resolve) => {
    bob.on('state', (state) => {
      if (state.leaderboards[CHALLENGE_ID].length === 1) resolve(state)
    })
  })

  await alice.submit(TARGET_PROGRAM)
  await replicateAndSync([alice, bob])

  const state = await remoteState
  t.is(state.leaderboards[CHALLENGE_ID][0].program, TARGET_PROGRAM)
  t.is(state.leaderboards[CHALLENGE_ID][0].author, alice.state.playerKey)
})

function leaderboard(game) {
  return game.state.leaderboards[CHALLENGE_ID]
}
