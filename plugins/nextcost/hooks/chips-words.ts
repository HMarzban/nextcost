// Chips' words: what chips' row says beyond the readings' own, the cache
// pill's table, the hover cards and the context's amount. Pure, built from
// the readings' facts and words with the phrasebook's primitives.

import type { CacheFacts } from './cache'
import type { ContextFacts, Frame, LimitFacts } from './facts'
import { clamp01, fmtCountdown, fmtTokens, severityMark } from './format'
import { IDLE_COMPACT_AT, LIMIT_TITLES, MOOD_ALT, UNKNOWN, SINCE_LOADED, compactedWords, compactsIn, countedSinceLoad, goneShort, lifetimeAssumed, paceText, saidJoined, wakeSaid } from './words'
import type { SpendWords } from './words'

/** Every word chips' row says about the cache, for one mood: the pill, its
 *  hover and the battery's name. */
type CacheCopy = Readonly<{
  pill: (short: boolean) => string
  hover: string
  alt: string
}>

const cacheCopy = (f: CacheFacts, frame: Frame): CacheCopy => {
  // What a warm read costs against input on the model in force.
  const readPct = `${+(f.readShare * 100).toFixed(1)}%`
  const left = fmtCountdown(f.leftMs)
  // The price is the cache rewrite alone: the message's own input and the
  // reply come on top. A hover is one line, so each keeps its price and its
  // qualifiers near its front, where a cut row leaves them.
  const rewrites = (what: string): string => (f.reWarmUsd === null ? `next message rewrites ${what}` : `${f.estimate} rewrites ${what}`)
  const battery = f.charge <= 0 ? 'cache battery empty' : `cache battery ${Math.round(clamp01(f.charge) * 100)}% left`
  // A turn the user didn't type restarted the countdown: who did, said after.
  const woken = (hover: string): string => (f.wake === undefined ? hover : `${hover}; ${wakeSaid(f.wake, f.mood)}`)
  // A guessed hour is said right after the countdown, where a cut hover keeps it.
  const assumed = lifetimeAssumed(f)
  const warmHover = woken(
    f.idleCompactSoon
      ? `${left} left${assumed ? ' (assumed)' : ''}; may be compacted ${IDLE_COMPACT_AT}`
      : assumed
        ? `${left} left (assumed ${f.ttl} lifetime); warm cache bills input at ${readPct}`
        : `${left} left; warm cache bills input at ${readPct}, expires ${f.ttl} after a request`,
  )
  switch (f.mood) {
    case 'unmeasured':
      return {
        pill: () => `cache ${UNKNOWN}`,
        hover: "Not measured since the band loaded; the countdown starts with Claude's next reply",
        alt: MOOD_ALT.unmeasured,
      }
    case 'warming':
      return {
        pill: () => 'cache warming',
        hover: `Your first message builds the cache; after that it bills input at ${readPct}`,
        alt: MOOD_ALT.warming,
      }
    case 'expiring':
      return {
        pill: short => (short ? `${left} ${f.estimate}` : `${left} left · re-warm ${f.estimate}`),
        hover: woken(`${left} left${assumed ? ' (assumed)' : ''}; if cold, ${rewrites('the cache')}, plus your reply`),
        alt: battery,
      }
    case 'compacted':
      return {
        // A summary to write, not a cache lost: as calm as cold.
        pill: short => (short ? goneShort('compacted', f.estimate) : `cache compacted · next ${f.estimate}`),
        hover: f.window === 0
          ? 'Compacted: next message writes the summary, plus your reply'
          : `${compactedWords(f.compactedIdle)}: ${rewrites(`the ${fmtTokens(f.window)} summary`)}, plus your reply`,
        alt: MOOD_ALT.compacted,
      }
    case 'uncached':
      return {
        pill: short => (short ? 'no cache' : 'not caching'),
        hover: 'The last reply read and wrote no cache, so all input bills in full',
        alt: MOOD_ALT.uncached,
      }
    case 'switched':
      return {
        pill: short => (short ? `new model ${f.estimate}` : `model changed · next ${f.estimate}`),
        hover: `Model changed: each model has its own cache, so the next message rebuilds ${f.estimate}`,
        alt: MOOD_ALT.switched,
      }
    case 'cold':
      return {
        // Cold is a price, not an error: neutral, no hue, no alarm.
        pill: short => (short ? goneShort('cold', f.estimate) : `cache cold · next message ${f.estimate}`),
        hover: woken(`Cold: ${rewrites(`${fmtTokens(f.window)} tokens to the cache`)}, plus your reply`),
        alt: battery,
      }
    case 'warm':
      return {
        pill: () => (frame.isWorking ? 'cache warm' : `cache ${left}`),
        hover: warmHover,
        alt: battery,
      }
  }
}

