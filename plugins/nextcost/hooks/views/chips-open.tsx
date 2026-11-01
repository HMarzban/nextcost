// Chips' open view: its four cards, CACHE, SPEND, CONTEXT and LIMITS, and its
// footer of the workspace strip and the buttons.

import type { RenderChildren, RenderElement } from 'claude-code'
import { meter, splitBar } from '../charts'
import type { SplitPart } from '../charts'
import type { Tone } from '../facts'
import type { Kit } from '../kit'
import { textCells } from '../layout'
import type { BarSize } from '../layout'
import type { LimitReading, Readings } from '../reading'
import type { BandActions } from '../snapshot'
import { SPLIT_LABELS, type Say } from '../words'
import { bodyRowsFor, footer, topStrip } from './frame'
import { CARD_NAMES, alertLine, cardGrid, cardLine, cardShell, cardsPresent, factRow, headHolds, headline, limitAccent, linesOf } from './shell'
import type { CardName } from './shell'

const SPLIT_ALT = `token split: ${SPLIT_LABELS.join(', ')}`

/** The session's tokens split by kind, in `SPLIT_LABELS`' order, each part
 *  in its colour. Cache reads are in the warm colour: cheap, and often most
 *  of the bar. In text each part has its own fill too, since the inks sit
 *  close in lightness: colour is never the only signal. The desktop's parts
 *  are solid, divided by the ground, so its legend marks them solid. */
const tokenPartsOf = (kit: Kit, read: Readings): SplitPart[] => {
  const { Svg, palette } = kit
  const { spend } = read
  const [inputFill, outputFill, readsFill] = Svg ? ['■', '■', '■'] : kit.glyphs === 'ascii' ? ['#', '=', '+'] : ['█', '▓', '▒']
  return [
    { n: spend.sent, color: palette.meterFill, mark: inputFill },
    { n: spend.back, color: palette.coin, mark: outputFill },
    { n: spend.cached, color: palette.warm, mark: readsFill },
  ]
}

/** Where chips' cards sit: how many to a line and the columns of a card's
 *  edge; where the workspace strip goes, on top or in the footer; whether
 *  the cards fit at all; and what each card is built at. */
type Grid = Readonly<{ perLine: number; edge: number; stripPlace: 'top' | 'footer' | undefined; cardsFit: boolean; fit: Fit }>

/** What a card is built at: the columns inside it, the rows its body may
 *  take, and its bar's size. */
type Fit = Readonly<{ inner: number; bodyRows: number; bar: BarSize }>

/** The grid: as many cards to a line as hold their text, else two, else one.
 *  Each line shares its width equally (a zero basis, grown alike), so the
 *  cards align whatever their text and a line never wraps one away. A
 *  desktop card has a visible edge; a terminal card is a fill, its border
 *  would cost two columns. Lines keep a row of air between them. */
const gridOf = (kit: Kit, read: Readings, collapsedRows: number): Grid => {
  const hasCard = cardsPresent(read)
  const cardCount = CARD_NAMES.filter(name => hasCard[name]).length
  const { perLine, inner, edge, pxEdge } = cardLine(kit, cardCount)
  const lineCount = Math.ceil(cardCount / perLine)
  const lineGap = 1
  // The rows a card's body may take: the frame's, shared by the lines less
  // the row of air between them, less a card's edge and its header. A taller
  // band would scroll, hiding the buttons.
  const bodyFor = (strip: number) =>
    Math.floor((bodyRowsFor(read.frame.maxRows, collapsedRows, strip) - lineGap * (lineCount - 1)) / lineCount) - edge - 1
  // The strip heads the view when every card still keeps a fact of its own;
  // short of that row it takes the footer's, in place of the hint.
  const stripPlace = read.workspace === undefined ? undefined : bodyFor(1) >= 1 ? 'top' : 'footer'
  return {
    perLine,
    edge,
    stripPlace,
    // Short of a row under each head for a fact, the cards give way whole.
    // The desktop draws a card's edge as a line of pixels, so there it never
    // counts as the row a fact needs.
    cardsFit: bodyFor(0) + (pxEdge ? edge : 0) >= 1,
    fit: { inner, bodyRows: Math.max(1, bodyFor(stripPlace === 'top' ? 1 : 0)), bar: { px: inner * kit.measure.pxPerCell, cells: inner } },
  }
}

/** A fact the readings may not know yet: nothing until they do. */
const knownRow = (kit: Kit, label: string, value: string | undefined): RenderChildren => (value === undefined ? null : factRow(kit, label, value))

