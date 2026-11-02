// What the band can tell you that the engine's own figures don't: what your
// last message cost, when your pace fills the 5-hour limit, and the trails
// pulse draws: each message's cost, and the context. One set per session,
// made at session.start beside the cache model.

import { MINUTE_MS, sameReset } from './format'

/** The pace is measured over the last half hour's points: across ten
 *  minutes at least, and a rise of 2 points, the newest no staler than a
 *  quarter of an hour. */
const LOOKBACK_MS = 30 * MINUTE_MS
const MIN_SPAN_MS = 10 * MINUTE_MS
const MIN_RISE = 2
const STALE_MS = 15 * MINUTE_MS

/** The newest messages' costs the cost trail keeps. */
export const COST_TRAIL = 24
/** The newest turns' context the context trail keeps. */
export const CONTEXT_TRAIL = 40

/** What a main-loop message cost, and whether its turn rebuilt the cache. */
export type CostEntry = Readonly<{ usd: number; reWarm: boolean }>
/** The 5-hour window's use at one moment. */
type PacePoint = Readonly<{ at: number; pct: number }>
export type Trails = Readonly<{ costs: readonly CostEntry[]; context: readonly number[] }>

/** The mean cost of the messages that found the cache warm: a re-warm's
 *  rebuild left out. Undefined while there is none. */
export const warmAverageOf = (costs: readonly CostEntry[]): number | undefined => {
  const warm = costs.filter(e => !e.reWarm)
  return warm.length === 0 ? undefined : warm.reduce((sum, e) => sum + e.usd, 0) / warm.length
}

/** What the last message cost: the trail's newest cost, the one fact every
 *  layout reads; null before the conversation's first. A turn that cost
 *  nothing is never on the trail, so the last that did still stands. */
export const lastCostOf = (t: Trails): number | null => t.costs.at(-1)?.usd ?? null

/** One session's insights' facts, plain data, for a reload to carry on from. */
export type InsightState = {
  /** The ledger as each open main-loop turn started, by turn id. */
  turnStartCost: Record<string, number>
  /** The 5-hour window's use as measured, oldest first, within the lookback. */
  points: readonly PacePoint[]
  /** When the 5-hour window resets, epoch ms. */
  resetsAt: number | undefined
  /** Each trail, replaced on every push and never changed in place, so a
   *  snapshot that holds one holds it as it stood. */
  costs: readonly CostEntry[]
  context: readonly number[]
}

/** One session's insights. Each entry is a hook's facts, in its shape. */
export type Insights = Readonly<{
  /** Everything they hold, for the next insights after a reload to start from. */
  kept: () => InsightState
  /** turn.start of a main-loop turn: the ledger as it starts. */
  noteTurnStart: (turnId: string, costUsd: number | undefined) => void
  /** turn.complete of a main-loop turn: everything the ledger rose by during
   *  it, its tool calls and subagents and any background work that ran
   *  meanwhile; null unless known and above zero. */
  noteTurnEnd: (turnId: string, costUsd: number | undefined) => number | null
  /** What a main-loop message cost, and whether its turn rebuilt the cache. */
  pushCost: (usd: number, reWarm: boolean) => void
  /** The context's tokens at a turn's end. */
  pushContext: (tokens: number) => void
  /** session.measure: the 5-hour window's use at `now`, and its reset. */
  noteFiveHour: (now: number, percentUsed: number, resetsAt: number | undefined) => void
  /** Time until your pace fills the 5-hour window, or null while the
   *  evidence is thin, stale, or the window resets first. */
  fiveHourEtaMs: (now: number) => number | null
  /** session.end: a new conversation (/clear, resume). Its turns and their
   *  trails start over, but the 5-hour window is account-wide, so its pace
   *  carries on. */
  conversationEnded: () => void
  /** The trails as they stand, for a snapshot to hold. */
  trails: () => Trails
}>

/** A session's insights: before anything is known of it, or carrying on from
 *  what the insights before a reload `kept`. */
export const newInsights = (kept?: InsightState): Insights => {
  const s: InsightState = { turnStartCost: {}, points: [], resetsAt: undefined, costs: [], context: [], ...kept }
  return {
    kept: () => ({ ...s }),
    noteTurnStart: (turnId, costUsd) => {
      if (costUsd !== undefined) s.turnStartCost = { ...s.turnStartCost, [turnId]: costUsd }
    },
    noteTurnEnd: (turnId, costUsd) => {
      const { [turnId]: start, ...open } = s.turnStartCost
      s.turnStartCost = open
      if (start === undefined || costUsd === undefined) return null
      const spent = costUsd - start
      return spent > 0 ? spent : null
    },
    pushCost: (usd, reWarm) => {
      s.costs = [...s.costs, { usd, reWarm }].slice(-COST_TRAIL)
    },
    pushContext: tokens => {
      s.context = [...s.context, tokens].slice(-CONTEXT_TRAIL)
    },
    noteFiveHour: (now, percentUsed, resetsAt) => {
      const last = s.points.at(-1)
      const kept = !sameReset(resetsAt, s.resetsAt) || (last !== undefined && percentUsed < last.pct) ? [] : s.points
      s.resetsAt = resetsAt
      s.points = [...kept, { at: now, pct: percentUsed }].filter(p => now - p.at <= LOOKBACK_MS)
    },
    fiveHourEtaMs: now => {
      const first = s.points[0]
      const last = s.points.at(-1)
      if (first === undefined || last === undefined || last.pct >= 100) return null
      const span = last.at - first.at
      const rise = last.pct - first.pct
      if (span < MIN_SPAN_MS || rise < MIN_RISE || now - last.at > STALE_MS) return null
      const tFull = last.at + ((100 - last.pct) * span) / rise
      if (s.resetsAt !== undefined && tFull >= s.resetsAt) return null
      return Math.max(0, tFull - now)
    },
    conversationEnded: () => {
      s.turnStartCost = {}
      s.costs = []
      s.context = []
    },
    trails: () => ({ costs: s.costs, context: s.context }),
  }
}
