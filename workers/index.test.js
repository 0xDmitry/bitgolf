const { test } = require('brittle')
const os = require('bare-os')
const path = require('bare-path')

const App = require('../app.js')

const TEST_STORAGE = path.join(os.tmpdir(), 'bitgolf-tests')

class GameOnlyApp extends App {
  _openUpdater() {}
}

test('app waits for the game worker and supports a framed IPC round trip', async (t) => {
  const app = new GameOnlyApp({ dir: TEST_STORAGE })
  let resolvePong
  const pong = new Promise((resolve) => {
    resolvePong = resolve
  })

  app.on('error', (err) => t.fail(err.message))
  app.on('game-message', (message) => {
    if (message.type === 'game:pong') resolvePong(message)
  })
  t.teardown(() => app.close())

  await app.ready()
  t.ok(app.gameReady)

  app.sendGame({ type: 'game:ping', requestId: 'round-trip' })
  t.alike(await pong, { type: 'game:pong', requestId: 'round-trip' })

  await app.close()
  t.absent(app.gameReady)
})
