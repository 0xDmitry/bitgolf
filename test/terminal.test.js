const { test } = require('brittle')
const { PassThrough } = require('bare-stream')

const Terminal = require('../terminal.js')
const { TARGET_PROGRAM } = require('./helpers/programs.js')
const CHALLENGES = require('../workers/game/challenges.js')
const { bitmapId } = require('../workers/game/protocol.js')

const CHALLENGE_ID = bitmapId(CHALLENGES[0].target)

const TARGET_ROWS = [
  '····█···',
  '···█····',
  '··███···',
  '···███··',
  '·██████·',
  '····███·',
  '··████··',
  '···██···'
]

test('terminal labels the local player and safely shortens other player ids', async (t) => {
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
    leaderboards: {
      [CHALLENGE_ID]: [
        {
          score: 1,
          author: '82af91' + '0'.repeat(58),
          program: '\u001b[31mx'
        },
        {
          score: 2,
          author: '91ac72' + '0'.repeat(58),
          program: ' \ta!\n '
        }
      ]
    }
  })
  terminal.showSubmission({ valid: true, score: 1 })
  await new Promise((resolve) => setTimeout(resolve, 0))

  const screen = chunks.join('')

  t.absent(screen.includes('BIT GOLF'))
  t.ok(screen.includes('\nconnected · 3 peers\n'))
  t.ok(screen.includes('connected · 3 peers'))
  t.absent(screen.includes('91ac72'))
  t.ok(screen.includes('1       82af91...'))
  t.ok(screen.includes('2       YOU          a!'))
  t.absent(screen.includes('\\ta!\\n'))
  t.ok(screen.includes('\\u001b[31mx'))
  t.absent(screen.includes('\u001b[31m'))
  t.ok(screen.includes('✓ submitted · score 1'))
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
  input.write('a\r\n')
  await new Promise((resolve) => setTimeout(resolve, 0))

  t.alike(programs, [])
  t.ok(chunks.join('').includes('1 byte · syntax valid · target mismatch'))
  t.ok(chunks.join('').includes('OUTPUT     TARGET     DIFF'))
  t.ok(chunks.join('').includes(`│····████│ │${TARGET_ROWS[0]}│ │·····███│`))
  t.ok(chunks.join('').includes('target-matching lines submit automatically'))
  t.absent(chunks.join('').includes('ENTER when matched'))

  input.write(`${TARGET_PROGRAM}\r\n`)
  await new Promise((resolve) => setTimeout(resolve, 0))

  t.ok(chunks.join('').includes(`${TARGET_PROGRAM.length} bytes · target matched`))
  t.ok(chunks.join('').includes('DIFF · exact match'))

  terminal.updateState({
    playerKey: '91ac72' + '0'.repeat(58),
    peers: 1,
    leaderboards: { [CHALLENGE_ID]: [] }
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  t.alike(programs, [TARGET_PROGRAM])
  t.ok(chunks.join('').includes('connecting...'))
  t.ok(chunks.join('').includes('connected · 1 peer'))
})

