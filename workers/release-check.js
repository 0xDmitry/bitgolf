'use strict'

const semver = require('bare-semver')

module.exports = async function hasNewerRelease(updater, swarm = null) {
  // A mandatory gate must hear from an authenticated release-drive peer. The
  // findingPeers bracket prevents Hypercore from resolving an update request
  // before the current DHT discovery pass has had a chance to connect.
  if (swarm === null) await updater.drive.update({ wait: true })
  else await synchronizeReleaseDrive(updater.drive, swarm)

  const checkout = updater.drive.checkout(updater.drive.core.length)

  try {
    const manifestBuffer = await checkout.get('/package.json')
    if (manifestBuffer === null) throw new Error('Release manifest is unavailable')

    const manifest = JSON.parse(manifestBuffer.toString())
    const current = semver.Version.parse(updater.version)
    const remote = semver.Version.parse(manifest.version)

    return current.compare(remote) < 0
  } finally {
    await checkout.close()
  }
}

async function synchronizeReleaseDrive(drive, swarm) {
  let sawPeer = drive.core.peers.length > 0
  const onPeer = () => {
    sawPeer = true
  }
  const done = drive.findingPeers()

  drive.core.on('peer-add', onPeer)

  try {
    const updating = drive.update({ wait: true })
    const discovering = swarm.flush().finally(done)

    await Promise.all([updating, discovering])
    if (!sawPeer) throw new Error('Release drive is unavailable')
  } finally {
    drive.core.removeListener('peer-add', onPeer)
  }
}

module.exports.synchronizeReleaseDrive = synchronizeReleaseDrive