/** A line of words in a label's ink, wrapped. */
const wrappedNote = (kit: Kit, text: string): RenderElement => {
  const { Text, palette } = kit
  return (
    <Text key="note" color={palette.label} wrap="wrap">
      {text}
    </Text>
  )
}

/** As much of a card's body as the band has rows for, its facts listed most
 *  important first. Its bar repeats a chip's, so it shows only when every
 *  fact fits beside it; short of rows, a fact wins. */
const fitBody = (fit: Fit, bar: RenderChildren, body: RenderChildren[]): RenderChildren[] => {
  const facts = body.filter(part => part !== null && part !== undefined)
  return bar !== null && facts.length < fit.bodyRows ? [bar, ...facts] : facts.slice(0, fit.bodyRows)
}

/** A card: its title and headline on one line, then its bar and its body. */
const card = (kit: Kit, fit: Fit, name: CardName, head: Readonly<{ say: Say; tone?: Tone }>, bar: RenderChildren, body: RenderChildren[]): RenderElement =>
  cardShell(kit, { key: `card:${name}`, name, head: headline(kit, head.say, head.tone ?? 'calm'), body: fitBody(fit, bar, body) })

const cacheCard = (kit: Kit, read: Readings, fit: Fit): RenderElement => {
  const { cache } = read
  // The rows the facts ahead of who woke the session take: past them, it has
  // no row of its own, and the headline says it instead, where the card holds
  // it whole.
  const ahead = (cache.cardNote === undefined ? 0 : 1) + (cache.known ? 1 : 0)
  const woken = fit.bodyRows <= ahead && cache.wakeHead !== undefined ? [...cache.cardHead, ...cache.wakeHead] : undefined
  return card(
    kit,
    fit,
    'cache',
    { say: woken !== undefined && headHolds(kit, 'cache', woken, cache.tone, fit.inner) ? woken : cache.cardHead, tone: cache.tone },
    cache.known ? meter(kit, { label: 'cache', frac: cache.charge, tone: cache.tone, accent: kit.palette.warm, size: fit.bar, stretch: true, reads: 'left' }) : null,
    [
      cache.cardNote === undefined ? null : wrappedNote(kit, cache.cardNote),
      cache.known ? factRow(kit, cache.estimateLabel, cache.estimate) : null,
      cache.wakeRow === undefined ? null : factRow(kit, cache.wakeRow.label, cache.wakeRow.value),
      knownRow(kit, 'idle for', cache.idleText),
      knownRow(kit, 'unexpected rebuilds', cache.rebuildsText),
      knownRow(kit, 'saved by cache', cache.savedText),
      knownRow(kit, 'hit rate', cache.hitText),
      factRow(kit, 'expires', cache.lastsText),
    ],
  )
}

const spendCard = (kit: Kit, read: Readings, fit: Fit): RenderElement => {
  const { spend } = read
  const tokenParts = tokenPartsOf(kit, read)
  const lastRow = spend.lastText === undefined ? null : factRow(kit, 'last message', spend.lastText)
  const splitShown = read.cache.measured
  const tokenRows = splitShown
    ? spend.split.map((part, i) => factRow(kit, part.label, part.text, tokenParts[i]))
    : [wrappedNote(kit, 'Breakdown counts from your next message.')]
  return card(kit, fit, 'spend', { say: [[spend.totalText, 'value']] }, splitShown ? splitBar(kit, { alt: SPLIT_ALT, parts: tokenParts, size: fit.bar }) : null, [lastRow, ...tokenRows])
}

/** The context's card, once it is reported. */
const contextCard = (kit: Kit, read: Readings, fit: Fit): RenderElement | null => {
  const { context } = read
  if (!context.known) return null
  return card(
    kit,
    fit,
    'context',
    { say: context.cardHead, tone: context.tone },
    meter(kit, { label: 'context', frac: context.frac, tone: context.tone, accent: kit.palette.meterFill, size: fit.bar, stretch: true }),
    [
      knownRow(kit, 'room left', context.roomText),
      knownRow(kit, 'auto-compacts at', context.compactsAtText),
      factRow(kit, 'in context', context.inContextText),
      factRow(kit, 'model window', context.windowText),
    ],
  )
}

/** Limits' first row: the worst window's reset, at its clock time once the
 *  offset is known, and its pace. */