test('interactive terminal opens with a descriptive navigable menu', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  const terminal = new Terminal({ input, output })

  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()

  let screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'menu')
  t.ok(screen.includes('Draw 8×8 monochrome images with tiny postfix Boolean programs.'))
  t.ok(screen.includes('Every token costs one byte. Lower scores lead the shared leaderboard.'))
  t.ok(screen.includes('connecting...'))
  t.ok(screen.includes('› 1  Start tutorial'))
  t.ok(screen.includes('  2  Solve challenge'))
  t.ok(screen.includes('  3  Leaderboard'))
  t.ok(screen.includes('↑/↓ choose · ENTER open · 1-3 shortcut · Ctrl+C quit'))
  t.ok(latestScreen(chunks).endsWith('\u001b[?7h\u001b[?25l\u001b[1;1H'))

  terminal.updateState({
    playerKey: '91ac72' + '0'.repeat(58),
    peers: 0,
    leaderboards: { [CHALLENGE_ID]: [] }
  })
  await tick()

  t.is(firstVisibleLine(chunks), 'connected · 0 peers')
  t.absent(plainLatestScreen(chunks).includes('91ac72'))
  t.ok(plainLatestScreen(chunks).startsWith('\r\n\r\nconnected · 0 peers'))
  t.ok(plainLatestScreen(chunks).includes('connected · 0 peers\r\n\r\nDraw 8×8 monochrome images'))

  input.write('\u001b[B')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.menuIndex, 1)
  t.ok(screen.includes('› 2  Solve challenge'))

  input.write('\r')
  await tick()

  t.is(terminal.view, 'challenge')
  t.is(firstVisibleLine(chunks), 'connected · 0 peers')
  t.ok(plainLatestScreen(chunks).startsWith('\r\n\r\nconnected · 0 peers'))
  t.ok(plainLatestScreen(chunks).includes('connected · 0 peers\r\n\r\nOUTPUT'))
  t.absent(plainLatestScreen(chunks).includes('SOLVE CHALLENGE'))

  await pressEscape(input)
  t.is(terminal.view, 'menu')

  input.write('1')
  await tick()
  t.is(terminal.view, 'tutorial')
  t.is(firstVisibleLine(chunks), 'connected · 0 peers')
  t.ok(plainLatestScreen(chunks).startsWith('\r\n\r\nconnected · 0 peers'))
  t.ok(plainLatestScreen(chunks).includes('connected · 0 peers\r\n\r\nTUTORIAL'))
  t.ok(plainLatestScreen(chunks).includes('TUTORIAL 1/3 · Coordinate bits'))

  await pressEscape(input)
  input.write('3')
  await tick()
  t.is(terminal.view, 'leaderboard')
  t.is(firstVisibleLine(chunks), 'connected · 0 peers')
  screen = plainLatestScreen(chunks)
  t.ok(screen.startsWith('\r\n\r\nconnected · 0 peers'))
  t.ok(screen.includes('connected · 0 peers\r\n\r\nSCORE'))
  t.ok(screen.includes('SCORE   PLAYER       PROGRAM\r\n(no submissions yet)'))
  t.ok(screen.includes('(no submissions yet)\r\n\r\nEsc menu'))
  t.is(screen.split('Esc menu').length - 1, 1)
  t.absent(screen.includes('PgUp/PgDn'))
  t.absent(screen.includes('LEADERBOARD'))

  input.write('q')
  await tick()
  t.is(terminal.view, 'menu')
  t.ok(plainLatestScreen(chunks).includes('› 3  Leaderboard'))
})

test('short main menu truncates from the top and redraws safely after resize', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  const terminal = new Terminal({ input, output })

  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  output.rows = 8
  output.emit('resize')
  await tick()

  const screen = plainLatestScreen(chunks)
  const redraw = chunks[chunks.length - 1]
  t.absent(screen.includes('connecting...'))
  t.absent(screen.includes('Draw 8×8 monochrome images'))
  t.absent(screen.includes('Every token costs one byte'))
  t.ok(screen.includes('Choose a path:'))
  t.ok(screen.includes('› 1  Start tutorial'))
  t.ok(screen.includes('  2  Solve challenge'))
  t.ok(screen.includes('  3  Leaderboard'))
  t.ok(screen.includes('↑/↓ choose · ENTER open · 1-3 shortcut · Ctrl+C quit'))
  t.absent(redraw.includes('\r'))
  t.absent(redraw.includes('\n'))
  t.absent(redraw.includes('\u001b[2J'))
  t.ok(redraw.startsWith('\u001b[?25l\u001b[?7l'))
  t.is(redraw.split('\u001b[2K').length - 1, output.rows)
  t.ok(redraw.endsWith('\u001b[?7h\u001b[?25l\u001b[1;1H'))
})

