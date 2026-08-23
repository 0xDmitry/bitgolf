'use strict'

const { test } = require('brittle')

const CHALLENGES = require('../../tutorial/challenges.js')
const { evaluateAttempt } = require('../../workers/game/evaluator.js')

const TARGETS = {
  1: [
    '01010101',
    '01010101',
    '01010101',
    '01010101',
    '01010101',
    '01010101',
    '01010101',
    '01010101'
  ],
  2: [
    '00000000',
    '11111111',
    '00000000',
    '11111111',
    '00000000',
    '11111111',
    '00000000',
    '11111111'
  ],
  3: [
    '10101010',
    '10101010',
    '10101010',
    '10101010',
    '10101010',
    '10101010',
    '10101010',
    '10101010'
  ],
  4: [
    '00000000',
    '00000000',
    '00000000',
    '00000000',
    '00001111',
    '00001111',
    '00001111',
    '00001111'
  ],
  5: [
    '00001111',
    '00001111',
    '00001111',
    '00001111',
    '11111111',
    '11111111',
    '11111111',
    '11111111'
  ],
  6: [
    '01010101',
    '10101010',
    '01010101',
    '10101010',
    '01010101',
    '10101010',
    '01010101',
    '10101010'
  ],
  7: [
    '00010000',
    '00010000',
    '00010000',
    '00010000',
    '00010000',
    '00010000',
    '00010000',
    '00010000'
  ],
  '8a': [
    '00000000',
    '00000000',
    '00000000',
    '00000000',
    '00000000',
    '00010000',
    '00000000',
    '00000000'
  ],
  '8b': [
    '11111111',
    '10000001',
    '10000001',
    '10000001',
    '10000001',
    '10000001',
    '10000001',
    '11111111'
  ]
}

test('tutorial stages are frozen declarative challenges with exact targets', (t) => {
  t.alike(
    CHALLENGES.map(({ key }) => key),
    ['1', '2', '3', '4', '5', '6', '7', '8a', '8b']
  )
  t.alike(
    CHALLENGES.map(({ lesson }) => lesson),
    [1, 2, 3, 4, 5, 6, 7, 8, 8]
  )
  t.ok(Object.isFrozen(CHALLENGES))

  for (const stage of CHALLENGES) {
    t.ok(Object.isFrozen(stage))
    t.ok(Object.isFrozen(stage.target))
    t.ok(Object.isFrozen(stage.copy))
    t.ok(Object.isFrozen(stage.hints))
    t.ok(Object.isFrozen(stage.solvedCopy))
    t.is(stage.title, stage.title.toUpperCase())
    t.alike(stage.target.map(renderRow), TARGETS[stage.key])

    for (const row of stage.target) t.ok(Object.isFrozen(row))
  }
})

test('every tutorial reference solution renders its exact target', (t) => {
  for (const stage of CHALLENGES) {
    const result = evaluateAttempt(stage.referenceSolution, stage)

    t.ok(result.valid, `${stage.key} reference is valid`)
    t.ok(result.matches, `${stage.key} reference matches`)
    t.is(result.diff.flat().filter(Boolean).length, 0)
  }
})

test('frame reference and bonus solutions render the same target', (t) => {
  const frame = CHALLENGES.find(({ key }) => key === '8b')
  const reference = evaluateAttempt(frame.referenceSolution, frame)
  const bonus = evaluateAttempt(frame.bonusSolution, frame)

  t.is(reference.size, 29)
  t.is(bonus.size, 17)
  t.ok(reference.matches)
  t.ok(bonus.matches)
  t.alike(reference.bitmap, bonus.bitmap)
})

test('tutorial matching accepts redundant equivalent programs', (t) => {
  const masks = CHALLENGES[0]
  const redundant = evaluateAttempt(`${masks.referenceSolution}!!`, masks)

  t.ok(redundant.valid)
  t.ok(redundant.matches)
  t.is(redundant.size, 3)
  t.absent(`${masks.referenceSolution}!!` === masks.referenceSolution)
})

function renderRow(row) {
  return row.map((pixel) => (pixel ? '1' : '0')).join('')
}
