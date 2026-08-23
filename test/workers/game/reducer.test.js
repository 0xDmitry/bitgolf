'use strict'

const { test } = require('brittle')

const { TARGET_PROGRAM, targetProgram } = require('../../helpers/programs.js')
const CHALLENGES = require('../../../workers/game/challenges.js')
const { bitmapId } = require('../../../workers/game/protocol.js')
const { reduceEvents } = require('../../../workers/game/reducer.js')

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const CAROL = 'c'.repeat(64)
const DAVE = 'd'.repeat(64)
const CHALLENGE_ID = bitmapId(CHALLENGES[0].target)

test('reducer derives one leaderboard row from one submission', (t) => {
  const state = reduceEvents([accepted(ALICE, TARGET_PROGRAM)])

  t.alike(leaderboard(state), [scored(ALICE, TARGET_PROGRAM)])
})

test('reducer sorts different scores in ascending order', (t) => {
  const state = reduceEvents([
    accepted(ALICE, targetProgram(2)),
    accepted(BOB, targetProgram(1)),
    accepted(CAROL, TARGET_PROGRAM)
  ])

  t.alike(
    leaderboard(state).map(({ score, author }) => ({ score, author })),
    [
      { score: TARGET_PROGRAM.length, author: CAROL },
      { score: TARGET_PROGRAM.length + 2, author: BOB },
      { score: TARGET_PROGRAM.length + 4, author: ALICE }
    ]
  )
})

test('reducer gives a score to the first event in view order', (t) => {
  const spaced = ` ${TARGET_PROGRAM} `
  const aliceFirst = reduceEvents([accepted(ALICE, TARGET_PROGRAM), accepted(BOB, spaced)])
  const bobFirst = reduceEvents([accepted(BOB, spaced), accepted(ALICE, TARGET_PROGRAM)])

  t.is(leaderboard(aliceFirst).length, 1)
  t.is(leaderboard(aliceFirst)[0].author, ALICE)
  t.is(leaderboard(bobFirst).length, 1)
  t.is(leaderboard(bobFirst)[0].author, BOB)
})

test('reducer keeps only the first submission for each score', (t) => {
  const state = reduceEvents([
    accepted(ALICE, targetProgram(1)),
    accepted(BOB, ` ${targetProgram(1)} `),
    accepted(CAROL, TARGET_PROGRAM),
    accepted(DAVE, targetProgram(2))
  ])

  t.alike(
    leaderboard(state).map(({ author, score }) => ({ author, score })),
    [
      { author: CAROL, score: TARGET_PROGRAM.length },
      { author: ALICE, score: TARGET_PROGRAM.length + 2 },
      { author: DAVE, score: TARGET_PROGRAM.length + 4 }
    ]
  )
})

test('reducer ignores invalid accepted events', (t) => {
  const state = reduceEvents([
    accepted(ALICE, TARGET_PROGRAM),
    { ...accepted(BOB, TARGET_PROGRAM), author: 'short' },
    { ...accepted(CAROL, TARGET_PROGRAM), score: TARGET_PROGRAM.length },
    { ...accepted(DAVE, TARGET_PROGRAM), challenge: 'stub-v1' },
    null
  ])

  t.alike(leaderboard(state), [scored(ALICE, TARGET_PROGRAM)])
  t.alike(reduceEvents(null), { leaderboards: { [CHALLENGE_ID]: [] } })
})

test('reducer independently verifies the target and derives token scores', (t) => {
  const spaced = ` ${TARGET_PROGRAM} `
  const state = reduceEvents([
    accepted(ALICE, spaced),
    accepted(BOB, 'a&'),
    accepted(CAROL, 'a'),
    accepted(DAVE, targetProgram(1))
  ])

  t.alike(leaderboard(state), [
    scored(ALICE, spaced, TARGET_PROGRAM.length),
    scored(DAVE, targetProgram(1))
  ])
})

test('reducer is deterministic and does not mutate its input', (t) => {
  const events = Object.freeze([
    Object.freeze(accepted(ALICE, targetProgram(2))),
    Object.freeze(accepted(BOB, targetProgram(1))),
    Object.freeze(accepted(CAROL, TARGET_PROGRAM))
  ])
  const before = events.map((event) => ({ ...event }))

  const first = reduceEvents(events)
  const second = reduceEvents(events)

  t.alike(first, second)
  t.alike(events, before)
})

function accepted(author, program) {
  return {
    v: 1,
    type: 'submission',
    challenge: CHALLENGE_ID,
    program,
    author
  }
}

function leaderboard(state) {
  return state.leaderboards[CHALLENGE_ID]
}

function scored(author, program, score = program.replace(/\s/g, '').length) {
  return {
    program,
    author,
    score
  }
}
