'use strict'

const { test } = require('brittle')

const { TARGET_PROGRAM, targetProgram } = require('../../helpers/programs.js')
const CHALLENGES = require('../../../workers/game/challenges.js')
const { MAX_PROGRAM_LENGTH } = require('../../../workers/game/constants.js')
const { bitmapId } = require('../../../workers/game/protocol.js')
const { verifySubmission } = require('../../../workers/game/verifier.js')

const CHALLENGE_ID = bitmapId(CHALLENGES[0].target)

test('verifier accepts only complete programs that render the target', (t) => {
  t.alike(verifySubmission(submission(TARGET_PROGRAM)), {
    valid: true,
    score: TARGET_PROGRAM.length
  })
  t.alike(verifySubmission(submission(` ${TARGET_PROGRAM}\n`)), {
    valid: true,
    score: TARGET_PROGRAM.length
  })
  t.alike(verifySubmission(submission(targetProgram(1))), {
    valid: true,
    score: TARGET_PROGRAM.length + 2
  })
})

test('verifier rejects non-target, incomplete, underflowing, and unsupported programs', (t) => {
  const invalid = ['a', 'ab&', 'cf^', '', 'ab', '&', 'a&', 'c^f', 'hello', null, 1]

  for (const program of invalid) {
    t.alike(verifySubmission(submission(program)), { valid: false, score: 0 })
  }

  t.alike(verifySubmission({ ...submission(TARGET_PROGRAM), v: 2 }), {
    valid: false,
    score: 0
  })
  t.alike(verifySubmission({ ...submission(TARGET_PROGRAM), challenge: 'missing-v1' }), {
    valid: false,
    score: 0
  })
  t.alike(verifySubmission(null), { valid: false, score: 0 })
})

test('verifier enforces the shared raw-source limit', (t) => {
  const maximum = `${TARGET_PROGRAM}${'!'.repeat(MAX_PROGRAM_LENGTH - TARGET_PROGRAM.length)}`
  const padded = ` ${TARGET_PROGRAM}${'!'.repeat(MAX_PROGRAM_LENGTH - TARGET_PROGRAM.length - 2)} `
  const oversized = `${maximum}!`

  t.alike(verifySubmission(submission(maximum)), { valid: true, score: MAX_PROGRAM_LENGTH })
  t.alike(verifySubmission(submission(padded)), {
    valid: true,
    score: MAX_PROGRAM_LENGTH - 2
  })
  t.alike(verifySubmission(submission(oversized)), { valid: false, score: 0 })
})

function submission(program) {
  return {
    v: 1,
    type: 'submission',
    challenge: CHALLENGE_ID,
    program
  }
}
