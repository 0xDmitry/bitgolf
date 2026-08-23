'use strict'

const { test } = require('brittle')

const { MAX_PROGRAM_LENGTH } = require('../../../workers/game/constants.js')
const {
  evaluateBitmap,
  evaluateProgram,
  tokenizeProgram
} = require('../../../workers/game/evaluator.js')

test('evaluator renders the primitive coordinate masks exactly', (t) => {
  t.alike(
    evaluateBitmap('a').bitmap,
    bitmap([
      '00001111',
      '00001111',
      '00001111',
      '00001111',
      '00001111',
      '00001111',
      '00001111',
      '00001111'
    ])
  )
  t.alike(
    evaluateBitmap('a!').bitmap,
    bitmap([
      '11110000',
      '11110000',
      '11110000',
      '11110000',
      '11110000',
      '11110000',
      '11110000',
      '11110000'
    ])
  )
  t.alike(
    evaluateBitmap('d').bitmap,
    bitmap([
      '00000000',
      '00000000',
      '00000000',
      '00000000',
      '11111111',
      '11111111',
      '11111111',
      '11111111'
    ])
  )
  t.alike(
    evaluateBitmap('cf^').bitmap,
    bitmap([
      '01010101',
      '10101010',
      '01010101',
      '10101010',
      '01010101',
      '10101010',
      '01010101',
      '10101010'
    ])
  )
})

test('evaluator classifies complete, incomplete, and underflowing stacks', (t) => {
  t.alike(evaluateProgram('a'), valid(1))
  t.alike(evaluateProgram('ab'), incomplete(2, 2))
  t.alike(evaluateProgram('ab&'), valid(3))
  t.alike(evaluateProgram('abc&^'), valid(5))
  t.alike(evaluateProgram(''), incomplete(0, 0))
  t.alike(evaluateProgram('   \n'), incomplete(0, 0))
  t.alike(evaluateProgram('&'), invalid(0, 1, '& needs 2 stack values'))
  t.alike(evaluateProgram('a&'), invalid(1, 2, '& needs 2 stack values'))
  t.alike(evaluateProgram('!'), invalid(0, 1, '! needs 1 stack value'))
  t.is(evaluateProgram('c^f').status, 'invalid')
})

test('evaluator implements every boolean operator', (t) => {
  t.alike(row(evaluateBitmap('a!')), '11110000')
  t.alike(row(evaluateBitmap('ab&')), '00000011')
  t.alike(row(evaluateBitmap('ab|')), '00111111')
  t.alike(row(evaluateBitmap('ab^')), '00111100')
})

test('incomplete programs preview their top stack value', (t) => {
  const result = evaluateBitmap('ab')

  t.is(result.status, 'incomplete')
  t.is(result.stackDepth, 2)
  t.alike(row(result), '00110011')
  t.is(evaluateBitmap('').bitmap, null)
  t.is(evaluateBitmap('a&').bitmap, null)
})

test('tokenization ignores whitespace for syntax and score', (t) => {
  t.alike(tokenizeProgram(' a\tb\nc & ^ '), {
    ok: true,
    tokens: ['a', 'b', 'c', '&', '^'],
    size: 5
  })
  t.alike(evaluateProgram(' a\tb\nc & ^ '), valid(5))
})

test('evaluator rejects unsupported values and enforces the shared source limit', (t) => {
  t.alike(evaluateProgram(null), invalid(0, 0, 'Program must be a string'))
  t.alike(evaluateProgram('ag'), invalid(0, 1, 'Unsupported token "g"'))

  const atLimit = `a${'!'.repeat(MAX_PROGRAM_LENGTH - 1)}`
  const overLimit = `${atLimit}!`
  const paddedAtLimit = `${' '.repeat(MAX_PROGRAM_LENGTH - 1)}a`

  t.alike(evaluateProgram(atLimit), valid(MAX_PROGRAM_LENGTH))
  t.alike(
    evaluateProgram(overLimit),
    invalid(0, 0, `Program exceeds ${MAX_PROGRAM_LENGTH} characters`)
  )
  t.alike(evaluateProgram(paddedAtLimit), valid(1))
  t.alike(
    evaluateProgram(` ${atLimit}`),
    invalid(0, 0, `Program exceeds ${MAX_PROGRAM_LENGTH} characters`)
  )
})

function bitmap(rows) {
  return rows.map((value) => [...value].map((pixel) => pixel === '1'))
}

function row(result) {
  return result.bitmap[0].map((pixel) => (pixel ? '1' : '0')).join('')
}

function valid(size) {
  return {
    status: 'valid',
    valid: true,
    stackDepth: 1,
    size
  }
}

function incomplete(stackDepth, size) {
  return {
    status: 'incomplete',
    valid: false,
    stackDepth,
    size
  }
}

function invalid(stackDepth, size, error) {
  return {
    status: 'invalid',
    valid: false,
    stackDepth,
    size,
    error
  }
}
