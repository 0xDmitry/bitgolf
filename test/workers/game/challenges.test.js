'use strict'

const { test } = require('brittle')

const CHALLENGES = require('../../../workers/game/challenges.js')
const { bitmapId } = require('../../../workers/game/protocol.js')

test('challenge registry contains the immutable bitmap definition without a stored id', (t) => {
  t.is(CHALLENGES.length, 1)

  const [challenge] = CHALLENGES

  t.alike(
    {
      protocolVersion: challenge.protocolVersion,
      rulesVersion: challenge.rulesVersion
    },
    { protocolVersion: 1, rulesVersion: 1 }
  )
  t.absent(Object.prototype.hasOwnProperty.call(challenge, 'id'))
  t.alike(challenge.target.map(renderRow), [
    '00001000',
    '00010000',
    '00111000',
    '00011100',
    '01111110',
    '00001110',
    '00111100',
    '00011000'
  ])
  t.ok(Object.isFrozen(CHALLENGES))
  t.ok(Object.isFrozen(challenge))
  t.ok(Object.isFrozen(challenge.target))
  for (const row of challenge.target) t.ok(Object.isFrozen(row))
})

test('deployed bitmap ids and protocol/id identities are unique', (t) => {
  const identities = CHALLENGES.map(
    ({ target, protocolVersion }) => `${protocolVersion}:${bitmapId(target)}`
  )
  const ids = CHALLENGES.map(({ target }) => bitmapId(target))

  t.is(new Set(identities).size, CHALLENGES.length)
  t.is(new Set(ids).size, CHALLENGES.length)
})

function renderRow(row) {
  return row.map((pixel) => (pixel ? '1' : '0')).join('')
}
