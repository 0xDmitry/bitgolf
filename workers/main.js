const PearRuntime = require('pear-runtime') // pear-runtime on desktop; pear-mobile on mobile
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')
const path = require('bare-path')
const dir = require('bare-storage')
const { isBareKit } = require('which-runtime')
const hasNewerRelease = require('./release-check.js')

// Mobile workers omit the executable and entrypoint from Bare.argv.
const argv = (index) => Bare.argv[index + (isBareKit ? 0 : 2)]

const updaterConfig = {
  version: argv(0),
  upgrade: argv(1),
  name: argv(2),
  dir: argv(3) || dir.persistent(),
  app: argv(4),
  delay: 0
}

const pipe = new FramedStream(Bare.IPC)
const store = new Corestore(path.join(updaterConfig.dir, 'pear-runtime', 'corestore'))
const swarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm, store })
let blocked = false
let applying = null
let updaterFrozen = false

pear.updater.on('updating', () => {
  // This process exits after applying one release. Stop queued updater passes
  // from re-mirroring the staging directory while it is being swapped.
  pear.updater.updates = false
  updaterFrozen = true
  blockForUpdate()
  send({ type: 'updater:updating' })
})
pear.updater.on('updated', () => {
  blockForUpdate()
  send({ type: 'updater:downloaded', version: pear.updater.nextVersion })
})
pear.updater.on('error', reportError)
pear.on('minver-required', () => {
  blockForUpdate()
  reportError(new Error('A newer Pear Runtime is required'))
})

swarm.on('connection', (connection) => store.replicate(connection))
swarm.join(pear.updater.drive.core.discoveryKey, {
  client: true,
  server: false
})

goodbye(async () => {
  await swarm.destroy()
  if (updaterFrozen) pear.updater.updates = true
  await pear.close()
  await store.close()
})

pipe.on('data', (data) => {
  handleCommand(data).catch(reportError)
})

main().catch(reportError)

async function main() {
  await pear.ready()

  const updateAvailable = await hasNewerRelease(pear.updater, swarm)

  if (updateAvailable) {
    blockForUpdate()
    if (!pear.updater.bundled) {
      throw new Error('OTA updates require an installed Bit Golf executable')
    }
    return
  }

  if (!blocked) send({ type: 'updater:current' })
}

async function handleCommand(data) {
  let message

  try {
    message = JSON.parse(data.toString())
  } catch {
    throw new Error('Updater command must be valid JSON')
  }

  if (message?.type !== 'updater:apply') {
    throw new Error('Unknown updater command')
  }

  if (applying !== null) return await applying

  applying = installUpdate()
  return await applying
}

async function installUpdate() {
  if (!pear.updater.updated || !pear.updater.bundled || pear.updater.applied) {
    throw new Error('No downloaded OTA update is ready to install')
  }

  await pear.updater.applyUpdate()
  if (!pear.updater.applied) throw new Error('OTA update was not installed')

  send({ type: 'updater:applied', version: pear.updater.nextVersion })
}

function blockForUpdate() {
  if (blocked) return
  blocked = true
  send({ type: 'updater:required' })
}

function reportError(err) {
  blocked = true
  send({ type: 'updater:error', error: err?.message || String(err) })
}

function send(message) {
  pipe.write(JSON.stringify(message))
}
