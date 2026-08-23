'use strict'

function verifyProgram(program) {
  if (typeof program !== 'string') return { valid: false, score: 0 }

  return {
    valid: program.length > 0,
    score: program.length
  }
}

module.exports = { verifyProgram }
