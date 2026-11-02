// How the band measures a line: the columns a character and a drawn tree
// take on each surface, the clips that cut a line to its columns, the sizes
// it lays out by, and the squeeze that fits a line to its room by a give-way
// order its layout names.

import type { RenderChildren, RenderElement } from 'claude-code'

/** The longest line a card holds unwrapped, in characters: LIMITS' lead
 *  row, `resets  Mon 08:40 · full before reset`, its label two columns apart. */
export const CARD_TEXT = 37
/** Columns a framed Button's padding and edges take beyond its label. */
const BUTTON_CHROME = 3
/** Columns a Button's hotkey mark takes beside its label. */
export const HOTKEY_MARK = 2
/** Room the band keeps free, so a row measured a little short never wraps. */
export const ROW_SLACK = 4

/** A bar's length: px on desktop, cells elsewhere. */
export type BarSize = Readonly<{ px: number; cells: number }>

/** How a surface lays text out against its bodyColumns: the terminal one cell
 *  a character; the desktop's proportional font runs about three quarters of
 *  a column, at roughly 10px a column. */
type Measure = Readonly<{ text: number; pxPerCell: number }>
export const TERMINAL: Measure = { text: 1, pxPerCell: 8 }
export const DESKTOP: Measure = { text: 0.75, pxPerCell: 10 }
/** On a proportional surface the board's capitals and digits take a full
 *  column each: SF at 15 px draws a capital 9.9 px and a digit 8.8 against
 *  a 10 px column, where the measure's 0.75 fits prose's lower case (7.7
 *  px). Every other character keeps the measure's own: a bracket is 5.5 px,
 *  a space 4.2, punctuation 7.0. Monospace counts every character as one. */
const BOARD_CAPS = 1
export const boardCells = (text: string, m: Measure): number =>
  m.text >= 1 ? textCells(text) * m.text : [...text].reduce((n, c) => n + (/[A-Z0-9]/.test(c) ? BOARD_CAPS : charCells(c) * m.text), 0)

/** East Asian Wide and Fullwidth, by block: Hangul Jamo, CJK and its
 *  punctuation, kana, Hangul syllables, CJK compatibility forms, the
 *  fullwidth forms and the ideographs' supplementary planes, which draw two
 *  columns in every terminal. The emoji blocks are taken whole, though a few
 *  of their characters are narrow: counting one wide only keeps a column
 *  spare. Ambiguous glyphs (█ · … │) are not here: a terminal draws them one
 *  column wide unless a CJK locale widens them, which the ascii tier answers. */
