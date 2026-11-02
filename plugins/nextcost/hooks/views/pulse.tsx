// Pulse, the session's trace: each message a beat, the cache a heartbeat,
// context and the 5h window as lines over time, the week by day, in the one
// order. Shut, each reading a tile: its name, its figure, then its chart.
// Open, its cards, each with its chart (pulse-open.tsx). Both build their
// charts in pulse-charts.tsx, each at its own size.

import type { RenderChildren, RenderElement } from 'claude-code'
import { heartbeat, sparkline } from '../charts'
import type { Kit } from '../kit'
import { isDrawn } from '../layout'
import type { Tone } from '../facts'
import type { Readings } from '../reading'
import type { Amber } from '../words'
import { fitLine, groundOf, type Keeps, line, pieceGap, type PieceOf } from './frame'
import { beatsChart, chartsDraw, weekCells, windowTrail } from './pulse-charts'
import { pulseOpen } from './pulse-open'
import type { View } from './view'

/** What gives way as the row narrows, first to last (three-layouts spec
 *  §4.1, §2.1), calm only: the last cost, the context trail, the trace from
 *  14 beats to 8, the 5h trail, the 7d cells, the trace; then whole
 *  readings, spend, context and 5h; then their short forms. Each step is
 *  taken only while the row doesn't fit: at 40 columns a calm row of tiles
 *  is the cache and the 7d, and a few columns wider the 5h is back. An amber
 *  reading keeps its tile, its chart and its long words until the amber
 *  step. Past it the 5h's forecast gives way to its value: it says `full` or
 *  nothing, never a bare time, which beside a reset would read as one. Last
 *  of all, the tiles drop their padding (plain, its second column between
 *  readings, each amber one led by its `!`). The cache and the 7d never go. */
const ORDER = {
  calm: ['last', 'contextTrail', 'beats14', 'fiveTrail', 'sevenDays', 'beats', 'spend', 'context', 'five', 'short'],
  amber: ['amberShort'],
  last: ['forecast', 'padding'],
} as const
type Piece = PieceOf<typeof ORDER>
/** The beats' width: 6 px a beat. */
const BEATS_PX = { 14: 84, 8: 48 } as const

/** The heartbeat's state for the cache's mood. */
const heartState = (read: Readings): 'beat' | 'flat' | 'hollow' =>
  read.cache.mood === 'cold' || read.cache.mood === 'compacted' ? 'flat'
  : read.cache.untimed ? 'hollow'
  : 'beat'

/** A reading's words in its tone's ink. */
const said = (kit: Kit, key: string, text: string, tone: Tone): RenderElement => {
  const { Text, palette, onTone } = kit
  return <Text key={key} color={onTone(tone, palette.value)}>{text}</Text>
}

/** A reading's name, in a label's ink, before its figure. */
const named = (kit: Kit, name: string): RenderElement => {
  const { Text, palette } = kit
  return <Text key="name" color={palette.label}>{name}</Text>
}

/** A reading as one keyed tile, as chips' pieces sit: on its ground, the
 *  surface or its window's tint (amber's own while amber), a column of
 *  padding either side; plain draws no ground, and the row sets its tiles
 *  two columns apart instead. Inside, its name, its figure, then its chart,
 *  a column apart. An amber reading's words name it themselves, led by its
 *  mark, so its tile draws no name of its own. */
const tile = (kit: Kit, k: Keeps<Piece>, key: string, tone: Tone, ground: string, parts: readonly RenderChildren[]): RenderElement => {
  const { Box, palette, onTone } = kit
  const fill = groundOf(kit, k, onTone(tone, ground, palette.amberBg))
  const drawn = parts.filter(isDrawn)
  return (
    <Box key={key} flexDirection="row" flexShrink={0} {...fill}>
      {drawn.flatMap((part, i) => (i === 0 ? [part] : [kit.air(`g${i}`), part]))}
    </Box>
  )
}

/** A calm reading's words, long until the short step. */
const calmWords = (k: Keeps<Piece>, long: string, short: string): string => (k.has('short') ? long : short)

