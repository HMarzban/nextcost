// Chips' words: what chips' row says beyond the readings' own, the cache
// pill's table, the hover cards and the context's amount. Pure, built from
// the readings' facts and words with the phrasebook's primitives.

import type { CacheFacts } from './cache'
import type { ContextFacts, Frame, LimitFacts } from './facts'
import { clamp01, fmtCountdown, fmtTokens, severityMark } from './format'
import { IDLE_COMPACT_AT, MOOD_ALT, UNKNOWN, compactsIn, goneShort, paceText, wakeSaid } from './words'
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
  // The rebuild's price after its tokens, where a rate is known.
  const priced = f.reWarmUsd === null ? '' : ` (${f.estimate})`
  const battery = f.charge <= 0 ? 'cache battery empty' : `cache battery ${Math.round(clamp01(f.charge) * 100)}% left`
  // A turn the user didn't type restarted the countdown: who did, said after.
  const woken = (hover: string): string => (f.wake === undefined ? hover : `${hover}; ${wakeSaid(f.wake, f.mood)}`)
  const warmHover = woken(
    f.idleCompactSoon ? `${left} left; may be compacted ${IDLE_COMPACT_AT}` : `${left} left; warm cache bills input at ${readPct}, expires ${f.ttl} after a request`,
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
        hover: warmHover,
        alt: battery,
      }
    case 'compacted':
      return {
        // A summary to write, not a cache lost: as calm as cold.
        pill: short => (short ? goneShort('compacted', f.estimate) : `cache compacted · next ${f.estimate}`),
        hover: f.window === 0
          ? 'Compacted: next message writes the summary'
          : `${f.compactedIdle ? 'Compacted while idle' : 'Compacted'}: next message writes the ${fmtTokens(f.window)} summary${priced}`,
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
        hover: woken(`Cold: next message rebuilds ${fmtTokens(f.window)} tokens${priced}`),
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

/** The chips a limit window has, and the title its hover card names it by. */
const CHIP_TITLES = { '5h': '5-hour limit', '7d': 'Weekly limit' } as const

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
   *  description. Undefined while the engine reports no such window. */
  limitHover: Readonly<Record<keyof typeof CHIP_TITLES, string | undefined>>
}>

/** Chips' words, from the facts and the words the other layouts share. */
export const chipsWords = (r: Readonly<{ frame: Frame; cache: CacheFacts; spend: SpendWords; context: ContextFacts; limits: readonly LimitFacts[] }>): ChipsWords => {
  const { spend, context: x } = r
  const limitHover = (key: keyof typeof CHIP_TITLES): string | undefined => {
    const l = r.limits.find(w => w.key === key)
    if (l === undefined) return undefined
    const title = CHIP_TITLES[key]
    if (l.passed) return `${title} has reset; it updates after your next message`
    const about = l.reset?.kind === 'in' ? `Resets in ${l.reset.text}; ${title.toLowerCase()}, all your Claude use` : `Your ${title.toLowerCase()}, across all your Claude use`
    // A fill is the last half hour's pace drawn straight on: a burst of work
    // fills the window sooner, so the hover says what it rests on.
    return l.etaMs === null ? about : `${about}; ${paceText(l)} at the current pace`
  }
  return {
    cache: cacheCopy(r.cache, r.frame),
    costHover: spend.lastText === undefined ? `${spend.totalText} so far this session` : `${spend.lastText} spent during your last message, subagents included`,
    tokensHover: spend.split.map(s => `${s.label} ${s.text}`).join(' · '),
    contextPill: long => {
      const amount =
        x.compactAt !== undefined ? (long ? `${x.pct} full` : x.pct) : !long || x.tokens === undefined ? x.pct : `${fmtTokens(x.tokens)} / ${fmtTokens(x.window)}`
      const mark = x.compactAt === undefined ? severityMark(x.frac) : ''
      return `${amount}${mark}${x.nearCompact ? ` · ${compactsIn(x.toCompact)}` : ''}`
    },
    contextHover:
      x.compactAt === undefined
        ? `${fmtTokens(x.used)} of ${fmtTokens(x.window)} (${x.pct}); older turns get summarized near full`
        : `${fmtTokens(x.used)} of ${fmtTokens(x.compactAt)} (${x.pct}); auto-${compactsIn(x.toCompact)}`,
    limitHover: { '5h': limitHover('5h'), '7d': limitHover('7d') },
  }
}
