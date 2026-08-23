const { test } = require('brittle')
const ReadyResource = require('ready-resource')

const { MAX_PROGRAM_LENGTH } = require('../../workers/game/constants.js')
const WorkerTask = require('../../workers/worker-task.js')

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
    leaderboard: []
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
    JSON.stringify({ type: 'game:submit', requestId: 'submission-1', program: 'hello' })
  )
  await game.commandQueue

  const result = pipe.messages.find((message) => message.type === 'game:submit-result')
  const state = pipe.messages.filter((message) => message.type === 'game:state').at(-1)

  t.alike(result, {
    type: 'game:submit-result',
    requestId: 'submission-1',
    valid: true,
    score: 5
  })
  t.is(state.leaderboard.length, 1)
  t.is(state.leaderboard[0].score, 5)
  t.is(state.leaderboard[0].program, 'hello')
  t.is(state.leaderboard[0].author, playerKey)
})

test('game task rejects invalid and oversized submissions', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, await t.tmp(), { network: false })
  t.teardown(() => game.close(), { force: true })

  await game.ready()
  pipe.messages.length = 0

  pipe.emit('data', JSON.stringify({ type: 'game:submit', requestId: 'empty', program: '' }))
  pipe.emit(
    'data',
    JSON.stringify({
      type: 'game:submit',
      requestId: 'oversized',
      program: 'x'.repeat(MAX_PROGRAM_LENGTH + 1)
    })
  )
  await game.commandQueue

  const results = pipe.messages.filter((message) => message.type === 'game:submit-result')
  t.alike(
    results.map(({ requestId, valid }) => ({ requestId, valid })),
    [
      { requestId: 'empty', valid: false },
      { requestId: 'oversized', valid: false }
    ]
  )
  t.is(game.game.state.leaderboard.length, 0)
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
