'use strict'

const CHALLENGES = require('./challenges.js')
const { bitmapId, isValidAcceptedSubmission } = require('./protocol.js')
const { verifySubmission } = require('./verifier.js')

function reduceEvents(events) {
  const scoresByChallenge = new Map(CHALLENGES.map(({ target }) => [bitmapId(target), new Map()]))

  if (Array.isArray(events)) {
    for (const event of events) {
      if (!isValidAcceptedSubmission(event)) continue

      const firstByScore = scoresByChallenge.get(event.challenge)
      if (firstByScore === undefined) continue

      const result = verifySubmission(event)
      if (!result.valid) continue

      const entry = {
        program: event.program,
        author: event.author,
        score: result.score
      }

      if (!firstByScore.has(result.score)) firstByScore.set(result.score, entry)
    }
  }

  const leaderboards = {}

  for (const { target } of CHALLENGES) {
    const id = bitmapId(target)
    leaderboards[id] = [...scoresByChallenge.get(id).values()].sort((a, b) => a.score - b.score)
  }

  return { leaderboards }
}

module.exports = { reduceEvents }
