// Chips' words: what chips' row says beyond the readings' own, the cache
// pill's table, the hover cards and the context's amount. Pure, built from
// the readings as the board's words are, with the phrasebook's primitives.

import type { CacheFacts } from './cache-facts'
import type { ContextFacts, LimitFacts } from './facts'
import { clamp01, fmtCountdown, fmtTokens } from './format'
import { IDLE_COMPACT_AT, LIMIT_TITLES, MOOD_ALT, SINCE_LOADED, compactedWords, compactsIn, saidJoined } from './words'
import type { CacheWords, ContextWords, LimitWords, SpendWords } from './words'

/** What chips' words are built from: the readings. */
type ChipsFacts = Readonly<{
  cache: CacheFacts & CacheWords
  spend: SpendWords
  context: ContextFacts & ContextWords
  limits: readonly (LimitFacts & LimitWords)[]
  asOf: string | undefined
}>

/** Every word chips' row says about the cache, for one mood: the pill, its
 *  hover and the battery's name. */
type CacheCopy = Readonly<{
  pill: (short: boolean) => string
  /** Whether the pill's own words name the cache: where they don't, `◷` is
   *  all that does, and the ascii tier, which drops it, says the word. */
  named: (short: boolean) => boolean
  hover: string
  alt: string
}>

/** The cache's pill and hover by mood. Where a pill reads as the other
 *  layouts' figure it is theirs; a countdown and cold's long form are its own. */
const moodCopy = (c: ChipsFacts['cache']): Omit<CacheCopy, 'alt'> => {
  // What a warm read costs against input on the model in force.
  const readPct = `${+(c.readShare * 100).toFixed(1)}%`
  const left = fmtCountdown(c.leftMs)
  // The price is the cache rewrite alone: the message's own input and the
  // reply come on top. A hover is one line, so each keeps its price and its
  // qualifiers near its front, where a cut row leaves them.
  const rewrites = (what: string): string => (c.reWarmUsd === null ? `next message rewrites ${what}` : `${c.estimate} rewrites ${what}`)
  // A turn the user didn't type restarted the countdown: who did, said after.
  const woken = (hover: string): string => (c.woken === undefined ? hover : `${hover}; ${c.woken.said}`)
  // A guessed hour is said right after the countdown, where a cut hover keeps it.
  const assumed = c.lifetimeAssumed
  const figure = (cut: boolean): string => (cut ? c.figureShort : c.figure)
  switch (c.mood) {
    case 'unmeasured':
      return {
        pill: () => `cache ${c.figure}`,
        named: () => true,
        hover: "Not measured since the band loaded; the countdown starts with Claude's next reply",
      }
    case 'warming':
      return {
        pill: () => `cache ${c.figure}`,
        named: () => true,
        hover: `Your first message builds the cache; after that it bills input at ${readPct}`,
      }
    case 'expiring':
      return {
        pill: cut => (cut ? `${left} ${c.estimate}` : `${left} left · re-warm ${c.estimate}`),
        named: () => false,
        hover: woken(`${left} left${assumed ? ' (assumed)' : ''}; if cold, ${rewrites('the cache')}, plus your reply`),
      }
    case 'compacted':
      return {
        // A summary to write, not a cache lost: as calm as cold.
        pill: cut => (cut ? c.figureShort : `cache ${c.figure}`),
        named: cut => !cut,
        hover: c.window === 0
          ? 'Compacted: next message writes the summary, plus your reply'
          : `${compactedWords(c.compactedIdle)}: ${rewrites(`the ${fmtTokens(c.window)} summary`)}, plus your reply`,
      }
    case 'uncached':
      return {
        pill: figure,
        named: cut => cut,
        hover: 'The last reply read and wrote no cache, so all input bills in full',
      }
    case 'switched':
      return {
        pill: figure,
        named: () => false,
        hover: `Model changed: each model has its own cache, so the next message rebuilds ${c.estimate}`,
      }
    case 'cold':
      return {
        // Cold is a price, not an error: neutral, no hue, no alarm.
        pill: cut => (cut ? c.figureShort : `cache cold · next message ${c.estimate}`),
        named: cut => !cut,
        hover: woken(`Cold: ${rewrites(`${fmtTokens(c.window)} tokens to the cache`)}, plus your reply`),
      }
    case 'warm':
      return {
        pill: () => (c.coldInMs === undefined ? 'cache warm' : `cache ${left}`),
        named: () => true,
        hover: woken(
          c.idleCompactSoon
            ? `${left} left${assumed ? ' (assumed)' : ''}; may be compacted ${IDLE_COMPACT_AT}`
            : assumed
              ? `${left} left (assumed ${c.ttl} lifetime); warm cache bills input at ${readPct}`
              : `${left} left; warm cache bills input at ${readPct}, expires ${c.ttl} after a request`,
        ),
      }
  }
}

/** The moods the battery has a charge to name: elsewhere, the mood's own. */
const batteried = (mood: CacheFacts['mood']): boolean => mood === 'warm' || mood === 'expiring' || mood === 'cold'

const cacheCopy = (c: ChipsFacts['cache']): CacheCopy => ({
  ...moodCopy(c),
  alt: !batteried(c.mood) ? MOOD_ALT[c.mood] : c.charge <= 0 ? 'cache battery empty' : `cache battery ${Math.round(clamp01(c.charge) * 100)}% left`,
})

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

/** Chips' words, from the readings. */
export const chipsWords = (r: ChipsFacts): ChipsWords => {
  const { spend, context: x } = r
  const limitHover = (key: keyof typeof LIMIT_TITLES): string | undefined => {
    const l = r.limits.find(w => w.key === key)
    if (l === undefined) return undefined
    const title = LIMIT_TITLES[key]
    if (l.passed) return `${title.charAt(0).toUpperCase()}${title.slice(1)} has reset; it updates after your next message`
    const about = l.reset?.kind === 'in' ? `Resets in ${l.reset.text}; ${title}, all your Claude use` : `Your ${title}, across all your Claude use`
    // A fill is the last half hour's pace drawn straight on: a burst of work
    // fills the window sooner, so the hover says what it rests on.
    const paced = l.etaMs === null ? about : `${about}; ${l.pace} at the current pace`
    // Last, so a short row's cut takes it before the reset or the pace.
    return saidJoined([paced, r.asOf], '; ')
  }
  return {
    cache: cacheCopy(r.cache),
    costHover: spend.lastText === undefined ? `${spend.totalText} so far this session` : `${spend.lastText} spent during your last message, subagents included`,
    tokensHover: saidJoined([...spend.split.map(s => `${s.label} ${s.text}`), r.cache.sinceLoaded ? SINCE_LOADED : undefined], ' · '),
    contextPill: long => {
      const amount =
        x.compactAt !== undefined ? (long ? `${x.pct} full` : x.pct) : !long || x.tokens === undefined ? x.pct : `${fmtTokens(x.tokens)} / ${x.windowText}`
      return `${amount}${x.fillMark}${x.nearCompact ? ` · ${compactsIn(x.toCompact)}` : ''}`
    },
    contextHover:
      x.compactAt === undefined
        ? `${fmtTokens(x.used)} of ${x.windowText} (${x.pct}); older turns get summarized near full`
        : `${fmtTokens(x.used)} of ${x.compactsAtText} (${x.pct}) toward compaction; window ${x.windowText}; ${compactsIn(x.toCompact)}`,
    limitHover: { '5h': limitHover('5h'), '7d': limitHover('7d') },
  }
}
