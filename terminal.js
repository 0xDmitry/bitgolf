'use strict'

const ansiEscapes = require('bare-ansi-escapes')
const KeyDecoder = require('bare-ansi-escapes/key-decoder')
const Readline = require('bare-readline')
const ReadyResource = require('ready-resource')

const CHALLENGES = require('./workers/game/challenges.js')
const { tokenizeProgram, evaluateAttempt } = require('./workers/game/evaluator.js')
const { bitmapId } = require('./workers/game/protocol.js')

const PLAYER_PREFIX_LENGTH = 6
const MAX_DISPLAY_PROGRAM_LENGTH = 64
const DEFAULT_COLUMNS = 80
const DEFAULT_ROWS = 24
const CRLF_DELAY = 100
const ESCAPE_CODE_TIMEOUT = 50
const { CSI } = ansiEscapes.constants
const CLEAR_SCREEN = ansiEscapes.eraseDisplay + CSI + 'H'
const DISABLE_WRAP = CSI + '?7l'
const ENABLE_WRAP = CSI + '?7h'
const CURRENT_CHALLENGE = CHALLENGES[CHALLENGES.length - 1]
const CURRENT_CHALLENGE_ID = bitmapId(CURRENT_CHALLENGE.target)
const MENU_ITEMS = [
  { label: 'Start tutorial', view: 'tutorial' },
  { label: 'Solve challenge', view: 'challenge' },
  { label: 'Leaderboard', view: 'leaderboard' }
]
const TUTORIAL_PAGES = [
  {
    title: 'Coordinate bits',
    lines: [
      'Every program draws one 8×8 monochrome image.',
      '',
      'a b c   high → low bits of the horizontal coordinate x',
      'd e f   high → low bits of the vertical coordinate y',
      '',
      'Example: a lights the right half; d lights the bottom half.'
    ]
  },
  {
    title: 'Postfix operators',
    lines: [
      'Values go on a stack. Operators consume the values before them.',
      '',
      '!       NOT',
      '&       AND',
      '|       OR',
      '^       XOR',
      '',
      'Examples: ab& means a AND b; abc&^ means a XOR (b AND c).'
    ]
  },
  {
    title: 'Valid programs and scoring',
    lines: [
      'A complete program never underflows and ends with one stack value.',
      '',
      'Whitespace is ignored. Every language token costs one byte.',
      'Only programs that draw the target can be submitted; lower scores are better.',
      '',
      'The live preview and diff update after every edit.'
    ]
  }
]

module.exports = class Terminal extends ReadyResource {
  constructor({ input, output, challengeId = CURRENT_CHALLENGE_ID }) {
    super()

    const challenge = CHALLENGES.find(({ target }) => bitmapId(target) === challengeId)
    if (challenge === undefined) throw new TypeError(`Unknown challenge: ${challengeId}`)

    this.input = input
    this.output = output
    this.challenge = challenge
    this.challengeId = bitmapId(challenge.target)
    this.interactive = input.isTTY === true && output.isTTY === true
    this.readline = null
    this.state = null
    this.feedback = null
    this.editor = editorState('', 0, this.challenge)
    this.restored = false
    this.viewportStart = null
    this.view = this.interactive ? 'menu' : 'combined'
    this.menuIndex = 0
    this.tutorialPage = 0

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

  _close() {
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
      tutorialPage: this.tutorialPage
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
          viewport
        )
      )
    } else {
      this.output.write(screen.lines.join('\n') + '\n')
    }
  }

  _onEditorEdit(program, cursor) {
    this.viewportStart = null

    if (program !== this.editor.program) {
      this.feedback = null
      this.editor = editorState(program, cursor, this.challenge)
    } else {
      this.editor.cursor = cursor
    }

    this._render()
  }

  _canSubmit(program) {
    const evaluation = evaluateAttempt(program, this.challenge)

    this.editor = {
      program,
      cursor: this.readline === null ? program.length : this.readline.cursor,
      evaluation
    }

    return evaluation.matches
  }

  _onLine(program) {
    this.viewportStart = null

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
    this.emit('submit', program, this.challengeId)
    this._render()
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
        this._setView('menu')
      } else if (key.name === 'left') {
        if (this.tutorialPage > 0) {
          this.tutorialPage--
          this.viewportStart = null
          this._render()
        }
      } else if (key.name === 'right' || key.name === 'return' || key.name === 'linefeed') {
        if (this.tutorialPage === TUTORIAL_PAGES.length - 1) {
          this._setView('challenge')
        } else {
          this.tutorialPage++
          this.viewportStart = null
          this._render()
        }
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

    if (MENU_ITEMS[index].view === 'tutorial') this.tutorialPage = 0
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
  constructor({ input, onEdit, canSubmit, onLine, onEnd, onPage, onNavigate }) {
    this.input = input
    this.line = ''
    this.cursor = 0
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
    if (!this._canSubmit(this.line)) return this._notifyEdit()

    const line = this.line
    const remember = line.trim() !== ''

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
  tutorialPage
}) {
  if (view === 'menu') return formatMenuScreen(state, feedback, menuIndex)
  if (view === 'tutorial') return formatTutorialScreen(state, feedback, tutorialPage)
  if (view === 'challenge') {
    return formatChallengeScreen(state, feedback, editor, challenge, columns)
  }
  if (view === 'leaderboard') return formatLeaderboardScreen(state, feedback, challenge)
  return formatCombinedScreen(state, feedback, editor, challenge, columns)
}

