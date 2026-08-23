import { command, flag, summary } from 'paparam'
import { persistent } from 'bare-storage'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import pkg from './package.json'
import App from './app.js'
import Terminal from './terminal.js'

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

const cmd = command(
  appName,
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--storage <dir>', 'custom storage directory'),
  flag('--no-updates', 'disable OTA updates for this run')
)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const updates = cmd.flags.updates
const storage = cmd.flags.storage || (isDev ? null : path.join(persistent(), appName))
const dir = storage || path.join(os.tmpdir(), 'pear', appName)

const app = new App({
  dir,
  app: isDev ? null : os.execPath(),
  updates,
  version: pkg.version,
  upgrade: pkg.upgrade,
  name: isWindows ? appName + '.exe' : appName
})
const terminal = new Terminal({ input: process.stdin, output: process.stdout })

let request = 0
let stopping = null

terminal.on('submit', (program) => {
  if (!app.gameReady) {
    terminal.showError('game worker is still connecting')
    return
  }

  terminal.showSubmitting()

  try {
    app.sendGame({
      type: 'game:submit',
      requestId: `submission-${++request}`,
      program
    })
  } catch (err) {
    terminal.showError(err.message)
  }
})
terminal.on('exit', (code) => stop(code))

app.on('game-message', (message) => {
  if (message.type === 'game:state') terminal.updateState(message)
  if (message.type === 'game:submit-result') terminal.showSubmission(message)
  if (message.type === 'game:warning') terminal.showWarning(message.warning)
})
app.on('game-error', ({ error }) => terminal.showError(error))
app.on('error', (err) => terminal.showError(err.message))

process.on('SIGHUP', () => stop(129))
process.on('SIGINT', () => stop(130))
process.on('SIGQUIT', () => stop(131))
process.on('SIGTERM', () => stop(143))

try {
  await terminal.ready()
  await app.ready()
} catch (err) {
  terminal.showError(err.message)
  await stop(1)
}

async function stop(code = 0) {
  if (stopping !== null) return stopping

  Bare.exitCode = code
  stopping = Promise.allSettled([terminal.close(), app.close()])
  await stopping
  Bare.exit(code)
}
