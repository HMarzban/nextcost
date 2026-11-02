// Pulse open: four cards in chips' grammar, in the one order, CACHE, SPEND,
// CONTEXT and LIMITS, each its title and headline, its chart and its fact,
// laid out as chips lays its cards (shell.tsx); then the footer, the strip
// in its row. The charts are pulse's own: the cache's hour as a track, each
// message's cost as a beat over their average, the context's trail under
// its compaction line, the 5h window and the 7d by day. Short of rows, the
// charts step down first, two rows to one to none; then the calm cards give
// way in pulse's order, an amber one never. Who restarted the countdown, when
// the user didn't, takes the cache's headline and gives way to all of these.

import type { RenderChildren, RenderElement } from 'claude-code'
import { dayCellsFit, sparkline, track } from '../charts'
import type { Tone } from '../facts'
import type { Kit } from '../kit'
import { cellsOf } from '../layout'
import type { LimitReading, Readings } from '../reading'
import type { BandActions } from '../snapshot'
import { EMPTY, limitsHead, markedHead, type Say } from '../words'
import { bodyRowsFor, footer } from './frame'
import { beatsChart, chartsDraw, weekCells, windowTrail } from './pulse-charts'
import { CARD_NAMES, alertLine, cardGrid, cardLine, cardShell, cardsPresent, factRow, fitForm, headHolds, headline, linesOf } from './shell'
import type { CardLine, CardName } from './shell'

const DOT = ' · '

/** What gives way short of rows, a card or the other limits' row in Limits. */
type Unit = 'other' | 'context' | 'limits' | 'cache' | 'spend'
const UNITS: readonly Unit[] = ['cache', 'spend', 'context', 'limits', 'other']
/** The order they give way, first to last (three-layouts spec §4.2): the
 *  other limits, Context, Limits, the cache, then Spend. A calm one gives
 *  way at its turn; an amber one only where the body can't hold every amber
 *  one, then in AMBER_SHED's order, so the view is empty only when nothing
 *  fits. */
const SHED: readonly Unit[] = ['other', 'context', 'limits', 'cache', 'spend']
const AMBER_SHED: readonly Unit[] = ['other', 'context', 'limits', 'cache']

/** A chart's rows: on the desktop two, then one, then none; in text one line. */
type ChartRows = 0 | 1 | 2
const CHART_STEPS: readonly ChartRows[] = [2, 1, 0]

/** A chart of whole rows on the desktop, 24 px each, its air above it. */
const CHART_PX: Readonly<Record<1 | 2, Readonly<{ height: number; air: number }>>> = { 1: { height: 20, air: 4 }, 2: { height: 40, air: 8 } }
/** Day cells draw a px of outline above and below their height. */
const DAY_PX: Readonly<Record<1 | 2, Readonly<{ height: number; air: number }>>> = { 1: { height: 18, air: 4 }, 2: { height: 38, air: 8 } }
/** Px kept above the context's scale, so its compaction line sits in its own chart. */
const HEADROOM_PX: Readonly<Record<1 | 2, number>> = { 1: 4, 2: 8 }
/** The widest day cell. */
const DAY_CELL_PX = 32
/** The columns between Limits' two halves. */
const HALF_GAP = 2

/** The phrases joined by DOT, as many as fit `room` from the first; the
 *  first always, which the surface cuts if it must. */
const fitWords = (kit: Kit, phrases: readonly string[], room: number): string => {
  let words = phrases[0] ?? ''
  for (const p of phrases.slice(1)) {
    const longer = `${words}${DOT}${p}`
    if (cellsOf(longer, kit.measure) > room) break
    words = longer
  }
  return words
}

/** Whether a fact's label and value fit `room` side by side, two columns apart. */
const factFits = (kit: Kit, label: string, value: string, room: number): boolean => cellsOf(label, kit.measure) + 2 + cellsOf(value, kit.measure) <= room

