// Departures open: one board on its dark ground under the collapsed row. Its
// header says DEPARTURES and the time now; quiet column headings follow, then
// a line per reading in the one order, the other limits after 7D
// (three-layouts spec §5.3). ITEM, STATUS and TIME are flaps, tiles only
// where there are characters, each in a column of its own width so the lines
// align; REMARKS are plain dim text. The footer is the one every layout
// draws: the workspace strip, then Collapse and Hide band. Short of rows, the
// remarks give way first, then the lines in that spec's order; an amber line
// never does.

import type { RenderElement } from 'claude-code'
import { boardBudget, boardLineHeight, boardRule, flapCells, flapColumns, type FlapColumn } from '../flaps'
import type { Kit } from '../kit'
import { boardCells, clipToTiles, textCells } from '../layout'
import type { Readings } from '../reading'
import type { BandActions } from '../snapshot'
import type { Palette } from '../palette'
import { BOARD_HEADINGS, BOARD_NOW, BOARD_NO_TIME, BOARD_TITLE, type BoardKey, type BoardRow } from '../board-words'
import { bodyRowsFor, footer, rowRoom } from './frame'

/** Each reading's ITEM ink: its own, as an airline's code has its colour. */
export const ITEM_INK: Readonly<Record<BoardKey, Exclude<keyof Palette, 'filled'>>> = {
  cache: 'flapItemCache', spend: 'flapItemSpend', context: 'flapItemContext', '5h': 'flapItem5h', '7d': 'flapItem7d', other: 'flapText',
}

/** What a line is named by: the header, the headings, or its reading. */
type LineName = 'header' | 'headings' | BoardKey

/** What gives way as rows run out, first to last (three-layouts spec §5.3),
 *  CACHE and 7D together as the body's last step, after the remarks where
 *  leaving them out saves height. Calm lines alone give way (three-layouts
 *  spec §2.1): an amber reading's line stays, as chips' cards leave their
 *  alert. */
const GIVE_WAY: ReadonlyArray<readonly LineName[]> = [['other'], ['headings'], ['spend'], ['context'], ['header'], ['5h'], ['cache', '7d']]

/** The columns of air after ITEM, STATUS and TIME. */
const COLUMN_GAP = 2
/** REMARKS narrower than this, and the lines leave them out. */
const REMARKS_LEAST = 8
/** The columns the board's paddingX takes, both sides. */
const BOARD_PAD = 2

type Line = Readonly<{ name: LineName; key: string; row?: BoardRow }>
/** The lines a board keeps, and whether they keep their remarks. */
type Plan = Readonly<{ lines: readonly Line[]; remarks: boolean }>
/** The board's columns: ITEM, STATUS and TIME as wide as their widest,
 *  air included; REMARKS what is left, none under REMARKS_LEAST; and the
 *  characters each flap column keeps. */
type Columns = Readonly<{ item: number; status: number; time: number; remarks: number; keep: Readonly<{ item: number; status: number; time: number }> }>
type FlapKey = 'item' | 'status' | 'time'
const FLAP_KEYS: readonly FlapKey[] = ['item', 'status', 'time']

/** The lines the board would draw with every row: each named by what gives
 *  way with it. */
const boardLines = (read: Readings): readonly Line[] => {
  const { rows } = read.board()
  const named = (key: BoardKey): Line[] => rows.filter(r => r.key === key).map(row => ({ name: key, row, key: `row:${key}` }))
  return [
    { name: 'header', key: 'row:header' },
    { name: 'headings', key: 'row:headings' },
    ...named('cache'), ...named('spend'), ...named('context'), ...named('5h'), ...named('7d'),
    ...rows.filter(r => r.key === 'other').map((row, i): Line => ({ name: 'other', row, key: `row:other:${i}` })),
  ]
}

/** A flap column's text as the columns keep it: whole, or cut with `…`
 *  where the room can't hold the widest. */
const kept = (cols: Pick<Columns, 'keep'>, key: FlapKey, text: string): string => clipToTiles(text, cols.keep[key])

/** The columns for `rows` in `room`: each flap column as wide as its widest
 *  text and its heading, then the air. Where the three outgrow the room the
 *  widest is cut a character at a time; REMARKS take what is left. */
