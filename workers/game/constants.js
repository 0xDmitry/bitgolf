'use strict'

const MAX_PROGRAM_LENGTH = 4096
const MAX_ENCODED_EVENT_BYTES = 32 * 1024

// Stable Autobase namespace shared by every challenge, protocol version, and
// client build. No matching secret key is retained.
const GAME_BOOTSTRAP_HEX = '38ba3d03da10565c0365bb615eebeb5451e2e83223c41954a168d3cab93975bb'
const GAME_BOOTSTRAP_KEY = Buffer.from(GAME_BOOTSTRAP_HEX, 'hex')

module.exports = {
  MAX_PROGRAM_LENGTH,
  MAX_ENCODED_EVENT_BYTES,
  GAME_BOOTSTRAP_KEY
}
