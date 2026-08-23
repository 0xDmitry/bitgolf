'use strict'

const MAX_PROGRAM_LENGTH = 4096
const MAX_ENCODED_EVENT_BYTES = 32 * 1024

// Generated once as an unowned namespace for the global game. Tests generate their own keys.
const GAME_BOOTSTRAP_HEX = '73865652ceb10203a62ca0d4a5a1b9bf9ae43f797a716e6b457d26af100e7f32'
const GAME_BOOTSTRAP_KEY = Buffer.from(GAME_BOOTSTRAP_HEX, 'hex')

module.exports = {
  MAX_PROGRAM_LENGTH,
  MAX_ENCODED_EVENT_BYTES,
  GAME_BOOTSTRAP_KEY
}