/** Everything the plan and the cards read, worked out once a draw. */
type Facts = Readonly<{
  /** Whether charts draw here: the desktop's, and the unicode tier's braille. */
  charts: boolean
  windows: readonly LimitReading[]
  others: readonly LimitReading[]
  amber: ReadonlySet<Unit>
  has: Readonly<Record<CardName, boolean>>
  /** Whether each card has a chart to draw, given rows for one. */
  charted: Readonly<Record<CardName, boolean>>
}>

const factsOf = (kit: Kit, read: Readings): Facts => {
  const { Svg } = kit
  const { cache, context } = read
  const week = read.week()
  const charts = chartsDraw(kit)
  const windows = [read.fiveHour, read.sevenDay].filter((l): l is LimitReading => l !== undefined)
  const others = read.limits.filter(l => l.key === 'other')
  const amber = new Set<Unit>([
    ...(cache.tone === 'amber' ? (['cache'] as const) : []),
    ...(context.tone === 'amber' && context.known ? (['context'] as const) : []),
    ...(windows.some(l => l.tone === 'amber') ? (['limits'] as const) : []),
    ...(others.some(l => l.tone === 'amber') ? (['other'] as const) : []),
  ])
  return {
    charts,
    windows,
    others,
    amber,
    has: cardsPresent(read),
    charted: {
      cache: charts && !cache.untimed,
      spend: charts,
      context: charts && context.known,
      limits: charts && ((read.fiveHour !== undefined && week.fiveHourWindow.values.length > 1) || (Svg !== undefined && read.sevenDay !== undefined && week.daysDrawn.measured)),
    },
  }
}

/** What a step keeps: its units, and its charts' rows; `wakeRow`, a row in
 *  the cache's card for who restarted the countdown; `asOfRow`, one in
 *  Limits' for the age of its reading. */
type Plan = Readonly<{ kept: ReadonlySet<Unit>; chart: ChartRows; wakeRow?: boolean; asOfRow?: boolean }>

/** The cards a plan's units draw, in the one order. */
const cardsOf = (f: Facts, kept: ReadonlySet<Unit>): CardName[] => {
  const limits = (kept.has('limits') && f.windows.length > 0) || (kept.has('other') && f.others.length > 0)
  return CARD_NAMES.filter(c => f.has[c] && (c === 'limits' ? limits : kept.has(c)))
}

/** Whether Limits' two halves sit side by side in `room`, each fact in its half. */
const halvesAcross = (kit: Kit, f: Facts, room: number): boolean => {
  const half = f.windows.length > 1 ? Math.floor((room - HALF_GAP) / 2) : room
  return f.windows.every(l => factFits(kit, l.fact.label, l.fact.value, half))
}

/** The rows a card on `line` takes at a plan: its edge, its head, its chart and its facts. */
const cardRows = (kit: Kit, f: Facts, card: CardName, p: Plan, line: CardLine): number => {
  const chartRows = p.chart === 0 || !f.charted[card] ? 0 : kit.Svg ? p.chart : 1
  if (card !== 'limits') return line.edgeRows + 1 + chartRows + 1 + (card === 'cache' && p.wakeRow === true ? 1 : 0)
  const halves = p.kept.has('limits') ? f.windows.length : 0
  const across = halvesAcross(kit, f, line.inner)
  // Side by side, one chart and one fact row; else one over the other.
  const halfRows = halves === 0 ? 0 : across ? chartRows + 1 : halves * (chartRows + 1)
  return line.edgeRows + 1 + halfRows + (p.kept.has('other') && f.others.length > 0 ? 1 : 0) + (p.asOfRow === true ? 1 : 0)
}

/** The lines of cards a plan draws, `perLine` to a line, and its rows: each
 *  line its tallest card's, a row of air between lines. */
const planLines = (kit: Kit, f: Facts, p: Plan) => {
  const cards = cardsOf(f, p.kept)
  const geometry = cardLine(kit, cards.length)
  const lines = linesOf(cards, geometry.perLine)
  const rows = lines.reduce((n, line) => n + Math.max(...line.map(c => cardRows(kit, f, c, p, geometry))), 0) + Math.max(0, lines.length - 1)
  return { lines, rows }
}

