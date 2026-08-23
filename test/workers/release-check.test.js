'use strict'

const { test } = require('brittle')

const hasNewerRelease = require('../../workers/release-check.js')
const { synchronizeReleaseDrive } = hasNewerRelease

test('release check compares the replicated manifest with the running version', async (t) => {
  const newer = fakeUpdater('1.2.3', '1.3.0')
  const current = fakeUpdater('1.2.3', '1.2.3')
  const older = fakeUpdater('1.2.3', '1.1.9')

  t.ok(await hasNewerRelease(newer.updater))
  t.absent(await hasNewerRelease(current.updater))
  t.absent(await hasNewerRelease(older.updater))
  t.alike(newer.calls, ['update:wait=true', 'checkout:7', 'get:/package.json', 'close'])
})

test('release check fails closed when the release manifest is unavailable', async (t) => {
  const empty = fakeUpdater('1.2.3', null)

  try {
    await hasNewerRelease(empty.updater)
    t.fail('an empty release drive must not unlock the game')
  } catch (err) {
    t.is(err.message, 'Release manifest is unavailable')
  }
  t.ok(empty.closed())
})

test('release synchronization brackets discovery and requires a drive peer', async (t) => {
  const connected = fakeReleaseNetwork(true)

  await synchronizeReleaseDrive(connected.drive, connected.swarm)
  t.alike(connected.calls, [
    'finding-peers',
    'on:peer-add',
    'update:wait=true',
    'flush',
    'peer-add',
    'done-finding',
    'off:peer-add'
  ])

  const unavailable = fakeReleaseNetwork(false)
  try {
    await synchronizeReleaseDrive(unavailable.drive, unavailable.swarm)
    t.fail('discovery without a release-drive peer must fail closed')
  } catch (err) {
    t.is(err.message, 'Release drive is unavailable')
  }
  t.ok(unavailable.calls.includes('done-finding'))
  t.ok(unavailable.calls.includes('off:peer-add'))
})

function fakeUpdater(version, remoteVersion) {
  const calls = []
  let checkoutClosed = false
  const manifest =
    remoteVersion === null ? null : Buffer.from(JSON.stringify({ version: remoteVersion }))

  return {
    calls,
    closed: () => checkoutClosed,
    updater: {
      version,
      drive: {
        core: { length: 7 },
        update(options) {
          calls.push(`update:wait=${options.wait}`)
        },
        checkout(length) {
          calls.push(`checkout:${length}`)
          return {
            get(name) {
              calls.push(`get:${name}`)
              return manifest
            },
            close() {
              checkoutClosed = true
              calls.push('close')
            }
          }
        }
      }
    }
  }
}

function fakeReleaseNetwork(connect) {
  const calls = []
  const peerListeners = new Set()
  let resolveUpdate

  const drive = {
    core: {
      peers: [],
      on(name, listener) {
        calls.push(`on:${name}`)
        peerListeners.add(listener)
      },
      removeListener(name, listener) {
        calls.push(`off:${name}`)
        peerListeners.delete(listener)
      }
    },
    findingPeers() {
      calls.push('finding-peers')
      return () => {
        calls.push('done-finding')
        resolveUpdate()
      }
    },
    update(options) {
      calls.push(`update:wait=${options.wait}`)
      return new Promise((resolve) => {
        resolveUpdate = resolve
      })
    }
  }
  const swarm = {
    flush() {
      calls.push('flush')
      if (connect) {
        calls.push('peer-add')
        drive.core.peers.push({})
        for (const listener of peerListeners) listener()
      }
      return Promise.resolve()
    }
  }

  return { calls, drive, swarm }
}
