'use strict'

const { test } = require('brittle')
const { PassThrough } = require('bare-stream')

const Terminal = require('../../terminal.js')
const TUTORIAL_STAGES = require('../../tutorial/challenges.js')
const { freshTutorialState } = require('../../tutorial/state.js')
const { TARGET_PROGRAM } = require('../helpers/programs.js')

const ALL_LESSONS = [1, 2, 3, 4, 5, 6, 7, 8]

test('fresh managed state opens the shared menu and global play stays local', async (t) => {
  const tutorialStates = []
  const persisted = []
  const { input, chunks, terminal } = createManagedTerminal(t, {
    persistTutorialState(state) {
      persisted.push(state)
    }
  })

  terminal.on('tutorial-state', (state) => tutorialStates.push(state))
  await terminal.ready()

  let screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'menu')
  t.ok(screen.includes('connecting...'))
  t.ok(screen.includes('› 1  Tutorial'))
  t.ok(screen.includes('  2  Solve challenge'))
  t.ok(screen.includes('  3  Leaderboard'))

  input.write('2')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'challenge')
  t.ok(screen.includes('OUTPUT'))
  t.alike(terminal.tutorialState, freshTutorialState())
  t.alike(tutorialStates, [])
  t.alike(persisted, [])
})

test('managed progress starts at the menu and resumes when Tutorial is opened', async (t) => {
  const { input, chunks, terminal } = createManagedTerminal(t, {
    tutorialState: tutorialState({
      completed: [1, 2, 3],
      current: 7,
      solutions: { 1: 'c', 2: 'f', 3: 'c!', 4: 'ad' }
    })
  })

  await terminal.ready()

  let screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'menu')
  t.ok(screen.includes('› 1  Tutorial'))

  input.write('1')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'tutorial')
  t.is(terminal.tutorialStageKey, '4')
  t.is(terminal.readline.line, 'ad')
  t.ok(screen.includes('BIT GOLF — TUTORIAL 4/8'))
  t.ok(screen.includes('INTERSECT'))
  t.ok(screen.includes('2 bytes · stack 2 · incomplete · top preview'))
})

test('started but unsolved progress waits at the menu and resumes lesson one', async (t) => {
  const { input, chunks, terminal } = createManagedTerminal(t, {
    tutorialState: startedTutorialState()
  })

  await terminal.ready()

  let screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'menu')
  t.ok(screen.includes('› 1  Tutorial'))

  input.write('1')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'tutorial')
  t.is(terminal.tutorialStageKey, '1')
  t.is(terminal.readline.line, '')
  t.ok(screen.includes('BIT GOLF — TUTORIAL 1/8'))
})

test('tutorial uses the live editor, recovers from errors, and persists an exact solve', async (t) => {
  const emitted = []
  const persisted = []
  const { input, chunks, terminal } = createManagedTerminal(t, {
    persistTutorialState(state) {
      persisted.push(state)
    }
  })

  terminal.on('tutorial-state', (state) => emitted.push(state))
  await terminal.ready()
  input.write('\r')
  await tick()

  let screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'tutorial')
  t.is(terminal.tutorialStageKey, '1')
  t.ok(screen.includes('TARGET'))
  t.ok(screen.includes('YOUR OUTPUT'))
  t.ok(screen.includes('0 bytes · stack 0 · incomplete'))
  t.ok(screen.includes('— / 64 pixels'))

  input.write('a')
  await tick()

  screen = plainLatestScreen(chunks)
  t.ok(screen.includes('1 byte · stack 1 · valid'))
  t.ok(screen.includes('32 / 64 pixels'))

  input.write('b')
  await tick()
  t.is(terminal.readline.line, 'ab')
  t.ok(plainLatestScreen(chunks).includes('2 bytes · stack 2 · incomplete · top preview'))

  input.write('\u001b[D')
  input.write('!')
  input.write('\u001b[C')
  input.write('\x7f')
  await tick()

  t.is(terminal.readline.line, 'a!')
  t.is(terminal.readline.cursor, 2)

  input.write('\x7f\x7f&')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.readline.line, '&')
  t.ok(screen.includes('1 byte · stack 0 · invalid'))
  t.ok(screen.includes('error: & needs 2 stack values'))
  t.ok(screen.includes('— / 64 pixels'))

  input.write('\x7fc')
  await tick()
  await terminal.tutorialSaveTail

  screen = plainLatestScreen(chunks)
  t.is(terminal.tutorialStageKey, '1')
  t.is(terminal.readline.line, 'c')
  t.ok(terminal.tutorialSolved)
  t.ok(screen.includes('1 byte · stack 1 · valid'))
  t.ok(screen.includes('64 / 64 pixels'))
  t.ok(screen.includes('✓ SOLVED'))
  t.ok(screen.includes('ENTER continue'))
  t.alike(emitted, [startedTutorialState(), solvedLessonOneState()])
  t.alike(persisted, [startedTutorialState(), solvedLessonOneState()])
})

