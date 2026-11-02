// The departures board's words: a row per reading in the board's capitals,
// its statuses, short forms, remarks and alt sentences, and the headings and
// header it draws them under. Pure, built from the readings' facts and
// words with the phrasebook's primitives, so the board says what every
// layout says, in its own voice.

import type { CacheFacts } from './cache'
import type { ContextFacts, Frame, LimitFacts, LimitKey, SpendFacts, Tone } from './facts'
import { boardSpan, etaMinutes, fillTime, fmtClock, fmtDayClock, fmtEta } from './format'
import { AMBER_LEAD, EMPTY, PRICE_COVERS, UNKNOWN, compactsIn, saidJoined } from './words'
import type { CacheWords, ContextWords, LimitWords, SpendWords } from './words'

export type BoardKey = 'cache' | 'spend' | 'context' | '5h' | '7d' | 'other'
export type BoardRow = Readonly<{
  key: BoardKey
  /** `CACHE`, `SPEND`, `CONTEXT`, `5H`, `7D`, or an other limit's name, upper-case. */
  item: string
  /** `DEPARTS`, `LAST CALL`, `DEPARTED`, `BOARDING`, `CHECK-IN`, `$0.24`, `8% USED`, `26%`, `! NEAR LIMIT`. */
  status: string
  /** `17:24`, `SAT 13:30`, `IN 38 MIN`, `IN 1H 04M`, `PASSED`; none where it has no time. */
  time: string | undefined
  remarks: string
  /** After a turn the user didn't type, what REMARKS say in its place, widest
   *  first, the waker leading each: the board keeps the widest its column
   *  holds, and the last when every other remark gives way. */
  woken?: readonly string[]
  /** Collapsed, long: `DEPARTS 17:24`, `26% RESET 17:50`, `85% RESET SAT 13:30 ! NEAR LIMIT`. */
  cell: string
  /** Collapsed, short: `17:24`, `! 47S`, `26%`. */
  cellShort: string
  /** Limits only: the cell without its reset. */
  cellNoReset?: string
  tone: Tone
  /** The reading's own alt, in words, never capitals or ↻. */
  alt: string
}>
/** What the board says for a reset: the flap face has no ↻. */
const BOARD_RESET = 'RESET'
export type Board = Readonly<{
  rows: readonly BoardRow[]
  /** The time now on the viewer's clock, `20:36`, for the open board's
   *  header; none where the zone isn't known. */
  now: string | undefined
}>
type BoardFacts = Readonly<{
  frame: Frame
  cache: CacheFacts & CacheWords
  spend: SpendFacts & SpendWords
  context: ContextFacts & ContextWords
  limits: readonly (LimitFacts & LimitWords)[]
}>

/** A projection on the board: `~40 MIN`, `~1H 15M`. */
const boardEta = (ms: number): string => (etaMinutes(ms) < 60 ? `~${etaMinutes(ms)} MIN` : fmtEta(ms))

/** REMARKS after a turn the user didn't type, widest first: what it did and
 *  every remark; who and the `price` alone; what it did; who. */
const wokenForms = (c: CacheWords, remarks: string, price: string): Pick<BoardRow, 'woken'> => {
  if (c.wakeRow === undefined || c.wakeShort === undefined) return {}
  const long = `${c.wakeRow.label} ${c.wakeRow.value}`
  return { woken: [saidJoined([long, remarks], ' · '), saidJoined([c.wakeShort, price], ' · '), long, c.wakeShort] }
}