const columnsOf = (kit: Kit, rows: readonly BoardRow[], room: number): Columns => {
  const texts: Readonly<Record<FlapKey, readonly string[]>> = {
    item: rows.map(r => r.item), status: rows.map(r => r.status), time: rows.flatMap(r => r.time ?? []),
  }
  const keep = { item: 0, status: 0, time: 0 }
  for (const k of FLAP_KEYS) keep[k] = Math.max(0, ...texts[k].map(textCells))
  const widthOf = (k: FlapKey): number =>
    Math.max(Math.ceil(boardCells(BOARD_HEADINGS[k], kit.measure)), ...texts[k].map(t => flapCells(kit, clipToTiles(t, keep[k])))) + COLUMN_GAP
  const total = () => FLAP_KEYS.reduce((n, k) => n + widthOf(k), 0)
  while (total() > room) {
    const widest = FLAP_KEYS.reduce((a, b) => (keep[b] > keep[a] ? b : a))
    if (keep[widest] <= 1) break
    keep[widest]--
  }
  const [item, status, time] = [widthOf('item'), widthOf('status'), widthOf('time')]
  const left = room - item - status - time
  return { item, status, time, remarks: left >= REMARKS_LEAST ? left : 0, keep }
}

/** A line's remark as drawn: cut to its column, none where it has none or
 *  the plan leaves them out. A column holds a capital a cell. After a turn
 *  the user didn't type, the widest form the column holds, and with the
 *  plan's remarks gone its last: who restarted the countdown says nowhere
 *  else on the board. */
const remarkOf = (row: BoardRow, cols: Columns, plan: Plan): string => {
  if (cols.remarks === 0) return ''
  const forms = plan.remarks ? row.woken : row.woken?.slice(-1)
  if (forms === undefined) return plan.remarks ? clipToTiles(row.remarks, cols.remarks) : ''
  return clipToTiles(forms.find(form => textCells(form) <= cols.remarks) ?? forms.at(-1) ?? '', cols.remarks)
}

/** The plan's height in the board's units, a rule under each line but the
 *  last on the desktop. */
const heightOf = (kit: Kit, plan: Plan, cols: Columns): number =>
  plan.lines.reduce((sum, l, i) => {
    const rule = i < plan.lines.length - 1 && l.name !== 'headings'
    const text = l.row === undefined || l.row.time === undefined || remarkOf(l.row, cols, plan) !== ''
    return sum + boardLineHeight(kit, { text, rule })
  }, 0)

/** The plan that fits `budget`: every line with its remarks; then, where
 *  that saves height, without them; then calm lines go in GIVE_WAY's order.
 *  Past the last step only amber lines are left, as many as fit. */
const fitPlan = (kit: Kit, lines: readonly Line[], cols: Columns, budget: number): Plan => {
  // A line of flaps alone is shorter than one with text on the desktop alone.
  const saves = kit.Svg !== undefined
  const plans: Plan[] = [{ lines, remarks: true }, ...(saves ? [{ lines, remarks: false }] : [])]
  let left = lines
  for (const names of GIVE_WAY) {
    left = left.filter(l => !names.includes(l.name) || l.row?.tone === 'amber')
    plans.push({ lines: left, remarks: !saves })
  }
  const fits = plans.find(p => heightOf(kit, p, cols) <= budget)
  if (fits !== undefined) return fits
  let last: Plan = { lines: left, remarks: !saves }
  while (last.lines.length > 0 && heightOf(kit, last, cols) > budget) last = { ...last, lines: last.lines.slice(0, -1) }
  return last
}

/** The header: DEPARTURES, and the time now at the other end where the
 *  zone is known; a rule under it on the desktop. */
const headerLine = (kit: Kit, read: Readings, inner: number, rule: boolean): RenderElement => {
  const { Box, Text, palette } = kit
  const now = read.board().now
  return (
    <Box key="row:header" flexDirection="column" flexShrink={0}>
      <Box key="line" flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text color={palette.flapDim}>{BOARD_TITLE}</Text>
        {now === undefined ? null : (
          <Box key="now" flexDirection="row" columnGap={1} flexShrink={0}>
            <Text color={palette.flapDim}>{BOARD_NOW}</Text>
            <Text color={palette.flapText} bold>{now}</Text>
          </Box>
        )}
      </Box>
      {rule ? boardRule(kit, inner) : null}
    </Box>
  )
}

