'use strict'

const CHALLENGES = require('./challenges.js')
const { evaluateAttempt } = require('./evaluator.js')
const { bitmapId } = require('./protocol.js')

// Append handlers when challenge rules change. Never rewrite a deployed handler.
const RULE_VERIFIERS = Object.freeze({
  1: verifyV1Submission
})

function verifySubmission(event) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return invalidResult()

  const challenge = CHALLENGES.find(
    ({ target, protocolVersion }) =>
      bitmapId(target) === event.challenge && protocolVersion === event.v
  )
  if (challenge === undefined) return invalidResult()

  const verify = RULE_VERIFIERS[challenge.rulesVersion]
  if (typeof verify !== 'function') return invalidResult()

  return verify(event.program, challenge)
}

function verifyV1Submission(program, challenge) {
  const result = evaluateAttempt(program, challenge)

  if (!result.matches) return invalidResult()

  return { valid: true, score: result.size }
}

function invalidResult() {
  return { valid: false, score: 0 }
}

module.exports = { verifySubmission }