const cacheBoard = (r: BoardFacts): BoardRow => {
  const c = r.cache
  const zone = r.frame.zone
  /** The cache's line; `price`, the part of its remarks a waker keeps beside
   *  it, its remarks all where none is named. A named price says what it
   *  covers in REMARKS alone, last, so a narrowing column clips that first;
   *  never in what a waker leads, so the waker's own words are what it drops
   *  last. */
  const at = (cell: Omit<BoardRow, 'key' | 'item' | 'alt' | 'woken'>, price?: string): BoardRow =>
    ({ key: 'cache', item: 'CACHE', alt: c.alt, ...cell, remarks: price === undefined ? cell.remarks : `${cell.remarks} · ${PRICE_COVERS}`, ...wokenForms(c, cell.remarks, price ?? cell.remarks) })
  /** A row with no time to show: its status alone, in every column. */
  const statusOnly = (status: string): BoardRow => at({ status, time: undefined, remarks: '', cell: status, cellShort: status, tone: 'calm' })
  const reWarm = `RE-WARM ${c.estimate}`
  if (c.mood === 'uncached') return statusOnly('NOT CACHING')
  if (c.untimed) return statusOnly('CHECK-IN')
  const clock = c.coldAt === null || zone === undefined ? undefined : `${c.measured ? '' : '~'}${fmtClock(c.coldAt, zone)}`
  /** A cache gone: when it went, where the clock is known, and what the next message costs. */
  const gone = (status: string, remarks: string): BoardRow =>
    at({ status, time: clock, remarks, cell: clock === undefined ? `${status} · ${remarks}` : `${status} ${clock} · ${remarks}`, cellShort: remarks, tone: 'calm' }, remarks)
  if (c.mood === 'compacted') return gone('COMPACTED', `NEXT ${c.estimate}`)
  if (c.mood === 'cold') return gone('DEPARTED', reWarm)
  if (c.mood === 'switched') return at({ status: 'MODEL CHANGED', time: undefined, remarks: `NEXT ${c.estimate}`, cell: `MODEL CHANGED · NEXT ${c.estimate}`, cellShort: `NEXT ${c.estimate}`, tone: 'calm' })
  if (r.frame.isWorking) return statusOnly('BOARDING')
  const left = c.coldInMs ?? 0
  if (c.tone === 'amber') {
    const secs = boardSpan(left)
    // The mark leads the status and the cell, so plain, which has no hue, still tells it from the calm last call.
    return at({ status: `${AMBER_LEAD}LAST CALL`, time: secs, remarks: reWarm, cell: `${AMBER_LEAD}LAST CALL ${secs}`, cellShort: `${AMBER_LEAD}${secs}`, tone: 'amber' }, reWarm)
  }
  const status = c.lastCall ? 'LAST CALL' : 'DEPARTS'
  const countdown = `IN ${boardSpan(left)}`
  const time = clock ?? countdown
  return at({ status, time, remarks: `${clock === undefined ? '' : `${countdown} · `}${reWarm} IF MISSED`, cell: `${status} ${time}`, cellShort: time, tone: 'calm' }, reWarm)
}

const spendBoard = (r: BoardFacts): BoardRow => ({
  key: 'spend', item: 'SPEND', status: r.spend.totalText, time: undefined,
  remarks: r.spend.lastText === undefined ? '' : `LAST ${r.spend.lastText}`,
  cell: r.spend.totalText, cellShort: r.spend.totalText, tone: 'calm', alt: `spent ${r.spend.totalText} this session`,
})

const contextBoard = (r: BoardFacts): BoardRow => {
  const x = r.context
  const base = { key: 'context', item: 'CONTEXT', time: undefined, alt: x.alt } as const
  if (!x.known) return { ...base, status: EMPTY.context, remarks: '', cell: EMPTY.context, cellShort: EMPTY.context, tone: 'calm' }
  // With compaction known the percentage is toward it, which REMARKS say first; else it is of the window.
  const remarks = saidJoined([x.compactsAtText === undefined ? undefined : `TOWARD COMPACTION AT ${x.compactsAtText}`, x.roomText === undefined ? undefined : `${x.roomText} LEFT`], ' · ')
  if (x.tone === 'calm') return { ...base, status: `${x.valueText} USED`, remarks, cell: x.valueText, cellShort: x.valueText, tone: 'calm' }
  // Near compaction the board names the event; with compaction off, the
  // fill. The group's ITEM already says CONTEXT, so its cell never does.
  const short = `${AMBER_LEAD}${x.valueText}`
  const long = x.toCompact === undefined ? short : `${AMBER_LEAD}${compactsIn(x.toCompact)}`
  return { ...base, status: long, remarks, cell: long, cellShort: short, tone: 'amber' }
}

