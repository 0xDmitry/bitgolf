'use strict'

const Readline = require('bare-readline')
const ReadyResource = require('ready-resource')

const PLAYER_PREFIX_LENGTH = 6
const MAX_DISPLAY_PROGRAM_LENGTH = 64

module.exports = class Terminal extends ReadyResource {
  constructor({ input, output }) {
    super()

    this.input = input
    this.output = output
    this.interactive = input.isTTY === true && output.isTTY === true
    this.readline = null
    this.state = null
    this.feedback = null
    this.restored = false

    this._onLine = this._onLine.bind(this)
    this._onEnd = this._onEnd.bind(this)
    this._onInputEnd = this._onInputEnd.bind(this)
  }

  _open() {
    this.output.write(formatScreen(this.state, this.feedback) + '\n\n')
    this.input.setEncoding('utf8')

    if (this.interactive && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(true)
    }

    this.readline = Readline.createInterface({
      input: this.input,
      output: this.interactive ? this.output : null,
      prompt: this.interactive ? 'program > ' : ''
    })

    this.readline.on('line', this._onLine)
    this.readline.on('end', this._onEnd)
    this.input.once('end', this._onInputEnd)
    this.input.resume()

    if (!this.interactive) this.readline.prompt()
  }

  _close() {
    if (this.readline !== null) {
      this.readline.removeListener('line', this._onLine)
      this.readline.removeListener('end', this._onEnd)
      this.readline.close()
      this.readline = null
    }

    this.input.removeListener('end', this._onInputEnd)
    this._restoreInput()
  }

  updateState(state) {
    this.state = state
    this._render()
  }

  showSubmission(result) {
    this.feedback = result.valid ? { type: 'valid', score: result.score } : { type: 'invalid' }
    this._render()
  }

  showSubmitting() {
    this.feedback = { type: 'submitting' }
    this._render()
  }

  showError(error) {
    this.feedback = { type: 'error', message: String(error) }
    this._render()
  }

  showWarning(warning) {
    this.feedback = { type: 'warning', message: String(warning) }
    this._render()
  }

  _render() {
    if (!this.opened || this.readline === null) return

    const screen = formatScreen(this.state, this.feedback)

    if (this.interactive) {
      this.output.write('\r\n' + screen + '\r\n')
      this.readline.prompt()
    } else {
      this.output.write(screen + '\n')
    }
  }

  _onLine(program) {
    this.emit('submit', program)
  }

  _onEnd() {
    if (this.closing !== null || this.closed) return
    this._restoreInput()
    this.emit('exit', this.interactive ? 130 : 0)
  }

  _onInputEnd() {
    if (this.interactive || this.closing !== null || this.closed) return
    this.emit('exit', 0)
  }

  _restoreInput() {
    if (this.restored) return
    this.restored = true

    if (this.interactive && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(false)
    }

    this.input.pause()
  }
}

function formatScreen(state, feedback) {
  const lines = ['BIT GOLF', '']

  if (state === null) {
    lines.push('connecting...')
  } else {
    lines.push('connected', '')
    lines.push(`player   ${shortKey(state.playerKey)}`)
    lines.push(`peers    ${state.peers}`)
    lines.push('', formatLeaderboard(state.leaderboard))
  }

  if (feedback !== null) lines.push('', formatFeedback(feedback))

  return lines.join('\n')
}

function formatLeaderboard(leaderboard) {
  const lines = [row('SCORE', 'PLAYER', 'PROGRAM')]

  for (const entry of leaderboard || []) {
    lines.push(row(entry.score, shortKey(entry.author), displayProgram(entry.program)))
  }

  return lines.join('\n')
}

function formatFeedback(feedback) {
  if (feedback.type === 'valid') return `✓ valid\nscore ${feedback.score}`
  if (feedback.type === 'invalid') return '✗ invalid'
  if (feedback.type === 'submitting') return 'submitting...'
  if (feedback.type === 'warning') return `warning: ${feedback.message}`
  return `error: ${feedback.message}`
}

function row(score, player, program) {
  return `${String(score).padEnd(8)}${String(player).padEnd(13)}${program}`
}

function shortKey(key) {
  if (typeof key !== 'string' || key.length === 0) return 'unknown'
  return key.slice(0, PLAYER_PREFIX_LENGTH) + '...'
}

function displayProgram(program) {
  const json = JSON.stringify(typeof program === 'string' ? program : '')
  const escaped = json.slice(1, -1)

  if (escaped.length <= MAX_DISPLAY_PROGRAM_LENGTH) return escaped
  return escaped.slice(0, MAX_DISPLAY_PROGRAM_LENGTH - 1) + '…'
}
