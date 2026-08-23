const { test } = require('brittle')

const App = require('../../app.js')
const { TARGET_PROGRAM } = require('../helpers/programs.js')
const CHALLENGES = require('../../workers/game/challenges.js')
const { bitmapId } = require('../../workers/game/protocol.js')

const CHALLENGE_ID = bitmapId(CHALLENGES[0].target)

class GameOnlyApp extends App {
  _openUpdater() {}
}

test('app waits for the game worker and supports a framed IPC round trip', async (t) => {
  const app = new GameOnlyApp({ dir: await t.tmp(), gameNetwork: false })
  let resolvePong
  let resolveSubmission
  const pong = new Promise((resolve) => {
    resolvePong = resolve
  })
  const submission = new Promise((resolve) => {
    resolveSubmission = resolve
  })

  app.on('error', (err) => t.fail(err.message))
  app.on('game-message', (message) => {
    if (message.type === 'game:pong') resolvePong(message)
    if (message.type === 'game:submit-result') resolveSubmission(message)
  })
  t.teardown(() => app.close(), { force: true })

  await app.ready()
  t.ok(app.gameReady)

  app.sendGame({ type: 'game:ping', requestId: 'round-trip' })
  t.alike(await pong, { type: 'game:pong', requestId: 'round-trip' })

  app.sendGame({
    type: 'game:submit',
    requestId: 'submission',
    challenge: CHALLENGE_ID,
    program: TARGET_PROGRAM
  })
  t.alike(await submission, {
    type: 'game:submit-result',
    requestId: 'submission',
    valid: true,
    score: TARGET_PROGRAM.length,
    challenge: CHALLENGE_ID
  })

  await app.close()
  t.absent(app.gameReady)
})
