const { test } = require('brittle')

const App = require('../app.js')

test('app validates and routes structured game messages', (t) => {
  const app = new App({})
  let sent = null
  let ready = false
  let error = null

  app.gamePipe = {
    write(data) {
      sent = JSON.parse(data.toString())
      return true
    }
  }
  app.gameReady = true
  app.on('game-ready', () => {
    ready = true
  })
  app.on('error', (err) => {
    error = err
  })

  t.ok(app.sendGame({ type: 'game:ping', requestId: 'request-3' }))
  t.alike(sent, { type: 'game:ping', requestId: 'request-3' })

  app._onGameMessage(JSON.stringify({ type: 'game:ready' }))
  t.ok(ready)

  app._onGameMessage('{}')
  t.is(error.message, 'Game worker sent an invalid message')

  try {
    app.sendGame({})
    t.fail('invalid command should throw')
  } catch (err) {
    t.is(err.message, 'Game message type must be a non-empty string')
  }
})

test('app waits for the updater before opening the game', async (t) => {
  const steps = []
  let releaseUpdater

  class GatedApp extends App {
    _openUpdater() {
      steps.push('updater')
      return new Promise((resolve) => {
        releaseUpdater = resolve
      })
    }

    _openGame() {
      steps.push('game')
      this.gameReady = true
    }
  }

  const app = new GatedApp({ updates: true })
  const opening = app.ready()

  await Promise.resolve()
  t.alike(steps, ['updater'])

  releaseUpdater(true)
  await opening
  t.alike(steps, ['updater', 'game'])

  await app.close()
})

test('an applied startup update prevents the game from opening', async (t) => {
  let gameOpened = false

  class UpdatedApp extends App {
    _openUpdater() {
      this.updateRequired = true
      this.updateApplied = true
      return false
    }

    _openGame() {
      gameOpened = true
    }
  }

  const app = new UpdatedApp({ updates: true })

  await app.ready()
  t.absent(gameOpened)
  t.absent(app.gameReady)

  await app.close()
})

test('a downloaded update locks the game and is installed before continuing', (t) => {
  const app = new App({ updates: true })
  let gameDestroyed = false
  let updateRequired = false
  let updateApplied = false
  let command = null

  app.gameReady = true
  app.gameStopped = false
  app.gamePipe = {
    destroy() {
      gameDestroyed = true
    }
  }
  app.gameIPC = { destroy() {} }
  app.updaterPipe = {
    write(data) {
      command = JSON.parse(data.toString())
      return true
    }
  }
  app.on('update-required', () => {
    updateRequired = true
  })
  app.on('update-applied', () => {
    updateApplied = true
  })

  app._onUpdaterMessage(JSON.stringify({ type: 'updater:downloaded', version: '0.0.1' }))

  t.ok(updateRequired)
  t.ok(gameDestroyed)
  t.absent(app.gameReady)
  t.ok(app.updateTimeout !== null)
  t.alike(command, { type: 'updater:apply' })

  command = null
  app._onUpdaterMessage(JSON.stringify({ type: 'updater:downloaded', version: '0.0.1' }))
  t.absent(command, 'a repeated download notification must not race a second install')

  app._onUpdaterMessage(JSON.stringify({ type: 'updater:applied', version: '0.0.1' }))

  t.ok(updateApplied)
  t.ok(app.updateApplied)
  t.is(app.updateTimeout, null)
})

test('updater failures reject the startup gate', async (t) => {
  const app = new App({ updates: true })
  const gate = app._createUpdaterGate()
  let reported = null

  app.on('update-error', (err) => {
    reported = err
  })
  app._onUpdaterMessage(JSON.stringify({ type: 'updater:error', error: 'release check failed' }))

  try {
    await gate
    t.fail('the updater gate must fail closed')
  } catch (err) {
    t.is(err.message, 'release check failed')
  }
  t.is(reported.message, 'release check failed')

  await app.close()
})

test('closing the app cancels an unfinished updater gate', async (t) => {
  class HangingUpdaterApp extends App {
    _openUpdater() {
      return this._createUpdaterGate()
    }

    _openGame() {
      t.fail('the game must not open while the updater is pending')
    }
  }

  const app = new HangingUpdaterApp({ updates: true })
  const opening = app.ready()

  await Promise.resolve()
  await app.close()

  try {
    await opening
    t.fail('opening must be cancelled')
  } catch (err) {
    t.is(err.message, 'App closed during startup')
  }
  t.ok(app.closed)
})

test('closing cancels an update discovered while the game is opening', async (t) => {
  let rejectGame

  class InterruptedGameApp extends App {
    _openUpdater() {
      return true
    }

    _openGame() {
      return new Promise((resolve, reject) => {
        rejectGame = reject
      })
    }
  }

  const app = new InterruptedGameApp({ updates: true })
  const opening = app.ready()

  await Promise.resolve()
  app._requireUpdate()
  rejectGame(new Error('Game stopped for update'))
  await Promise.resolve()
  await app.close()

  try {
    await opening
    t.fail('the startup update wait must be cancelled')
  } catch (err) {
    t.is(err.message, 'App closed during startup')
  }
  t.ok(app.closed)
})
