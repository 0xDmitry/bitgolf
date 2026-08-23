'use strict'

const { test } = require('brittle')

const { createSubmission } = require('../../../workers/game/protocol.js')
const { reduceEvents } = require('../../../workers/game/reducer.js')

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const CAROL = 'c'.repeat(64)
const DAVE = 'd'.repeat(64)

test('reducer derives one leaderboard row from one submission', (t) => {
  const state = reduceEvents([accepted(ALICE, 'abc&^')])

  t.alike(state.leaderboard, [scored(ALICE, 'abc&^')])
})

test('reducer sorts different scores in ascending order', (t) => {
  const state = reduceEvents([
    accepted(ALICE, 'a!!!!!!!'),
    accepted(BOB, 'abc&^'),
    accepted(CAROL, 'ab&')
  ])

  t.alike(
    state.leaderboard.map(({ score, author }) => ({ score, author })),
    [
      { score: 3, author: CAROL },
      { score: 5, author: BOB },
      { score: 8, author: ALICE }
    ]
  )
})

test('reducer gives a score to the first event in view order', (t) => {
  const aliceFirst = reduceEvents([accepted(ALICE, 'abc&^'), accepted(BOB, 'def|&')])
  const bobFirst = reduceEvents([accepted(BOB, 'def|&'), accepted(ALICE, 'abc&^')])

  t.is(aliceFirst.leaderboard.length, 1)
  t.is(aliceFirst.leaderboard[0].author, ALICE)
  t.is(bobFirst.leaderboard.length, 1)
  t.is(bobFirst.leaderboard[0].author, BOB)
})

test('reducer keeps only the first submission for each score', (t) => {
  const state = reduceEvents([
    accepted(ALICE, 'abc&^'),
    accepted(BOB, 'def|&'),
    accepted(CAROL, 'a'),
    accepted(DAVE, 'a!!!!!!!')
  ])

  t.alike(
    state.leaderboard.map(({ author, score }) => ({ author, score })),
    [
      { author: CAROL, score: 1 },
      { author: ALICE, score: 5 },
      { author: DAVE, score: 8 }
    ]
  )
})

test('reducer ignores invalid accepted events', (t) => {
  const state = reduceEvents([
    accepted(ALICE, 'a'),
    { ...accepted(BOB, 'abc&^'), author: 'short' },
    { ...accepted(CAROL, 'ab&'), score: 3 },
    { ...accepted(DAVE, 'ab&'), challenge: 'stub-v2' },
    null
  ])

  t.alike(state.leaderboard, [scored(ALICE, 'a')])
  t.alike(reduceEvents(null), { leaderboard: [] })
})

test('reducer independently verifies syntax and derives token scores', (t) => {
  const state = reduceEvents([
    accepted(ALICE, 'a b &'),
    accepted(BOB, 'a&'),
    accepted(CAROL, 'ab'),
    accepted(DAVE, 'abc&^')
  ])

  t.alike(state.leaderboard, [scored(ALICE, 'a b &', 3), scored(DAVE, 'abc&^')])
})

test('reducer is deterministic and does not mutate its input', (t) => {
  const events = Object.freeze([
    Object.freeze(accepted(ALICE, 'a!!!!!!!')),
    Object.freeze(accepted(BOB, 'abc&^')),
    Object.freeze(accepted(CAROL, 'ab&'))
  ])
  const before = events.map((event) => ({ ...event }))

  const first = reduceEvents(events)
  const second = reduceEvents(events)

  t.alike(first, second)
  t.alike(events, before)
})

function accepted(author, program) {
  return { ...createSubmission(program), author }
}

function scored(author, program, score = program.length) {
  return {
    program,
    author,
    score
  }
}
