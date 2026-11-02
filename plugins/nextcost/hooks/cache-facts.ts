// What the prompt cache's view means for the band: its mood, its charge, its
// last call. Pure, from what the model in cache.ts shows.

import { IDLE_COMPACT_MS, TTL_MS } from './cache'
import type { CacheView } from './cache'
import type { Tone } from './facts'
import { LAST_CALL_MS, SOON_MS, fmtEstimate, fmtTokens } from './format'

/** Unmeasured: loaded mid-conversation, before its next reply. Compacted:
 *  the conversation was compacted, so the next message writes the summary.
 *  Uncached: the last response read and wrote no cache, so none exists.
 *  Switched: /model named another model, so the next message rebuilds. */
type CacheMood = 'unmeasured' | 'warming' | 'warm' | 'expiring' | 'cold' | 'compacted' | 'uncached' | 'switched'

/** The cache as the band reads it: its view, and what that means. */
export type CacheFacts = CacheView &
  Readonly<{
    mood: CacheMood
    tone: Tone
    /** The battery's charge: the share of the lifetime left, full while
     *  Claude works, empty when there is nothing to count. */
    charge: number
    /** What the next message costs to rebuild the cache: dollars when a rate
     *  is known, else the tokens it writes. */
    estimate: string
    /** A reply seen, or a resumed conversation's tokens read off its transcript. */
    measured: boolean
    /** Measured, or recalled from the session's last reply: time and price
     *  known. Not caching, there is neither. */
    known: boolean
    /** No time to count, neither seen nor recalled: unmeasured, warming, or
     *  not caching. */
    untimed: boolean
    /** The hit ratio, once measured. */
    hitFrac: number | undefined
    /** Time to cold while it counts down: expiring, or warm while Claude isn't working. */
    coldInMs: number | undefined
    /** Departures' calm last call, LAST CALL at its clock: under LAST_CALL_MS
     *  to cold, or for the 5-minute cache its last minute. The board draws the
     *  last minute by its amber tone first, as every layout does. */
    lastCall: boolean
    /** Counting down on the hour's cache before the ~54-minute mark, where
     *  Claude Code may compact the conversation instead of letting it go cold. */
    idleCompactSoon: boolean
  }>

const moodOf = (c: CacheView): CacheMood =>
  c.compacted
    ? 'compacted'
    : c.requests === 0 && !c.recalled
      ? c.fresh
        ? 'warming'
        : 'unmeasured'
      : c.notCaching
        ? 'uncached'
        : c.modelChanged
          ? 'switched'
          : c.leftMs <= 0
            ? 'cold'
            : c.leftMs <= SOON_MS
              ? 'expiring'
              : 'warm'

/** What the cache's view means while Claude is working, or isn't. */
export const cacheFactsOf = (c: CacheView, isWorking: boolean): CacheFacts => {
  const mood = moodOf(c)
  const measured = c.requests > 0 || c.recovered
  // Mid-turn every step restarts the TTL, so a countdown would only bounce.
  const counting = mood === 'expiring' || (mood === 'warm' && !isWorking)
  const untimed = mood === 'unmeasured' || mood === 'warming' || mood === 'uncached'
  const timeless = untimed || mood === 'cold' || mood === 'compacted' || mood === 'switched'
  return {
    ...c,
    mood,
    tone: mood === 'expiring' ? 'amber' : 'calm',
    charge: timeless ? 0 : mood === 'warm' && isWorking ? 1 : c.leftMs / TTL_MS[c.ttl],
    // After a switch the rate is the old model's, so the tokens alone. After a
    // compaction of no size told, only that it writes the summary.
    estimate: mood === 'compacted' && c.window === 0 ? 'summary' : c.window === 0 && c.reWarmUsd === null ? 'unknown' : c.reWarmUsd !== null && mood !== 'switched' ? fmtEstimate(c.reWarmUsd) : `${fmtTokens(c.window)} tokens`,
    measured,
    known: mood !== 'uncached' && (measured || c.recalled),
    untimed,
    hitFrac: measured && c.hitRatio !== null ? c.hitRatio : undefined,
    coldInMs: counting ? c.leftMs : undefined,
    // A 5-minute cache is always under ten minutes from cold, so its last
    // call is its last minute, when chips turns amber too.
    lastCall: counting && (c.ttl === '5m' ? mood === 'expiring' : c.leftMs < LAST_CALL_MS),
    idleCompactSoon: counting && c.idleCompacts && c.ttl === '1h' && c.leftMs > TTL_MS['1h'] - IDLE_COMPACT_MS,
  }
}
