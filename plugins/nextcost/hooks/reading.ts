// What the band reads off its snapshot before it draws anything: the cache's
// meaning, the context's fill, each limit's tone and pace, with their words
// beside them, the board's and chips'. Pure, so readingsOf can be checked
// without mounting the band.

import { cacheFactsOf } from './cache'
import type { CacheFacts } from './cache'
import { drawnWeekOf } from './calendar'
import type { DrawnWeek, WindowNow } from './calendar'
import type { ContextFacts, ContextFill, Frame, LimitBase, LimitFacts, LimitKey, LiveLimit, SpendFacts } from './facts'
import {
  FIVE_HOUR_MS,
  SEVEN_DAY_MS,
  WARN_AT,
  clamp01,
  contextPressure,
  contextUsed,
  fixedZone,
  fmtPct,
  fmtPercent,
  resetIn,
  shownFrac,
  toCompaction,
} from './format'
import { lastCostOf, warmAverageOf } from './insights'
import type { CostEntry, Trails } from './insights'
import type { BandSnapshot, LimitUse } from './snapshot'
import { boardWords } from './board-words'
import type { Board } from './board-words'
import { chipsWords } from './chips-words'
import type { ChipsWords } from './chips-words'
import { asOfWords, cacheWords, contextWords, historyWords, limitWords, spendWords, weekWords } from './words'
import type { CacheWords, ContextWords, HistoryWords, LimitWords, SpendWords, WeekWords } from './words'

// ---- the limits -------------------------------------------------------------

/** The share of a window gone, from its length and its reset at `at`; undefined when unknown. */
const windowGone = (at: number | undefined, windowMs: number | undefined, now: number): number | undefined =>
  windowMs === undefined || at === undefined || at <= now ? undefined : clamp01(1 - (at - now) / windowMs)

/** The share of the 5-hour window gone before the average's landing is said:
 *  before it, the pace is too young to read. */
const PACE_MIN_GONE = 0.05
/** The week's: a day of it. Use comes in bursts, workdays and weekends, so
 *  an average over the first hours of a week says little of how it ends. */
const WEEK_PACE_MIN_GONE = 1 / 7

/** A window still to reset, from its `base`: where the average lands it,
 *  when it fills, its tone and the time to its reset. `etaMs` is a measured
 *  fill, set only for one that comes before the reset. */
const paceOf = (base: LimitBase, windowMs: number | undefined, etaMs: number | null, now: number): LiveLimit => {
  const { percentUsed, gone, resetsAt: at } = base
  // The average's landing, once enough of the window has gone and any of it
  // is used: with none, the window may not have begun.
  const minGone = windowMs === SEVEN_DAY_MS ? WEEK_PACE_MIN_GONE : PACE_MIN_GONE
  const average = gone === undefined || gone < minGone || percentUsed <= 0 ? undefined : percentUsed / gone
  // A measured fill lands it at 100, so the words and the amber agree. The
  // 5h's fill is claimed only by its measured pace: the window's average says
  // nothing of an hour gone idle or flat, so it stands only as a landing short.
  const projectedPct = etaMs !== null ? 100 : average === undefined || (base.key === '5h' && average >= 100) ? undefined : average
  // At the average's pace, what is left takes the time gone so far, scaled by what is left over what is used.
  const averageFill =
    projectedPct === undefined || projectedPct < 100 || gone === undefined || windowMs === undefined
      ? undefined
      : (Math.max(0, 100 - percentUsed) / percentUsed) * gone * windowMs
  const fillInMs = etaMs ?? averageFill
  return {
    ...base,
    passed: false,
    etaMs,
    tone: shownFrac(base.frac) >= WARN_AT || etaMs !== null ? 'amber' : 'calm',
    projectedPct,
    resetInMs: base.reset?.kind === 'in' && at !== undefined ? at - now : undefined,
    fillInMs,
    // A full window has nothing left to fill: it says its percent, and its reset.
    fullInMs: percentUsed >= 100 ? undefined : fillInMs,
  }
}

// ---- the readings -----------------------------------------------------------

// What the views read: each section's facts, and its words beside them.
type CacheReading = CacheFacts & CacheWords
type ContextReading = ContextFacts & ContextWords
type SpendReading = SpendFacts & SpendWords
/** A limit window as the views read it. */
export type LimitReading = LimitFacts & LimitWords