const leadRow = (kit: Kit, worst: LimitReading | undefined): RenderChildren => {
  if (worst === undefined) return null
  const { Box, Text, palette, oneLine } = kit
  const { pace, resetWhen: when } = worst
  // Its pace alone needs no label: the phrase says it is one.
  if (when === undefined) return pace === '' ? null : <Box key="fact:pace">{oneLine({ color: palette.label }, pace)}</Box>
  return (
    <Box key="fact:resets" flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Text color={palette.label}>resets</Text>
      {oneLine({}, [
        <Text key="when" color={palette.cardValue}>
          {when}
        </Text>,
        pace === '' ? null : <Text key="pace" color={palette.label}>{` · ${pace}`}</Text>,
      ])}
    </Box>
  )
}

/** One window: its name, bar and value on a line, then its name again with
 *  its reset and pace in words, `5h resets 4h 55m`, which the lead row says
 *  for the worst. */
const limitRows = (kit: Kit, fit: Fit, worst: LimitReading | undefined, w: LimitReading): readonly [RenderChildren, RenderChildren] => {
  const { Box, Text, palette, measure, onTone, oneLine } = kit
  const { name, frac, tone } = w
  if (w.passed) return [factRow(kit, name, 'reset'), null]
  const value = w.valueMarked
  const reset = w.resetAndPace
  const room = Math.max(4, fit.inner - textCells(name) - textCells(value) - 2)
  const size: BarSize = { px: room * measure.pxPerCell, cells: room }
  return [
    <Box key={`fact:${name}`} flexDirection="row" columnGap={1}>
      <Text color={palette.label}>{name}</Text>
      <Box key="bar" flexGrow={1} width={0} minWidth={0}>
        {meter(kit, { label: name, frac, tone, accent: limitAccent(palette, w.key), size, stretch: true })}
      </Box>
      <Text color={onTone(tone, palette.cardValue)}>{value}</Text>
    </Box>,
    // Named, so beneath another window's headline it reads as its own.
    w === worst || reset === undefined ? null : <Box key={`fact:${name} pace`}>{oneLine({ color: palette.label }, `${name} ${reset}`)}</Box>,
  ]
}

/** The lead row, then every window's rows; short of rows, each window's bar
 *  row before any pace line, and with no lead row the worst's bar last of
 *  all, since the headline says its value. */
const limitLines = (kit: Kit, read: Readings, fit: Fit): RenderChildren[] => {
  const worst = read.worstLimit
  const lead = leadRow(kit, worst)
  const rows = read.limits.map(w => limitRows(kit, fit, worst, w))
  const lines = rows.flat().filter(part => part !== null)
  const room = fit.bodyRows - (lead === null ? 0 : 1)
  if (lines.length <= room) return [lead, ...lines]
  const bars = rows.map(([bar]) => bar)
  const worstAt = lead === null ? read.limits.findIndex(w => w === worst) : -1
  const worstBar = worstAt < 0 ? [] : bars.splice(worstAt, 1)
  return [lead, ...bars, ...rows.map(([, pace]) => pace), ...worstBar]
}

/** The limits' card, once the engine reports any window. Each window's bar
 *  is in its own row, so the card has none apart. */
const limitsCard = (kit: Kit, read: Readings, fit: Fit): RenderElement | null => {
  const worst = read.worstLimit
  if (read.limits.length === 0) return null
  return card(
    kit,
    fit,
    'limits',
    {
      say: worst === undefined ? [['all reset', 'value']] : [[`${worst.name} `, 'label'], [worst.valueMarked, 'value']],
      tone: worst === undefined ? 'calm' : worst.tone,
    },
    null,
    limitLines(kit, read, fit),
  )
}

/** Chips' open view, beneath its row: as many cards to a line as hold their
 *  text, each as much of its body as the band has rows for; the workspace
 *  strip on top or in the footer; then Collapse and Hide band. */
export const chipsOpen = (kit: Kit, read: Readings, act: BandActions, collapsedRows: number): RenderChildren[] => {
  const { perLine, edge, stripPlace, cardsFit, fit } = gridOf(kit, read, collapsedRows)
  const ws = read.workspace
  const cards = [cacheCard(kit, read, fit), spendCard(kit, read, fit), contextCard(kit, read, fit), limitsCard(kit, read, fit)].filter(view => view !== null)
  return [
    stripPlace === 'top' && ws !== undefined ? topStrip(kit, ws, edge) : null,
    cardsFit ? cardGrid(kit, linesOf(cards, perLine), { marginTop: stripPlace === 'top' ? 0 : 1, align: 'flex-start' })
    // Without them, the other windows' alert, where the band has a row for it.
    : bodyRowsFor(read.frame.maxRows, collapsedRows, 0) < 1 ? null
    : alertLine(kit, read),
    footer(kit, act, stripPlace === 'footer' ? ws : undefined),
  ]
}
