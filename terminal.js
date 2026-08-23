'use strict'

const ansiEscapes = require('bare-ansi-escapes')
const KeyDecoder = require('bare-ansi-escapes/key-decoder')
const process = require('bare-process')
const Readline = require('bare-readline')
const ReadyResource = require('ready-resource')

const CHALLENGES = require('./workers/game/challenges.js')
const { tokenizeProgram, evaluateBitmap, evaluateAttempt } = require('./workers/game/evaluator.js')
const { bitmapId } = require('./workers/game/protocol.js')
const TUTORIAL_STAGES = require('./tutorial/challenges.js')
const { freshTutorialState, normalizeTutorialState } = require('./tutorial/state.js')

const PLAYER_PREFIX_LENGTH = 6
const SCORE_COLUMN_WIDTH = 8
const PLAYER_COLUMN_WIDTH = 13
const PROGRAM_COLUMN_OFFSET = SCORE_COLUMN_WIDTH + PLAYER_COLUMN_WIDTH
const MIN_INLINE_PROGRAM_WIDTH = 8
const DEFAULT_COLUMNS = 80
const DEFAULT_ROWS = 24
const CRLF_DELAY = 100
const ESCAPE_CODE_TIMEOUT = 50
const BITMAP_SIZE = 8
const PIXEL_WIDTH = 2
const BITMAP_INNER_WIDTH = BITMAP_SIZE * PIXEL_WIDTH
const BITMAP_PANEL_WIDTH = BITMAP_INNER_WIDTH + 2
const MISMATCH_PIXEL = '×'
const { CSI } = ansiEscapes.constants
const CLEAR_SCREEN = ansiEscapes.eraseDisplay + CSI + 'H'
const DISABLE_WRAP = CSI + '?7l'
const ENABLE_WRAP = CSI + '?7h'
const RESET_STYLE = CSI + '0m'
const BOLD = CSI + '1m'
const NORMAL_WEIGHT = CSI + '22m'
const LIME = CSI + '38;2;176;217;68m'
const COOL_TEXT = CSI + '38;2;196;203;212m'
const COOL_MUTED = CSI + '38;2;127;138;155m'
const COOL_BORDER = CSI + '38;2;70;81;95m'
const CORAL = CSI + '38;2;255;102;127m'
const AMBER = CSI + '38;2;230;184;92m'
const CURRENT_CHALLENGE = CHALLENGES[CHALLENGES.length - 1]
const CURRENT_CHALLENGE_ID = bitmapId(CURRENT_CHALLENGE.target)
const MENU_ITEMS = [
  { label: 'Tutorial', view: 'tutorial' },
  { label: 'Solve challenge', view: 'challenge' },
  { label: 'Leaderboard', view: 'leaderboard' }
]
const TUTORIAL_STAGE_BY_KEY = new Map(TUTORIAL_STAGES.map((stage) => [stage.key, stage]))
const GLOBAL_COMMANDS = new Set([':masks', ':tutorial', ':tutorial reset'])
const ALL_TUTORIAL_LESSONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8])

