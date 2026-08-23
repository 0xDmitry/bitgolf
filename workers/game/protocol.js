'use strict'

const { MAX_PROGRAM_LENGTH, MAX_ENCODED_EVENT_BYTES } = require('./constants.js')
const CHALLENGES = require('./challenges.js')

const CURRENT_CHALLENGE = CHALLENGES[CHALLENGES.length - 1]
const CURRENT_CHALLENGE_ID = bitmapId(CURRENT_CHALLENGE.target)
// Append protocol descriptors for new versions. Deployed descriptors are historical data.
const PROTOCOLS = Object.freeze([
  Object.freeze({
    version: 1,
    type: 'submission',
    fields: Object.freeze(['challenge', 'program', 'type', 'v']),
    acceptedFields: Object.freeze(['author', 'challenge', 'program', 'type', 'v']),
    maxProgramLength: MAX_PROGRAM_LENGTH,
    maxEncodedBytes: MAX_ENCODED_EVENT_BYTES,
    create: createV1Submission,
    validateSubmission: validateV1Submission,
    validateAccepted: validateV1AcceptedSubmission
  })
])
const WRITER_KEY_PATTERN = /^[0-9a-f]{64}$/

function bitmapId(bitmap) {
  if (!isBitmap(bitmap)) throw new TypeError('Bitmap must be an 8x8 Boolean matrix')

  let id = ''

  for (const row of bitmap) {
    let byte = 0
    for (let x = 0; x < row.length; x++) {
      if (row[x]) byte |= 0x80 >> x
    }
    id += byte.toString(16).padStart(2, '0')
  }

  return id
}

function createSubmission(program, challengeId = CURRENT_CHALLENGE_ID) {
  const challenge = CHALLENGES.find(({ target }) => bitmapId(target) === challengeId)
  if (challenge === undefined) throw new TypeError(`Unknown challenge: ${challengeId}`)

  const protocol = findProtocol(challenge.protocolVersion)
  if (protocol === undefined) {
    throw new TypeError(`Unsupported protocol: ${challenge.protocolVersion}`)
  }

  return protocol.create(challenge, program)
}

function isValidSubmission(event) {
  const protocol = findProtocol(event?.v)

  if (protocol === undefined) return false
  if (!supportsChallenge(event.v, event.challenge)) return false
  return protocol.validateSubmission(event, protocol)
}

function isValidAcceptedSubmission(event) {
  const protocol = findProtocol(event?.v)

  if (protocol === undefined) return false
  if (!supportsChallenge(event.v, event.challenge)) return false
  return protocol.validateAccepted(event, protocol)
}

function encodeSubmission(event) {
  if (!isValidSubmission(event)) throw new TypeError('Invalid submission event')

  const protocol = findProtocol(event.v)
  const encoded = Buffer.from(JSON.stringify(event))
  if (encoded.byteLength > protocol.maxEncodedBytes) {
    throw new RangeError('Submission event is too large')
  }

  return encoded
}

function decodeSubmission(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value.byteLength !== 'number' ||
    value.byteLength === 0 ||
    value.byteLength > MAX_ENCODED_EVENT_BYTES
  ) {
    return null
  }

  try {
    return JSON.parse(value.toString('utf8'))
  } catch {
    return null
  }
}

function findProtocol(version) {
  return PROTOCOLS.find((protocol) => protocol.version === version)
}

function supportsChallenge(version, challengeId) {
  return CHALLENGES.some(
    ({ target, protocolVersion }) => bitmapId(target) === challengeId && protocolVersion === version
  )
}

function createV1Submission(challenge, program) {
  return {
    v: 1,
    type: 'submission',
    challenge: bitmapId(challenge.target),
    program
  }
}

function validateV1Submission(event, protocol) {
  if (!hasExactFields(event, protocol.fields)) return false
  if (event.v !== protocol.version || event.type !== protocol.type) return false
  if (typeof event.program !== 'string') return false
  if (event.program.length === 0 || event.program.length > protocol.maxProgramLength) return false

  return encodedSize(event) <= protocol.maxEncodedBytes
}

function validateV1AcceptedSubmission(event, protocol) {
  if (!hasExactFields(event, protocol.acceptedFields)) return false
  if (typeof event.author !== 'string' || !WRITER_KEY_PATTERN.test(event.author)) return false

  return validateV1Submission(
    {
      v: event.v,
      type: event.type,
      challenge: event.challenge,
      program: event.program
    },
    protocol
  )
}

function hasExactFields(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  const keys = Object.keys(value).sort()
  if (keys.length !== fields.length) return false

  for (let i = 0; i < fields.length; i++) {
    if (keys[i] !== fields[i]) return false
  }

  return true
}

function isBitmap(bitmap) {
  if (!Array.isArray(bitmap) || bitmap.length !== 8) return false

  for (const row of bitmap) {
    if (!Array.isArray(row) || row.length !== 8) return false
    for (let x = 0; x < row.length; x++) {
      if (typeof row[x] !== 'boolean') return false
    }
  }

  return true
}

function encodedSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    return Infinity
  }
}

module.exports = {
  bitmapId,
  createSubmission,
  isValidSubmission,
  isValidAcceptedSubmission,
  encodeSubmission,
  decodeSubmission
}