const WIDE = /[\u1100-\u115f\u231a\u231b\u2329\u232a\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{16fe0}-\u{16fe4}\u{17000}-\u{18aff}\u{1b000}-\u{1b2ff}\u{1f300}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u

/** Whether a character draws two columns wide. */
export const isWide = (ch: string): boolean => WIDE.test(ch)

/** The columns a character takes in a monospace cell grid: a wide one two,
 *  any other one. */
const charCells = (ch: string): number => (isWide(ch) ? 2 : 1)

/** The columns `text` takes in a monospace cell grid. */
export const textCells = (text: string): number => [...text].reduce((n, ch) => n + charCells(ch), 0)

/** The most of `chars` from their start that fits `room` columns. */
const headIn = (chars: readonly string[], room: number): string[] => {
  let used = 0
  const kept: string[] = []
  for (const ch of chars) {
    used += charCells(ch)
    if (used > room) break
    kept.push(ch)
  }
  return kept
}

/** `text` at most `max` columns, cut in the middle: a branch keeps both its
 *  prefix and its end, where names differ. A wide character takes two
 *  columns, and is never cut through; a column the head can't use goes to
 *  the end. */
export const clipMiddle = (text: string, max: number): string => {
  if (textCells(text) <= max) return text
  if (max <= 1) return '…'.slice(0, max)
  const chars = [...text]
  const head = headIn(chars, Math.ceil((max - 1) / 2))
  const tail = headIn([...chars].reverse(), max - 1 - textCells(head.join(''))).reverse()
  return `${head.join('')}…${tail.join('')}`
}

/** `text` at most `room` columns, cut at its last whole word with a `.` in
 *  place of the punctuation it ended on; a first word longer than the room
 *  is cut where the room ends. A wide character takes two columns. */
export const clipWords = (text: string, room: number): string => {
  if (textCells(text) <= room) return text
  const chars = [...text]
  // The last space within the room but the `.`'s column, by its index.
  let space = -1
  let at = 0
  for (const [i, ch] of chars.entries()) {
    if (at > room - 1) break
    if (ch === ' ' && i > 0) space = i
    at += charCells(ch)
  }
  const kept = space > 0 ? chars.slice(0, space).join('').replace(/[\s,;:]+$/, '') : headIn(chars, room - 1).join('')
  return `${kept}.`
}

/** `text` at most `tiles` columns, `…` last where cut, a wide character
 *  never split; nothing at a column or less. The board's flap columns and
 *  its remarks are cut so. */
export const clipToTiles = (text: string, tiles: number): string => {
  if (textCells(text) <= tiles) return text
  if (tiles <= 1) return ''
  return `${headIn([...text], tiles - 1).join('')}…`
}

const isList = (n: RenderChildren): n is readonly RenderChildren[] => Array.isArray(n)

/** Whether a child draws anything: null, undefined and false draw nothing. */
export const isDrawn = (child: unknown): boolean => child !== null && child !== undefined && child !== false

/** Whether `n` is a Box placed out of the flow: a hover card. */
const isPlaced = (n: RenderChildren): boolean =>
  typeof n === 'object' && n !== null && !isList(n) && n.type === 'Box' && n.props?.position === 'absolute'

/** Columns a drawn tree takes: text, padding, gaps and Button labels, a
 *  wide character twice a narrow one's. A column Box takes its widest row;
 *  hidden cards take none, nor a gap; an Svg takes its width in columns,
 *  rounded up. */
export const cellsOf = (n: RenderChildren, m: Measure): number => {
  if (n === null || n === undefined || typeof n === 'boolean') return 0
  if (typeof n === 'string' || typeof n === 'number') return textCells(String(n)) * m.text
  if (isList(n)) return n.reduce((sum: number, k: RenderChildren) => sum + cellsOf(k, m), 0)
  switch (n.type) {
    case 'Button':
      // A framed button's chrome: its padding and edges either side.
      return textCells(n.props.label ?? '') * m.text + (n.props.variant === undefined ? 0 : BUTTON_CHROME)
    case 'Svg':
      return Math.ceil((n.props.width ?? 64) / m.pxPerCell)
    case 'Box':
    case 'Text': {
      if (isPlaced(n)) return 0
      if (n.type === 'Box' && typeof n.props?.width === 'number') return n.props.width
      const kids = (n.children ?? []).filter(k => isDrawn(k) && !isPlaced(k))
      const pad = typeof n.props?.paddingX === 'number' ? 2 * n.props.paddingX : 0
      const widths = kids.map(k => cellsOf(k, m))
      const own =
        n.type === 'Box' && n.props?.flexDirection === 'column'
          ? Math.max(0, ...widths) + pad
          : widths.reduce((sum, w) => sum + w, 0) +
            pad +
            (typeof n.props?.columnGap === 'number' ? n.props.columnGap * Math.max(0, kids.length - 1) : 0)
      return n.type === 'Box' && typeof n.props?.minWidth === 'number' ? Math.max(n.props.minWidth, own) : own
    }
    default:
      return 0
  }
}

/** The first of `forms`, longest first, that `fits`, else the last: a row's
 *  value or remark says all it has room for, and never leaves itself out. */
export const longestThatFits = (forms: readonly string[], fits: (form: string) => boolean): string => forms.find(fits) ?? forms.at(-1) ?? ''

/** The columns a piece takes in its row: from its first, up to its end. */
export type Span = readonly [start: number, end: number]

/** The columns each of a row's drawn pieces takes, the pieces `gap`
 *  columns apart. */
export const spansOf = (pieces: readonly RenderChildren[], gap: number, m: Measure): Span[] => {
  let at = 0
  return pieces.map(piece => {
    const start = at
    at += cellsOf(piece, m)
    const span: Span = [start, at]
    at += gap
    return span
  })
}

/** The line `build` draws at the first step of `order` at which it fits
 *  `room` columns, or at the last: a line drops its pieces in the order
 *  named, and `has` says whether a piece is still kept. */
export const squeezeToFit = <P extends string>(order: readonly P[], room: number, m: Measure, build: (has: (piece: P) => boolean) => RenderElement): RenderElement => {
  const at = (squeeze: number) => build(piece => squeeze <= order.indexOf(piece))
  let squeeze = 0
  let line = at(squeeze)
  while (squeeze < order.length && cellsOf(line, m) > room) line = at(++squeeze)
  return line
}