module.exports = class Terminal extends ReadyResource {
  constructor({
    input,
    output,
    challengeId = CURRENT_CHALLENGE_ID,
    tutorialState = null,
    persistTutorialState = null
  }) {
    super()

    const challenge = CHALLENGES.find(({ target }) => bitmapId(target) === challengeId)
    if (challenge === undefined) throw new TypeError(`Unknown challenge: ${challengeId}`)

    this.input = input
    this.output = output
    this.challenge = challenge
    this.challengeId = bitmapId(challenge.target)
    this.interactive = input.isTTY === true && output.isTTY === true
    this.colors = supportsTerminalColors(output)
    this.tutorialState = normalizeTutorialState(tutorialState || freshTutorialState())
    this.persistTutorialState =
      typeof persistTutorialState === 'function' ? persistTutorialState : null
    this.tutorialSaveTail = Promise.resolve()
    this.tutorialReplay = false
    this.tutorialStageKey = tutorialStageKey(this.tutorialState)
    this.tutorialDrafts = { ...this.tutorialState.solutions }
    this.globalDraft = { program: '', cursor: 0 }
    this.globalHistory = []
    this.commandDraft = null
    this.referenceReturnView = 'challenge'
    this.readline = null
    this.state = null
    this.feedback = null
    this.restored = false
    this.viewportStart = null
    this.view = this.interactive ? 'menu' : 'combined'
    this.menuIndex = 0
    this.editor = editorState('', 0, this.challenge)
    this.tutorialSolved = false

    this._onLine = this._onLine.bind(this)
    this._onEnd = this._onEnd.bind(this)
    this._onInputEnd = this._onInputEnd.bind(this)
    this._onEditorEdit = this._onEditorEdit.bind(this)
    this._canSubmit = this._canSubmit.bind(this)
    this._onViewportPage = this._onViewportPage.bind(this)
    this._onNavigate = this._onNavigate.bind(this)
    this._onResize = this._onResize.bind(this)
  }

  _open() {
    this.input.setEncoding('utf8')

    if (this.interactive && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(true)
    }

    if (this.interactive) {
      this.readline = new LiveEditor({
        input: this.input,
        line: this.editor.program,
        cursor: this.editor.cursor,
        onEdit: this._onEditorEdit,
        canSubmit: this._canSubmit,
        onLine: this._onLine,
        onEnd: this._onEnd,
        onPage: this._onViewportPage,
        onNavigate: this._onNavigate
      })
    } else {
      this.readline = Readline.createInterface({
        input: this.input,
        output: null,
        prompt: ''
      })
      this.readline.on('line', this._onLine)
      this.readline.on('end', this._onEnd)
    }

    this.input.once('end', this._onInputEnd)
    if (this.interactive) this.output.on('resize', this._onResize)
    this.input.resume()

    this._render(true)
  }

  async _close() {
    if (this.readline !== null) {
      if (!this.interactive) {
        this.readline.removeListener('line', this._onLine)
        this.readline.removeListener('end', this._onEnd)
      }

      this.readline.close()
      this.readline = null
    }

    this.input.removeListener('end', this._onInputEnd)
    if (this.interactive) this.output.removeListener('resize', this._onResize)
    this._restoreInput()
    await this.tutorialSaveTail
  }

  updateState(state) {
    this.state = state
    this._render()
  }

  showSubmission(result) {
    if (result.challenge !== undefined && result.challenge !== this.challengeId) return

    this.feedback = result.valid ? { type: 'valid', score: result.score } : { type: 'invalid' }
    this._render()
  }

  showSubmitting(challengeId = this.challengeId) {
    if (challengeId !== this.challengeId) return

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

  _formatScreen() {
    return formatScreen({
      view: this.view,
      state: this.state,
      feedback: this.feedback,
      editor: this.editor,
      challenge: this.challenge,
      columns: this.output.columns || DEFAULT_COLUMNS,
      menuIndex: this.menuIndex,
      tutorialState: this.tutorialState,
      tutorialStage: this._tutorialStage(),
      tutorialSolved: this.tutorialSolved,
      tutorialReplay: this.tutorialReplay
    })
  }

  _render(opening = false, viewportAction = null) {
    if ((!opening && !this.opened) || this.readline === null) return

    const screen = this._formatScreen()

    if (this.interactive) {
      const rows = this.output.rows || DEFAULT_ROWS
      const viewport = viewportLayout(screen, rows)
      let viewportStart =
        this.viewportStart === null
          ? viewport.defaultStart
          : Math.min(viewport.lastStart, Math.max(0, this.viewportStart))

      if (viewportAction !== null) {
        const pageSize = Math.max(1, viewport.contentHeight)

        if (viewportAction === 'page-up') viewportStart = Math.max(0, viewportStart - pageSize)
        if (viewportAction === 'page-down') {
          viewportStart = Math.min(viewport.lastStart, viewportStart + pageSize)
        }
        if (viewportAction === 'line-up') viewportStart = Math.max(0, viewportStart - 1)
        if (viewportAction === 'line-down') {
          viewportStart = Math.min(viewport.lastStart, viewportStart + 1)
        }
        if (viewportAction === 'home') viewportStart = 0
        if (viewportAction === 'end') viewportStart = viewport.lastStart
      }

      this.viewportStart = viewportStart === viewport.defaultStart ? null : viewportStart
      this.output.write(
        renderInteractive(
          screen,
          rows,
          this.output.columns || DEFAULT_COLUMNS,
          opening,
          viewportStart,
          viewport,
          this.colors
        )
      )
    } else {
      this.output.write(screen.lines.join('\n') + '\n')
    }
  }

  _onEditorEdit(program, cursor) {
    this.viewportStart = null

    const tutorial = this.view === 'tutorial'
    const editable = tutorial || this.view === 'challenge' || this.view === 'combined'
    const previous = this.editor

    if (!editable) return

    if (this._commandActive() && !program.startsWith(':')) {
      this._cancelCommandMode()
      return
    }

    if (this.interactive && program.startsWith(':') && !previous.program.startsWith(':')) {
      this.commandDraft = {
        view: this.view,
        stage: tutorial ? this.tutorialStageKey : null,
        program: previous.program,
        cursor: previous.cursor
      }
    }

    const editorChallenge = tutorial ? this._tutorialStage() : this.challenge

    if (program !== previous.program) {
      this.feedback = null
      this.editor = editorState(program, cursor, editorChallenge)
    } else {
      this.editor.cursor = cursor
    }

    if (tutorial) {
      if (!program.startsWith(':')) {
        this.tutorialDrafts[this.tutorialStageKey] = program
      }

      if (this.editor.evaluation.matches && !this.tutorialSolved) {
        this._markTutorialSolved(program)
      }
    } else if (!program.startsWith(':')) {
      this.globalDraft = { program, cursor }
    }

    this._render()
  }

  _canSubmit(program) {
    const command = normalizeCommand(program)

    if (command !== null) {
      if (this.view === 'tutorial') return false
      return GLOBAL_COMMANDS.has(command) ? { accept: true, remember: false } : false
    }

    const tutorial = this.view === 'tutorial'
    const evaluation = evaluateAttempt(program, tutorial ? this._tutorialStage() : this.challenge)

    this.editor = {
      program,
      cursor: this.readline === null ? program.length : this.readline.cursor,
      evaluation
    }

    if (tutorial && evaluation.matches && !this.tutorialSolved) {
      this._markTutorialSolved(program)
    }

    if (tutorial) {
      return this.tutorialSolved ? { accept: true, remember: false } : false
    }

    return evaluation.matches
  }

  _onLine(program) {
    this.viewportStart = null

    if (this.interactive && this._handleCommand(program)) return

    if (this.view === 'tutorial') {
      const evaluation = evaluateAttempt(program, this._tutorialStage())
      this.editor = { program, cursor: program.length, evaluation }

      if (evaluation.matches && !this.tutorialSolved) this._markTutorialSolved(program)

      if (this.tutorialSolved) this._advanceTutorial()
      else this._render()
      return
    }

    const evaluation = evaluateAttempt(program, this.challenge)

    if (!evaluation.matches) {
      this.editor = { program, cursor: program.length, evaluation }
      this._render()
      return
    }

    this.feedback = null
    this.editor = this.interactive
      ? editorState('', 0, this.challenge)
      : { program, cursor: program.length, evaluation }
    if (this.interactive) this.globalDraft = { program: '', cursor: 0 }
    this.emit('submit', program, this.challengeId)
    this._render()
  }

  _tutorialStage() {
    const stage = TUTORIAL_STAGE_BY_KEY.get(this.tutorialStageKey)
    if (stage === undefined) throw new Error(`Unknown tutorial stage: ${this.tutorialStageKey}`)
    return stage
  }

  _markTutorialSolved(program) {
    if (this.tutorialSolved) return

    const stage = this._tutorialStage()
    const completed = new Set(this.tutorialState.completed)
    const solutions = { ...this.tutorialState.solutions, [stage.key]: program }
    let current = this.tutorialState.current
    let tutorialStage = this.tutorialState.stage

    this.tutorialSolved = true
    this.tutorialDrafts[stage.key] = program

    if (stage.key === '8a') {
      current = 8
      tutorialStage = '8b'
    } else {
      completed.add(stage.lesson)
      current = stage.lesson === 8 ? 8 : stage.lesson + 1
    }

    this._updateTutorialState({
      ...this.tutorialState,
      completed: [...completed].sort((a, b) => a - b),
      current,
      stage: tutorialStage,
      solutions
    })
  }

  _advanceTutorial() {
    const index = TUTORIAL_STAGES.findIndex((stage) => stage.key === this.tutorialStageKey)

    if (index === TUTORIAL_STAGES.length - 1) {
      this._updateTutorialState({
        ...this.tutorialState,
        completed: [...ALL_TUTORIAL_LESSONS],
        current: 8,
        stage: '8b',
        tutorialComplete: true
      })
      this.view = 'tutorial-complete'
      this.viewportStart = null
      this.commandDraft = null
      this.editor = editorState('', 0, this._tutorialStage())
      this._render()
      return
    }

    const next = TUTORIAL_STAGES[index + 1]
    this.tutorialStageKey = next.key
    const program = this.tutorialDrafts[next.key] || ''
    this.editor = editorState(program, program.length, next)
    this.tutorialSolved = this.editor.evaluation.matches
    this.commandDraft = null
    this.readline.setLine(program, program.length)
    this.viewportStart = null
    this._render()
  }

  _startTutorial({ replay = false, reset = false } = {}) {
    if (reset) this.tutorialState = freshTutorialState()

    const entering = this.view !== 'tutorial'
    this._captureGlobalDraft()
    if (entering) {
      this.globalHistory = [...this.readline.history]
      this.readline.setHistory([])
    }
    this.tutorialReplay = replay || this.tutorialState.tutorialComplete
    if (!this.tutorialReplay && !this.tutorialState.started) {
      this._updateTutorialState({ ...this.tutorialState, started: true })
    }
    this.tutorialDrafts = this.tutorialReplay ? {} : { ...this.tutorialState.solutions }
    this.tutorialStageKey = this.tutorialReplay ? '1' : tutorialStageKey(this.tutorialState)
    this.commandDraft = null
    this.feedback = null
    this.view = 'tutorial'
    this.viewportStart = null

    const stage = this._tutorialStage()
    const program = this.tutorialDrafts[stage.key] || ''
    this.editor = editorState(program, program.length, stage)
    this.tutorialSolved = this.editor.evaluation.matches
    this.readline.setLine(program, program.length)
    this._render()
  }

  _leaveTutorial(view = 'menu') {
    this.tutorialReplay = false
    this.commandDraft = null
    this.view = view
    this.viewportStart = null
    this.editor = editorState(this.globalDraft.program, this.globalDraft.cursor, this.challenge)
    this.readline.setLine(this.globalDraft.program, this.globalDraft.cursor)
    this.readline.setHistory(this.globalHistory)
    this._render()
  }

  _captureGlobalDraft() {
    if (this.view !== 'challenge' && this.view !== 'menu' && this.view !== 'leaderboard') return
    if (this.readline === null || this.readline.line.startsWith(':')) return

    this.globalDraft = {
      program: this.readline.line,
      cursor: this.readline.cursor
    }
  }

  _handleCommand(program) {
    const command = normalizeCommand(program)
    if (command === null) return false

    if (this.view === 'tutorial') {
      return false
    }

    if (this.view !== 'challenge' || !GLOBAL_COMMANDS.has(command)) return false

    this._restoreCommandDraft(false)

    if (command === ':masks') {
      this._openMaskReference('challenge')
    } else if (command === ':tutorial reset') {
      this._startTutorial({ reset: true })
    } else {
      this._startTutorial({ replay: this.tutorialState.tutorialComplete })
    }

    return true
  }

  _enterCommandMode() {
    const tutorial = this.view === 'tutorial'

    this.commandDraft = {
      view: this.view,
      stage: tutorial ? this.tutorialStageKey : null,
      program: this.readline.line,
      cursor: this.readline.cursor
    }
    this.editor = editorState(':', 1, tutorial ? this._tutorialStage() : this.challenge)
    this.readline.setLine(':', 1)
    this.viewportStart = null
    this._render()
  }

  _commandActive() {
    if (this.commandDraft === null || this.commandDraft.view !== this.view) return false
    return this.view !== 'tutorial' || this.commandDraft.stage === this.tutorialStageKey
  }

  _cancelCommandMode() {
    if (!this._commandActive()) return false
    this._restoreCommandDraft(this.view === 'tutorial')
    this.viewportStart = null
    this._render()
    return true
  }

  _restoreCommandDraft(tutorial) {
    const stage = tutorial ? this._tutorialStage() : this.challenge
    const fallback = tutorial
      ? { program: this.tutorialDrafts[this.tutorialStageKey] || '', cursor: 0 }
      : this.globalDraft
    const saved =
      this.commandDraft !== null &&
      this.commandDraft.view === this.view &&
      (!tutorial || this.commandDraft.stage === this.tutorialStageKey)
        ? this.commandDraft
        : fallback

    this.commandDraft = null
    const cursor = Math.min(saved.program.length, saved.cursor)
    this.editor = editorState(saved.program, cursor, stage)
    this.readline.setLine(saved.program, cursor)
  }

  _openMaskReference(returnView) {
    this.referenceReturnView = returnView
    this.view = 'mask-reference'
    this.viewportStart = null
    this._render()
  }

  _updateTutorialState(state) {
    this.tutorialState = normalizeTutorialState(state)
    this._queueTutorialState()
  }

  _queueTutorialState() {
    const snapshot = cloneTutorialState(this.tutorialState)
    this.emit('tutorial-state', snapshot)

    if (this.persistTutorialState === null) return

    this.tutorialSaveTail = this.tutorialSaveTail
      .then(() => this.persistTutorialState(snapshot))
      .catch((err) => {
        this.feedback = {
          type: 'warning',
          message: `tutorial progress was not saved: ${err.message}`
        }
        this._render()
      })
  }

  _onEnd() {
    if (this.closing !== null || this.closed) return
    this._restoreInput()
    this.emit('exit', this.interactive ? 130 : 0)
  }

  _onInputEnd() {
    if (this.closing !== null || this.closed) return

    if (this.interactive) {
      this.readline.close()
      return this._onEnd()
    }

    this.emit('exit', 0)
  }

  _onViewportPage(direction) {
    this._render(false, direction === 'up' ? 'page-up' : 'page-down')
  }

  _onResize() {
    if (!this.interactive) return
    if (this.view !== 'leaderboard') this.viewportStart = null
    this._render()
  }

  _onNavigate(key) {
    if (!this.interactive || this.view === 'combined') return false

    if (key.ctrl && key.name === 'l') {
      this._render()
      return true
    }

    if (this.view === 'challenge' && isPrintableKey(key) && key.sequence === ':') {
      if (!this._commandActive()) this._enterCommandMode()
      return true
    }

    if (key.name === 'escape' && this._cancelCommandMode()) return true

    if (this.view === 'menu') {
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
        this.menuIndex = (this.menuIndex + MENU_ITEMS.length - 1) % MENU_ITEMS.length
        this.viewportStart = null
        this._render()
      } else if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
        this.menuIndex = (this.menuIndex + 1) % MENU_ITEMS.length
        this.viewportStart = null
        this._render()
      } else if (key.name === 'return' || key.name === 'linefeed') {
        this._openMenuItem(this.menuIndex)
      } else if (isPrintableKey(key) && /^[1-3]$/.test(key.sequence)) {
        this._openMenuItem(Number(key.sequence) - 1)
      }

      return true
    }

    if (this.view === 'tutorial') {
      if (key.name === 'escape') {
        this._leaveTutorial('menu')
        return true
      }

      return false
    }

    if (this.view === 'tutorial-complete') {
      if (key.name === 'return' || key.name === 'linefeed') this._leaveTutorial('challenge')
      else if (key.name === 'escape') this._leaveTutorial('menu')
      return true
    }

    if (this.view === 'mask-reference') {
      if (key.name === 'pageup' || key.name === 'pagedown') return false

      if (
        key.name === 'escape' ||
        key.name === 'return' ||
        key.name === 'linefeed' ||
        (isPrintableKey(key) && key.sequence.toLowerCase() === 'q')
      ) {
        this.view = this.referenceReturnView
        this.viewportStart = null
        this._render()
      }

      return true
    }

    if (this.view === 'leaderboard') {
      if (key.name === 'escape' || (isPrintableKey(key) && key.sequence.toLowerCase() === 'q')) {
        this._setView('menu')
      } else if (key.name === 'up') {
        this._render(false, 'line-up')
      } else if (key.name === 'down') {
        this._render(false, 'line-down')
      } else if (key.name === 'home') {
        this._render(false, 'home')
      } else if (key.name === 'end') {
        this._render(false, 'end')
      } else if (key.name === 'pageup' || key.name === 'pagedown') {
        return false
      }

      return true
    }

    if (this.view === 'challenge') {
      if (key.name === 'escape') {
        this._setView('menu')
        return true
      }

      if (key.name === 'pageup' || key.name === 'pagedown') return true
    }

    return false
  }

  _openMenuItem(index) {
    this.menuIndex = index

    if (MENU_ITEMS[index].view === 'tutorial') {
      this._startTutorial({ replay: this.tutorialState.tutorialComplete })
      return
    }

    this._setView(MENU_ITEMS[index].view)
  }

  _setView(view) {
    const menuIndex = MENU_ITEMS.findIndex((item) => item.view === view)

    if (menuIndex !== -1) this.menuIndex = menuIndex
    this.view = view
    this.viewportStart = null
    this._render()
  }

  _restoreInput() {
    if (this.restored) return
    this.restored = true

    if (this.interactive && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(false)
    }

    if (this.interactive) {
      const bottomRow = Math.max(0, (this.output.rows || DEFAULT_ROWS) - 1)
      this.output.write(
        ENABLE_WRAP + absoluteCursorPosition(0, bottomRow) + ansiEscapes.cursorShow + '\r\n'
      )
    }

    this.input.pause()
  }
}

