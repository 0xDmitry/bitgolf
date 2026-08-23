'use strict'

const { test } = require('brittle')

const { TARGET_PROGRAM } = require('../../helpers/programs.js')
const CHALLENGES = require('../../../workers/game/challenges.js')
const { MAX_PROGRAM_LENGTH } = require('../../../workers/game/constants.js')
const {
  evaluateAttempt,
  evaluateBitmap,
  tokenizeProgram
} = require('../../../workers/game/evaluator.js')

const CHALLENGE = CHALLENGES[0]

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
  t.alike(evaluation('a'), valid(1))
  t.alike(evaluation('ab'), incomplete(2, 2))
  t.alike(evaluation('ab&'), valid(3))
  t.alike(evaluation('abc&^'), valid(5))
  t.alike(evaluation(''), incomplete(0, 0))
  t.alike(evaluation('   \n'), incomplete(0, 0))
  t.alike(evaluation('&'), invalid(0, 1, '& needs 2 stack values'))
  t.alike(evaluation('a&'), invalid(1, 2, '& needs 2 stack values'))
  t.alike(evaluation('!'), invalid(0, 1, '! needs 1 stack value'))
  t.is(evaluation('c^f').status, 'invalid')
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

test('evaluator compares an attempt with challenge data', (t) => {
  const exact = evaluateAttempt(TARGET_PROGRAM, CHALLENGE)

  t.ok(exact.valid)
  t.ok(exact.matches)
  t.alike(exact.diff, emptyBitmap())

  const mismatch = evaluateAttempt('a', CHALLENGE)

  t.ok(mismatch.valid)
  t.absent(mismatch.matches)
  t.is(mismatch.diff.flat().filter(Boolean).length, 29)

  const incomplete = evaluateAttempt('ab', CHALLENGE)

  t.is(incomplete.status, 'incomplete')
  t.absent(incomplete.matches)
  t.ok(Array.isArray(incomplete.diff))
})

test('attempt comparison rejects missing or malformed challenge targets', (t) => {
  const malformed = [
    null,
    [],
    CHALLENGE.target.slice(1),
    [[false]],
    { rows: CHALLENGE.target },
    CHALLENGE.target.map((row) => [...row])
  ]
  malformed[malformed.length - 1][0][0] = 0

  for (const target of malformed) {
    const attempt = evaluateAttempt(TARGET_PROGRAM, { ...CHALLENGE, target })

    t.absent(attempt.matches)
    t.is(attempt.diff, null)
  }

  try {
    evaluateAttempt(TARGET_PROGRAM, { ...CHALLENGE, rulesVersion: 2 })
    t.fail('unknown rules must not fall back to current semantics')
  } catch (err) {
    t.is(err.message, 'Unsupported challenge rules: 2')
  }
})

test('tokenization ignores whitespace for syntax and score', (t) => {
  t.alike(tokenizeProgram(' a\tb\nc & ^ '), {
    ok: true,
    tokens: ['a', 'b', 'c', '&', '^'],
    size: 5
  })
  t.alike(evaluation(' a\tb\nc & ^ '), valid(5))
})

test('evaluator rejects unsupported values and enforces the shared source limit', (t) => {
  t.alike(evaluation(null), invalid(0, 0, 'Program must be a string'))
  t.alike(evaluation('ag'), invalid(0, 1, 'Unsupported token "g"'))

  const atLimit = `a${'!'.repeat(MAX_PROGRAM_LENGTH - 1)}`
  const overLimit = `${atLimit}!`
  const paddedAtLimit = `${' '.repeat(MAX_PROGRAM_LENGTH - 1)}a`

  t.alike(evaluation(atLimit), valid(MAX_PROGRAM_LENGTH))
  t.alike(evaluation(overLimit), invalid(0, 0, `Program exceeds ${MAX_PROGRAM_LENGTH} characters`))
  t.alike(evaluation(paddedAtLimit), valid(1))
  t.alike(
    evaluation(` ${atLimit}`),
    invalid(0, 0, `Program exceeds ${MAX_PROGRAM_LENGTH} characters`)
  )
})

function evaluation(program) {
  const { bitmap, ...result } = evaluateBitmap(program)
  return result
}

function bitmap(rows) {
  return rows.map((value) => [...value].map((pixel) => pixel === '1'))
}

function emptyBitmap() {
  return Array.from({ length: 8 }, () => Array(8).fill(false))
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
