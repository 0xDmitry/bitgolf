const { test } = require('brittle')

const App = require('./app.js')

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