test('all nine tutorial stages remain local and completion waits for Enter', async (t) => {
  const submitted = []
  const persisted = []
  const { input, chunks, terminal } = createManagedTerminal(t, {
    persistTutorialState(state) {
      persisted.push(state)
    }
  })

  terminal.on('submit', (program) => submitted.push(program))
  await terminal.ready()
  input.write('\r')
  await tick()

  for (let index = 0; index < TUTORIAL_STAGES.length; index++) {
    const stage = TUTORIAL_STAGES[index]

    t.is(terminal.tutorialStageKey, stage.key)
    input.write(stage.referenceSolution)
    await tick()

    t.is(terminal.tutorialStageKey, stage.key)
    t.ok(terminal.tutorialSolved, `${stage.key} latches as solved`)
    t.ok(plainLatestScreen(chunks).includes('64 / 64 pixels'))
    t.ok(plainLatestScreen(chunks).includes('✓ SOLVED'))
    t.alike(submitted, [])

    if (stage.key === '8a') {
      t.alike(terminal.tutorialState.completed, [1, 2, 3, 4, 5, 6, 7])
      t.is(terminal.tutorialState.stage, '8b')
      t.absent(terminal.tutorialState.tutorialComplete)
    }

    if (stage.key === '8b') {
      t.alike(terminal.tutorialState.completed, ALL_LESSONS)
      t.absent(terminal.tutorialState.tutorialComplete)
    }

    input.write(index === 0 ? '\r\n' : '\r')
    await tick()

    if (index < TUTORIAL_STAGES.length - 1) {
      t.is(terminal.view, 'tutorial')
      t.is(terminal.tutorialStageKey, TUTORIAL_STAGES[index + 1].key)
    }
  }

  await terminal.tutorialSaveTail

  let screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'tutorial-complete')
  t.ok(screen.includes('TUTORIAL COMPLETE'))
  t.ok(screen.includes('[ENTER] join the global game'))
  t.ok(terminal.tutorialState.tutorialComplete)
  t.alike(terminal.tutorialState.completed, ALL_LESSONS)
  t.ok(persisted[persisted.length - 1].tutorialComplete)
  t.alike(submitted, [])

  input.write('\r')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'challenge')
  t.ok(screen.includes('OUTPUT'))
  t.alike(submitted, [])
})

test('completed state starts at the menu and offers replay there or from the challenge', async (t) => {
  const submitted = []
  const { input, chunks, terminal } = createManagedTerminal(t, {
    tutorialState: completeTutorialState()
  })

  terminal.on('submit', (program) => submitted.push(program))
  await terminal.ready()

  let screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'menu')
  t.ok(screen.includes('› 1  Replay tutorial'))

  input.write('1')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'tutorial')
  t.is(terminal.tutorialStageKey, '1')
  t.ok(terminal.tutorialReplay)
  t.ok(screen.includes('BIT GOLF — TUTORIAL 1/8 · MASKS · REPLAY'))

  await pressEscape(input)
  screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'menu')
  t.ok(screen.includes('› 1  Replay tutorial'))

  input.write('2')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'challenge')
  t.ok(screen.includes('OUTPUT'))

  input.write(':tutorial\r')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'tutorial')
  t.is(terminal.tutorialStageKey, '1')
  t.ok(terminal.tutorialReplay)
  t.ok(screen.includes('BIT GOLF — TUTORIAL 1/8 · MASKS · REPLAY'))
  t.is(terminal.readline.line, '')
  t.alike(submitted, [])
})

