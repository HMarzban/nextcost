// The snapshot register.tsx reads for the band, and what the band can do
// back: the one contract between the engine side and the drawing, and the
// one way to build it. With it, the layouts' names, and those a stored
// layout or the command may still name.

import type { RenderSurface, SessionRateLimit, SessionUsage } from 'claude-code'
import type { CacheView } from './cache'
import { parseReset } from './format'
import type { Zone } from './format'
import type { Trails } from './insights'
import type { Sample } from './memory'
import type { Palette } from './palette'
import type { Workspace } from './workspace'

/** The glyph tier: the band's own glyphs, or ascii alone where a terminal
 *  draws ambiguous-width glyphs two columns wide. */
export type Glyphs = 'unicode' | 'ascii'

/** Every layout the band can be drawn in. */
export const LAYOUT_NAMES = ['chips', 'pulse', 'departures'] as const
export type LayoutName = (typeof LAYOUT_NAMES)[number]
/** The layout drawn until /nextcost layout chooses another. */
export const DEFAULT_LAYOUT: LayoutName = 'chips'
/** Layouts this version removed: a stored one draws chips, and the command names it. */
const REMOVED_LAYOUTS = ['gauges', 'ledger', 'rings', 'tiles', 'week', 'forecast'] as const
export const REMOVED_IN = '0.14.0'

/** A name from the store or the command, trimmed, in any case. */
const nameOf = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim().toLowerCase() : undefined)
/** A layout's name from the store or the command; anything else, a name
 *  from a newer version included, is undefined. */
export const asLayoutName = (v: unknown): LayoutName | undefined => {
  const name = nameOf(v)
  return LAYOUT_NAMES.find(n => n === name)
}
/** A removed layout's name from the store or the command; else undefined. */
export const removedLayoutOf = (v: unknown): string | undefined => {
  const name = nameOf(v)
  return REMOVED_LAYOUTS.find(n => n === name)
}

/** A limit window's use, and when it resets, epoch ms; undefined without a readable time. */
export type LimitUse = Readonly<{ percentUsed: number; resetsAt: number | undefined }>
/** A window the engine reports, by its kind: `five_hour`, `spend_limit`. */
export type ReportedLimit = LimitUse & Readonly<{ kind: string }>

/** A window the engine reports, its reset parsed once, here: past this
 *  point every reset is epoch ms. */
export const limitOf = (l: SessionRateLimit): ReportedLimit => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: parseReset(l.resetsAt) })

/** The engine's names for the two limits the band reads by name. */
export const FIVE_HOUR = 'five_hour'
export const SEVEN_DAY = 'seven_day'

/** The 5-hour and 7-day windows the engine reports, and every other one. */
export const splitLimits = <L extends Readonly<{ kind: string }>>(limits: readonly L[]): Readonly<{ five: L | undefined; seven: L | undefined; others: L[] }> => ({
  five: limits.find(l => l.kind === FIVE_HOUR),
  seven: limits.find(l => l.kind === SEVEN_DAY),
  others: limits.filter(l => l.kind !== FIVE_HOUR && l.kind !== SEVEN_DAY),
})

/** Everything the band shows, read by register.tsx. */
export type BandSnapshot = Readonly<{
  surface: RenderSurface
  columns: number
  /** Rows the band may take before it scrolls. */
  maxRows: number
  isWorking: boolean
  expanded: boolean
  palette: Readonly<Palette>
  now: number
  cache: CacheView
  costUsd: number
  /** This conversation's message costs and context: the newest cost is
   *  what the last message cost. */
  history: Trails
  context: Readonly<{
    tokens: number | undefined
    window: number
    percent: number | undefined
    /** Where auto-compaction runs, when it is on. */
    compactAt: number | undefined
    /** Auto-compaction is off, as the engine said; false while unknown. */
    autoCompactOff: boolean
  }>
  fiveHour: (LimitUse & { etaMs: number | null }) | undefined
  sevenDay: LimitUse | undefined
  /** When the limits were last read, epoch ms: they come from the last API
   *  response, so they are as old as the last reply. Undefined before one. */
  limitsAt: number | undefined
  /** The newest limit samples, a week's worth of 15-minute buckets, every
   *  session's, oldest first. Sparse use may stretch them back past a week. */
  samples: readonly Sample[]
  /** Any other window the engine reports, such as a gateway's spend_limit. */
  otherLimits: readonly ReportedLimit[]
  /** The project, home-relative, and git there; undefined until first read. */
  workspace: Workspace | undefined
  /** The layout chosen with /nextcost layout. */
  layout: LayoutName
  /** The glyph tier, resolved once per session. */
  glyphs: Glyphs
  /** The local zone, its offset read at each instant drawn; undefined when
   *  the clock gives no offset, and the band counts down instead. */
  zone: Zone | undefined
}>

export type BandActions = Readonly<{
  toggleExpanded: () => Promise<void>
  hide: () => Promise<void>
}>

/** What a snapshot is built from: the engine's usage at `now` and the
 *  render's mount; what the band keeps between hooks; and the cache's view
 *  and the insights as they stand then, the ledger already noted. */
export type SnapshotParts = Readonly<{
  usage: Pick<SessionUsage, 'rateLimits' | 'context'>
  now: number
  mount: Pick<BandSnapshot, 'surface' | 'columns' | 'maxRows' | 'isWorking'>
  expanded: boolean
  band: Pick<BandSnapshot, 'palette' | 'layout' | 'glyphs' | 'samples' | 'workspace'> & Pick<BandSnapshot['context'], 'compactAt' | 'autoCompactOff'>
  cache: CacheView
  costUsd: number
  history: Trails
  /** Time until your pace fills the 5-hour window, as insights.ts measures it. */
  etaMs: number | null
  /** When the limits were last read, as insights.ts keeps it. */
  readAt: number | undefined
  zone: Zone | undefined
}>

/** The snapshot of `p`: each window the engine reports read once, the 5h
 *  and 7d by name, and the context with where it compacts. */
export const snapshotOf = (p: SnapshotParts): BandSnapshot => {
  const { five, seven, others } = splitLimits(p.usage.rateLimits.map(limitOf))
  const { band, usage } = p
  return {
    ...p.mount,
    expanded: p.expanded,
    palette: band.palette,
    layout: band.layout,
    glyphs: band.glyphs,
    now: p.now,
    cache: p.cache,
    costUsd: p.costUsd,
    history: p.history,
    context: {
      tokens: usage.context.tokens,
      window: usage.context.window,
      percent: usage.context.percent,
      compactAt: band.compactAt,
      autoCompactOff: band.autoCompactOff,
    },
    fiveHour: five ? { percentUsed: five.percentUsed, resetsAt: five.resetsAt, etaMs: p.etaMs } : undefined,
    sevenDay: seven ? { percentUsed: seven.percentUsed, resetsAt: seven.resetsAt } : undefined,
    limitsAt: p.readAt,
    samples: band.samples,
    workspace: band.workspace,
    zone: p.zone,
    otherLimits: others,
  }
}

/** The resets a snapshot draws, epoch ms: the timer repaints as their countdowns turn. */
export const resetsOf = (s: BandSnapshot): number[] =>
  [s.fiveHour, s.sevenDay, ...s.otherLimits].flatMap(l => (l?.resetsAt === undefined ? [] : [l.resetsAt]))
