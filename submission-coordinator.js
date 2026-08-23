'use strict'

module.exports = class SubmissionCoordinator {
  constructor({ terminal, app, onExit }) {
    this.terminal = terminal
    this.app = app
    this.onExit = onExit

    this.queue = []
    this.pending = new Map()
    this.request = 0
    this.initialized = false
    this.exitRequested = false
    this.exitCode = 0
    this.stopping = false
    this.closed = false

    this._onSubmit = this._onSubmit.bind(this)
    this._onTerminalExit = this._onTerminalExit.bind(this)
    this._onGameReady = this._onGameReady.bind(this)
    this._onGameMessage = this._onGameMessage.bind(this)
    this._onGameError = this._onGameError.bind(this)
    this._onAppError = this._onAppError.bind(this)

    this.terminal.on('submit', this._onSubmit)
    this.terminal.on('exit', this._onTerminalExit)
    this.app.on('game-ready', this._onGameReady)
    this.app.on('game-message', this._onGameMessage)
    this.app.on('game-error', this._onGameError)
    this.app.on('error', this._onAppError)
  }

  markInitialized() {
    if (this.closed) return

    this.initialized = true
    this._flush()
    this._maybeExit()
  }

  close() {
    if (this.closed) return
    this.closed = true

    this.terminal.removeListener('submit', this._onSubmit)
    this.terminal.removeListener('exit', this._onTerminalExit)
    this.app.removeListener('game-ready', this._onGameReady)
    this.app.removeListener('game-message', this._onGameMessage)
    this.app.removeListener('game-error', this._onGameError)
    this.app.removeListener('error', this._onAppError)
  }

  _onSubmit(program, challenge) {
    if (this.closed) return

    const submission = { program }
    if (challenge !== undefined) submission.challenge = challenge

    if (!this.app.gameReady) {
      if (this.terminal.interactive) {
        this.terminal.showError('game worker is still connecting')
        return
      }

      this.queue.push(submission)
      return
    }

    this._send(submission)
  }

  _onTerminalExit(code) {
    if (this.closed) return

    if (this.terminal.interactive) {
      this._exit(code)
      return
    }

    this.exitRequested = true
    if (this.exitCode === 0) this.exitCode = code
    this._maybeExit()
  }

  _onGameReady() {
    this._flush()
  }

  _onGameMessage(message) {
    if (message.type !== 'game:submit-result') return

    this.pending.delete(message.requestId)
    if (!message.valid && !this.terminal.interactive) this.exitCode = 1
    this.terminal.showSubmission(message)
    this._maybeExit()
  }

  _onGameError(message) {
    this.pending.delete(message.requestId)
    if (!this.terminal.interactive) this.exitCode = 1
    this.terminal.showError(message.error)
    this._maybeExit()
  }

  _onAppError(err) {
    this.terminal.showError(err.message)
    if (this.terminal.interactive) return

    this.queue.length = 0
    this.pending.clear()
    this._exit(1)
  }

  _flush() {
    if (this.closed || !this.app.gameReady) return

    while (this.queue.length > 0) this._send(this.queue.shift())
  }

  _send(submission) {
    const requestId = `submission-${++this.request}`

    this.pending.set(requestId, submission)
    this.terminal.showSubmitting(submission.challenge)

    try {
      this.app.sendGame({ type: 'game:submit', requestId, ...submission })
    } catch (err) {
      this.pending.delete(requestId)
      if (!this.terminal.interactive) this.exitCode = 1
      this.terminal.showError(err.message)
    }

    this._maybeExit()
  }

  _maybeExit() {
    if (
      !this.exitRequested ||
      !this.initialized ||
      this.queue.length > 0 ||
      this.pending.size > 0
    ) {
      return
    }

    this._exit(this.exitCode)
  }

  _exit(code) {
    if (this.stopping) return
    this.stopping = true
    this.onExit(code)
  }
}
