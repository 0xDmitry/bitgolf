'use strict'

// Append challenges in deployment order. Never edit or remove a deployed entry.
// The last entry is the default challenge for this release.
module.exports = Object.freeze([
  Object.freeze({
    protocolVersion: 1,
    rulesVersion: 1,
    target: Object.freeze(
      [
        '00001000',
        '00010000',
        '00111000',
        '00011100',
        '01111110',
        '00001110',
        '00111100',
        '00011000'
      ].map((row) => Object.freeze([...row].map((pixel) => pixel === '1')))
    )
  })
])
