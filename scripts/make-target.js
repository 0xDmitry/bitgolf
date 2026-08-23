#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const appName = pkg.productName || pkg.name
const host = process.argv[2]
const supported = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64'
])

if (!supported.has(host)) {
  console.error(`Unsupported build target: ${host || '(missing)'}`)
  process.exit(1)
}

const out = path.join(root, 'out', host)
const app = path.join(out, host.startsWith('win32-') ? `${appName}.exe` : appName)
const metadata = path.join(out, 'build.json')

fs.mkdirSync(out, { recursive: true })
fs.rmSync(metadata, { force: true })

const command = process.platform === 'win32' ? 'bare-build.cmd' : 'bare-build'
const result = spawnSync(
  command,
  ['--name', appName, '--standalone', '--host', host, '--out', out, 'bin.mjs'],
  { cwd: root, stdio: 'inherit' }
)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status || 1)

const marker = Buffer.from(
  `  "name": ${JSON.stringify(pkg.name)},\n  "version": ${JSON.stringify(pkg.version)},`
)
if (!fs.readFileSync(app).includes(marker)) {
  console.error(`Built ${host} artifact does not embed ${pkg.name} v${pkg.version}`)
  process.exit(1)
}

const stat = fs.statSync(app)
const build = {
  name: appName,
  version: pkg.version,
  host,
  file: path.basename(app),
  size: stat.size,
  sha256: sha256(app)
}

fs.writeFileSync(metadata, JSON.stringify(build, null, 2) + '\n')
console.log(`Built ${host} ${appName} v${pkg.version}`)

function sha256(file) {
  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const fd = fs.openSync(file, 'r')

  try {
    let bytes = 0
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes))
    }
  } finally {
    fs.closeSync(fd)
  }

  return hash.digest('hex')
}
