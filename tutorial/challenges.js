'use strict'

const RULES_VERSION = 1

module.exports = Object.freeze([
  challenge({
    key: '1',
    lesson: 1,
    title: 'MASKS',
    target: [
      '01010101',
      '01010101',
      '01010101',
      '01010101',
      '01010101',
      '01010101',
      '01010101',
      '01010101'
    ],
    copy: [
      'a b c split columns.',
      'd e f split rows.',
      'Within each group, the pattern gets twice as fine.'
    ],
    hints: [
      '`a`, `b`, and `c` are the vertical masks, from coarse to fine.',
      'Choose the finest vertical mask.'
    ],
    solvedCopy: ['One token can represent an entire image.'],
    referenceSolution: 'c'
  }),
  challenge({
    key: '2',
    lesson: 2,
    title: 'TURN IT',
    target: [
      '00000000',
      '11111111',
      '00000000',
      '11111111',
      '00000000',
      '11111111',
      '00000000',
      '11111111'
    ],
    copy: [
      'Same rhythm, different direction.',
      'a ↔ d coarse · b ↔ e · c ↔ f fine.',
      '`abc` describe where you are left-to-right. `def` describe where you are top-to-bottom.'
    ],
    hints: [
      '`a ↔ d` are coarse, `b ↔ e` are medium, and `c ↔ f` are fine.',
      'Use the fine horizontal mask.'
    ],
    solvedCopy: ['The same rhythm can run in either direction.'],
    referenceSolution: 'f'
  }),
  challenge({
    key: '3',
    lesson: 3,
    title: 'INVERT',
    target: [
      '10101010',
      '10101010',
      '10101010',
      '10101010',
      '10101010',
      '10101010',
      '10101010',
      '10101010'
    ],
    copy: ['`!` flips every pixel in the image on top of the stack.'],
    hints: ['Start with the fine vertical mask.', 'Put `!` after the image: `c!`.'],
    solvedCopy: ['One small change can flip all 64 pixels.'],
    referenceSolution: 'c!'
  }),
  challenge({
    key: '4',
    lesson: 4,
    title: 'INTERSECT',
    target: [
      '00000000',
      '00000000',
      '00000000',
      '00000000',
      '00001111',
      '00001111',
      '00001111',
      '00001111'
    ],
    copy: [
      '`&` takes the top two images and keeps pixels that are ON in both.',
      '`a` → `[a]` · `d` → `[a, d]` · `&` → `[a & d]`.',
      'Put the images on the stack first. Then apply the operator.'
    ],
    hints: [
      '`a` lights the right half. `d` lights the bottom half.',
      'Stack: `a` → `[a]`, `d` → `[a, d]`, `&` → `[a & d]`.',
      'Try `ad&`.'
    ],
    solvedCopy: ['Two whole images can become one.'],
    referenceSolution: 'ad&'
  }),
  challenge({
    key: '5',
    lesson: 5,
    title: 'COMBINE',
    target: [
      '00001111',
      '00001111',
      '00001111',
      '00001111',
      '11111111',
      '11111111',
      '11111111',
      '11111111'
    ],
    copy: [
      '`|` keeps pixels that are ON in either image.',
      'Compare `ad&` overlap with `ad|` combine.'
    ],
    hints: ['Use the same two masks as before.', 'Put `|` after both images.', 'Try `ad|`.'],
    solvedCopy: ['The operator changes how the same two images combine.'],
    referenceSolution: 'ad|'
  }),
  challenge({
    key: '6',
    lesson: 6,
    title: 'TOGGLE',
    target: [
      '01010101',
      '10101010',
      '01010101',
      '10101010',
      '01010101',
      '10101010',
      '01010101',
      '10101010'
    ],
    copy: ['`^` keeps pixels where the two images differ.'],
    hints: [
      '`c` makes fine columns. `f` makes fine rows.',
      'Put both images on the stack, then toggle them with `^`.',
      'Try `cf^`.'
    ],
    solvedCopy: ['Three bytes can already describe all 64 pixels.'],
    referenceSolution: 'cf^'
  }),
  challenge({
    key: '7',
    lesson: 7,
    title: 'SELECT',
    target: [
      '00010000',
      '00010000',
      '00010000',
      '00010000',
      '00010000',
      '00010000',
      '00010000',
      '00010000'
    ],
    copy: [
      '`abc` are the three bits of the horizontal position.',
      'x 0 1 2 3 4 5 6 7',
      'abc 000 001 010 011 100 101 110 111',
      'Column 3 is `011`: `a = 0`, `b = 1`, `c = 1`.'
    ],
    hints: ['`abc` represent x.', '`x = 3` is `011`.', 'You need `!a`, `b` and `c`.', '`a!b&c&`'],
    solvedCopy: ['Three coordinate masks can select one exact column.'],
    referenceSolution: 'a!b&c&'
  }),
  challenge({
    key: '8a',
    lesson: 8,
    title: 'COMPOSE',
    subtitle: 'ONE PIXEL',
    target: [
      '00000000',
      '00000000',
      '00000000',
      '00000000',
      '00000000',
      '00010000',
      '00000000',
      '00000000'
    ],
    copy: [
      'Build `x == 3` and `y == 5` separately, then combine both images with `&`.',
      '`x = 3` → `abc = 011`. `y = 5` → `def = 101`.'
    ],
    hints: [
      'Reuse the column-3 program.',
      'For `y = 5`, use `d`, `!e`, and `f`.',
      'Each subprogram should leave one image on the stack.',
      '`a!b&c&de!&f&&`'
    ],
    solvedCopy: [
      'A whole subprogram leaves one image on the stack.',
      'You can combine that image with another whole subprogram.'
    ],
    referenceSolution: 'a!b&c&de!&f&&'
  }),
  challenge({
    key: '8b',
    lesson: 8,
    title: 'COMPOSE',
    subtitle: 'FRAME / FIRST GOLF',
    target: [
      '11111111',
      '10000001',
      '10000001',
      '10000001',
      '10000001',
      '10000001',
      '10000001',
      '11111111'
    ],
    copy: [
      'Final challenge.',
      "Don't think about 28 separate pixels.",
      'What simpler shapes make up this picture?'
    ],
    hints: [
      'Build the left edge, right edge, top edge, and bottom edge.',
      'Combine the four edge images with `|`.'
    ],
    solvedCopy: [
      'You solved it.',
      'But correctness is only the first game.',
      'Different programs can generate exactly the same 64 pixels.',
      'Can you generate the same frame in under 20 bytes?'
    ],
    referenceSolution: 'a!b!&c!&ab&c&|d!e!&f!&|de&f&|',
    bonusSolution: 'ab^bc^|!de^ef^|!|'
  })
])

function challenge({ target, copy, hints, solvedCopy, ...definition }) {
  return Object.freeze({
    ...definition,
    rulesVersion: RULES_VERSION,
    target: bitmap(target),
    copy: Object.freeze([...copy]),
    hints: Object.freeze([...hints]),
    solvedCopy: Object.freeze([...solvedCopy])
  })
}

function bitmap(rows) {
  if (!Array.isArray(rows) || rows.length !== 8) throw new TypeError('Bitmap must have 8 rows')

  return Object.freeze(
    rows.map((row) => {
      if (typeof row !== 'string' || !/^[01]{8}$/.test(row)) {
        throw new TypeError('Bitmap rows must contain 8 binary pixels')
      }

      return Object.freeze([...row].map((pixel) => pixel === '1'))
    })
  )
}
