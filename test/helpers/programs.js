'use strict'

const TARGET_PROGRAM = 'bfc!&!&afb&!cfd!b!&^&^&^e!ba&d!f!b&fa&|&^cdaba!&^f!ba&!&^&&^&^'

function targetProgram(extraNegationPairs = 0) {
  return `${TARGET_PROGRAM}${'!!'.repeat(extraNegationPairs)}`
}

module.exports = {
  TARGET_PROGRAM,
  targetProgram
}