class LiveEditor {
  constructor({
    input,
    line = '',
    cursor = line.length,
    onEdit,
    canSubmit,
    onLine,
    onEnd,
    onPage,
    onNavigate
  }) {
    this.input = input
    this.line = line
    this.cursor = cursor
    this.closed = false
    this.history = []
    this.historyCursor = -1
    this.sawReturn = 0
    this._onEdit = onEdit
    this._canSubmit = canSubmit
    this._onLine = onLine
    this._onEnd = onEnd
    this._onPage = onPage
    this._onNavigate = onNavigate
    this._onInput = this._onInput.bind(this)
    this._onKey = this._onKey.bind(this)

    this.decoder = new KeyDecoder({ escapeCodeTimeout: ESCAPE_CODE_TIMEOUT }).on(
      'data',
      this._onKey
    )
    this.input.on('data', this._onInput)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.input.removeListener('data', this._onInput)
    this.decoder.removeListener('data', this._onKey)
    this.decoder.destroy()
  }

  setLine(line, cursor = line.length) {
    this.line = line
    this.cursor = Math.min(line.length, Math.max(0, cursor))
    this.historyCursor = -1
  }

  setHistory(history) {
    this.history = [...history]
    this.historyCursor = -1
  }

  _onInput(data) {
    if (!this.closed) this.decoder.write(data)
  }

