#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const appName = pkg.productName || pkg.name
const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: npm run build -- [target]

Assemble all six CLI binaries into a Pear deployment directory.
The target defaults to ../${pkg.name}-${pkg.version}.`)
  process.exit(0)
}

if (args.length > 1) {
  console.error('Usage: npm run build -- [target]')
  process.exit(1)
}

const target = path.resolve(root, args[0] || path.join('..', `${pkg.name}-${pkg.version}`))
const relativeTarget = path.relative(root, target)
const targetIsInsideRoot =
  relativeTarget === '' ||
  (!relativeTarget.startsWith(`..${path.sep}`) &&
    relativeTarget !== '..' &&
    !path.isAbsolute(relativeTarget))

if (targetIsInsideRoot) {
  console.error('Pear deployment target must be outside the project directory.')
  process.exit(1)
}

const builds = [
  ['darwin-arm64', path.join(root, 'out', 'darwin-arm64', appName)],
  ['darwin-x64', path.join(root, 'out', 'darwin-x64', appName)],
  ['linux-arm64', path.join(root, 'out', 'linux-arm64', appName)],
  ['linux-x64', path.join(root, 'out', 'linux-x64', appName)],
  ['win32-x64', path.join(root, 'out', 'win32-x64', `${appName}.exe`)],
  ['win32-arm64', path.join(root, 'out', 'win32-arm64', `${appName}.exe`)]
]

const missing = builds.filter(([, app]) => !fs.existsSync(app))
if (missing.length > 0) {
  console.error('Missing CLI build artifacts:')
  for (const [host, app] of missing) {
    console.error(`  ${path.relative(root, app)} (run npm run make:${host})`)
  }
  process.exit(1)
}

const pearArgs = ['build', '--package', path.join(root, 'package.json')]
for (const [host, app] of builds) pearArgs.push(`--${host}-app`, app)
pearArgs.push('--target', target)

const result = spawnSync('pear', pearArgs, {
  cwd: root,
  stdio: 'inherit'
})

if (result.error) {
  console.error(`Could not run Pear: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) process.exit(result.status || 1)
console.log(`Pear deployment assembled at ${target}`)
