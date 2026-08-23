'use strict'

const { MAX_PROGRAM_LENGTH } = require('./constants.js')

const VARIABLES = new Set(['a', 'b', 'c', 'd', 'e', 'f'])
const BINARY_OPERATORS = new Set(['&', '|', '^'])
const LANGUAGE_TOKENS = new Set([...VARIABLES, '!', ...BINARY_OPERATORS])
// Append evaluators when rules change. Never rewrite a deployed rule implementation.
const ATTEMPT_EVALUATORS = Object.freeze({
  1: evaluateAttemptV1
})

function tokenizeProgramV1(program) {
  if (typeof program !== 'string') {
    return {
      ok: false,
      tokens: [],
      size: 0,
      error: 'Program must be a string'
    }
  }

  if (program.length > MAX_PROGRAM_LENGTH) {
    return {
      ok: false,
      tokens: [],
      size: 0,
      error: `Program exceeds ${MAX_PROGRAM_LENGTH} characters`
    }
  }

  const tokens = []

  for (const token of program) {
    if (/\s/.test(token)) continue

    if (!LANGUAGE_TOKENS.has(token)) {
      return {
        ok: false,
        tokens,
        size: tokens.length,
        error: `Unsupported token ${JSON.stringify(token)}`
      }
    }

    tokens.push(token)
  }

  return { ok: true, tokens, size: tokens.length }
}

function evaluateBitmapV1(program) {
  const { result, tokens } = inspectProgram(program)

  if (result.status === 'invalid' || result.stackDepth === 0) {
    return { ...result, bitmap: null }
  }

  const bitmap = new Array(8)

  for (let y = 0; y < 8; y++) {
    const row = new Array(8)
    for (let x = 0; x < 8; x++) row[x] = evaluateTokens(tokens, x, y)
    bitmap[y] = row
  }

  return { ...result, bitmap }
}

function evaluateAttempt(program, challenge) {
  const evaluator = ATTEMPT_EVALUATORS[challenge?.rulesVersion]
  if (typeof evaluator !== 'function') {
    throw new TypeError(`Unsupported challenge rules: ${challenge?.rulesVersion}`)
  }

  return evaluator(program, challenge)
}

function evaluateAttemptV1(program, challenge) {
  const evaluation = evaluateBitmapV1(program)
  const target = challenge.target
  const diff = diffBitmaps(evaluation.bitmap, target)
  let matches = evaluation.valid && diff !== null

  if (matches) {
    for (const row of diff) {
      if (row.includes(true)) {
        matches = false
        break
      }
    }
  }

  return { ...evaluation, matches, diff }
}

function diffBitmaps(actual, expected) {
  if (!isBitmap(actual) || !isBitmap(expected)) return null

  return actual.map((row, y) => row.map((pixel, x) => pixel !== expected[y][x]))
}

function isBitmap(bitmap) {
  if (!Array.isArray(bitmap) || bitmap.length !== 8) return false

  for (const row of bitmap) {
    if (!Array.isArray(row) || row.length !== 8) return false
    for (const pixel of row) {
      if (typeof pixel !== 'boolean') return false
    }
  }

  return true
}

function inspectProgram(program) {
  const tokenized = tokenizeProgramV1(program)

  if (!tokenized.ok) {
    return {
      tokens: tokenized.tokens,
      result: invalidResult(0, tokenized.size, tokenized.error)
    }
  }

  let stackDepth = 0

  for (const token of tokenized.tokens) {
    if (VARIABLES.has(token)) {
      stackDepth++
      continue
    }

    if (token === '!') {
      if (stackDepth === 0) {
        return {
          tokens: tokenized.tokens,
          result: invalidResult(stackDepth, tokenized.size, '! needs 1 stack value')
        }
      }

      continue
    }

    if (stackDepth < 2) {
      return {
        tokens: tokenized.tokens,
        result: invalidResult(stackDepth, tokenized.size, `${token} needs 2 stack values`)
      }
    }

    stackDepth--
  }

  const valid = stackDepth === 1

  return {
    tokens: tokenized.tokens,
    result: {
      status: valid ? 'valid' : 'incomplete',
      valid,
      stackDepth,
      size: tokenized.size
    }
  }
}

function invalidResult(stackDepth, size, error) {
  return {
    status: 'invalid',
    valid: false,
    stackDepth,
    size,
    error
  }
}

function evaluateTokens(tokens, x, y) {
  const stack = new Array(tokens.length)
  let stackDepth = 0

  for (const token of tokens) {
    if (VARIABLES.has(token)) {
      stack[stackDepth++] = variableValue(token, x, y)
      continue
    }

    if (token === '!') {
      stack[stackDepth - 1] = !stack[stackDepth - 1]
      continue
    }

    const right = stack[--stackDepth]
    const left = stack[stackDepth - 1]

    if (token === '&') stack[stackDepth - 1] = left && right
    else if (token === '|') stack[stackDepth - 1] = left || right
    else stack[stackDepth - 1] = left !== right
  }

  return stack[stackDepth - 1]
}

function variableValue(variable, x, y) {
  if (variable === 'a') return Boolean((x >> 2) & 1)
  if (variable === 'b') return Boolean((x >> 1) & 1)
  if (variable === 'c') return Boolean(x & 1)
  if (variable === 'd') return Boolean((y >> 2) & 1)
  if (variable === 'e') return Boolean((y >> 1) & 1)
  return Boolean(y & 1)
}

module.exports = {
  tokenizeProgram: tokenizeProgramV1,
  evaluateBitmap: evaluateBitmapV1,
  evaluateAttempt
}