  _onKey(key) {
    if (this.closed) return

    if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
      this.close()
      this._onEnd()
      return
    }

    const lineBreak = key.name === 'return' || key.name === 'linefeed'

    if (lineBreak && !this._acceptLineBreak(key.name === 'linefeed')) return
    if (this._onNavigate(key)) return

    if (key.name === 'pageup' || key.name === 'pagedown') {
      this._onPage(key.name === 'pageup' ? 'up' : 'down')
      return
    }

    if (key.name === 'up' || (key.ctrl && key.name === 'p')) return this._onUp()
    if (key.name === 'down' || (key.ctrl && key.name === 'n')) return this._onDown()

    this.historyCursor = -1

    if (key.name === 'right' || (key.ctrl && key.name === 'f')) return this._onRight()
    if (key.name === 'left' || (key.ctrl && key.name === 'b')) return this._onLeft()
    if (key.name === 'end' || (key.ctrl && key.name === 'e')) return this._onMove(this.line.length)
    if (key.name === 'home' || (key.ctrl && key.name === 'a')) return this._onMove(0)

    if (key.name === 'backspace') return this._onBackspace()

    if (lineBreak) return this._onSubmit()

    if (!isPrintableKey(key)) return

    const characters = key.sequence
    this.line = this.line.substring(0, this.cursor) + characters + this.line.substring(this.cursor)
    this.cursor += characters.length
    this._notifyEdit()
  }

  _acceptLineBreak(linefeed) {
    if (linefeed) {
      if (this.sawReturn > 0 && Date.now() - this.sawReturn <= CRLF_DELAY) return false
      this.sawReturn = 0
    } else {
      this.sawReturn = Date.now()
    }

    return true
  }

  _onSubmit() {
    const acceptance = this._canSubmit(this.line)
    const accepted = acceptance === true || acceptance?.accept === true
    if (!accepted) return this._notifyEdit()

    const line = this.line
    const remember = line.trim() !== '' && acceptance?.remember !== false

    if (remember && line !== this.history[0]) this.history.unshift(line)

    this.line = ''
    this.cursor = 0
    this.historyCursor = -1
    this._onLine(line)
  }

  _onBackspace() {
    if (this.cursor === 0) return

    this.line = this.line.substring(0, this.cursor - 1) + this.line.substring(this.cursor)
    this.cursor--
    this._notifyEdit()
  }

  _onUp() {
    if (this.historyCursor === -1 && this.line.length > 0) return
    if (this.history.length <= this.historyCursor + 1) return

    this.historyCursor++
    this.line = this.history[this.historyCursor]
    this.cursor = this.line.length
    this._notifyEdit()
  }

  _onDown() {
    if (this.historyCursor === -1) return

    this.historyCursor--
    this.line = this.historyCursor === -1 ? '' : this.history[this.historyCursor]
    this.cursor = this.line.length
    this._notifyEdit()
  }

  _onRight() {
    if (this.cursor < this.line.length) this._onMove(this.cursor + 1)
  }

  _onLeft() {
    if (this.cursor > 0) this._onMove(this.cursor - 1)
  }

  _onMove(cursor) {
    if (cursor === this.cursor) return
    this.cursor = cursor
    this._notifyEdit()
  }

  _notifyEdit() {
    this._onEdit(this.line, this.cursor)
  }
}

function isPrintableKey(key) {
  if (key.ctrl || key.meta || typeof key.sequence !== 'string') return false

  for (const character of key.sequence) {
    const codePoint = character.codePointAt(0)
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) return false
  }

  return key.sequence.length > 0
}

function tutorialStageKey(state) {
  if (state.current === 8) return state.stage === '8b' ? '8b' : '8a'
  return String(state.current)
}

function normalizeCommand(program) {
  const source = program.trim()
  if (!source.startsWith(':')) return null
  return source.toLowerCase().replace(/\s+/g, ' ')
}