test('tutorial treats CRLF as one step and completes into the challenge', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  const programs = []
  const terminal = new Terminal({ input, output })

  terminal.on('submit', (program) => programs.push(program))
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('1')
  await tick()

  t.is(terminal.tutorialPage, 0)
  t.ok(plainLatestScreen(chunks).includes('TUTORIAL 1/3 · Coordinate bits'))

  input.write('\r\n')
  await tick()

  t.is(terminal.view, 'tutorial')
  t.is(terminal.tutorialPage, 1)
  t.ok(plainLatestScreen(chunks).includes('TUTORIAL 2/3 · Postfix operators'))
  t.absent(plainLatestScreen(chunks).includes('TUTORIAL 3/3'))

  input.write('\r\n')
  await tick()

  t.is(terminal.tutorialPage, 2)
  t.ok(plainLatestScreen(chunks).includes('TUTORIAL 3/3 · Valid programs and scoring'))
  t.ok(plainLatestScreen(chunks).includes('Only programs that draw the target can be submitted'))
  t.ok(plainLatestScreen(chunks).includes('The live preview and diff update after every edit.'))
  t.ok(plainLatestScreen(chunks).includes('ENTER solve challenge'))

  input.write('\r\n')
  await tick()

  t.is(terminal.view, 'challenge')
  t.ok(plainLatestScreen(chunks).includes('OUTPUT'))
  t.absent(plainLatestScreen(chunks).includes('SOLVE CHALLENGE'))
  t.is(terminal.readline.line, '')
  t.alike(programs, [])
})

test('short tutorial keeps its footer and truncates content from the top', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  output.rows = 10

  const terminal = new Terminal({ input, output })
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('1')
  await tick()

  const screen = plainLatestScreen(chunks)
  t.absent(screen.includes('connecting...'))
  t.ok(screen.includes('TUTORIAL 1/3 · Coordinate bits'))
  t.ok(screen.includes('Example: a lights the right half; d lights the bottom half.'))
  t.ok(screen.includes('\r\n\r\n←/→ step · ENTER next · Esc menu'))
  t.absent(screen.includes('PgUp/PgDn'))
})

test('challenge renders the exact target and a meaningful live diff', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  const terminal = new Terminal({ input, output })

  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('2')
  await tick()

  let screen = plainLatestScreen(chunks)
  const emptyPanels = TARGET_ROWS.map((row) => `│        │ │${row}│ │        │`).join('\r\n')

  t.ok(screen.includes('OUTPUT     TARGET     DIFF'))
  t.ok(screen.includes(emptyPanels))
  t.ok(screen.includes('DIFF · unavailable until output can be evaluated'))
  t.ok(screen.includes('ENTER when matched · Esc menu'))

  input.write('a')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('│····████│ │····█···│ │·····███│'))
  t.ok(screen.includes('1 byte · syntax valid · target mismatch'))
  t.ok(screen.includes('DIFF · 29 mismatches · █ marks a mismatch'))
  t.ok(screen.includes('ENTER when matched · Esc menu'))

  input.write('b')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('2 bytes · stack 2 · incomplete'))
  t.ok(screen.includes('2 bytes · stack 2 · incomplete · top preview'))
  t.ok(screen.includes('DIFF · '))
  t.absent(screen.includes('DIFF · unavailable'))

  input.write('\x7f\x7f&')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('1 byte · invalid'))
  t.ok(screen.includes('DIFF · unavailable until output can be evaluated'))

  output.columns = 32
  output.rows = 24
  output.emit('resize')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('OUTPUT    TARGET    DIFF'))
  t.ok(screen.includes('┌────────┐┌────────┐┌────────┐'))
  t.ok(screen.includes(`│        ││${TARGET_ROWS[7]}││        │`))
  t.ok(screen.includes('PROGRAM'))

  output.columns = 30
  output.rows = 40
  output.emit('resize')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('OUTPUT     TARGET'))
  t.ok(screen.includes('\r\n\r\nDIFF\r\n'))
  t.absent(screen.includes('OUTPUT     TARGET     DIFF'))

  output.columns = 21
  output.rows = 60
  output.emit('resize')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.indexOf('OUTPUT') < screen.indexOf('TARGET'))
  t.ok(screen.indexOf('TARGET') < screen.indexOf('DIFF'))
  t.ok(screen.split('\r\n').every((line) => line.length <= 20))
})

