// Chips: a row of pills, and its four cards beneath it when open. Its pill
// builders, its row and its bar's size are exported for its tests; pulse and
// departures draw their own look. Like every layout it draws only words from
// the readings: its hover cards and the context's amount are chips' own
// words, in chips-words.ts. The pill a chip sits in is drawn here alone, led
// on the cache's by the battery from charts.tsx.

import type { RenderChildren, RenderElement } from 'claude-code'
import { batteryIcon, meter, textBattery } from '../charts'
import type { LimitKey, Tone } from '../facts'
import { GLYPH } from '../icons'
import type { Icon } from '../icons'
import type { Kit } from '../kit'
import { cellsOf, spansOf } from '../layout'
import type { BarSize } from '../layout'
import type { Palette } from '../palette'
import type { Readings } from '../reading'
import { chipsOpen } from './chips-open'
import { fitLine, type Keeps, type PieceOf } from './frame'
import type { View } from './view'

/** What the row gives up as it narrows, least important first. The row is
 *  measured after each step; an amber piece holds out until the end. */
const ORDER = {
  calm: ['tokens', 'weekReset', 'fiveReset', 'contextMeter', 'calmWeek', 'limitBars', 'shortWording', 'calmContext', 'calmFive'],
  amber: ['amberWeekReset', 'amberFiveReset'],
} as const
type Piece = PieceOf<typeof ORDER>

/** Below this, the cache's wording and a limit's pace turn short whatever
 *  the squeeze. */
const SHORT_BELOW = 68
/** A chip's bar: 44 px on the desktop, 6 cells elsewhere. */
export const CHIP_BAR: BarSize = { px: 44, cells: 6 }

// ---- the pill ---------------------------------------------------------------

type PillSpec = Readonly<{
  key: string
  tone: Tone
  body: RenderChildren[]
  /** The one-line explanation shown while the pill is hovered, on a card
   *  its row draws after every pill. */
  hover?: string
  /** The terminal battery paints its own background in its Texts. */
  paintsOwnBg?: boolean
  bg?: string
}>

/** A pill carries its own foreground and background, never one of each. It
 *  reveals its card, drawn after every pill, through the hover scope they
 *  share; one line, since a collapsed band is one row. Plain has no cards;
 *  the open view says it all. A pill never shrinks: the squeeze drops
 *  pieces instead, so its text never wraps. */
const pill = (kit: Kit, { key, tone, body, hover, paintsOwnBg, bg }: PillSpec): RenderElement => {
  const { Box, Text, palette, onTone, hoverable } = kit
  if (!palette.filled) {
    const fg = onTone(tone, palette.value)
    return (
      <Box key={key} flexShrink={0}>
        <Text color={fg}>[</Text>
        {body}
        <Text color={fg}>]</Text>
      </Box>
    )
  }
  const fill = paintsOwnBg ? {} : { backgroundColor: onTone(tone, bg ?? palette.surface, palette.amberBg), paddingX: 1 }
  return (
    <Box key={key} flexShrink={0} {...fill} {...(hover === undefined ? {} : hoverable(key))}>
      {body}
    </Box>
  )
}

/** A reset after its reading: the separator in label ink, then `↻` and
 *  when, in `ink`. `↻` is a glyph on every surface, as the boards draw it,
 *  never the clock icon; elsewhere it is the reset icon's own glyph. */
const resetClause = (kit: Kit, ink: string, when: string): RenderElement[] => {
  const { Text, palette } = kit
  return [
    <Text key="d" color={palette.label}>
      {' │ '}
    </Text>,
    <Text key="i-reset" color={ink}>{`${GLYPH.reset} `}</Text>,
    <Text key="r" color={ink}>
      {when}
    </Text>,
  ]
}

// ---- limits ---------------------------------------------------------------

type ChipKey = Exclude<LimitKey, 'other'>
type Tint = Readonly<{ bg: string; fg: string; accent: string }>
type LimitSpec = Readonly<{
  icon: Icon
  calm: Piece
  reset: Piece
  amberReset: Piece
  tint: (p: Readonly<Palette>) => Tint
}>