/** The column headings, quiet plain text over their columns. */
const headingsLine = (kit: Kit, cols: Columns, remarks: boolean): RenderElement => {
  const { Box, Text, palette } = kit
  return (
    <Box key="row:headings" flexDirection="row" flexShrink={0}>
      {FLAP_KEYS.map(k => (
        <Box key={k} width={cols[k]} flexShrink={0}>
          <Text color={palette.flapDim}>{BOARD_HEADINGS[k]}</Text>
        </Box>
      ))}
      {remarks ? <Text key="remarks" color={palette.flapDim}>{BOARD_HEADINGS.remarks}</Text> : null}
    </Box>
  )
}

/** A reading's line, keyed `key`: ITEM in its own ink, STATUS amber where
 *  the reading is, TIME, each flaps in its column, or a dim dash for no
 *  TIME; then its remark in plain dim text; a rule under it on the desktop. */
const readingLine = (kit: Kit, key: string, row: BoardRow, cols: Columns, remark: string, inner: number, rule: boolean): RenderElement => {
  const { Box, Text, palette, onTone, oneLine } = kit
  const time = row.time
  const flapsOf: FlapColumn[] = [
    { text: kept(cols, 'item', row.item), ink: palette[ITEM_INK[row.key]], cells: cols.item },
    { text: kept(cols, 'status', row.status), ink: onTone(row.tone, palette.flapText, palette.flapAmber), cells: cols.status },
    ...(time === undefined ? [] : [{ text: kept(cols, 'time', time), ink: palette.flapText, cells: cols.time }]),
  ]
  return (
    <Box key={key} flexDirection="column" flexShrink={0}>
      <Box key="line" flexDirection="row">
        {flapColumns(kit, { key: 'flaps', alt: row.alt, columns: flapsOf, bg: palette.flapBg, seam: palette.flapSeam })}
        {time !== undefined ? null : (
          <Box key="time" width={cols.time} flexShrink={0}>
            <Text color={palette.flapDim}>{BOARD_NO_TIME}</Text>
          </Box>
        )}
        {remark === '' ? null : oneLine({ key: 'remarks', color: palette.flapDim }, remark)}
      </Box>
      {rule ? boardRule(kit, inner) : null}
    </Box>
  )
}

/** The board, its lines fitted to the body's rows, on its dark ground;
 *  nothing when no line fits. */
const board = (kit: Kit, read: Readings, collapsedRows: number): RenderElement | null => {
  const { Box, Svg, palette } = kit
  const inner = Math.max(0, rowRoom(kit) - BOARD_PAD)
  const cols = columnsOf(kit, read.board().rows, inner)
  const plan = fitPlan(kit, boardLines(read), cols, boardBudget(kit, bodyRowsFor(read.frame.maxRows, collapsedRows, 0)))
  if (plan.lines.length === 0) return null
  const remarks = cols.remarks > 0 && (plan.remarks || plan.lines.some(l => l.row !== undefined && remarkOf(l.row, cols, plan) !== ''))
  return (
    <Box
      key="board"
      flexDirection="column"
      marginTop={1}
      paddingX={1}
      backgroundColor={palette.filled ? palette.boardBg : undefined}
      {...(Svg ? { borderStyle: 'round', borderColor: palette.boardBg } : {})}
    >
      {plan.lines.map((l, i) => {
        const rule = i < plan.lines.length - 1
        return l.row !== undefined ? readingLine(kit, l.key, l.row, cols, remarkOf(l.row, cols, plan), inner, rule)
          : l.name === 'header' ? headerLine(kit, read, inner, rule)
          : headingsLine(kit, cols, remarks)
      })}
    </Box>
  )
}

/** Departures open: the board, then the footer every layout draws, the
 *  workspace strip in its row. */
export const departuresOpen = (kit: Kit, read: Readings, act: BandActions, collapsedRows: number): RenderElement[] =>
  [board(kit, read, collapsedRows), footer(kit, act, read.workspace)].filter(e => e !== null)
