const { test } = require('brittle')
const { PassThrough } = require('bare-stream')

const Terminal = require('../terminal.js')

test('terminal renders a readable and escape-safe leaderboard', async (t) => {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks = []

  output.setEncoding('utf8')
  output.on('data', (chunk) => chunks.push(chunk))

  const terminal = new Terminal({ input, output })
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  terminal.updateState({
    playerKey: '91ac72' + '0'.repeat(58),
    peers: 3,
    leaderboard: [
      {
        score: 1,
        author: '82af91' + '0'.repeat(58),
        program: '\u001b[31mx'
      }
    ]
  })
  terminal.showSubmission({ valid: true, score: 1 })
  await new Promise((resolve) => setTimeout(resolve, 0))

  const screen = chunks.join('')

  t.ok(screen.includes('player   91ac72...'))
  t.ok(screen.includes('1       82af91...'))
  t.ok(screen.includes('\\u001b[31mx'))
  t.absent(screen.includes('\u001b[31m'))
  t.ok(screen.includes('✓ valid\nscore 1'))
})

test('terminal accepts piped lines and renders remote state updates', async (t) => {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks = []
  const programs = []

  output.setEncoding('utf8')
  output.on('data', (chunk) => chunks.push(chunk))

  const terminal = new Terminal({ input, output })
  terminal.on('submit', (program) => programs.push(program))
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('hello\r\n')
  await new Promise((resolve) => setTimeout(resolve, 0))

  terminal.updateState({
    playerKey: '91ac72' + '0'.repeat(58),
    peers: 1,
    leaderboard: []
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  t.alike(programs, ['hello'])
  t.ok(chunks.join('').includes('connecting...'))
  t.ok(chunks.join('').includes('peers    1'))
})