/** The conversation's trails, their words, and the series a chart draws. */
type HistoryReading = Trails &
  HistoryWords &
  Readonly<{
    /** No cost yet this conversation. */
    empty: boolean
    /** Each message's cost, oldest first. */
    costValues: readonly number[]
    /** Which of them were re-warms. */
    reWarms: readonly boolean[]
    /** Their mean, re-warms left out: what a chart scales and rules its bars by. */
    warmAvgUsd: number | undefined
    /** The top of the cost scale: twice the warm average, or the largest warm
     *  cost if that is more; with no warm cost the largest cost; 1 when there
     *  is none to scale by. Never 0. */
    beatsTop: number
  }>

/** The week's cells, and as drawn, with their words. */
type WeekReading = DrawnWeek & WeekWords

export type Readings = Readonly<{
  frame: Frame
  cache: CacheReading
  spend: SpendReading
  context: ContextReading
  fiveHour: LimitReading | undefined
  sevenDay: LimitReading | undefined
  /** 5h, 7d, then every other window the engine reports. */
  limits: readonly LimitReading[]
  /** That they are as of the last reply, and how long ago past a few minutes;
   *  undefined while none is still to reset. */
  asOf: string | undefined
  worstLimit: LimitReading | undefined
  workspace: BandSnapshot['workspace']
  /** Built the first time a view calls it, then kept, so chips never pays for it. */
  history: () => HistoryReading
  /** The week's day and hour cells; built, like history, the first time a view calls it. */
  week: () => WeekReading
  /** The departures board's rows, in its capitals; built, like history, the first time a view calls it. */
  board: () => Board
  chips: ChipsWords
}>

/** The context's fill, measured toward auto-compaction when it is known:
 *  full means compacting, and no tick is needed to show where. Else it is
 *  measured against the model window. */
const contextFacts = (snap: BandSnapshot): ContextFacts => {
  const ctx = snap.context
  const used = contextUsed(ctx) ?? 0
  const pressure = contextPressure(used, ctx.window, ctx.compactAt)
  const frac = clamp01(pressure.frac)
  // Classed by the percent shown, so a figure at `80%` is amber whatever its decimals.
  const amber = shownFrac(frac) >= (pressure.levels[0] ?? 1)
  const fill: ContextFill = {
    known: ctx.percent !== undefined || ctx.tokens !== undefined,
    used,
    frac,
    pct: fmtPct(frac),
    tone: amber ? 'amber' : 'calm',
    tokens: ctx.tokens,
    autoCompactOff: ctx.autoCompactOff,
    window: ctx.window,
  }
  return ctx.compactAt === undefined
    ? { ...fill, compactAt: undefined, toCompact: undefined, nearCompact: false }
    : { ...fill, compactAt: ctx.compactAt, toCompact: toCompaction(used, ctx.compactAt), nearCompact: amber }
}

/** The session's cost and its tokens: sent, back, read from cache, and their total. */
const spendFacts = (snap: BandSnapshot): SpendFacts => {
  const t = snap.cache.tokens
  return { totalUsd: snap.costUsd, lastTurnUsd: lastCostOf(snap.history), sent: t.sent, back: t.back, cached: t.cached, total: t.sent + t.back + t.cached }
}

/** The facts of each window the engine reports: 5h, 7d, then the rest. */
const limitFacts = (snap: BandSnapshot): LimitFacts[] => {
  const one = (name: string, key: LimitKey, use: LimitUse, windowMs: number | undefined, etaMs: number | null): LimitFacts => {
    const at = use.resetsAt
    const reset = resetIn(at, snap.now)
    const frac = clamp01(use.percentUsed / 100)
    const gone = windowGone(at, windowMs, snap.now)
    const base: LimitBase = { name, key, reset, resetsAt: at, gone, percentUsed: use.percentUsed, frac, value: fmtPercent(use.percentUsed) }
    // Passed, the window that reset has no pace, reset or fill to say.
    if (reset?.kind === 'passed')
      return { ...base, passed: true, tone: 'calm', etaMs: null, projectedPct: undefined, resetInMs: undefined, fillInMs: undefined, fullInMs: undefined }
    return paceOf(base, windowMs, etaMs, snap.now)
  }
  return [
    ...(snap.fiveHour ? [one('5h', '5h', snap.fiveHour, FIVE_HOUR_MS, snap.fiveHour.etaMs)] : []),
    ...(snap.sevenDay ? [one('7d', '7d', snap.sevenDay, SEVEN_DAY_MS, null)] : []),
    ...snap.otherLimits.map(limit => one(limit.kind === 'spend_limit' ? 'spend' : limit.kind.replace(/_/g, ' '), 'other', limit, undefined, null)),
  ]
}

