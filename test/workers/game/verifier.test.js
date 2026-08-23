'use strict'

const { test } = require('brittle')

const { MAX_PROGRAM_LENGTH } = require('../../../workers/game/constants.js')
const { verifyProgram } = require('../../../workers/game/verifier.js')

test('verifier accepts complete Bit Golf programs and derives token scores', (t) => {
  t.alike(verifyProgram('a'), { valid: true, score: 1 })
  t.alike(verifyProgram('ab&'), { valid: true, score: 3 })
  t.alike(verifyProgram('cf^'), { valid: true, score: 3 })
  t.alike(verifyProgram('abc&^'), { valid: true, score: 5 })
  t.alike(verifyProgram('a b c & ^'), { valid: true, score: 5 })
})

test('verifier rejects empty, incomplete, underflowing, and unsupported programs', (t) => {
  const invalid = ['', 'ab', '&', 'a&', 'c^f', 'hello', null, 1]

  for (const program of invalid) {
    t.alike(verifyProgram(program), { valid: false, score: 0 })
  }
})

test('verifier enforces the shared raw-source limit', (t) => {
  const maximum = `a${'!'.repeat(MAX_PROGRAM_LENGTH - 1)}`
  const padded = ` a${'!'.repeat(MAX_PROGRAM_LENGTH - 2)}`
  const oversized = `${maximum}!`

  t.alike(verifyProgram(maximum), { valid: true, score: MAX_PROGRAM_LENGTH })
  t.alike(verifyProgram(padded), { valid: true, score: MAX_PROGRAM_LENGTH - 1 })
  t.alike(verifyProgram(oversized), { valid: false, score: 0 })
})
