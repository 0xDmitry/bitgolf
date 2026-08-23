'use strict'

const { test } = require('brittle')

const SubmissionCoordinator = require('../submission-coordinator.js')

test('piped submissions queue until ready, preserve order, and delay EOF', (t) => {
  const terminal = new FakeTerminal(false)
  const app = new FakeApp(false)
  const exits = []
  const coordinator = createCoordinator(terminal, app, exits)

  terminal.emit('submit', 'first')
  terminal.emit('submit', 'second')
  terminal.emit('exit', 0)

  t.alike(app.sent, [])
  t.alike(exits, [])

  app.gameReady = true
  app.emit('game-ready')

  t.alike(
    app.sent.map(({ requestId, program }) => ({ requestId, program })),
    [
      { requestId: 'submission-1', program: 'first' },
      { requestId: 'submission-2', program: 'second' }
    ]
  )
  t.alike(exits, [])

  app.emit('game-message', result('submission-1', 5))
  coordinator.markInitialized()

  t.alike(exits, [])

  app.emit('game-message', result('submission-2', 6))

  t.alike(exits, [0])
  t.alike(
    terminal.submissions.map(({ requestId }) => requestId),
    ['submission-1', 'submission-2']
  )
})

test('piped EOF waits for initialization even without a submission', (t) => {
  const terminal = new FakeTerminal(false)
  const app = new FakeApp(false)
  const exits = []
  const coordinator = createCoordinator(terminal, app, exits)

  terminal.emit('exit', 0)
  t.alike(exits, [])

  app.gameReady = true
  app.emit('game-ready')
  t.alike(exits, [])

  coordinator.markInitialized()
  t.alike(exits, [0])
})

test('request-specific failures settle piped submissions', (t) => {
  const terminal = new FakeTerminal(false)
  const app = new FakeApp(true)
  const exits = []
  const coordinator = createCoordinator(terminal, app, exits)

  coordinator.markInitialized()
  terminal.emit('submit', 'first')
  terminal.emit('submit', 'second')
  terminal.emit('exit', 0)

  app.emit('game-error', {
    type: 'game:error',
    requestId: 'submission-1',
    error: 'first failed'
  })

  t.alike(exits, [])
  t.alike(terminal.errors, ['first failed'])

  app.emit('game-message', result('submission-2', 6))

  t.alike(exits, [1])
})

test('rejected piped submissions return a failure exit code', (t) => {
  const terminal = new FakeTerminal(false)
  const app = new FakeApp(true)
  const exits = []
  const coordinator = createCoordinator(terminal, app, exits)

  coordinator.markInitialized()
  terminal.emit('submit', 'rejected')
  terminal.emit('exit', 0)
  app.emit('game-message', {
    type: 'game:submit-result',
    requestId: 'submission-1',
    valid: false,
    score: 0
  })

  t.alike(exits, [1])
  t.is(terminal.submissions[0].valid, false)
})

test('synchronous send failures settle queued piped submissions', (t) => {
  const terminal = new FakeTerminal(false)
  const app = new FakeApp(true)
  const exits = []
  const coordinator = createCoordinator(terminal, app, exits)

  app.sendError = new Error('write failed')
  terminal.emit('submit', 'program')
  terminal.emit('exit', 0)

  t.alike(exits, [])
  coordinator.markInitialized()

  t.alike(terminal.errors, ['write failed'])
  t.alike(exits, [1])
})

test('fatal app errors abort piped work but remain recoverable interactively', (t) => {
  const pipedTerminal = new FakeTerminal(false)
  const pipedApp = new FakeApp(true)
  const pipedExits = []

  createCoordinator(pipedTerminal, pipedApp, pipedExits)
  pipedTerminal.emit('submit', 'pending')
  pipedTerminal.emit('exit', 0)
  pipedApp.emit('error', new Error('worker crashed'))

  t.alike(pipedTerminal.errors, ['worker crashed'])
  t.alike(pipedExits, [1])

  const interactiveTerminal = new FakeTerminal(true)
  const interactiveApp = new FakeApp(true)
  const interactiveExits = []

  createCoordinator(interactiveTerminal, interactiveApp, interactiveExits)
  interactiveApp.emit('error', new Error('worker crashed'))

  t.alike(interactiveTerminal.errors, ['worker crashed'])
  t.alike(interactiveExits, [])
})

test('interactive submission and exit behavior remains immediate', (t) => {
  const terminal = new FakeTerminal(true)
  const app = new FakeApp(false)
  const exits = []

  createCoordinator(terminal, app, exits)

  terminal.emit('submit', 'too-early')
  t.alike(app.sent, [])
  t.alike(terminal.errors, ['game worker is still connecting'])

  app.gameReady = true
  terminal.emit('submit', 'program')

  t.alike(app.sent, [
    {
      type: 'game:submit',
      requestId: 'submission-1',
      program: 'program'
    }
  ])

  terminal.emit('exit', 130)
  t.alike(exits, [130])
})

test('submission coordinator preserves the selected challenge id', (t) => {
  const terminal = new FakeTerminal(true)
  const app = new FakeApp(true)

  createCoordinator(terminal, app, [])
  terminal.emit('submit', 'program', 'future-v2')

  t.is(app.sent[0].challenge, 'future-v2')
  t.is(app.sent[0].program, 'program')
})

function createCoordinator(terminal, app, exits) {
  return new SubmissionCoordinator({
    terminal,
    app,
    onExit(code) {
      exits.push(code)
    }
  })
}

function result(requestId, score) {
  return {
    type: 'game:submit-result',
    requestId,
    valid: true,
    score
  }
}

class FakeEmitter {
  constructor() {
    this.listeners = new Map()
  }

  on(name, listener) {
    const listeners = this.listeners.get(name) || []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }

  removeListener(name, listener) {
    const listeners = this.listeners.get(name) || []
    this.listeners.set(
      name,
      listeners.filter((candidate) => candidate !== listener)
    )
  }

  emit(name, ...values) {
    for (const listener of this.listeners.get(name) || []) listener(...values)
  }
}

class FakeTerminal extends FakeEmitter {
  constructor(interactive) {
    super()
    this.interactive = interactive
    this.submitting = 0
    this.submissions = []
    this.errors = []
  }

  showSubmitting() {
    this.submitting++
  }

  showSubmission(result) {
    this.submissions.push(result)
  }

  showError(error) {
    this.errors.push(error)
  }
}

class FakeApp extends FakeEmitter {
  constructor(gameReady) {
    super()
    this.gameReady = gameReady
    this.sent = []
    this.sendError = null
  }

  sendGame(message) {
    this.sent.push(message)
    if (this.sendError !== null) throw this.sendError
    return true
  }
}
