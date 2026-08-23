const { test } = require('brittle')
const ReadyResource = require('ready-resource')

const { TARGET_PROGRAM } = require('../helpers/programs.js')
const CHALLENGES = require('../../workers/game/challenges.js')
const { MAX_PROGRAM_LENGTH } = require('../../workers/game/constants.js')
const { bitmapId } = require('../../workers/game/protocol.js')
const WorkerTask = require('../../workers/worker-task.js')

const CHALLENGE_ID = bitmapId(CHALLENGES[0].target)

class TestPipe extends ReadyResource {
  constructor() {
    super()
    this.messages = []
  }

  write(data) {
    this.messages.push(JSON.parse(data.toString()))
    return true
  }
}

test('game task announces readiness and its initial state', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, await t.tmp(), { network: false })
  t.teardown(() => game.close(), { force: true })

  await game.ready()

  t.is(pipe.messages[0].type, 'game:ready')
  t.alike(pipe.messages[1], {
    type: 'game:state',
    playerKey: pipe.messages[1].playerKey,
    peers: 0,
    leaderboards: { [CHALLENGE_ID]: [] }
  })
  t.ok(/^[0-9a-f]{64}$/.test(pipe.messages[1].playerKey))
})

test('game task handles a health check over its command boundary', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, await t.tmp(), { network: false })
  t.teardown(() => game.close(), { force: true })

  await game.ready()
  pipe.messages.length = 0
  pipe.emit('data', JSON.stringify({ type: 'game:ping', requestId: 'request-1' }))
  await game.commandQueue

  t.alike(pipe.messages, [{ type: 'game:pong', requestId: 'request-1' }])
})

test('game task accepts a submission and returns its derived score', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, await t.tmp(), { network: false })
  t.teardown(() => game.close(), { force: true })

  await game.ready()
  const playerKey = pipe.messages.find((message) => message.type === 'game:state').playerKey
  pipe.messages.length = 0

  pipe.emit(
    'data',
    JSON.stringify({
      type: 'game:submit',
      requestId: 'submission-1',
      challenge: CHALLENGE_ID,
      program: TARGET_PROGRAM
    })
  )
  await game.commandQueue

  const result = pipe.messages.find((message) => message.type === 'game:submit-result')
  const state = pipe.messages.filter((message) => message.type === 'game:state').at(-1)

  t.alike(result, {
    type: 'game:submit-result',
    requestId: 'submission-1',
    valid: true,
    score: TARGET_PROGRAM.length,
    challenge: CHALLENGE_ID
  })
  const leaderboard = state.leaderboards[CHALLENGE_ID]
  t.is(leaderboard.length, 1)
  t.is(leaderboard[0].score, TARGET_PROGRAM.length)
  t.is(leaderboard[0].program, TARGET_PROGRAM)
  t.is(leaderboard[0].author, playerKey)
})

test('game task rejects empty, non-target, malformed, and oversized programs', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, await t.tmp(), { network: false })
  t.teardown(() => game.close(), { force: true })

  await game.ready()
  pipe.messages.length = 0

  pipe.emit('data', JSON.stringify({ type: 'game:submit', requestId: 'empty', program: '' }))
  pipe.emit('data', JSON.stringify({ type: 'game:submit', requestId: 'wrong', program: 'a' }))
  pipe.emit(
    'data',
    JSON.stringify({ type: 'game:submit', requestId: 'unsupported', program: 'hello' })
  )
  pipe.emit(
    'data',
    JSON.stringify({
      type: 'game:submit',
      requestId: 'unknown-challenge',
      challenge: 'missing-v1',
      program: TARGET_PROGRAM
    })
  )
  pipe.emit(
    'data',
    JSON.stringify({
      type: 'game:submit',
      requestId: 'oversized',
      program: `${TARGET_PROGRAM}${'!'.repeat(MAX_PROGRAM_LENGTH)}`
    })
  )
  await game.commandQueue

  const results = pipe.messages.filter((message) => message.type === 'game:submit-result')
  t.alike(
    results.map(({ requestId, valid, challenge }) => ({ requestId, valid, challenge })),
    [
      { requestId: 'empty', valid: false, challenge: CHALLENGE_ID },
      { requestId: 'wrong', valid: false, challenge: CHALLENGE_ID },
      { requestId: 'unsupported', valid: false, challenge: CHALLENGE_ID },
      { requestId: 'unknown-challenge', valid: false, challenge: 'missing-v1' },
      { requestId: 'oversized', valid: false, challenge: CHALLENGE_ID }
    ]
  )
  t.is(game.game.state.leaderboards[CHALLENGE_ID].length, 0)
  t.absent(game.game.state.submissions)
})

test('game task rejects malformed and unknown commands', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, await t.tmp(), { network: false })
  t.teardown(() => game.close(), { force: true })

  await game.ready()
  pipe.messages.length = 0

  pipe.emit('data', '{')
  pipe.emit('data', JSON.stringify({ type: 'game:move', requestId: 'request-2' }))
  await game.commandQueue

  t.alike(pipe.messages, [
    {
      type: 'game:error',
      code: 'INVALID_JSON',
      error: 'Game command must be valid JSON'
    },
    {
      type: 'game:error',
      requestId: 'request-2',
      code: 'UNKNOWN_COMMAND',
      error: 'Unknown game command: game:move'
    }
  ])
})

test('game task rejects structurally invalid commands', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, await t.tmp(), { network: false })
  t.teardown(() => game.close(), { force: true })

  await game.ready()
  pipe.messages.length = 0

  pipe.emit('data', JSON.stringify(null))
  pipe.emit('data', JSON.stringify({ type: '' }))

  t.alike(
    pipe.messages.map(({ code }) => code),
    ['INVALID_COMMAND', 'INVALID_COMMAND']
  )

  await game.close()
  t.is(pipe.listenerCount('data'), 0)
})
