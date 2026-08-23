'use strict'

const { test } = require('brittle')

const {
  MAX_ENCODED_EVENT_BYTES,
  MAX_PROGRAM_LENGTH
} = require('../../../workers/game/constants.js')
const {
  createSubmission,
  decodeSubmission,
  encodeSubmission,
  isValidAcceptedSubmission,
  isValidSubmission
} = require('../../../workers/game/protocol.js')

const ALICE = 'a'.repeat(64)

test('submission protocol accepts the canonical event', (t) => {
  const event = createSubmission('hello')

  t.alike(event, {
    v: 1,
    type: 'submission',
    challenge: 'stub-v1',
    program: 'hello'
  })
  t.ok(isValidSubmission(event))
  t.alike(decodeSubmission(encodeSubmission(event)), event)
})

test('submission protocol rejects malformed events', (t) => {
  const valid = createSubmission('hello')
  const malformed = [
    null,
    [],
    {},
    { ...valid, v: 2 },
    { ...valid, type: 'move' },
    { ...valid, challenge: 'stub-v2' },
    { ...valid, program: '' },
    { ...valid, program: 1 },
    { ...valid, author: ALICE },
    { ...valid, score: 5 }
  ]

  for (const event of malformed) t.absent(isValidSubmission(event))
})

test('submission protocol enforces program and encoded size bounds', (t) => {
  t.ok(isValidSubmission(createSubmission('x'.repeat(MAX_PROGRAM_LENGTH))))
  t.absent(isValidSubmission(createSubmission('x'.repeat(MAX_PROGRAM_LENGTH + 1))))

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
  const accepted = { ...createSubmission('hello'), author: ALICE }

  t.ok(isValidAcceptedSubmission(accepted))
  t.absent(isValidAcceptedSubmission({ ...accepted, author: 'a'.repeat(63) }))
  t.absent(isValidAcceptedSubmission({ ...accepted, author: 'g'.repeat(64) }))
  t.absent(isValidAcceptedSubmission({ ...accepted, score: 5 }))
})