/** The first plan whose cards fit `body` rows: every unit with charts of
 *  two rows, then one, then none; then the calm units give way by SHED,
 *  each time from charts of two rows again. Where the amber ones alone
 *  don't fit, they give way by AMBER_SHED. */
const planFor = (kit: Kit, f: Facts, body: number): Plan | undefined => {
  for (let a = 0; a <= AMBER_SHED.length; a++) {
    const guarded = new Set([...f.amber].filter(u => !AMBER_SHED.slice(0, a).includes(u)))
    for (let s = 0; s <= SHED.length; s++) {
      const shed = SHED.slice(0, s).filter(u => !guarded.has(u))
      const kept = new Set(UNITS.filter(u => !shed.includes(u)))
      if (cardsOf(f, kept).length === 0) continue
      for (const chart of CHART_STEPS) {
        const p = { kept, chart }
        if (planLines(kit, f, p).rows <= body) return p
      }
    }
  }
  return undefined
}

/** The cache's headline with who restarted the countdown, where its card of
 *  `inner` columns holds it whole; undefined where it doesn't, or the user
 *  typed the turn. */
const wokenHead = (kit: Kit, read: Readings, inner: number): Say | undefined => {
  const { cache } = read
  if (cache.woken === undefined) return undefined
  const woken = [...markedHead(cache.cardHead, cache.tone), ...cache.woken.head]
  return headHolds(kit, 'cache', woken, cache.tone, inner) ? woken : undefined
}

/** Who restarted the countdown costs no chart or card: the headline says it,
 *  and where it can't, a row of its own only if `body` has one to spare. */
const withWake = (kit: Kit, read: Readings, f: Facts, p: Plan, body: number): Plan => {
  const line = planLines(kit, f, p).lines.find(cards => cards.includes('cache'))
  if (line === undefined || read.cache.woken === undefined || wokenHead(kit, read, cardLine(kit, line.length).inner) !== undefined) return p
  const roomy = { ...p, wakeRow: true }
  return planLines(kit, f, roomy).rows <= body ? roomy : p
}

/** The age of the limits' reading costs no chart or card: it takes a row of
 *  Limits' own only if `body` has one to spare. */
const withAsOf = (kit: Kit, read: Readings, f: Facts, p: Plan, body: number): Plan => {
  if (read.asOf === undefined || !cardsOf(f, p.kept).includes('limits')) return p
  const roomy = { ...p, asOfRow: true }
  return planLines(kit, f, roomy).rows <= body ? roomy : p
}

/** What a card on a line is built at: the facts and the plan; the columns
 *  inside it, `inner`, and on the desktop `px`, so a chart spans its card to
 *  where its fact row ends; and its charts' sizes at the plan, none without
 *  charts. */
type CardAt = Readonly<{
  f: Facts
  p: Plan
  inner: number
  px: number
  size: (typeof CHART_PX)[1 | 2] | undefined
  daySize: (typeof DAY_PX)[1 | 2] | undefined
  headroom: number | undefined
}>

/** What a card on a line of `count` is built at. */
const cardAt = (kit: Kit, f: Facts, p: Plan, count: number): CardAt => {
  const { inner, innerPx } = cardLine(kit, count)
  return p.chart === 0
    ? { f, p, inner, px: innerPx, size: undefined, daySize: undefined, headroom: undefined }
    : { f, p, inner, px: innerPx, size: CHART_PX[p.chart], daySize: DAY_PX[p.chart], headroom: HEADROOM_PX[p.chart] }
}

/** A chart in its card: in text clipped to the card, the desktop's its own width. */
const plot = (kit: Kit, chart: RenderChildren): RenderChildren => {
  const { Box, Svg } = kit
  return chart === null || Svg ? chart : <Box key="plot" overflow="hidden">{chart}</Box>
}

/** A line of words in a label's ink, cut to its row. */
const clippedNote = (kit: Kit, key: string, text: string): RenderElement => {
  const { Box, palette, oneLine } = kit
  return <Box key={key}>{oneLine({ color: palette.label }, text)}</Box>
}