/** The two limit chips: one shape, their own tint and steps. */
const LIMITS: Readonly<Record<ChipKey, LimitSpec>> = {
  '5h': {
    icon: 'five',
    calm: 'calmFive',
    reset: 'fiveReset',
    amberReset: 'amberFiveReset',
    tint: p => ({ bg: p.fiveBg, fg: p.fiveFg, accent: p.fiveAccent }),
  },
  '7d': {
    icon: 'week',
    calm: 'calmWeek',
    reset: 'weekReset',
    amberReset: 'amberWeekReset',
    tint: p => ({ bg: p.weekBg, fg: p.weekFg, accent: p.weekAccent }),
  },
}

// ---- the pills --------------------------------------------------------------

/** Whether the row says the cache and a limit's pace short at its squeeze:
 *  always below `SHORT_BELOW` columns. The context's amount turns short at
 *  the `shortWording` step alone, as chips' frozen trees draw it. */
const shortAt = (kit: Kit, k: Keeps<Piece>): boolean => kit.columns < SHORT_BELOW || !k.has('shortWording')

/** The cache pill: a draining battery and its countdown, or its mood. */
export const cachePill = (kit: Kit, read: Readings, short: boolean): PillSpec => {
  const { Text, Svg, palette, onTone } = kit
  const { mood, tone, charge } = read.cache
  const copy = read.chips.cache
  const text = copy.pill(short)
  const fg = onTone(tone, palette.value)
  if (Svg) {
    // A normal rounded pill led by a draining battery icon; the text-surface
    // battery would paint a square-cornered block here.
    return { key: 'cache', tone, body: [batteryIcon(kit, charge, tone, copy.alt), <Text key="c" color={fg}>{` ${text}`}</Text>], hover: copy.hover }
  }
  if (palette.filled) {
    return {
      key: 'cache',
      tone,
      body: textBattery(kit, charge, tone, `◷ ${text}`),
      hover: copy.hover,
      paintsOwnBg: true,
    }
  }
  const dot = mood === 'warm' || mood === 'expiring' ? palette.warm : palette.cold
  return {
    key: 'cache',
    tone,
    body: [tone === 'amber' ? null : <Text key="dot" color={dot}>{'● '}</Text>, <Text key="c" color={fg}>{tone === 'amber' ? `◷ ${text}` : text}</Text>],
    hover: copy.hover,
  }
}

/** The session's cost; its card names the last message's. */
const costPill = (kit: Kit, read: Readings): PillSpec => {
  const { Text, palette, icon } = kit
  return {
    key: 'cost',
    tone: 'calm',
    body: [...icon('cost', palette.coin), <Text key="v" color={palette.value} bold>{read.spend.totalText}</Text>],
    hover: read.chips.costHover,
  }
}

/** The session's tokens; its card splits them by kind. */
const tokensPill = (kit: Kit, read: Readings): PillSpec => {
  const { Text, palette, icon } = kit
  return {
    key: 'tokens',
    tone: 'calm',
    body: [...icon('tokens', palette.label), <Text key="v" color={palette.value}>{read.spend.tokensText}</Text>],
    hover: read.chips.tokensHover,
  }
}

/** The context's fill on a meter, counting down to compaction once near it. */
const contextPill = (kit: Kit, read: Readings, k: Keeps<Piece>): PillSpec => {
  const { Text, palette, onTone, gap, icon } = kit
  const { frac, tone } = read.context
  return {
    key: 'ctx',
    tone,
    body: [
      ...icon('context', onTone(tone, palette.label)),
      ...(k.has('contextMeter') ? [meter(kit, { label: 'context', frac, tone, accent: palette.meterFill, size: CHIP_BAR }), gap('g-bar')] : []),
      <Text key="v" color={onTone(tone, palette.value)}>
        {read.chips.contextPill(k.has('shortWording'))}
      </Text>,
    ],
    hover: read.chips.contextHover,
  }
}

/** A limit chip: its usage on a bar and the reset; a pace that fills it
 *  early speaks in words. A window whose reset has passed shows as reset:
 *  its last reading is from before it. Undefined while the engine reports
 *  no such window. */