function formatMenuScreen(state, feedback, menuIndex) {
  const lines = [
    '',
    formatConnection(state),
    '',
    'Draw 8×8 monochrome images with tiny postfix Boolean programs.',
    'Every token costs one byte. Lower scores lead the shared leaderboard.'
  ]
  const notice = formatNotice(feedback)

  if (notice !== null) lines.push(notice)

  lines.push('', 'Choose a path:', '')
  const menuRow = lines.length

  for (let index = 0; index < MENU_ITEMS.length; index++) {
    const marker = index === menuIndex ? '›' : ' '
    lines.push(`${marker} ${index + 1}  ${MENU_ITEMS[index].label}`)
  }

  lines.push('', '↑/↓ choose · ENTER open · 1-3 shortcut · Ctrl+C quit')

  return staticScreen(lines, 'bottom', null, menuRow + menuIndex)
}

function formatTutorialScreen(state, feedback, tutorialPage) {
  const page = TUTORIAL_PAGES[tutorialPage]
  const notice = formatNotice(feedback)
  const lines = [
    '',
    formatConnection(state),
    '',
    `TUTORIAL ${tutorialPage + 1}/${TUTORIAL_PAGES.length} · ${page.title}`,
    '',
    ...page.lines
  ]

  if (notice !== null) lines.push('', notice)

  const finalPage = tutorialPage === TUTORIAL_PAGES.length - 1
  const footer = finalPage
    ? '←/→ step · ENTER solve challenge · Esc menu'
    : '←/→ step · ENTER next · Esc menu'

  return {
    ...staticScreen(lines, 'bottom', null, null, footer),
    footerMode: 'always'
  }
}