test('terminal rejects challenge definitions outside the registry', (t) => {
  const { input, output } = interactiveStreams()

  try {
    new Terminal({ input, output, challengeId: 'missing-v1' })
    t.fail('unknown challenges must not be rendered')
  } catch (err) {
    t.is(err.message, 'Unknown challenge: missing-v1')
  }
})

test('terminal reevaluates live edits and only submits target matches', async (t) => {
  const { input, output, chunks, rawModes } = interactiveStreams()
  const programs = []
  const terminal = new Terminal({ input, output })

  terminal.on('submit', (program) => programs.push(program))
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  t.alike(rawModes, [true])

  terminal.updateState({
    playerKey: '91ac72' + '0'.repeat(58),
    peers: 1,
    leaderboards: {
      [CHALLENGE_ID]: [
        {
          score: 1,
          author: '91ac72' + '0'.repeat(58),
          program: 'a'
        }
      ]
    }
  })

  input.write('2')
  await tick()

  input.write('a')
  await tick()

  let screen = plainLatestScreen(chunks)
  t.ok(screen.includes('> a\r\n'))
  t.ok(screen.includes('│····████│ │····█···│ │·····███│'))
  t.ok(screen.includes('1 byte · syntax valid · target mismatch'))
  t.ok(screen.includes('ENTER when matched'))
  t.ok(screen.includes('> a\r\n\r\nENTER when matched'))
  t.ok(screen.lastIndexOf('OUTPUT') < screen.lastIndexOf('PROGRAM'))
  const redraw = latestScreen(chunks)
  t.absent(redraw.includes('\r'))
  t.absent(redraw.includes('\n'))
  t.absent(redraw.includes('\u001b[2J'))
  t.is(redraw.split('\u001b[2K').length - 1, output.rows)
  t.ok(redraw.endsWith('\u001b[18;4H'))
  t.absent(chunks.join('').includes('\u001b[?1049h'))
  t.absent(chunks.join('').includes('\u001b[3J'))
  t.is(chunks.join('').split('\u001b[2J\u001b[H').length - 1, 1)

  input.write('b')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('> ab\r\n'))
  t.ok(screen.includes('2 bytes · stack 2 · incomplete'))

  input.write('\r')
  await tick()

  t.alike(programs, [])
  t.is(terminal.readline.line, 'ab')

  await pressEscape(input)

  t.is(terminal.view, 'menu')
  t.is(terminal.readline.line, 'ab')
  t.ok(plainLatestScreen(chunks).includes('Choose a path:'))

  input.write('2')
  await tick()

  t.is(terminal.view, 'challenge')
  t.is(terminal.readline.line, 'ab')
  t.ok(plainLatestScreen(chunks).includes('> ab\r\n'))
  t.ok(plainLatestScreen(chunks).includes('2 bytes · stack 2 · incomplete'))

  input.write('\x7f')
  input.write('!')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('> a!\r\n'))
  t.ok(screen.includes('│████····│ │····█···│ │█████···│'))
  t.ok(screen.includes('2 bytes · syntax valid · target mismatch'))

  input.write('\u001b[D')
  input.write('b')
  input.write('\u001b[C')
  input.write('&')
  await tick()

  t.is(terminal.readline.line, 'ab!&')
  t.ok(plainLatestScreen(chunks).includes('4 bytes · syntax valid · target mismatch'))

  input.write('\r')
  await tick()

  t.alike(programs, [])
  t.is(terminal.readline.line, 'ab!&')

  input.write('\x7f\x7f\x7f\x7f')
  input.write(TARGET_PROGRAM)
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes(`${TARGET_PROGRAM.length} bytes · target matched`))
  t.ok(screen.includes('DIFF · exact match'))
  t.ok(screen.includes('ENTER submit · Esc menu'))

  input.write('\r')
  await tick()

  t.alike(programs, [TARGET_PROGRAM])
  t.is(terminal.readline.line, '')
})

