'use strict'

const { test } = require('brittle')

const {
  MAX_ENCODED_EVENT_BYTES,
  MAX_PROGRAM_LENGTH
} = require('../../../workers/game/constants.js')
const CHALLENGES = require('../../../workers/game/challenges.js')
const {
  bitmapId,
  createSubmission,
  decodeSubmission,
  encodeSubmission,
  isValidAcceptedSubmission,
  isValidSubmission
} = require('../../../workers/game/protocol.js')

const ALICE = 'a'.repeat(64)
const CHALLENGE = CHALLENGES[0]
const CHALLENGE_ID = bitmapId(CHALLENGE.target)
const HISTORICAL_V1_SUBMISSION = Object.freeze({
  v: 1,
  type: 'submission',
  challenge: CHALLENGE_ID,
  program: 'ab&'
})

test('bitmap ids use deterministic row-major packed hexadecimal bytes', (t) => {
  const copy = CHALLENGE.target.map((row) => [...row])

  t.is(bitmapId(CHALLENGE.target), '0810381c7e0e3c18')
  t.is(bitmapId(copy), bitmapId(CHALLENGE.target))

  copy[0][0] = !copy[0][0]
  t.not(bitmapId(copy), bitmapId(CHALLENGE.target))
})

test('bitmap ids reject malformed bitmap shapes and pixel values', (t) => {
  const wrongWidth = CHALLENGE.target.map((row) => [...row])
  const wrongPixel = CHALLENGE.target.map((row) => [...row])
  const malformed = [
    null,
    [],
    CHALLENGE.target.slice(1),
    [...CHALLENGE.target, CHALLENGE.target[0]],
    [[false]],
    { rows: CHALLENGE.target },
    wrongWidth,
    wrongPixel
  ]
  wrongWidth[0].pop()
  wrongPixel[0][0] = 0

  for (const value of malformed) {
    try {
      bitmapId(value)
      t.fail('malformed bitmaps must not produce ids')
    } catch (err) {
      t.is(err.message, 'Bitmap must be an 8x8 Boolean matrix')
    }
  }
})

test('submission protocol accepts the canonical event', (t) => {
  const event = createSubmission('ab&')

  t.alike(event, {
    v: 1,
    type: 'submission',
    challenge: CHALLENGE_ID,
    program: 'ab&'
  })
  t.ok(isValidSubmission(event))
  t.ok(isValidSubmission(HISTORICAL_V1_SUBMISSION))
  t.alike(decodeSubmission(encodeSubmission(event)), event)
})

test('submission protocol rejects unknown versions and challenges', (t) => {
  const futureProtocol = {
    v: 2,
    type: 'submission',
    challenge: CHALLENGE_ID,
    program: 'a'
  }
  const futureChallenge = {
    v: 1,
    type: 'submission',
    challenge: 'ffffffffffffffff',
    program: 'a'
  }
  const archivalPrototype = {
    v: 1,
    type: 'submission',
    challenge: 'stub-v1',
    program: 'a'
  }

  t.absent(isValidSubmission(futureProtocol))
  t.absent(isValidSubmission(futureChallenge))
  t.absent(isValidSubmission(archivalPrototype))
})

test('submission creation rejects unknown challenge ids', (t) => {
  try {
    createSubmission('ab&', 'missing-v1')
    t.fail('unknown challenges must not produce events')
  } catch (err) {
    t.is(err.message, 'Unknown challenge: missing-v1')
  }
})

test('submission protocol rejects malformed events', (t) => {
  const valid = createSubmission('ab&')
  const malformed = [
    null,
    [],
    {},
    { ...valid, v: 2 },
    { ...valid, type: 'move' },
    { ...valid, program: '' },
    { ...valid, program: 1 },
    { ...valid, author: ALICE },
    { ...valid, score: 5 }
  ]

  for (const event of malformed) {
    t.absent(isValidSubmission(event))
  }
})

test('submission protocol enforces raw program and encoded size bounds', (t) => {
  t.ok(isValidSubmission(createSubmission(validProgramOfLength(MAX_PROGRAM_LENGTH))))
  t.absent(isValidSubmission(createSubmission(validProgramOfLength(MAX_PROGRAM_LENGTH + 1))))

  const oversized = Buffer.alloc(MAX_ENCODED_EVENT_BYTES + 1, 0x78)
  t.is(decodeSubmission(oversized), null)
})

test('submission decoder rejects empty and invalid JSON encodings', (t) => {
  t.is(decodeSubmission(null), null)
  t.is(decodeSubmission(Buffer.alloc(0)), null)
  t.is(decodeSubmission(Buffer.from('{')), null)
})

test('submission decoding and validation are separate', (t) => {
  const invalid = createSubmission('')
  const decoded = decodeSubmission(Buffer.from(JSON.stringify(invalid)))

  t.alike(decoded, invalid)
  t.absent(isValidSubmission(decoded))
})

test('submission encoder rejects invalid events', (t) => {
  try {
    encodeSubmission(createSubmission(''))
    t.fail('invalid events must not be encoded')
  } catch (err) {
    t.is(err.message, 'Invalid submission event')
  }
})

test('accepted submission protocol authenticates full writer keys', (t) => {
  const accepted = { ...createSubmission('abc&^'), author: ALICE }

  t.ok(isValidAcceptedSubmission(accepted))
  t.absent(isValidAcceptedSubmission({ ...accepted, author: 'a'.repeat(63) }))
  t.absent(isValidAcceptedSubmission({ ...accepted, author: 'g'.repeat(64) }))
  t.absent(isValidAcceptedSubmission({ ...accepted, score: 5 }))
})

function validProgramOfLength(length) {
  return `a${'!'.repeat(length - 1)}`
}
