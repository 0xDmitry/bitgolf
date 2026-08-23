'use strict'

const fs = require('bare-fs')
const path = require('bare-path')

const STATE_VERSION = 1
const STATE_DIRECTORY = 'tutorial'
const STATE_FILENAME = 'state.json'
const MAX_SOLUTION_LENGTH = 4096
const STAGE_KEYS = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8a', '8b'])
const operations = new Map()

let temporaryFileSequence = 0

function freshTutorialState() {
  return {
    version: STATE_VERSION,
    started: false,
    completed: [],
    current: 1,
    stage: '8a',
    tutorialComplete: false,
    solutions: {}
  }
}

function normalizeTutorialState(value) {
  if (!isRecord(value) || value.version !== STATE_VERSION) return freshTutorialState()

  const completed = normalizeCompleted(value.completed)
  const current = firstIncompleteLesson(completed)
  const tutorialComplete = completed.length === 8 && value.tutorialComplete === true
  const stage = current === 8 && (value.stage === '8b' || completed.includes(8)) ? '8b' : '8a'
  const solutions = normalizeSolutions(value.solutions)
  const started =
    value.started === true || completed.length > 0 || Object.keys(solutions).length > 0

  return {
    version: STATE_VERSION,
    started,
    completed,
    current,
    stage,
    tutorialComplete,
    solutions
  }
}

function tutorialStatePath(storagePath) {
  if (typeof storagePath !== 'string' || storagePath.length === 0) {
    throw new TypeError('Tutorial storage path must be a non-empty string')
  }

  return path.join(storagePath, STATE_DIRECTORY, STATE_FILENAME)
}

function loadTutorialState(storagePath) {
  const filename = tutorialStatePath(storagePath)

  return serialize(filename, async () => {
    let encoded

    try {
      encoded = await fs.readFile(filename, 'utf8')
    } catch (err) {
      if (isMissing(err)) return freshTutorialState()
      throw err
    }

    try {
      return normalizeTutorialState(JSON.parse(encoded))
    } catch {
      return freshTutorialState()
    }
  })
}

function saveTutorialState(storagePath, state) {
  const filename = tutorialStatePath(storagePath)
  const normalized = normalizeTutorialState(state)

  return serialize(filename, async () => {
    const directory = path.dirname(filename)
    const temporary = path.join(
      directory,
      `.${STATE_FILENAME}.${Date.now().toString(36)}-${++temporaryFileSequence}.tmp`
    )

    await fs.mkdir(directory, { recursive: true })

    try {
      await fs.writeFile(temporary, JSON.stringify(normalized) + '\n', 'utf8')
      await fs.rename(temporary, filename)
    } catch (err) {
      await fs.unlink(temporary).catch(() => {})
      throw err
    }

    return normalized
  })
}

function resetTutorialState(storagePath) {
  const filename = tutorialStatePath(storagePath)

  return serialize(filename, async () => {
    try {
      await fs.unlink(filename)
    } catch (err) {
      if (!isMissing(err)) throw err
    }

    return freshTutorialState()
  })
}

function normalizeCompleted(value) {
  if (!Array.isArray(value)) return []

  const completed = new Set()

  for (const lesson of value) {
    if (Number.isInteger(lesson) && lesson >= 1 && lesson <= 8) completed.add(lesson)
  }

  return [...completed].sort((a, b) => a - b)
}

function firstIncompleteLesson(completed) {
  for (let lesson = 1; lesson <= 8; lesson++) {
    if (!completed.includes(lesson)) return lesson
  }

  return 8
}

function normalizeSolutions(value) {
  const solutions = {}
  if (!isRecord(value)) return solutions

  for (const key of STAGE_KEYS) {
    const solution = value[key]
    if (typeof solution !== 'string' || solution.length > MAX_SOLUTION_LENGTH) continue
    solutions[key] = solution
  }

  return solutions
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMissing(err) {
  return err !== null && typeof err === 'object' && err.code === 'ENOENT'
}

function serialize(filename, operation) {
  const previous = operations.get(filename) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)

  operations.set(filename, current)

  return current.finally(() => {
    if (operations.get(filename) === current) operations.delete(filename)
  })
}

module.exports = {
  STATE_VERSION,
  freshTutorialState,
  normalizeTutorialState,
  loadTutorialState,
  saveTutorialState,
  resetTutorialState,
  tutorialStatePath
}