test('tutorial reset, hints, and mask-reference commands preserve local editing', async (t) => {
  const emitted = []
  const persisted = []
  const { input, chunks, terminal } = createManagedTerminal(t, {
    tutorialState: completeTutorialState(),
    persistTutorialState(state) {
      persisted.push(state)
    }
  })

  terminal.on('tutorial-state', (state) => emitted.push(state))
  await terminal.ready()

  input.write('2')
  await tick()

  input.write(':masks\r')
  await tick()

  let screen = plainLatestScreen(chunks)
  t.is(terminal.view, 'mask-reference')
  t.ok(screen.includes('BIT GOLF — MASK REFERENCE'))
  t.ok(screen.includes('`abc` describe where you are left-to-right.'))
  t.ok(screen.includes('`def` describe where you are top-to-bottom.'))

  input.write('\r')
  await tick()
  t.is(terminal.view, 'challenge')
  t.is(terminal.readline.line, '')

  input.write(':tutorial reset\r')
  await tick()
  await terminal.tutorialSaveTail

  t.is(terminal.view, 'tutorial')
  t.is(terminal.tutorialStageKey, '1')
  t.absent(terminal.tutorialReplay)
  t.alike(terminal.tutorialState, startedTutorialState())
  t.alike(emitted, [startedTutorialState()])
  t.alike(persisted, [startedTutorialState()])

  input.write('a')
  await tick()
  input.write('?')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.tutorialHint, 1)
  t.is(terminal.readline.line, 'a')
  t.ok(screen.includes('HINT 1/2'))

  input.write(':masks\r')
  await tick()
  t.is(terminal.view, 'mask-reference')
  t.ok(plainLatestScreen(chunks).includes('a ↔ d coarse · b ↔ e · c ↔ f fine'))

  input.write('\r')
  await tick()
  t.is(terminal.view, 'tutorial')
  t.is(terminal.readline.line, 'a')

  input.write(':h\r')
  await tick()

  screen = plainLatestScreen(chunks)
  t.is(terminal.tutorialHint, 2)
  t.is(terminal.readline.line, 'a')
  t.ok(screen.includes('HINT 2/2'))
})

test('leaving tutorial restores a separate global draft, cursor, and history', async (t) => {
  const submitted = []
  const { input, terminal } = createManagedTerminal(t, {
    tutorialState: completeTutorialState()
  })

  terminal.on('submit', (program) => submitted.push(program))
  await terminal.ready()

  input.write('2')
  await tick()

  input.write(`${TARGET_PROGRAM}\r`)
  await tick()
  t.alike(submitted, [TARGET_PROGRAM])
  t.alike(terminal.readline.history, [TARGET_PROGRAM])

  input.write('ab\u001b[D')
  await tick()
  t.is(terminal.readline.line, 'ab')
  t.is(terminal.readline.cursor, 1)

  await pressEscape(input)
  input.write('1')
  await tick()

  t.is(terminal.view, 'tutorial')
  t.is(terminal.readline.line, '')
  t.alike(terminal.readline.history, [])

  await pressEscape(input)
  input.write('2')
  await tick()

  t.is(terminal.view, 'challenge')
  t.is(terminal.readline.line, 'ab')
  t.is(terminal.readline.cursor, 1)
  t.alike(terminal.readline.history, [TARGET_PROGRAM])
  t.alike(submitted, [TARGET_PROGRAM])
})

test('terminal close waits for a pending tutorial-state save', async (t) => {
  let releaseSave = null
  let saveStartedResolve = null
  const saveStarted = new Promise((resolve) => {
    saveStartedResolve = resolve
  })
  const { input, terminal } = createManagedTerminal(t, {
    persistTutorialState(state) {
      saveStartedResolve(state)
      return new Promise((resolve) => {
        releaseSave = resolve
      })
    }
  })

  await terminal.ready()
  input.write('\r')
  const saved = await saveStarted

  t.alike(saved, startedTutorialState())

  let closed = false
  const closing = terminal.close().then(() => {
    closed = true
  })

  await tick()
  t.absent(closed)

  releaseSave()
  await closing
  t.ok(closed)
})

function createManagedTerminal(
  t,
  {
    tutorialState: state = freshTutorialState(),
    persistTutorialState = null,
    columns = 80,
    rows = 50
  } = {}
) {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks = []

  input.isTTY = true
  input.setRawMode = () => {}
  output.isTTY = true
  output.columns = columns
  output.rows = rows
  output.setEncoding('utf8')
  output.on('data', (chunk) => chunks.push(chunk))

  const terminal = new Terminal({
    input,
    output,
    tutorialState: state,
    persistTutorialState
  })

  t.teardown(() => terminal.close(), { force: true })
  return { input, output, chunks, terminal }
}

function tutorialState(overrides = {}) {
  const fresh = freshTutorialState()

  return {
    ...fresh,
    ...overrides,
    completed: [...(overrides.completed || fresh.completed)],
    solutions: { ...fresh.solutions, ...overrides.solutions }
  }
}

function solvedLessonOneState() {
  return tutorialState({
    started: true,
    completed: [1],
    current: 2,
    solutions: { 1: 'c' }
  })
}

function completeTutorialState() {
  return tutorialState({
    started: true,
    completed: ALL_LESSONS,
    current: 8,
    stage: '8b',
    tutorialComplete: true
  })
}

function startedTutorialState() {
  return tutorialState({ started: true })
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

function pressEscape(input) {
  input.write('\u001b')
  return new Promise((resolve) => setTimeout(resolve, 75))
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
