'use strict'

const fs = require('bare-fs')
const path = require('bare-path')
const { test } = require('brittle')

const {
  STATE_VERSION,
  freshTutorialState,
  normalizeTutorialState,
  loadTutorialState,
  saveTutorialState,
  resetTutorialState,
  tutorialStatePath
} = require('../../tutorial/state.js')

test('fresh tutorial state has independent canonical values', (t) => {
  const first = freshTutorialState()
  const second = freshTutorialState()

  t.alike(first, {
    version: STATE_VERSION,
    started: false,
    completed: [],
    current: 1,
    stage: '8a',
    tutorialComplete: false,
    solutions: {}
  })
  t.absent(first === second)
  t.absent(first.completed === second.completed)
  t.absent(first.solutions === second.solutions)
})

test('an explicitly started tutorial persists before lesson one is solved', async (t) => {
  const storage = await t.tmp()
  const started = { ...freshTutorialState(), started: true }

  t.alike(await saveTutorialState(storage, started), started)
  t.alike(await loadTutorialState(storage), started)
})

test('normalization sanitizes fields and resumes the first incomplete lesson', (t) => {
  const oversized = 'a'.repeat(4097)
  const state = normalizeTutorialState({
    version: STATE_VERSION,
    completed: [4, 2, 2, 1, 9, 0, '3'],
    current: 7,
    stage: '8b',
    tutorialComplete: true,
    solutions: {
      1: 'c',
      2: 42,
      7: oversized,
      '8a': 'a!b&c&de!&f&&',
      missing: 'a'
    },
    extra: true
  })

  t.alike(state, {
    version: STATE_VERSION,
    started: true,
    completed: [1, 2, 4],
    current: 3,
    stage: '8a',
    tutorialComplete: false,
    solutions: {
      1: 'c',
      '8a': 'a!b&c&de!&f&&'
    }
  })
})

test('tutorial state saves atomically and reloads normalized progress', async (t) => {
  const storage = await t.tmp()
  const saved = await saveTutorialState(storage, {
    version: STATE_VERSION,
    completed: [1, 2, 3],
    current: 1,
    stage: '8b',
    tutorialComplete: false,
    solutions: { 1: 'c', 2: 'f', bad: 'x' }
  })

  t.alike(saved, {
    version: STATE_VERSION,
    started: true,
    completed: [1, 2, 3],
    current: 4,
    stage: '8a',
    tutorialComplete: false,
    solutions: { 1: 'c', 2: 'f' }
  })
  t.alike(await loadTutorialState(storage), saved)

  const encoded = await fs.readFile(tutorialStatePath(storage), 'utf8')
  t.alike(JSON.parse(encoded), saved)
})

test('tutorial state preserves the 8b resume stage', async (t) => {
  const storage = await t.tmp()
  const state = await saveTutorialState(storage, {
    version: STATE_VERSION,
    completed: [1, 2, 3, 4, 5, 6, 7],
    current: 8,
    stage: '8b',
    tutorialComplete: false,
    solutions: { '8a': 'a!b&c&de!&f&&' }
  })

  t.is(state.current, 8)
  t.is(state.stage, '8b')
  t.absent(state.tutorialComplete)
  t.alike(await loadTutorialState(storage), state)
})

test('completing all lessons produces canonical complete state', async (t) => {
  const storage = await t.tmp()
  const state = await saveTutorialState(storage, {
    version: STATE_VERSION,
    completed: [8, 7, 6, 5, 4, 3, 2, 1],
    current: 1,
    stage: '8a',
    tutorialComplete: true,
    solutions: { '8b': 'ab^bc^|!de^ef^|!|' }
  })

  t.alike(state.completed, [1, 2, 3, 4, 5, 6, 7, 8])
  t.is(state.current, 8)
  t.is(state.stage, '8b')
  t.ok(state.tutorialComplete)
  t.alike(await loadTutorialState(storage), state)
})

test('solved 8b waits for explicit tutorial completion', (t) => {
  const state = normalizeTutorialState({
    version: STATE_VERSION,
    completed: [1, 2, 3, 4, 5, 6, 7, 8],
    current: 8,
    stage: '8b',
    tutorialComplete: false,
    solutions: { '8b': 'a!b!&c!&ab&c&|d!e!&f!&|de&f&|' }
  })

  t.is(state.current, 8)
  t.is(state.stage, '8b')
  t.absent(state.tutorialComplete)
})

test('reset removes persisted tutorial progress', async (t) => {
  const storage = await t.tmp()
  await saveTutorialState(storage, {
    version: STATE_VERSION,
    completed: [1],
    solutions: { 1: 'c' }
  })

  t.alike(await resetTutorialState(storage), freshTutorialState())
  t.alike(await loadTutorialState(storage), freshTutorialState())
  t.absent(await fs.exists(tutorialStatePath(storage)))

  t.alike(await resetTutorialState(storage), freshTutorialState())
})

test('missing, corrupt, and unsupported tutorial state fall back to fresh state', async (t) => {
  const missingStorage = await t.tmp()
  t.alike(await loadTutorialState(missingStorage), freshTutorialState())

  const corruptStorage = await t.tmp()
  const corruptPath = tutorialStatePath(corruptStorage)
  await fs.mkdir(path.dirname(corruptPath), { recursive: true })
  await fs.writeFile(corruptPath, '{not json', 'utf8')
  t.alike(await loadTutorialState(corruptStorage), freshTutorialState())

  const futureStorage = await t.tmp()
  const futurePath = tutorialStatePath(futureStorage)
  await fs.mkdir(path.dirname(futurePath), { recursive: true })
  await fs.writeFile(
    futurePath,
    JSON.stringify({ ...freshTutorialState(), version: STATE_VERSION + 1 }),
    'utf8'
  )
  t.alike(await loadTutorialState(futureStorage), freshTutorialState())
})