test('interactive editor handles CRLF, printable keys, and history', async (t) => {
  const { input, output } = interactiveStreams()
  const programs = []
  const terminal = new Terminal({ input, output })

  terminal.on('submit', (program) => programs.push(program))
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('2')
  await tick()
  input.write(`${TARGET_PROGRAM}\r\n`)
  await tick()

  t.alike(programs, [TARGET_PROGRAM])
  t.is(terminal.readline.line, '')

  input.write('\u001b[A')
  await tick()
  t.is(terminal.readline.line, TARGET_PROGRAM)

  input.write('\u001b[B')
  input.write('A!')
  await tick()
  t.is(terminal.readline.line, 'A!')

  input.write('\b\x7f')
  await tick()
  t.is(terminal.readline.line, '')
})

test('interactive redraw uses an absolute cursor in a one-row viewport', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  output.rows = 1

  const terminal = new Terminal({ input, output })
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('2')
  await tick()
  input.write('a')
  await tick()

  t.absent(latestScreen(chunks).includes('\n'))
  t.ok(latestScreen(chunks).endsWith('\u001b[1;4H'))
})

test('challenge keeps history navigation and redraws on resize', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  output.rows = 10

  const terminal = new Terminal({ input, output })
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write(`2${TARGET_PROGRAM}\r`)
  await tick()

  t.is(terminal.readline.line, '')

  input.write('\u001b[A')
  await tick()

  let screen = plainLatestScreen(chunks)
  t.is(terminal.readline.line, TARGET_PROGRAM)
  t.is(terminal.viewportStart, null)
  t.ok(screen.includes('DIFF · exact match'))
  t.ok(screen.includes('ENTER submit · Esc menu'))
  t.absent(screen.includes('↑/↓ one row'))
  t.absent(screen.includes('PgUp/PgDn'))
  t.absent(screen.includes('/15 ·'))

  const beforePageKey = chunks.length
  input.write('\u001b[5~')
  await tick()
  t.is(chunks.length, beforePageKey)
  t.is(terminal.readline.line, TARGET_PROGRAM)
  t.is(terminal.viewportStart, null)

  input.write('\u001b[B')
  await tick()
  t.is(terminal.readline.line, '')
  t.is(terminal.viewportStart, null)

  input.write('\u001b[A')
  await tick()

  const beforeResize = chunks.length
  output.rows = 24
  output.emit('resize')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(chunks.length > beforeResize)
  t.ok(screen.includes('OUTPUT     TARGET     DIFF'))
  t.ok(screen.includes('PROGRAM'))
  t.ok(screen.includes(`${TARGET_PROGRAM.length} bytes · target matched`))
  t.ok(screen.includes('ENTER submit · Esc menu'))
  t.absent(screen.includes('PgUp/PgDn'))
  t.is(latestScreen(chunks).split('\u001b[2K').length - 1, output.rows)
})

test('challenge shows submission feedback without embedding the leaderboard', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  const terminal = new Terminal({ input, output })
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  terminal.updateState({
    playerKey: '91ac72' + '0'.repeat(58),
    peers: 1,
    leaderboards: {
      [CHALLENGE_ID]: [
        {
          score: 1,
          author: '91ac72' + '0'.repeat(58),
          program: 'a'
        }
      ]
    }
  })

  input.write('2')
  await tick()

  terminal.showSubmitting()
  await tick()

  let screen = plainLatestScreen(chunks)
  t.absent(screen.includes('SCORE   PLAYER       PROGRAM'))
  t.absent(screen.includes('1       YOU          a'))
  t.absent(screen.includes('91ac72'))
  t.ok(screen.includes('OUTPUT'))
  t.ok(screen.includes('PROGRAM'))
  t.ok(screen.includes('submitting...'))
  t.ok(screen.includes('ENTER when matched · Esc menu'))

  input.write('a')
  await tick()

  terminal.showSubmission({ valid: true, score: 1 })
  await tick()

  screen = plainLatestScreen(chunks)
  t.absent(screen.includes('SCORE   PLAYER       PROGRAM'))
  t.ok(screen.includes('1 byte · syntax valid · target mismatch'))
  t.ok(screen.includes('✓ submitted · score 1'))
  t.ok(screen.includes('ENTER when matched · Esc menu'))
})

