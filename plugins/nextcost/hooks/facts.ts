// The facts each reading holds, and the frame every layout draws by:
// reading.ts builds them, and the phrasebooks, the cache and the views read
// them. Types alone, built on format.ts's, so any module may import them
// without a cycle.

import type { ResetIn, Zone } from './format'

export type Tone = 'calm' | 'amber'

/** How the band is mounted and when: what every view lays itself out by. */
export type Frame = Readonly<{
  expanded: boolean
  maxRows: number
  now: number
  isWorking: boolean
  zone: Zone | undefined
}>

/** The context's fill, read alike whether or not it compacts. */
export type ContextFill = Readonly<{
  known: boolean
  used: number
  frac: number
  pct: string
  tone: Tone
  /** The tokens in context, as the engine reported them; undefined when it didn't. */
  tokens: number | undefined
  window: number
}>

/** The context toward auto-compaction, with the room left before it and
 *  whether it is near; or, with compaction off or not reported yet, against
 *  the window alone. */
export type ContextFacts = ContextFill &
  (
    | Readonly<{ compactAt: number; toCompact: number; nearCompact: boolean }>
    | Readonly<{ compactAt: undefined; toCompact: undefined; nearCompact: false }>
  )

export type SpendFacts = Readonly<{
  totalUsd: number
  lastTurnUsd: number | null
  sent: number
  back: number
  cached: number
  total: number
}>

export type LimitKey = '5h' | '7d' | 'other'

/** What a window says whether or not it has passed. */
export type LimitBase = Readonly<{
  name: string
  key: LimitKey
  percentUsed: number
  frac: number
  /** `82%`, with no severity mark: chips adds its own. */
  value: string
  reset: ResetIn | undefined
  /** When it resets, epoch ms, as the snapshot carries it. */
  resetsAt: number | undefined
  gone: number | undefined
}>

/** A window still to reset: its tone, its pace and when it fills. */
export type LiveLimit = LimitBase &
  Readonly<{
    passed: false
    tone: Tone
    etaMs: number | null
    /** 100 when a 5h fill is measured; else the average's landing, once 5% of
     *  the 5h (a day of the week) has gone and any of it is used. The 5h's is
     *  never 100 or more but by a measured fill: the average alone doesn't
     *  say a window fills. */
    projectedPct: number | undefined
    /** Time to the reset. */
    resetInMs: number | undefined
    /** Time to full before the reset: a measured fill, else the average's,
     *  once it lands at 100% or more; undefined while it lands short. */
    fillInMs: number | undefined
    /** `fillInMs` while there is something left to fill: undefined once full. */
    fullInMs: number | undefined
  }>

/** A window whose reset has passed: calm, with no pace, reset or fill to say. */
type PassedLimit = LimitBase &
  Readonly<{
    passed: true
    tone: 'calm'
    etaMs: null
    projectedPct: undefined
    resetInMs: undefined
    fillInMs: undefined
    fullInMs: undefined
  }>

export type LimitFacts = LiveLimit | PassedLimit