function cloneTutorialState(state) {
  return {
    version: state.version,
    started: state.started,
    completed: [...state.completed],
    current: state.current,
    stage: state.stage,
    tutorialComplete: state.tutorialComplete,
    solutions: { ...state.solutions }
  }
}

function editorState(program, cursor, challenge) {
  return { program, cursor, evaluation: evaluateAttempt(program, challenge) }
}

function formatScreen({
  view,
  state,
  feedback,
  editor,
  challenge,
  columns,
  menuIndex,
  tutorialState,
  tutorialStage,
  tutorialSolved,
  tutorialReplay
}) {
  if (view === 'menu') {
    return formatMenuScreen(state, feedback, menuIndex, tutorialState.tutorialComplete)
  }
  if (view === 'tutorial') {
    return formatTutorialScreen({
      state,
      feedback,
      editor,
      stage: tutorialStage,
      columns,
      solved: tutorialSolved,
      replay: tutorialReplay,
      solvedProgram: tutorialState.solutions[tutorialStage.key] || null
    })
  }
  if (view === 'tutorial-complete') return formatTutorialCompleteScreen(state, feedback)
  if (view === 'mask-reference') return formatMaskReferenceScreen(state, feedback, columns)
  if (view === 'challenge') {
    return formatChallengeScreen(state, feedback, editor, challenge, columns)
  }
  if (view === 'leaderboard') {
    return formatLeaderboardScreen(state, feedback, challenge, columns)
  }
  return formatCombinedScreen(state, feedback, editor, challenge, columns)
}

function formatMenuScreen(state, feedback, menuIndex, tutorialComplete) {
  const lines = [
    ...formatConnectionBlock(state, feedback),
    '',
    'Draw 8×8 monochrome images with tiny postfix Boolean programs.',
    'Every token costs one byte. Lower scores lead the shared leaderboard.'
  ]

  lines.push('', 'Choose a path:', '')
  const menuRow = lines.length

  for (let index = 0; index < MENU_ITEMS.length; index++) {
    const marker = index === menuIndex ? '›' : ' '
    const label = index === 0 && tutorialComplete ? 'Replay tutorial' : MENU_ITEMS[index].label
    lines.push(`${marker} ${index + 1}  ${label}`)
  }

  lines.push('', '↑/↓ choose · ENTER open · 1-3 shortcut · Ctrl+C quit')

  return staticScreen(lines, 'bottom', null, menuRow + menuIndex)
}

function formatTutorialScreen({
  state,
  feedback,
  editor,
  stage,
  columns,
  solved,
  replay,
  solvedProgram
}) {
  const stageLabel = stage.subtitle ? `${stage.title} · ${stage.subtitle}` : stage.title
  const lines = [
    ...formatConnectionBlock(state, feedback),
    '',
    `BIT GOLF — TUTORIAL ${stage.lesson}/8 · ${stageLabel}${replay ? ' · REPLAY' : ''}`,
    '',
    ...wrapCopy(stage.copy, columns)
  ]

  if (stage.key === '1') {
    lines.push(
      'MASK RHYTHMS · coarse → fine',
      'columns →  a ····████   b ··██··██   c ·█·█·█·█',
      'rows ↓     d ····████   e ··██··██   f ·█·█·█·█'
    )
  }

  lines.push(
    '',
    ...formatTutorialBitmaps(stage.target, editor.evaluation.bitmap, columns),
    '',
    `${formatTutorialEvaluation(editor.evaluation)} · ${formatPixelMatch(editor.evaluation.diff)}`
  )

  if (editor.evaluation.error) lines.push(`error: ${editor.evaluation.error}`)

  if (solved) {
    const solvedCopy = wrapCopy(stage.solvedCopy, columns)
    if (solvedCopy.length === 0) lines.push('✓ SOLVED')
    else lines.push(`✓ SOLVED · ${solvedCopy[0]}`, ...solvedCopy.slice(1))

    if (stage.key === '8b') {
      const saved =
        editor.evaluation.matches || solvedProgram === null
          ? editor.evaluation
          : evaluateAttempt(solvedProgram, stage)
      const bonus = editor.evaluation.matches && editor.evaluation.size < 20
      lines.push(`SOLVED PROGRAM · ${formatBytes(saved.size)}`)
      lines.push(
        ...wrapCopy(
          [
            bonus
              ? '✓ BONUS · under 20 bytes'
              : 'BONUS · Can you generate the same frame in under 20 bytes?'
          ],
          columns
        )
      )
    }
  }

  lines.push('', 'PROGRAM', '')

  const input = formatEditorInput(editor.program, editor.cursor, columns)
  const editorRow = lines.length
  lines.push(`> ${input.program}`)

  let action = 'type to draw'
  if (solved) action = stage.key === '8b' ? 'ENTER finish' : 'ENTER continue'

  return {
    lines,
    footer: `${action} · Esc leave`,
    footerMode: 'always',
    overflowFooter: 'PgUp/PgDn view · Esc leave',
    scrollable: true,
    editorRow,
    cursorColumn: 2 + input.cursor,
    viewportAnchor: 'editor'
  }
}

function formatTutorialCompleteScreen(state, feedback) {
  const lines = [
    ...formatConnectionBlock(state, feedback),
    '',
    'TUTORIAL COMPLETE',
    '',
    'You now know everything required to play Bit Golf.',
    '',
    'Solve the bitmap.',
    'Submit your program.',
    'Then make it smaller.',
    '',
    '[ENTER] join the global game'
  ]
  const joinRow = lines.length - 1

  return {
    ...staticScreen(lines, 'bottom', null, joinRow, 'ENTER join · Esc menu · Ctrl+C quit'),
    footerMode: 'always'
  }
}

function formatMaskReferenceScreen(state, feedback, columns) {
  const masks = ['a', 'b', 'c', 'd', 'e', 'f'].map((token) => ({
    label: token,
    bitmap: evaluateBitmap(token).bitmap
  }))
  const lines = [
    ...formatConnectionBlock(state, feedback),
    '',
    'BIT GOLF — MASK REFERENCE',
    '',
    '`abc` describe where you are left-to-right.',
    '`def` describe where you are top-to-bottom.',
    '',
    'VERTICAL · columns · coarse → fine',
    ...formatBitmapCollection(masks.slice(0, 3), columns),
    '',
    'HORIZONTAL · rows · coarse → fine',
    ...formatBitmapCollection(masks.slice(3), columns),
    '',
    'a ↔ d coarse · b ↔ e · c ↔ f fine'
  ]

  return {
    ...staticScreen(lines, 'top', 'PgUp/PgDn view · ENTER/Esc back', null, 'ENTER/Esc back', true),
    footerMode: 'always',
    overflowFooter: 'PgUp/PgDn view · ENTER/Esc back'
  }
}