function formatChallengeScreen(state, feedback, editor, challenge, columns) {
  const input = formatEditorInput(editor.program, editor.cursor, columns)
  const lines = ['', formatConnection(state), '']
  const { diff, matches } = editor.evaluation

  lines.push(...formatChallengeBitmaps(editor.evaluation.bitmap, challenge.target, diff, columns))
  lines.push(formatEvaluation(editor.evaluation, matches), formatDiff(diff))

  if (editor.evaluation.error) lines.push(`error: ${editor.evaluation.error}`)
  if (feedback !== null) lines.push(formatFeedback(feedback).join(' · '))

  lines.push('PROGRAM')

  const editorRow = lines.length
  lines.push(`> ${input.program}`)

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

function formatLeaderboardScreen(state, feedback, challenge) {
  const leaderboard = challengeLeaderboard(state, bitmapId(challenge.target))
  const lines = [
    '',
    formatConnection(state),
    '',
    ...formatLeaderboard(leaderboard, state === null ? null : state.playerKey)
  ]
  const overflowFooter = '↑/↓ one row · PgUp/PgDn one page · Esc menu'

  if (leaderboard.length === 0) lines.push('(no submissions yet)')

  const notice = formatNotice(feedback)
  if (notice !== null) lines.push('', notice)

  return {
    ...staticScreen(lines, 'top', overflowFooter, null, 'Esc menu', true),
    footerMode: 'always',
    overflowFooter
  }
}

function formatCombinedScreen(state, feedback, editor, challenge, columns) {
  const lines = []
  const { diff, matches } = editor.evaluation

  if (state === null) {
    lines.push('', 'connecting...')
  } else {
    lines.push('', formatConnection(state), '')
    lines.push(
      ...formatLeaderboard(challengeLeaderboard(state, bitmapId(challenge.target)), state.playerKey)
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
  lines.push(
    '',
    feedback === null
      ? 'target-matching lines submit automatically'
      : formatFeedback(feedback).join(' · ')
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

function renderInteractive(screen, rows, columns, clearDisplay, viewportStart, viewport) {
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
    const line = row < lines.length ? lines[row].slice(0, paintWidth) : ''
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

function formatBitmap(bitmap) {
  const lines = ['┌────────┐']
  const hasBitmap =
    Array.isArray(bitmap) &&
    bitmap.length === 8 &&
    bitmap.every((bitmapRow) => Array.isArray(bitmapRow) && bitmapRow.length === 8)

  for (let y = 0; y < 8; y++) {
    const pixels = hasBitmap ? bitmap[y].map((pixel) => (pixel ? '█' : '·')).join('') : '        '
    lines.push(`│${pixels}│`)
  }

  lines.push('└────────┘')
  return lines
}

function formatChallengeBitmaps(output, target, diff, columns) {
  const panels = [
    { label: 'OUTPUT', bitmap: output },
    { label: 'TARGET', bitmap: target },
    { label: 'DIFF', bitmap: diff }
  ]
  const panelGap = ' '

  if (columns >= 33) return formatBitmapRow(panels, panelGap)
  if (columns >= 31) return formatBitmapRow(panels, '')

  if (columns >= 22) {
    return [
      ...formatBitmapRow(panels.slice(0, 2), panelGap),
      '',
      ...formatBitmapRow(panels.slice(2), panelGap)
    ]
  }

  if (columns >= 21) {
    return [...formatBitmapRow(panels.slice(0, 2), ''), '', ...formatBitmapRow(panels.slice(2), '')]
  }

  const lines = []

  for (const panel of panels) {
    if (lines.length > 0) lines.push('')
    lines.push(...formatBitmapRow([panel], panelGap))
  }

  return lines
}

function formatBitmapRow(panels, gap) {
  const bitmaps = panels.map((panel) => formatBitmap(panel.bitmap))
  const lines = [
    panels
      .map((panel) => panel.label.padEnd(10))
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
  return `DIFF · ${mismatches} ${mismatches === 1 ? 'mismatch' : 'mismatches'} · █ marks a mismatch`
}

function formatEvaluation(evaluation, matched = null) {
  const bytes = `${evaluation.size} ${evaluation.size === 1 ? 'byte' : 'bytes'}`

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

function formatLeaderboard(leaderboard, playerKey = null) {
  const lines = [row('SCORE', 'PLAYER', 'PROGRAM')]

  for (const entry of leaderboard || []) {
    const player = playerKey !== null && entry.author === playerKey ? 'YOU' : shortKey(entry.author)
    lines.push(row(entry.score, player, displayProgram(entry.program)))
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
  return `${String(score).padEnd(8)}${String(player).padEnd(13)}${program}`
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
  const escaped = json.slice(1, -1)

  if (escaped.length <= MAX_DISPLAY_PROGRAM_LENGTH) return escaped
  return escaped.slice(0, MAX_DISPLAY_PROGRAM_LENGTH - 1) + '…'
}