/** Every word chips' row says beyond the readings' own: the cache pill's
 *  table, the hover cards, and the context's amount. */
export type ChipsWords = Readonly<{
  cache: CacheCopy
  /** The last message's cost, subagents included, else the session's so far. */
  costHover: string
  /** The tokens by kind: `input 41k · output 12k · cache reads 155k`. */
  tokensHover: string
  /** The context's amount, its mark, and near compaction the room before it:
   *  `87% full · compacts in ~14k`, or without compaction `76k / 200k`.
   *  `long` while the row keeps its long wording. */
  contextPill: (long: boolean) => string
  /** How much of the window is used, and where it compacts. */
  contextHover: string
  /** A limit chip's hover card: once passed, that it has reset; else its
   *  reset first, the fact the chip had, so a short row's cut only takes the
   *  description, and last that it is as of the last reply. Undefined while
   *  the engine reports no such window. */
  limitHover: Readonly<Record<keyof typeof LIMIT_TITLES, string | undefined>>
}>

/** Chips' words, from the facts and the words the other layouts share. */
export const chipsWords = (r: Readonly<{ frame: Frame; cache: CacheFacts; spend: SpendWords; context: ContextFacts; limits: readonly LimitFacts[]; asOf: string | undefined }>): ChipsWords => {
  const { spend, context: x } = r
  const limitHover = (key: keyof typeof LIMIT_TITLES): string | undefined => {
    const l = r.limits.find(w => w.key === key)
    if (l === undefined) return undefined
    const title = LIMIT_TITLES[key]
    if (l.passed) return `${title.charAt(0).toUpperCase()}${title.slice(1)} has reset; it updates after your next message`
    const about = l.reset?.kind === 'in' ? `Resets in ${l.reset.text}; ${title}, all your Claude use` : `Your ${title}, across all your Claude use`
    // A fill is the last half hour's pace drawn straight on: a burst of work
    // fills the window sooner, so the hover says what it rests on.
    const paced = l.etaMs === null ? about : `${about}; ${paceText(l)} at the current pace`
    // Last, so a short row's cut takes it before the reset or the pace.
    return saidJoined([paced, r.asOf], '; ')
  }
  return {
    cache: cacheCopy(r.cache, r.frame),
    costHover: spend.lastText === undefined ? `${spend.totalText} so far this session` : `${spend.lastText} spent during your last message, subagents included`,
    tokensHover: saidJoined([...spend.split.map(s => `${s.label} ${s.text}`), countedSinceLoad(r.cache) ? SINCE_LOADED : undefined], ' · '),
    contextPill: long => {
      const amount =
        x.compactAt !== undefined ? (long ? `${x.pct} full` : x.pct) : !long || x.tokens === undefined ? x.pct : `${fmtTokens(x.tokens)} / ${fmtTokens(x.window)}`
      const mark = x.compactAt === undefined ? severityMark(x.frac) : ''
      return `${amount}${mark}${x.nearCompact ? ` · ${compactsIn(x.toCompact)}` : ''}`
    },
    contextHover:
      x.compactAt === undefined
        ? `${fmtTokens(x.used)} of ${fmtTokens(x.window)} (${x.pct}); older turns get summarized near full`
        : `${fmtTokens(x.used)} of ${fmtTokens(x.compactAt)} (${x.pct}) toward compaction; window ${fmtTokens(x.window)}; ${compactsIn(x.toCompact)}`,
    limitHover: { '5h': limitHover('5h'), '7d': limitHover('7d') },
  }
}