test('dedicated leaderboard starts at the top and supports every scroll control', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  output.rows = 10

  const terminal = new Terminal({ input, output })
  const leaderboard = Array.from({ length: 30 }, (_, score) => ({
    score,
    author: String(score).padStart(6, '0') + '0'.repeat(58),
    program: 'a'
  }))

  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  terminal.updateState({
    playerKey: '91ac72' + '0'.repeat(58),
    peers: 1,
    leaderboards: { [CHALLENGE_ID]: leaderboard }
  })

  input.write('3')
  await tick()

  let screen = plainLatestScreen(chunks)
  const redraw = latestScreen(chunks)
  t.is(terminal.view, 'leaderboard')
  t.is(terminal.viewportStart, null)
  t.is(firstVisibleLine(chunks), 'connected · 1 peer')
  t.absent(screen.includes('LEADERBOARD'))
  t.ok(screen.includes('connected · 1 peer\r\n\r\nSCORE'))
  t.ok(screen.includes('SCORE   PLAYER       PROGRAM'))
  t.ok(screenHasScore(screen, 0))
  t.absent(screenHasScore(screen, 29))
  t.ok(screen.includes('000000...'))
  t.ok(screen.includes('PgUp/PgDn one page'))
  t.is(screen.split('PgUp/PgDn one page').length - 1, 1)
  t.ok(screen.includes('\r\n\r\n1-8/34 · ↑/↓ one row'))
  t.absent(screen.includes('HOME/END'))
  t.is(terminal.readline.line, '')
  t.absent(redraw.includes('\r'))
  t.absent(redraw.includes('\n'))
  t.absent(redraw.includes('\u001b[2J'))
  t.is(redraw.split('\u001b[2K').length - 1, output.rows)
  t.ok(redraw.endsWith('\u001b[?7h\u001b[?25l\u001b[1;1H'))

  input.write('\u001b[B')
  await tick()
  t.is(terminal.viewportStart, 1)

  input.write('\u001b[6~')
  await tick()
  t.is(terminal.viewportStart, 9)

  output.rows = 7
  output.emit('resize')
  await tick()

  const resizeRedraw = chunks[chunks.length - 1]
  t.is(terminal.viewportStart, 9)
  t.ok(plainLatestScreen(chunks).includes('10-14/34 · ↑/↓ one row'))
  t.absent(resizeRedraw.includes('\r'))
  t.absent(resizeRedraw.includes('\n'))
  t.absent(resizeRedraw.includes('\u001b[2J'))
  t.ok(resizeRedraw.startsWith('\u001b[?25l\u001b[?7l'))
  t.is(resizeRedraw.split('\u001b[2K').length - 1, output.rows)
  t.ok(resizeRedraw.endsWith('\u001b[?7h\u001b[?25l\u001b[1;1H'))

  output.rows = 10
  output.emit('resize')
  await tick()
  t.is(terminal.viewportStart, 9)

  input.write('\u001b[5~')
  await tick()
  t.is(terminal.viewportStart, 1)

  input.write('\u001b[F')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.viewportStart, 26)
  t.absent(screen.includes('connected · 1 peer'))
  t.ok(screenHasScore(screen, 29))
  t.absent(screenHasScore(screen, 0))
  t.ok(latestScreen(chunks).endsWith('\u001b[?7h\u001b[?25l\u001b[1;1H'))

  input.write('\u001b[A')
  await tick()
  t.is(terminal.viewportStart, 25)
  t.ok(screenHasScore(plainLatestScreen(chunks), 22))

  input.write('\u001b[H')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.viewportStart, null)
  t.absent(screen.includes('LEADERBOARD'))
  t.ok(screenHasScore(screen, 0))
  t.absent(screenHasScore(screen, 29))

  input.write('q')
  await tick()

  t.is(terminal.view, 'menu')
  t.ok(plainLatestScreen(chunks).includes('Choose a path:'))
  t.ok(plainLatestScreen(chunks).includes('› 3  Leaderboard'))

  await terminal.close()
  t.ok(chunks.join('').endsWith('\u001b[?25h\r\n'))
})