export const limitPill = (kit: Kit, read: Readings, key: ChipKey, k: Keeps<Piece>, short: boolean): PillSpec | undefined => {
  const { Text, palette, onTone, gap, icon } = kit
  const w = key === '5h' ? read.fiveHour : read.sevenDay
  if (w === undefined) return undefined
  const spec = LIMITS[key]
  const tint = spec.tint(palette)
  const { reset: r, frac, tone } = w
  if (r?.kind === 'passed') {
    return {
      key,
      tone: 'calm',
      bg: tint.bg,
      body: [...icon(spec.icon, tint.accent), <Text key="l" color={tint.fg}>{w.text}</Text>],
      hover: read.chips.limitHover[key],
    }
  }
  const pace = w.fullShort === undefined ? '' : ` ${short ? w.fullShort : w.pace}`
  const fg = onTone(tone, tint.fg)
  const accent = onTone(tone, tint.accent)
  const bar = k.has('limitBars') ? [gap('g-bar'), meter(kit, { label: key, frac, tone, accent: tint.accent, size: CHIP_BAR })] : []
  // The reset is a qualifier: in label ink, its figure the usage before it.
  const resetInk = onTone(tone, palette.label)
  const reset = r !== undefined && k.has(tone === 'amber' ? spec.amberReset : spec.reset) ? resetClause(kit, resetInk, r.text) : []
  return {
    key,
    tone,
    bg: tint.bg,
    body: [
      ...icon(spec.icon, accent),
      <Text key="l" color={fg}>
        {key}
      </Text>,
      ...bar,
      <Text key="v" color={fg} bold>
        {` ${w.valueMarked}`}
      </Text>,
      pace === '' ? null : <Text key="p" color={fg}>{pace}</Text>,
      ...reset,
    ],
    hover: read.chips.limitHover[key],
  }
}

/** Chips' pills at a squeeze, in its order, the tokens last: the calm ones
 *  give way by `ORDER`, the tokens first, and an amber one holds out. */
export const chipsPills = (kit: Kit, read: Readings, k: Keeps<Piece>): PillSpec[] => {
  const short = shortAt(kit, k)
  const five = read.fiveHour && k.calm(LIMITS['5h'].calm, read.fiveHour.tone) ? limitPill(kit, read, '5h', k, short) : undefined
  const seven = read.sevenDay && k.calm(LIMITS['7d'].calm, read.sevenDay.tone) ? limitPill(kit, read, '7d', k, short) : undefined
  return [
    cachePill(kit, read, short),
    costPill(kit, read),
    ...(read.context.known && k.calm('calmContext', read.context.tone) ? [contextPill(kit, read, k)] : []),
    ...(five === undefined ? [] : [five]),
    ...(seven === undefined ? [] : [seven]),
    ...(read.cache.measured && k.has('tokens') ? [tokensPill(kit, read)] : []),
  ]
}

/** Pills in a row, each revealing its card, then air and the toggle. A card
 *  ends short of ▵ and the gap before it, and covers whole pills. */
export const pillRow = (kit: Kit, toggle: RenderElement, specs: readonly PillSpec[]): RenderElement => {
  const { Box, measure, asDrawn, hoverCard } = kit
  const pills = specs.map(spec => pill(kit, spec))
  const room = kit.columns - cellsOf(toggle, measure) - 1
  const pieces = spansOf(pills.map(asDrawn), 1, measure)
  return (
    <Box key="row" flexDirection="row" flexWrap="nowrap" overflow="hidden" columnGap={1}>
      {pills}
      <Box flexGrow={1} />
      {specs.map(({ key, hover }, i) => (hover === undefined ? null : hoverCard(key, hover, { left: pieces[i]?.[0] ?? 0, room, pieces })))}
      {toggle}
    </Box>
  )
}

export const chipsView: View = {
  rows: { desktop: 1, terminal: 1 },
  // Its one row, squeezed until it fits.
  collapsed: (kit, read, toggle) => fitLine(kit, ORDER, k => pillRow(kit, toggle, chipsPills(kit, read, k))),
  open: chipsOpen,
}