function formatChallengeScreen(state, feedback, editor, challenge, columns) {
  const input = formatEditorInput(editor.program, editor.cursor, columns)
  const lines = [...formatConnectionBlock(state, feedback), '']
  const { diff, matches } = editor.evaluation

  lines.push(...formatChallengeBitmaps(editor.evaluation.bitmap, challenge.target, diff, columns))
  lines.push(formatEvaluation(editor.evaluation, matches), formatDiff(diff))

  if (editor.evaluation.error) lines.push(`error: ${editor.evaluation.error}`)

  lines.push('', 'PROGRAM', '')

  const editorRow = lines.length
  lines.push(`> ${input.program}`)

  const actionFeedback = formatActionFeedback(feedback)
  if (actionFeedback !== null) lines.push(actionFeedback)

  const action = matches ? 'ENTER submit' : 'ENTER when matched'

  return {
    lines,
    footer: `${action} · Esc menu`,
    footerMode: 'always',
    editorRow,
    cursorColumn: 2 + input.cursor,
    viewportAnchor: 'editor'
  }
}

function formatLeaderboardScreen(state, feedback, challenge, columns) {
  const leaderboard = challengeLeaderboard(state, bitmapId(challenge.target))
  const lines = [
    ...formatConnectionBlock(state, feedback),
    '',
    ...formatLeaderboard(leaderboard, state === null ? null : state.playerKey, columns)
  ]
  const overflowFooter = '↑/↓ one row · PgUp/PgDn one page · Esc menu'

  if (leaderboard.length === 0) lines.push('(no submissions yet)')

  return {
    ...staticScreen(lines, 'top', overflowFooter, null, 'Esc menu', true),
    footerMode: 'always',
    overflowFooter
  }
}

function formatCombinedScreen(state, feedback, editor, challenge, columns) {
  const lines = formatConnectionBlock(state, feedback)
  const { diff, matches } = editor.evaluation

  if (state !== null) {
    lines.push('')
    lines.push(
      ...formatLeaderboard(
        challengeLeaderboard(state, bitmapId(challenge.target)),
        state.playerKey,
        columns
      )
    )
  }

  const input = formatEditorInput(editor.program, editor.cursor, columns)
  lines.push(
    '',
    ...formatChallengeBitmaps(editor.evaluation.bitmap, challenge.target, diff, columns)
  )
  lines.push(formatEvaluation(editor.evaluation, matches), formatDiff(diff))

  if (editor.evaluation.error) lines.push(`error: ${editor.evaluation.error}`)

  lines.push('', 'PROGRAM', '')

  const editorRow = lines.length
  lines.push(`> ${input.program}`)

  const actionFeedback = formatActionFeedback(feedback)
  lines.push(
    '',
    actionFeedback === null ? 'target-matching lines submit automatically' : actionFeedback
  )

  return {
    lines,
    editorRow,
    cursorColumn: 2 + input.cursor,
    viewportAnchor: 'editor',
    pageHint: 'PgUp/PgDn one page · type to edit'
  }
}

function staticScreen(
  lines,
  viewportAnchor,
  pageHint,
  focusRow = null,
  footer = null,
  scrollable = false
) {
  return {
    lines,
    editorRow: null,
    focusRow,
    footer,
    scrollable,
    cursorColumn: null,
    viewportAnchor,
    pageHint
  }
}

function formatConnection(state) {
  if (state === null) return 'connecting...'

  const peers = `${state.peers} ${state.peers === 1 ? 'peer' : 'peers'}`
  return `connected · ${peers}`
}

function formatConnectionBlock(state, feedback) {
  const lines = ['', formatConnection(state)]
  const notice = formatNotice(feedback)

  if (notice !== null) lines.push(notice)
  return lines
}

function challengeLeaderboard(state, challengeId) {
  if (
    state === null ||
    state.leaderboards === null ||
    typeof state.leaderboards !== 'object' ||
    !Array.isArray(state.leaderboards[challengeId])
  ) {
    return []
  }

  return state.leaderboards[challengeId]
}

function formatNotice(feedback) {
  if (feedback === null || (feedback.type !== 'error' && feedback.type !== 'warning')) return null
  return formatFeedback(feedback).join(' · ')
}

function formatActionFeedback(feedback) {
  if (feedback === null || feedback.type === 'error' || feedback.type === 'warning') return null
  return formatFeedback(feedback).join(' · ')
}

function viewportLayout(screen, rows) {
  const height = Math.max(1, rows)
  const bodyHeight = height
  const canShowFooter = bodyHeight > 2
  const contentOverflows = screen.lines.length > bodyHeight
  const scrollable = screen.scrollable === true
  const hasFooterText = typeof screen.footer === 'string'
  const alwaysShowFooter = hasFooterText && screen.footerMode === 'always'
  const hasFlowFooter = alwaysShowFooter && screen.lines.length + 2 <= bodyHeight
  const hasFooter =
    canShowFooter && hasFooterText && !hasFlowFooter && (alwaysShowFooter || contentOverflows)
  const showPager = scrollable && !hasFooter && canShowFooter && contentOverflows
  const contentHeight = hasFooter || showPager ? bodyHeight - 2 : bodyHeight
  const hasPager = scrollable && screen.lines.length > contentHeight
  const maxStart = Math.max(0, screen.lines.length - contentHeight)
  const defaultStart =
    screen.viewportAnchor === 'top'
      ? 0
      : screen.viewportAnchor === 'focus' && Number.isInteger(screen.focusRow)
        ? Math.min(maxStart, Math.max(0, screen.focusRow - Math.floor(contentHeight / 2)))
        : Number.isInteger(screen.editorRow)
          ? Math.min(maxStart, screen.editorRow)
          : maxStart
  const lastStart = Number.isInteger(screen.editorRow) ? defaultStart : maxStart

  return {
    contentHeight,
    defaultStart,
    hasFlowFooter,
    hasFooter,
    hasPager,
    lastStart,
    showPager
  }
}