/** A reading's words on its tile: calm, its name then its figure; amber, its
 *  amber words alone, long until the amber step. */
const tileWords = (kit: Kit, k: Keeps<Piece>, name: string, figure: string, amber: Amber | undefined): RenderChildren[] =>
  amber === undefined ? [named(kit, name), said(kit, 'w', figure, 'calm')] : [said(kit, 'w', k.amber(amber), 'amber')]

const collapsed = (kit: Kit, read: Readings, toggle: RenderElement): RenderElement =>
  fitLine(kit, ORDER, k => {
    const { Text, palette, onTone } = kit
    const { cache, context, fiveHour, sevenDay } = read
    const hist = read.history()
    const charts = chartsDraw(kit)
    const n = k.has('beats14') ? 14 : 8
    const cacheTile = tile(kit, k, 'cache', cache.tone, palette.surface, [
      ...tileWords(kit, k, cache.bandName, calmWords(k, cache.figure, cache.figureShort), cache.amber),
      heartbeat(kit, { key: 'beat', alt: cache.heartAlt, state: heartState(read), color: onTone(cache.tone, palette.warm) }),
    ])
    // No message's cost: the trace flat, in a label's ink, only beside `no
    // costs yet`, while the total is $0, and the two give way together;
    // alone it would read as $0 a message. A known total says itself alone.
    const noted = hist.costsNote !== undefined && k.has('last')
    const trace = !k.has('beats') || !charts || (hist.empty && !noted) ? null : beatsChart(kit, read, { key: 'beats', count: n, px: BEATS_PX[n], height: 20 })
    const total = said(kit, 'w', k.has('last') && !hist.empty ? [read.spend.totalText, hist.numbersShort].join(' · ') : read.spend.totalText, 'calm')
    // Spend is never amber: it gives way whole at its step.
    const spendTile = !k.has('spend') ? null : tile(kit, k, 'spend', 'calm', palette.surface, [
      named(kit, read.spend.bandName),
      noted ? <Text key="w">{total}<Text key="none" color={palette.label}>{` · ${hist.costsNote}`}</Text></Text> : total,
      trace,
    ])
    const contextTile = !k.calm('context', context.tone) ? null : tile(kit, k, 'context', context.tone, palette.surface, [
      ...tileWords(kit, k, context.bandName, context.valueText, context.amber),
      charts && k.part('contextTrail', context.tone) && hist.context.length > 1
        ? sparkline(kit, { key: 'trail', alt: hist.contextTrailAlt, values: hist.context, color: palette.label, px: 36, height: 16, max: context.compactAt ?? context.window })
        : null,
    ])
    const fiveTile = fiveHour === undefined || !k.calm('five', fiveHour.tone) ? null : tile(kit, k, '5h', fiveHour.tone, palette.fiveBg, [
      ...tileWords(kit, k, fiveHour.bandName, fiveHour.valueText, k.has('forecast') ? fiveHour.amber : fiveHour.amberValue),
      charts && k.part('fiveTrail', fiveHour.tone) ? windowTrail(kit, read, fiveHour.tone, { key: 'trail', px: 48, height: 16 }) : null,
    ])
    // The 7d's cells are the desktop's: in text it is words
    // (three-layouts spec §4.1).
    const sevenTile = sevenDay === undefined ? null : tile(kit, k, '7d', sevenDay.tone, palette.weekBg, [
      ...tileWords(kit, k, sevenDay.bandName, sevenDay.valueText, sevenDay.amber),
      k.part('sevenDays', sevenDay.tone) ? weekCells(kit, read, sevenDay.tone, { key: 'days', cellPx: 4, height: 14 }) : null,
    ])
    // Tiles sit a column apart, as chips' do; plain's two, until the last step.
    return line(kit, [cacheTile, spendTile, contextTile, fiveTile, sevenTile], toggle, pieceGap(kit, k))
  })

export const pulseView: View = {
  rows: { desktop: 1, terminal: 1 },
  collapsed,
  open: pulseOpen,
}