/** A fact, its value's phrases as many as fit beside its label. */
const fact = (kit: Kit, at: CardAt, label: string, values: readonly string[]): RenderElement =>
  factRow(kit, label, fitWords(kit, values, at.inner - cellsOf(label, kit.measure) - 2))

/** What fills a card's height past its chart, so its fact sits on the line's last row. */
const fill = (kit: Kit): RenderElement => {
  const { Box } = kit
  return <Box key="fill" flexGrow={1} />
}

const card = (kit: Kit, name: CardName, say: Say, tone: Tone, body: RenderChildren[]): RenderElement =>
  cardShell(kit, { key: `pulse:${name}`, name, head: headline(kit, say, tone), body })

const cacheCard = (kit: Kit, read: Readings, at: CardAt): RenderElement => {
  const { palette, onTone } = kit
  const { cache } = read
  // Inked by its mood: amber in its last minute, warm green while warm, a
  // label's ink cold or compacted, the whole hour gone. Unmeasured or
  // warming, its hour isn't known: no track, and its note says when it will be.
  const ink = onTone(cache.tone, cache.mood === 'warm' ? palette.warm : palette.label)
  const chart = at.size === undefined || !at.f.charted.cache ? null : track(kit, { key: 'chart', alt: cache.alt, frac: 1 - cache.charge, color: ink, px: at.px, ...at.size, cells: at.inner })
  const said = cache.untimed && cache.cardNote !== undefined ? clippedNote(kit, 'fact', cache.cardNote) : factRow(kit, cache.estimateLabel, fitForm(kit, cache.estimateForms, at.inner - cellsOf(cache.estimateLabel, kit.measure) - 2))
  const head = wokenHead(kit, read, at.inner) ?? markedHead(cache.cardHead, cache.tone)
  const woken = at.p.wakeRow === true && cache.woken !== undefined ? factRow(kit, cache.woken.row.label, cache.woken.row.value) : null
  return card(kit, 'cache', head, cache.tone, [plot(kit, chart), fill(kit), woken, said])
}

const spendCard = (kit: Kit, read: Readings, at: CardAt): RenderElement => {
  const { Svg } = kit
  const hist = read.history()
  // The beats over their average, the newest last; in text two to a cell.
  // No cost yet: the trace flat and dim across the card, beside the note
  // that says when costs show, so it never reads as $0 a message.
  const count = hist.empty ? 2 * at.inner : Svg ? hist.costValues.length : Math.min(hist.costValues.length, 2 * at.inner)
  const chart = at.size === undefined || !at.f.charted.spend ? null : beatsChart(kit, read, { key: 'chart', count, level: true, px: at.px, ...at.size })
  const cost = hist.costFact
  const said = cost === undefined ? clippedNote(kit, 'fact', EMPTY.costs) : factRow(kit, cost.label, cost.value)
  return card(kit, 'spend', [[read.spend.totalText, 'value']], 'calm', [plot(kit, chart), fill(kit), said])
}

const contextCard = (kit: Kit, read: Readings, at: CardAt): RenderElement => {
  const { Svg, palette, onTone } = kit
  const { context } = read
  const hist = read.history()
  // Its trail under the compaction line; fewer than two turns, flat at its
  // level now, which is known. In text two turns to a cell.
  const turns = Svg ? hist.context.length : 2 * at.inner
  const values = hist.context.length > 1 ? hist.context.slice(-turns) : Array.from({ length: Math.max(2, Svg ? 2 : turns) }, () => context.used)
  const chart = at.size === undefined || !at.f.charted.context ? null
    : sparkline(kit, { key: 'chart', alt: hist.contextTrailAlt, values, color: onTone(context.tone, palette.label), px: at.px, ...at.size, headroom: at.headroom, max: context.compactAt ?? context.window, levelFrac: context.compactAt === undefined ? undefined : 1 })
  return card(kit, 'context', markedHead(context.cardHeadNamed, context.tone), context.tone, [plot(kit, chart), fill(kit), fact(kit, at, context.fact.label, context.fact.values)])
}

/** A window's half of Limits: its chart, `halfPx` wide, then its fact;
 *  side by side the halves share the line, else each takes all of it. */
