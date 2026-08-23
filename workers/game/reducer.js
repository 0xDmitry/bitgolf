'use strict'

const { isValidAcceptedSubmission } = require('./protocol.js')
const { verifyProgram } = require('./verifier.js')

function reduceEvents(events) {
  const firstByScore = new Map()

  if (!Array.isArray(events)) return { leaderboard: [] }

  for (const event of events) {
    if (!isValidAcceptedSubmission(event)) continue

    const result = verifyProgram(event.program)
    if (!result.valid) continue

    const entry = {
      program: event.program,
      author: event.author,
      score: result.score
    }

    if (!firstByScore.has(result.score)) firstByScore.set(result.score, entry)
  }

  const leaderboard = [...firstByScore.values()].sort((a, b) => a.score - b.score)

  return { leaderboard }
}

module.exports = { reduceEvents }