test('terminal shows invalid edits, supports recovery, and renders checkerboard', async (t) => {
  const { input, output, chunks } = interactiveStreams()
  const programs = []
  const terminal = new Terminal({ input, output })

  terminal.on('submit', (program) => programs.push(program))
  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('2')
  await tick()
  input.write('&')
  await tick()

  let screen = plainLatestScreen(chunks)
  t.ok(screen.includes('1 byte · invalid'))
  t.ok(screen.includes('error: & needs 2 stack values'))

  input.write('\r')
  await tick()
  t.alike(programs, [])
  t.is(terminal.readline.line, '&')

  input.write('\x7f')
  input.write('g')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('0 bytes · invalid'))
  t.ok(screen.includes('error: Unsupported token "g"'))

  input.write('\x7f')
  input.write('cf^')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('│·█·█·█·█│ │····█···│'))
  t.ok(screen.includes('│█·█·█·█·│ │···█····│'))
  t.ok(screen.includes('3 bytes · syntax valid · target mismatch'))
})

test('terminal restores raw input and exits on ctrl+c without changing screen buffers', async (t) => {
  const { input, output, chunks, rawModes } = interactiveStreams()
  const terminal = new Terminal({ input, output })
  const exited = new Promise((resolve) => terminal.once('exit', resolve))

  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('\x03')

  t.is(await exited, 130)
  await tick()
  t.alike(rawModes, [true, false])
  t.absent(chunks.join('').includes('\u001b[?1049h'))
  t.absent(chunks.join('').includes('\u001b[?1049l'))
})

test('terminal exits on ctrl+d without processing trailing input', async (t) => {
  const { input, output, chunks, rawModes } = interactiveStreams()
  const terminal = new Terminal({ input, output })
  const exited = new Promise((resolve) => terminal.once('exit', resolve))

  t.teardown(() => terminal.close(), { force: true })

  await terminal.ready()
  input.write('\x04a')

  t.is(await exited, 130)
  await tick()
  t.is(terminal.readline.line, '')
  t.alike(rawModes, [true, false])
  t.absent(chunks.join('').includes('\u001b[?1049l'))
})

function interactiveStreams() {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks = []
  const rawModes = []

  input.isTTY = true
  input.setRawMode = (mode) => rawModes.push(mode)
  output.isTTY = true
  output.columns = 80
  output.rows = 24
  output.setEncoding('utf8')
  output.on('data', (chunk) => chunks.push(chunk))

  return { input, output, chunks, rawModes }
}

function latestScreen(chunks) {
  const output = chunks.join('')
  const start = output.lastIndexOf('\u001b[1;1H\u001b[2K')
  return start === -1 ? output : output.slice(start)
}

function plainLatestScreen(chunks) {
  return latestScreen(chunks)
    .replace(/\u001b\[\d+;1H\u001b\[2K/g, '\r\n')
    .replace(/\u001b\[\?25[hl]/g, '')
    .replace(/\u001b\[\d+;\d+H$/, '')
}

function firstVisibleLine(chunks) {
  return plainLatestScreen(chunks)
    .split('\r\n')
    .find((line) => line.length > 0)
}

function screenHasScore(screen, score) {
  const prefix = String(score).padEnd(8)
  return screen.split('\r\n').some((line) => line.startsWith(prefix))
}

function pressEscape(input) {
  input.write('\u001b')
  return new Promise((resolve) => setTimeout(resolve, 75))
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
