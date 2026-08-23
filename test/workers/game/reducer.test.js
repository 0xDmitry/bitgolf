'use strict'

const { test } = require('brittle')

const { createSubmission } = require('../../../workers/game/protocol.js')
const { reduceEvents } = require('../../../workers/game/reducer.js')

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const CAROL = 'c'.repeat(64)
const DAVE = 'd'.repeat(64)

test('reducer derives one leaderboard row from one submission', (t) => {
  const state = reduceEvents([accepted(ALICE, 'hello')])

  t.alike(state.leaderboard, [scored(ALICE, 'hello')])
})

test('reducer sorts different scores in ascending order', (t) => {
  const state = reduceEvents([
    accepted(ALICE, 'abcdefgh'),
    accepted(BOB, 'hello'),
    accepted(CAROL, 'abc')
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
  const aliceFirst = reduceEvents([accepted(ALICE, 'hello'), accepted(BOB, 'world')])
  const bobFirst = reduceEvents([accepted(BOB, 'world'), accepted(ALICE, 'hello')])

  t.is(aliceFirst.leaderboard.length, 1)
  t.is(aliceFirst.leaderboard[0].author, ALICE)
  t.is(bobFirst.leaderboard.length, 1)
  t.is(bobFirst.leaderboard[0].author, BOB)
})

test('reducer keeps only the first submission for each score', (t) => {
  const state = reduceEvents([
    accepted(ALICE, 'hello'),
    accepted(BOB, 'world'),
    accepted(CAROL, 'x'),
    accepted(DAVE, 'abcdefgh')
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
    accepted(ALICE, 'x'),
    { ...accepted(BOB, 'hello'), author: 'short' },
    { ...accepted(CAROL, 'abc'), score: 3 },
    { ...accepted(DAVE, 'abc'), challenge: 'stub-v2' },
    null
  ])

  t.alike(state.leaderboard, [scored(ALICE, 'x')])
  t.alike(reduceEvents(null), { leaderboard: [] })
})

test('reducer is deterministic and does not mutate its input', (t) => {
  const events = Object.freeze([
    Object.freeze(accepted(ALICE, 'abcdefgh')),
    Object.freeze(accepted(BOB, 'hello')),
    Object.freeze(accepted(CAROL, 'abc'))
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

function scored(author, program) {
  return {
    program,
    author,
    score: program.length
  }
}
