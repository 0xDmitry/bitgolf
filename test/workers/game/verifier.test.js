'use strict'

const { test } = require('brittle')

const { verifyProgram } = require('../../../workers/game/verifier.js')

test('stub verifier scores programs by string length', (t) => {
  t.alike(verifyProgram('x'), { valid: true, score: 1 })
  t.alike(verifyProgram('abc'), { valid: true, score: 3 })
  t.alike(verifyProgram(''), { valid: false, score: 0 })
})

test('stub verifier rejects non-string programs', (t) => {
  t.alike(verifyProgram(null), { valid: false, score: 0 })
  t.alike(verifyProgram(1), { valid: false, score: 0 })
})
