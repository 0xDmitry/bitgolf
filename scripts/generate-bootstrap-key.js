#!/usr/bin/env node
'use strict'

const crypto = require('hypercore-crypto')

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  }
}

function main(args) {
  if (args.length !== 0) throw new Error('Usage: npm run generate-bootstrap-key')

  const bootstrapKey = generateBootstrapKey()

  console.log('Bootstrap key generated.')
  console.log('')
  console.log('bootstrap:')
  console.log(bootstrapKey.toString('hex'))
  console.log('')
  console.log('Use this only for a new, independent game namespace.')
  console.log('Do not rotate an existing production key during app upgrades.')

  return bootstrapKey
}

function generateBootstrapKey() {
  const { publicKey, secretKey } = crypto.keyPair()
  const bootstrapKey = Buffer.from(publicKey)

  secretKey.fill(0)
  return bootstrapKey
}

module.exports = { generateBootstrapKey }