function renderInteractive(
  screen,
  rows,
  columns,
  clearDisplay,
  viewportStart,
  viewport,
  colors = false
) {
  const height = Math.max(1, rows)
  const width = Math.max(1, columns)
  const paintWidth = Math.max(0, width - 1)
  const start = Math.max(0, viewportStart)
  const visible = screen.lines.slice(start, start + viewport.contentHeight)
  const lines = Array(height).fill('')

  for (let row = 0; row < visible.length; row++) lines[row] = visible[row]

  if (viewport.hasFlowFooter) {
    lines[screen.lines.length + 1] = screen.footer
  } else if (viewport.hasFooter) {
    const end = Math.min(screen.lines.length, start + viewport.contentHeight)
    const footer = viewport.hasPager ? screen.overflowFooter || screen.footer : screen.footer
    lines[height - 1] = viewport.hasPager
      ? formatViewportFooter(start, end, screen.lines.length, footer)
      : footer
  } else if (viewport.showPager) {
    const end = Math.min(screen.lines.length, start + viewport.contentHeight)
    lines[height - 1] = formatViewportFooter(start, end, screen.lines.length, screen.pageHint)
  }

  let rendered = ansiEscapes.cursorHide + DISABLE_WRAP

  if (clearDisplay) rendered += CLEAR_SCREEN

  for (let row = 0; row < height; row++) {
    const plainLine = row < lines.length ? lines[row].slice(0, paintWidth) : ''
    const line = colors ? paintInteractiveLine(plainLine) : plainLine
    rendered += absoluteCursorPosition(0, row) + ansiEscapes.eraseLine + line
  }

  if (!Number.isInteger(screen.editorRow)) {
    return rendered + ENABLE_WRAP + ansiEscapes.cursorHide + absoluteCursorPosition(0, 0)
  }

  const cursorContentRow = screen.editorRow - start
  if (cursorContentRow < 0 || cursorContentRow >= viewport.contentHeight) {
    return rendered + ENABLE_WRAP + ansiEscapes.cursorHide + absoluteCursorPosition(0, 0)
  }

  const cursorRow = cursorContentRow
  const cursorColumn = Math.min(width - 1, screen.cursorColumn)
  return (
    rendered +
    ENABLE_WRAP +
    ansiEscapes.cursorShow +
    absoluteCursorPosition(cursorColumn, cursorRow)
  )
}

function formatViewportFooter(start, end, total, hint) {
  return `${start + 1}-${end}/${total} · ${hint}`
}

function supportsTerminalColors(output) {
  const env = process.env || {}
  return (
    output === process.stdout &&
    output.isTTY === true &&
    env.NO_COLOR === undefined &&
    env.TERM !== 'dumb'
  )
}

function paintInteractiveLine(line) {
  if (line.length === 0) return ''

  if (/^(BIT GOLF —|TUTORIAL COMPLETE$|PROGRAM$)/.test(line)) {
    return BOLD + LIME + line + RESET_STYLE
  }

  if (line.startsWith('› ')) return BOLD + LIME + line + RESET_STYLE
  if (line.startsWith('✓ ')) return BOLD + LIME + line + RESET_STYLE
  if (
    /^(Choose a path:|MASK RHYTHMS|VERTICAL|HORIZONTAL|SCORE)/.test(line) ||
    (!line.includes(' · ') &&
      /^(?:OUTPUT|TARGET|DIFF|YOUR OUTPUT)(?:\s{2,}(?:OUTPUT|TARGET|DIFF|YOUR OUTPUT))*$/.test(
        line
      ))
  ) {
    return BOLD + COOL_MUTED + line + RESET_STYLE
  }

  let base = COOL_TEXT

  if (/^(connected|connecting)/.test(line) || /(?:Esc|Ctrl\+C|PgUp\/PgDn|↑\/↓)/.test(line)) {
    base = COOL_MUTED
  }

  if (/^(warning:|submitting\.\.\.)/.test(line)) base = AMBER
  if (/^(error:|✗ rejected)/.test(line)) base = CORAL

  if (line.startsWith('>')) {
    return base + styledSpan('>', LIME, base, true) + line.slice(1) + RESET_STYLE
  }

  if (/[╭╮╰╯│─]/.test(line)) {
    let bitmap = line
    bitmap = styledMatches(bitmap, /[╭╮╰╯│─]+/g, COOL_BORDER, base)
    bitmap = styledMatches(bitmap, /█+/g, LIME, base, true)
    bitmap = styledMatches(bitmap, /×+/g, CORAL, base, true)
    bitmap = styledMatches(bitmap, /·+/g, COOL_BORDER, base)
    return base + bitmap + RESET_STYLE
  }

  let styled = styledMatches(line, / · /g, COOL_BORDER, base)
  styled = styledMatches(styled, /^connected/, LIME, base, true)
  styled = styledMatches(styled, /\bYOU\b/g, LIME, base, true)
  styled = styledMatches(
    styled,
    /(?:target matched|exact match|SOLVED PROGRAM|✓ BONUS|\[ENTER\] join)/g,
    LIME,
    base,
    true
  )
  styled = styledMatches(
    styled,
    /(?:target mismatch|\d+ mismatches?|invalid|error:)/g,
    CORAL,
    base,
    true
  )
  styled = styledMatches(styled, /warning:/g, AMBER, base, true)
  styled = styledMatches(styled, /█+/g, LIME, base, true)
  styled = styledMatches(styled, /×+/g, CORAL, base, true)

  return base + styled + RESET_STYLE
}

function styledMatches(value, pattern, color, restore, bold = false) {
  return value.replace(pattern, (match) => styledSpan(match, color, restore, bold))
}

function styledSpan(value, color, restore, bold = false) {
  const weight = bold ? BOLD : ''
  const normal = bold ? NORMAL_WEIGHT : ''
  return `${weight}${color}${value}${normal}${restore}`
}

function absoluteCursorPosition(column, row) {
  if (row === 0) return CSI + `1;${column + 1}H`
  return ansiEscapes.cursorPosition(column, row)
}

function formatEditorInput(program, cursor, columns) {
  const available = Math.max(1, columns - 3)

  if (program.length <= available) return { program, cursor }

  const lastStart = program.length - available
  const start = Math.min(lastStart, Math.max(0, cursor - Math.floor(available / 2)))

  return {
    program: program.slice(start, start + available),
    cursor: cursor - start
  }
}

function formatBitmap(bitmap, onPixel = '█', formatPixel = null) {
  const lines = [`╭${'─'.repeat(BITMAP_INNER_WIDTH)}╮`]
  const hasBitmap =
    Array.isArray(bitmap) &&
    bitmap.length === BITMAP_SIZE &&
    bitmap.every((bitmapRow) => Array.isArray(bitmapRow) && bitmapRow.length === BITMAP_SIZE)

  for (let y = 0; y < BITMAP_SIZE; y++) {
    const pixels = hasBitmap
      ? bitmap[y]
          .map((pixel, x) => {
            const glyph = formatPixel === null ? (pixel ? onPixel : '·') : formatPixel(pixel, x, y)
            return glyph.repeat(PIXEL_WIDTH)
          })
          .join('')
      : ' '.repeat(BITMAP_INNER_WIDTH)
    lines.push(`│${pixels}│`)
  }

  lines.push(`╰${'─'.repeat(BITMAP_INNER_WIDTH)}╯`)
  return lines
}