const limitBoard = (r: BoardFacts, l: LimitFacts & LimitWords): BoardRow => {
  const { zone, now } = r.frame
  // An other limit names itself a limit: `spend` alone would read as the session's SPEND.
  const item = l.key !== 'other' ? l.key : /\blimit$/.test(l.name) ? l.name : `${l.name} limit`
  // Passed, its value is that it reset: RESET PASSED says it once, and the short forms the value.
  if (l.passed) return { key: l.key, item, status: l.valueText, time: 'PASSED', remarks: '', cell: `${BOARD_RESET} PASSED`, cellShort: l.valueText, cellNoReset: l.valueText, tone: l.tone, alt: l.alt }
  const time = l.resetInMs === undefined ? undefined : zone === undefined ? `IN ${boardSpan(l.resetInMs)}` : fmtDayClock(now + l.resetInMs, zone, now)
  // A measured fill says when it fills, past the warning line too, as every
  // layout's amber words do; amber without one, that it is near.
  const amber = l.tone !== 'amber' ? undefined : l.etaMs !== null ? `${AMBER_LEAD}${zone === undefined ? `FULL IN ${boardEta(l.etaMs)}` : `FULL ~${fmtClock(fillTime(now + l.etaMs, l.etaMs, zone), zone)}`}` : `${AMBER_LEAD}NEAR LIMIT`
  const calm = l.fillText ?? l.pace
  const tail = (amber ?? calm) === '' ? '' : ` ${amber ?? calm}`
  return {
    key: l.key, item, status: amber ?? l.valueText, time,
    // Amber from the pace, STATUS says the fill, so REMARKS doesn't again.
    remarks: amber === undefined ? calm : saidJoined([l.valueText, l.etaMs !== null ? undefined : calm], ' · '),
    cell: `${l.valueText}${time === undefined ? '' : ` ${BOARD_RESET} ${time}`}${tail}`, cellShort: amber === undefined ? l.valueText : `${AMBER_LEAD}${l.valueText}`, cellNoReset: `${l.valueText}${tail}`,
    tone: l.tone, alt: l.alt,
  }
}

const upRow = (row: BoardRow): BoardRow => ({
  ...row, item: row.item.toUpperCase(), status: row.status.toUpperCase(), time: row.time?.toUpperCase(),
  remarks: row.remarks.toUpperCase(), cell: row.cell.toUpperCase(), cellShort: row.cellShort.toUpperCase(),
  ...(row.cellNoReset === undefined ? {} : { cellNoReset: row.cellNoReset.toUpperCase() }),
  ...(row.woken === undefined ? {} : { woken: row.woken.map(form => form.toUpperCase()) }),
})

/** The departures board: a row per reading in the one order, in the
 *  board's capitals; alts stay in words. */
export const boardWords = (r: BoardFacts): Board => {
  const of = (key: LimitKey) => r.limits.filter(l => l.key === key).map(l => limitBoard(r, l))
  return {
    rows: [cacheBoard(r), spendBoard(r), contextBoard(r), ...of('5h'), ...of('7d'), ...of('other')].map(upRow),
    now: r.frame.zone === undefined ? undefined : fmtClock(r.frame.now, r.frame.zone),
  }
}

/** What a board line says in its four columns. */
type BoardText = Readonly<Record<'item' | 'status' | 'time' | 'remarks', string>>

/** The board's column headings, a line of their own. */
export const BOARD_HEADINGS: BoardText = { item: 'ITEM', status: 'STATUS', time: 'TIME', remarks: 'REMARKS' }
/** The open board's title, at its header's left. */
export const BOARD_TITLE = 'DEPARTURES'
/** What leads the time now, at the header's right: `NOW 20:36`. */
export const BOARD_NOW = 'NOW'
/** What TIME says, in plain text, on a line that has none. */
export const BOARD_NO_TIME = UNKNOWN
/** The alt of a rule between the board's lines. */
export const BOARD_RULE_ALT = 'a rule between the board\'s lines'
