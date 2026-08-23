'use strict'

const { MAX_PROGRAM_LENGTH, MAX_ENCODED_EVENT_BYTES } = require('./constants.js')

const PROTOCOL_VERSION = 1
const EVENT_TYPES = {
  SUBMISSION: 'submission'
}
const CHALLENGE_ID = 'stub-v1'

const SUBMISSION_FIELDS = ['challenge', 'program', 'type', 'v']
const ACCEPTED_SUBMISSION_FIELDS = [...SUBMISSION_FIELDS, 'author'].sort()
const WRITER_KEY_PATTERN = /^[0-9a-f]{64}$/

function createSubmission(program) {
  return {
    v: PROTOCOL_VERSION,
    type: EVENT_TYPES.SUBMISSION,
    challenge: CHALLENGE_ID,
    program
  }
}

function isValidSubmission(event) {
  if (!hasExactFields(event, SUBMISSION_FIELDS)) return false
  if (event.v !== PROTOCOL_VERSION) return false
  if (event.type !== EVENT_TYPES.SUBMISSION) return false
  if (event.challenge !== CHALLENGE_ID) return false
  if (typeof event.program !== 'string') return false
  if (event.program.length === 0 || event.program.length > MAX_PROGRAM_LENGTH) return false

  return encodedSize(event) <= MAX_ENCODED_EVENT_BYTES
}

function isValidAcceptedSubmission(event) {
  if (!hasExactFields(event, ACCEPTED_SUBMISSION_FIELDS)) return false
  if (!WRITER_KEY_PATTERN.test(event.author)) return false

  const submission = {
    v: event.v,
    type: event.type,
    challenge: event.challenge,
    program: event.program
  }

  return isValidSubmission(submission)
}

function encodeSubmission(event) {
  if (!isValidSubmission(event)) throw new TypeError('Invalid submission event')

  const encoded = Buffer.from(JSON.stringify(event))
  if (encoded.byteLength > MAX_ENCODED_EVENT_BYTES) {
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

function hasExactFields(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  const keys = Object.keys(value).sort()
  if (keys.length !== fields.length) return false

  for (let i = 0; i < fields.length; i++) {
    if (keys[i] !== fields[i]) return false
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
  createSubmission,
  isValidSubmission,
  isValidAcceptedSubmission,
  encodeSubmission,
  decodeSubmission
}