function formatChallengeBitmaps(output, target, diff, columns) {
  const panels = [
    { label: 'OUTPUT', bitmap: output },
    { label: 'TARGET', bitmap: target },
    {
      label: 'DIFF',
      bitmap: diff,
      formatPixel(mismatch, x, y) {
        if (mismatch) return MISMATCH_PIXEL
        if (output[y][x] && target[y][x]) return ' '
        return '·'
      }
    }
  ]
  const panelGap = ' '
  const available = Math.max(1, columns - 1)
  const threePanels = BITMAP_PANEL_WIDTH * 3
  const twoPanels = BITMAP_PANEL_WIDTH * 2

  if (available >= threePanels + panelGap.length * 2) {
    return formatBitmapRow(panels, panelGap)
  }
  if (available >= threePanels) return formatBitmapRow(panels, '')

  if (available >= twoPanels + panelGap.length) {
    return [
      ...formatBitmapRow(panels.slice(0, 2), panelGap),
      '',
      ...formatBitmapRow(panels.slice(2), panelGap)
    ]
  }

  if (available >= twoPanels) {
    return [...formatBitmapRow(panels.slice(0, 2), ''), '', ...formatBitmapRow(panels.slice(2), '')]
  }

  const lines = []

  for (const panel of panels) {
    if (lines.length > 0) lines.push('')
    lines.push(...formatBitmapRow([panel], panelGap))
  }

  return lines
}

function formatTutorialBitmaps(target, output, columns) {
  return formatBitmapCollection(
    [
      { label: 'TARGET', bitmap: target },
      { label: 'YOUR OUTPUT', bitmap: output }
    ],
    columns
  )
}

function formatBitmapCollection(panels, columns) {
  const available = Math.max(1, columns - 1)
  const panelWidth = Math.max(BITMAP_PANEL_WIDTH, ...panels.map((panel) => panel.label.length))
  const perRow = Math.min(3, Math.max(1, Math.floor((available + 1) / (panelWidth + 1))))
  const lines = []

  for (let index = 0; index < panels.length; index += perRow) {
    if (lines.length > 0) lines.push('')
    lines.push(...formatBitmapRow(panels.slice(index, index + perRow), ' '))
  }

  return lines
}

function formatBitmapRow(panels, gap) {
  const bitmaps = panels.map((panel) =>
    formatBitmap(panel.bitmap, panel.onPixel, panel.formatPixel)
  )
  const lines = [
    panels
      .map((panel) => panel.label.padEnd(BITMAP_PANEL_WIDTH))
      .join(gap)
      .trimEnd()
  ]

  for (let row = 0; row < bitmaps[0].length; row++) {
    lines.push(bitmaps.map((bitmap) => bitmap[row]).join(gap))
  }

  return lines
}

function formatDiff(diff) {
  if (diff === null) return 'DIFF · unavailable until output can be evaluated'

  let mismatches = 0
  for (const row of diff) for (const pixel of row) if (pixel) mismatches++

  if (mismatches === 0) return 'DIFF · exact match'
  return `DIFF · ${mismatches} ${mismatches === 1 ? 'mismatch' : 'mismatches'} · ${MISMATCH_PIXEL} marks a mismatch`
}

function formatPixelMatch(diff) {
  if (diff === null) return '— / 64 pixels'

  let matches = 64
  for (const row of diff) for (const pixel of row) if (pixel) matches--
  return `${matches} / 64 pixels`
}

function formatBytes(size) {
  return `${size} ${size === 1 ? 'byte' : 'bytes'}`
}

function wrapCopy(copy, columns) {
  const width = Math.max(10, columns - 1)
  const wrapped = []

  for (const source of copy) {
    const words = source.split(' ')
    let line = ''

    for (const word of words) {
      if (line.length === 0) {
        line = word
      } else if (line.length + word.length + 1 <= width) {
        line += ` ${word}`
      } else {
        wrapped.push(line)
        line = word
      }
    }

    wrapped.push(line)
  }

  return wrapped
}

function formatEvaluation(evaluation, matched = null) {
  const bytes = formatBytes(evaluation.size)

  if (evaluation.status === 'valid') {
    if (matched === true) return `${bytes} · target matched`
    if (matched === false) return `${bytes} · syntax valid · target mismatch`
    return `${bytes} · valid`
  }
  if (evaluation.status === 'invalid') return `${bytes} · invalid`
  if (evaluation.stackDepth > 0) {
    return `${bytes} · stack ${evaluation.stackDepth} · incomplete · top preview`
  }
  return `${bytes} · incomplete`
}

function formatTutorialEvaluation(evaluation) {
  const prefix = `${formatBytes(evaluation.size)} · stack ${evaluation.stackDepth}`

  if (evaluation.status === 'valid') return `${prefix} · valid`
  if (evaluation.status === 'invalid') return `${prefix} · invalid`
  if (evaluation.stackDepth > 0) return `${prefix} · incomplete · top preview`
  return `${prefix} · incomplete`
}

function formatLeaderboard(leaderboard, playerKey = null, columns = DEFAULT_COLUMNS) {
  const width = Math.max(1, columns - 1)
  const stacked = width - PROGRAM_COLUMN_OFFSET < MIN_INLINE_PROGRAM_WIDTH
  const lines = stacked ? ['SCORE · PLAYER', 'PROGRAM'] : [row('SCORE', 'PLAYER', 'PROGRAM')]

  for (const entry of leaderboard || []) {
    const player = playerKey !== null && entry.author === playerKey ? 'YOU' : shortKey(entry.author)
    const program = displayProgram(entry.program)

    if (stacked) {
      lines.push(`${entry.score} · ${player}`, ...wrapFixed(program, width))
      continue
    }

    const chunks = wrapFixed(program, width - PROGRAM_COLUMN_OFFSET)
    lines.push(row(entry.score, player, chunks[0]))

    for (let index = 1; index < chunks.length; index++) {
      lines.push(' '.repeat(PROGRAM_COLUMN_OFFSET) + chunks[index])
    }
  }

  return lines
}

function formatFeedback(feedback) {
  if (feedback.type === 'valid') return ['✓ submitted', `score ${feedback.score}`]
  if (feedback.type === 'invalid') return ['✗ rejected']
  if (feedback.type === 'submitting') return ['submitting...']
  if (feedback.type === 'warning') return [`warning: ${singleLine(feedback.message)}`]
  return [`error: ${singleLine(feedback.message)}`]
}

function singleLine(value) {
  return String(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

function row(score, player, program) {
  return `${String(score).padEnd(SCORE_COLUMN_WIDTH)}${String(player).padEnd(PLAYER_COLUMN_WIDTH)}${program}`
}

function shortKey(key) {
  if (typeof key !== 'string' || key.length === 0) return 'unknown'
  return key.slice(0, PLAYER_PREFIX_LENGTH) + '...'
}

function displayProgram(program) {
  const source = typeof program === 'string' ? program : ''
  const tokenized = tokenizeProgram(source)
  const canonical = tokenized.ok ? tokenized.tokens.join('') : source.replace(/\s/g, '')
  const json = JSON.stringify(canonical)
  return json.slice(1, -1)
}

function wrapFixed(value, width) {
  if (value.length === 0) return ['']

  const lines = []
  for (let start = 0; start < value.length; start += width) {
    lines.push(value.slice(start, start + width))
  }
  return lines
}
