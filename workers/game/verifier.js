'use strict'

const { evaluateProgram } = require('./evaluator.js')

function verifyProgram(program) {
  const result = evaluateProgram(program)

  if (!result.valid) return { valid: false, score: 0 }

  return { valid: true, score: result.size }
}

module.exports = { verifyProgram }