/** The conversation's trails with their words and the series a chart draws. */
const historyReading = (trails: Trails, context: ContextFacts, spend: Readonly<{ totalUsd: number }>): HistoryReading => {
  const warmAvgUsd = warmAverageOf(trails.costs)
  return {
    ...trails,
    ...historyWords(trails, context, spend, warmAvgUsd),
    empty: trails.costs.length === 0,
    costValues: trails.costs.map(e => e.usd),
    reWarms: trails.costs.map(e => e.reWarm),
    warmAvgUsd,
    beatsTop: beatsTopOf(trails.costs, warmAvgUsd),
  }
}

/** A chart's cost scale: the larger of twice the warm average `avg` and the
 *  largest warm cost, else the largest cost; 1 where that would be 0. */
const beatsTopOf = (costs: readonly CostEntry[], avg: number | undefined): number => {
  const top = Math.max(...(avg === undefined ? costs : costs.filter(e => !e.reWarm)).map(e => e.usd), 0)
  const scale = avg === undefined ? top : Math.max(2 * avg, top)
  return scale > 0 ? scale : 1
}

/** A window as the calendar reads it: its reset and its fill as times. A
 *  reset passed is one the calendar draws nothing for. */
const windowOf = (l: LimitReading | undefined, now: number): WindowNow | undefined =>
  l === undefined
    ? undefined
    : {
        percentUsed: l.percentUsed,
        projectedPct: l.projectedPct,
        resetsAt: l.resetsAt,
        // The fill the limit's own words say, so the week's cells name the same one.
        fullAt: l.fullInMs === undefined ? undefined : now + l.fullInMs,
        gone: l.gone,
      }

/** The week's cells from the limit samples, as drawn, with their words.
 *  With the zone unknown, the cells are named in UTC. */
const weekReading = (snap: BandSnapshot, sevenDay: LimitReading | undefined, fiveHour: LimitReading | undefined): WeekReading => {
  const week = drawnWeekOf({ samples: snap.samples, seven: windowOf(sevenDay, snap.now), five: windowOf(fiveHour, snap.now), now: snap.now, zone: snap.zone ?? fixedZone(0) })
  return { ...week, ...weekWords(week, fiveHour) }
}

/** A section's facts with its words beside them: what a view reads of it. */
const withWords = <F, W>(facts: F, words: (f: F) => W): F & W => ({ ...facts, ...words(facts) })

/** Everything a view reads, built once per draw: the frame, each section's
 *  facts and words, and chips' own inputs. */
export const readingsOf = (snap: BandSnapshot): Readings => {
  const frame: Frame = {
    expanded: snap.expanded,
    maxRows: snap.maxRows,
    now: snap.now,
    isWorking: snap.isWorking,
    zone: snap.zone,
  }
  const cache: CacheReading = withWords(cacheFactsOf(snap.cache, snap.isWorking), cacheWords)
  const spend: SpendReading = withWords(spendFacts(snap), spendWords)
  const context: ContextReading = withWords(contextFacts(snap), contextWords)
  const limits = limitFacts(snap).map((f): LimitReading => withWords(f, l => limitWords(l, frame)))
  // The headline is the window closest to its limit.
  const worstLimit = limits
    .filter(l => !l.passed)
    .reduce<LimitReading | undefined>((top, l) => (top === undefined || l.percentUsed > top.percentUsed ? l : top), undefined)
  // One reading of the account's limits, so one age for them all.
  const asOf = limits.some(l => !l.passed) ? asOfWords(snap.limitsAt === undefined ? undefined : Math.max(0, snap.now - snap.limitsAt)) : undefined
  const fiveHour = limits.find(l => l.key === '5h')
  const sevenDay = limits.find(l => l.key === '7d')
  let history: HistoryReading | undefined
  let week: WeekReading | undefined
  let board: Board | undefined
  return {
    frame,
    cache,
    spend,
    context,
    fiveHour,
    sevenDay,
    limits,
    asOf,
    worstLimit,
    workspace: snap.workspace,
    // Plain functions, not getters: reading a property never runs code.
    history: () => (history ??= historyReading(snap.history, context, spend)),
    week: () => (week ??= weekReading(snap, sevenDay, fiveHour)),
    board: () => (board ??= boardWords({ frame, cache, spend, context, limits })),
    chips: chipsWords({ frame, cache, spend, context, limits, asOf }),
  }
}
