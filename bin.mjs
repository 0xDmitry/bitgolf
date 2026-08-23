import { command, flag, summary } from 'paparam'
import { persistent } from 'bare-storage'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import pkg from './package.json'
import App from './app.js'
import Terminal from './terminal.js'
import SubmissionCoordinator from './submission-coordinator.js'

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

const options = [
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--storage <dir>', 'custom storage directory')
]
if (isDev) options.push(flag('--no-updates', 'disable OTA updates for this development run'))

const cmd = command(appName, ...options)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const updates = isDev ? cmd.flags.updates : true
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

let stopping = null
let updateLock = null
let updateNoticeShown = false
let updateFailureShown = false

const submissions = new SubmissionCoordinator({
  terminal,
  app,
  onExit(code) {
    stop(code)
  }
})

app.on('game-message', (message) => {
  if (message.type === 'game:state') terminal.updateState(message)
  if (message.type === 'game:warning') terminal.showWarning(message.warning)
})
app.on('update-required', () => {
  beginUpdate().catch(reportUpdateFailure)
})
app.on('update-applied', (version) => {
  finishUpdate(version).catch(reportUpdateFailure)
})
app.on('update-error', (err) => {
  reportUpdateFailure(err)
})

process.on('SIGHUP', () => stop(129))
process.on('SIGINT', () => stop(130))
process.on('SIGQUIT', () => stop(131))
process.on('SIGTERM', () => stop(143))

try {
  await app.ready()
  if (app.updateApplied) await stop(0)
  else {
    await terminal.ready()
    submissions.markInitialized()
  }
} catch (err) {
  if (!updateFailureShown) {
    if (terminal.opened) terminal.showError(err.message)
    else process.stderr.write(`error: ${err.message}\n`)
  }
  await stop(1)
}

function closeForUpdate() {
  if (updateLock !== null) return updateLock

  submissions.close()
  updateLock = terminal.close()
  return updateLock
}

async function beginUpdate() {
  await closeForUpdate()
  if (updateNoticeShown) return

  updateNoticeShown = true
  process.stdout.write(`${terminal.opened ? '\n' : ''}Updating Bit Golf...\n`)
}

async function finishUpdate(version) {
  await beginUpdate()
  const suffix = typeof version === 'string' && version.length > 0 ? ` to v${version}` : ''
  process.stdout.write(`Update installed${suffix}. Restart Bit Golf.\n`)
  await stop(0)
}

async function failUpdate(err) {
  if (updateFailureShown) return
  updateFailureShown = true

  await closeForUpdate()
  process.stderr.write(`error: ${err.message}\n`)
  await stop(1)
}

function reportUpdateFailure(err) {
  failUpdate(err).catch(() => {})
}

async function stop(code = 0) {
  if (stopping !== null) return stopping

  Bare.exitCode = code
  submissions.close()
  stopping = Promise.allSettled([terminal.close(), app.close()])
  await stopping
  Bare.exit(code)
}
