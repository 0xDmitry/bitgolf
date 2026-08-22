const { test } = require('brittle')
const os = require('bare-os')
const path = require('bare-path')
const ReadyResource = require('ready-resource')

const WorkerTask = require('./worker-task.js')

const TEST_STORAGE = path.join(os.tmpdir(), 'bitgolf-tests')

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

test('game task announces when it is ready', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, TEST_STORAGE)

  await game.ready()

  t.alike(pipe.messages, [{ type: 'game:ready' }])

  await game.close()
})

test('game task handles a health check over its command boundary', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, TEST_STORAGE)

  await game.ready()
  pipe.messages.length = 0
  pipe.emit('data', JSON.stringify({ type: 'game:ping', requestId: 'request-1' }))

  t.alike(pipe.messages, [{ type: 'game:pong', requestId: 'request-1' }])

  await game.close()
})

test('game task rejects malformed and unknown commands', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, TEST_STORAGE)

  await game.ready()
  pipe.messages.length = 0

  pipe.emit('data', '{')
  pipe.emit('data', JSON.stringify({ type: 'game:move', requestId: 'request-2' }))

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

  await game.close()
  t.is(pipe.listenerCount('data'), 0)
})

test('game task rejects structurally invalid commands', async (t) => {
  const pipe = new TestPipe()
  const game = new WorkerTask(pipe, TEST_STORAGE)

  await game.ready()
  pipe.messages.length = 0

  pipe.emit('data', JSON.stringify(null))
  pipe.emit('data', JSON.stringify({ type: '' }))

  t.alike(
    pipe.messages.map(({ code }) => code),
    ['INVALID_COMMAND', 'INVALID_COMMAND']
  )

  await game.close()
})