const half = (kit: Kit, read: Readings, at: CardAt, l: LimitReading, halfPx: number, across: boolean): RenderElement => {
  const { Box } = kit
  let chart: RenderChildren = null
  if (at.size !== undefined && at.daySize !== undefined && at.f.charts) {
    // The day cells are the desktop's: in text the 7d's half is its fact.
    const cellPx = dayCellsFit(halfPx, read.week().daysDrawn.values.length, DAY_CELL_PX)
    chart = l.key === '5h' ? windowTrail(kit, read, l.tone, { key: 'chart', px: halfPx, ...at.size })
      : l.key === '7d' && cellPx !== undefined ? weekCells(kit, read, l.tone, { key: 'chart', cellPx, ...at.daySize })
      : null
  }
  return (
    <Box key={l.key} flexDirection="column" justifyContent="flex-end" {...(across ? { flexGrow: 1, width: 0, minWidth: 0 } : {})}>
      {plot(kit, chart)}
      {factRow(kit, l.fact.label, l.fact.value)}
    </Box>
  )
}

const limitsCard = (kit: Kit, read: Readings, at: CardAt): RenderElement => {
  const { Box, palette, measure, onTone, oneLine } = kit
  const { f, p } = at
  const windows = p.kept.has('limits') ? f.windows : []
  const across = halvesAcross(kit, f, at.inner)
  const halfPx = windows.length > 1 && across ? Math.floor((at.px - HALF_GAP * measure.pxPerCell) / 2) : at.px
  const others = p.kept.has('other') ? f.others : []
  const shown = windows.length > 0 ? windows : others
  const tone: Tone = shown.some(l => l.tone === 'amber') ? 'amber' : 'calm'
  const othersAmber = others.some(l => l.tone === 'amber')
  return card(kit, 'limits', markedHead(limitsHead(shown), tone), tone, [
    windows.length === 0 ? null : (
      <Box key="halves" flexDirection={across ? 'row' : 'column'} alignItems="stretch" columnGap={HALF_GAP} flexGrow={1}>
        {windows.map(l => half(kit, read, at, l, halfPx, across))}
      </Box>
    ),
    others.length === 0 ? null : (
      <Box key="others">{oneLine({ color: onTone(othersAmber ? 'amber' : 'calm', palette.cardValue) }, others.map(l => l.line).join(DOT))}</Box>
    ),
    at.p.asOfRow === true && read.asOf !== undefined ? clippedNote(kit, 'as-of', read.asOf) : null,
  ])
}

/** Each card's builder, by name. */
const CARDS: Readonly<Record<CardName, (kit: Kit, read: Readings, at: CardAt) => RenderElement>> = {
  cache: cacheCard,
  spend: spendCard,
  context: contextCard,
  limits: limitsCard,
}

/** The cards drawn at a plan, line by line. */
const drawCards = (kit: Kit, read: Readings, f: Facts, p: Plan): RenderElement => {
  const { lines } = planLines(kit, f, p)
  return cardGrid(
    kit,
    lines.map(line => {
      const at = cardAt(kit, f, p, line.length)
      return line.map(c => CARDS[c](kit, read, at))
    }),
    { marginTop: 1, align: 'stretch' },
  )
}

/** Pulse open: the cards, fitted to the body's rows, then the footer, the
 *  strip in its row. Short of a row for any card, an amber window only the
 *  cards draw (the row never draws the other limits) still says it needs
 *  you, on the row they would have started on. */
export const pulseOpen = (kit: Kit, read: Readings, act: BandActions, collapsedRows: number): RenderElement[] => {
  const body = bodyRowsFor(read.frame.maxRows, collapsedRows, 0)
  const f = factsOf(kit, read)
  const planned = planFor(kit, f, body)
  const p = planned === undefined ? undefined : withAsOf(kit, read, f, withWake(kit, read, f, planned, body), body)
  const cards = p !== undefined ? drawCards(kit, read, f, p) : body < 1 ? null : alertLine(kit, read)
  return [cards, footer(kit, act, read.workspace)].filter(e => e !== null)
}
