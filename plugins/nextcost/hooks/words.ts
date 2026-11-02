// The phrasebook: every phrase a layout draws, built from the facts the
// readings hold. Pure, and the one place a layout's words are written, so
// amber, pace, resets, empty states and alt text read the same everywhere.
// The departures board's words are board-words.ts's, and chips' own
// chips-words.ts's, built from these.

import type { DrawnWeek, SliceMark } from './calendar'
import {
  fillTime,
  fmtAgo,
  fmtCost,
  fmtCountdown,
  fmtDay,
  fmtDayClock,
  fmtEstimate,
  fmtEta,
  fmtEtaSpoken,
  fmtLeft,
  fmtLeftShort,
  fmtLeftSpoken,
  fmtPct,
  fmtPercent,
  fmtSmallCost,
  fmtTokens,
  severityMark,
} from './format'
import { IDLE_COMPACT_MS } from './cache'
import type { CacheFacts, Wake, Waker } from './cache'
import type { ContextFacts, Frame, LimitFacts, SpendFacts, Tone } from './facts'
import { lastCostOf, warmAverageOf } from './insights'
import type { CostEntry, Trails } from './insights'

/** The colour a piece of a phrase is drawn in. */
export type Role = 'label' | 'value' | 'amber' | 'accent5' | 'accent7'
/** A phrase in pre-coloured segments, as `words()` draws it: a view places it, never slices it. */
export type Say = ReadonlyArray<readonly [string, Role]>
/** An amber reading's words: long while a calm piece remains to give way, then short. */
export type Amber = Readonly<{ long: string; short: string }>
/** A value not known yet: unknown, never 0. */
export const UNKNOWN = '–'

/** What leads an amber reading: its mark, then its words. */
export const AMBER_LEAD = '! '

/** A phrase's segments as one plain string. */
const joined = (say: Say): string => say.map(([text]) => text).join('')
/** The phrases said, the missing and the empty left out. */
const said = (parts: ReadonlyArray<string | undefined>): string[] => parts.filter((p): p is string => p !== undefined && p !== '')
/** The phrases said, joined by `sep`. */
export const saidJoined = (parts: ReadonlyArray<string | undefined>, sep: string): string => said(parts).join(sep)

/** The room before auto-compaction, an estimate: `~14k`. */
export const roomOf = (toCompact: number): string => `~${fmtTokens(toCompact)}`
/** Near compaction, the room before it: `compacts in ~14k`. Every layout's
 *  words say it so, chips' hover as `auto-compacts in ~14k`. */
export const compactsIn = (toCompact: number): string => `compacts in ${roomOf(toCompact)}`

/** When Claude Code may compact a conversation idle on the hour's cache. */
export const IDLE_COMPACT_AT = `at ~${fmtAgo(IDLE_COMPACT_MS)} idle, before it goes cold`

const amberOf = (say: Say, sayShort: Say): Amber => ({ long: joined(say), short: joined(sayShort) })
/** The context's amber lead and fill, long and short: `! context 93%`, `! ctx 93%`. */
const contextFill = (frac: number): Say => [[`${AMBER_LEAD}context `, 'amber'], [fmtPct(frac), 'value']]
const contextFillShort = (frac: number): Say => [[`${AMBER_LEAD}ctx `, 'amber'], [fmtPct(frac), 'value']]

/** What an amber reading says, long and short, always led by one
 *  `AMBER_LEAD`. */
export const AMBER = {
  cache: (leftShort: string, estimate: string): Amber =>
    amberOf([[AMBER_LEAD, 'amber'], [leftShort, 'value'], [` left · re-warm ${estimate}`, 'amber']], [[AMBER_LEAD, 'amber'], [leftShort, 'value']]),
  context: (frac: number, toCompact: number): Amber =>
    amberOf([...contextFill(frac), [` · ${compactsIn(toCompact)}`, 'amber']], contextFillShort(frac)),
  contextNoCompaction: (frac: number): Amber => amberOf(contextFill(frac), contextFillShort(frac)),
  limit: (name: string, percentUsed: number): Amber => {
    const both: Say = [[`${AMBER_LEAD}${name} `, 'amber'], [fmtPercent(percentUsed), 'value']]
    return amberOf(both, both)
  },
  limitPace: (name: string, eta: string): Amber =>
    amberOf([[`${AMBER_LEAD}${name} full in `, 'amber'], [eta, 'value']], [[`${AMBER_LEAD}${name} full `, 'amber'], [eta, 'value']]),
} as const

export const EMPTY = {
  costs: "Costs show after Claude's next reply.",
  /** Pulse's row, beside its flat trace: the costs' empty state, short. */
  costsShort: 'no costs yet',
  /** The flat trace's alt. */
  costsAlt: 'cost per message: none yet',
  context: 'not reported',
} as const

/** A landing at or over 100% is none: the window fills before it resets. */
const fillsBeforeReset = (projectedPct: number): boolean => projectedPct >= 100

/** What a pace drawn from the window's average says it rests on, in a
 *  row's room and spoken. */
const AVERAGE_PACE = 'at avg pace'
const AVERAGE_PACE_SPOKEN = "at the window's average pace"

/** A window's pace in words: a measured fill first, then the average's
 *  landing, said to be the average's. */
export const paceText = (p: Readonly<{ etaMs: number | null; projectedPct: number | undefined }>): string =>
  p.etaMs !== null
    ? `full in ${fmtEta(p.etaMs)}`
    : p.projectedPct === undefined
      ? ''
      : fillsBeforeReset(p.projectedPct)
        ? `full ${AVERAGE_PACE}`
        : `~${fmtPercent(p.projectedPct)} ${AVERAGE_PACE}`

/** What a screen reader hears for a drawn reading: `<name> <value>, <state>,
 *  <more>`, in words. A caller passes "about" and "resets in", never ~ or ↻. */
export const altOf = (name: string, value: string, state?: string, more?: string): string =>
  saidJoined([`${name} ${value}`, state, more], ', ')

/** The open cards' titles, in the order they are drawn. */
export const CARD_TITLES = { cache: 'Cache', spend: 'Spend', context: 'Context', limits: 'Limits' } as const

/** A card's headline, led by the amber mark while its reading is amber, so
 *  colour is never the only signal. */
export const markedHead = (say: Say, tone: Tone): Say => (tone === 'amber' ? [[AMBER_LEAD, 'amber'], ...say] : say)

/** A card's fact: its label at one end, its value at the other. */
type Fact = Readonly<{ label: string; value: string }>

// ---- the words of each section, from its facts ------------------------------

export type CacheWords = Readonly<{
  /** The cache's mood for a reader, unchanged as it counts down: the heartbeat's alt. */
  heartAlt: string
  /** Pulse's row tile's name: `cache`. */
  bandName: string
  /** The last minute: `! 47s left · re-warm ~$1.66`, then `! 47s`. */
  amber: Amber | undefined
  /** What the cache saved, `~$11.40`, and its hit rate, `96%`, once measured. */
  savedText: string | undefined
  hitText: string | undefined
  /** How long it lasts idle: `1h idle`, or `1h idle · assumed` while the hour is a guess. */
  lastsText: string
  /** Unexpected rebuilds, `2`, when there were any. */
  rebuildsText: string | undefined
  /** How long a recalled cache sat idle, `2h 05m`; undefined unless recalled. */
  idleText: string | undefined
  /** Who started the last turn, when the user didn't: `re-warmed by
   *  background task`, or within the TTL `kept warm by another session`;
   *  once the cache has gone again, `last turn by background task`. */
  wakeRow: Fact | undefined
  /** Who alone, in the fewest words that stay true: `by background task`;
   *  once the cache has gone, `last turn by background task`, since a bare
   *  `by` beside `cold` would blame it for the cold. */
  wakeShort: string | undefined
  /** The same, after the card's headline where the row has no room: ` · by
   *  background task`. */
  wakeHead: Say | undefined
  /** The cache card's headline: its countdown, `59m left`, else its mood. */
  cardHead: Say
  /** The cache card's line while there is nothing to count. */
  cardNote: string | undefined
  /** What a card names the re-warm estimate: `re-warm if cold`, or once
   *  cold, `next message`. */
  estimateLabel: string
  alt: string
  /** Pulse's row tile: its figure after the name, `cache`, the time marked
   *  `~` while it is recalled, not measured: `52m left`, `~40m left`, `cold ·
   *  re-warm ~$1.66`; short, `52m`, `~40m`, `cold ~$1.66`. */
  figure: string
  figureShort: string
}>

export type ContextWords = Readonly<{
  /** `38%`; while not reported, `–`. */
  valueText: string
  /** `! context 93% · compacts in ~14k` / `! ctx 93%`; compaction off, `! context 85%`. */
  amber: Amber | undefined
  /** Tokens in context, where it compacts, the room before then, and the window:
   *  `76k`, `190k`, `~114k`, `200k`. While not reported, `–` and no room. */
  inContextText: string
  compactsAtText: string | undefined
  roomText: string | undefined
  /** Pulse's row tile's name: `context`. */
  bandName: string
  windowText: string
  /** The context card's headline: `87% full`, marked past 80% when compaction is off. */
  cardHead: Say
  /** Pulse's context card's fact: `in context`, then phrase by phrase
   *  `76k of 200k` and `compacts at 190k`, or near it `compacts in ~10k`. */
  fact: Readonly<{ label: string; values: readonly string[] }>
  alt: string
}>

/** The kinds the session's tokens split into, in the order they are drawn. */
export const SPLIT_LABELS = ['input', 'output', 'cache reads'] as const

type SpendSplit = Readonly<{ label: (typeof SPLIT_LABELS)[number]; tokens: number; text: string; frac: number }>

export type SpendWords = Readonly<{
  /** Pulse's spend tile's name: `spend`. */
  bandName: string
  /** `$3.19`, the last message's `$0.21`, and the tokens, `225k`. */
  totalText: string
  lastText: string | undefined
  tokensText: string
  /** The tokens by kind, each with its share of the total. */
  split: readonly SpendSplit[]
}>

export type LimitWords = Readonly<{
  /** `4%`, or once its window has passed, `reset`. */
  valueText: string
  /** `82%!`: the value with its escalation mark, colour never the only signal. */
  valueMarked: string
  /** A card's reset and pace, `resets 3h 00m · ~10% at avg pace`; undefined
   *  without a reset to come. */
  resetAndPace: string | undefined
  /** When it resets, after `resets`: `16:40` or `Sat 13:30` once the offset
   *  is known, else `resetIn`; undefined without a reset to come. */
  resetWhen: string | undefined
  /** `5h 4%`, or once its window has passed, `5h reset`. */
  text: string
  say: Say
  /** `~10% at avg pace`, `full in ~40m`, `full at avg pace`, or empty. */
  pace: string
  /** When it fills before its reset, measured or at the average's pace, as
   *  the board says it: `full ~Mon` past today, `full ~14:20` today, or with
   *  the offset unknown `full in ~13h`; the average's, `at avg pace` after. */
  fillText: string | undefined
  /** Pulse's row tile's name: `5h`. */
  bandName: string
  /** Pulse's limits card's line for another window: its amber words, else
   *  `say` as plain text, its name among them. */
  line: string
  /** A measured fill, `~40m`. */
  fullIn: string | undefined
  /** The measured fill as a chip says it short, `full ~40m`: never the span
   *  alone, which beside a reset reads as one. */
  fullShort: string | undefined
  /** `! 5h 82%`, or with a measured fill, `! 5h full in ~40m` / `! 5h full
   *  ~40m`: never the span alone. */
  amber: Amber | undefined
  /** `! 5h 82%` while amber, measured fill or not: what a row says past the
   *  room for its forecast. */
  amberValue: Amber | undefined
  /** Pulse's limits card, under its chart: `5h resets` and `16:40`; with a
   *  measured fill, `5h full in` and `~40m`; passed, `5h` and `reset`;
   *  with no reset to come, its pace or its value. */
  fact: Fact
  alt: string
}>

/** What one mood of the cache says: its figure after `cache ` long and
 *  short, its card's headline and note, a reader's words, and its amber. */
type MoodWords = Pick<CacheWords, 'figureShort' | 'amber' | 'cardHead' | 'cardNote' | 'estimateLabel' | 'alt'> &
  Readonly<{ figure: Say }>

/** Each mood's name for a reader, unchanged as the cache counts down: the
 *  heartbeat's alt, and where a mood says no more, a card's and chips'. */
export const MOOD_ALT: Readonly<Record<CacheFacts['mood'], string>> = {
  unmeasured: 'cache not measured yet',
  warming: 'cache warming',
  warm: 'cache warm',
  expiring: 'cache in its last minute',
  cold: 'cache cold',
  compacted: 'cache compacted',
}

/** A cache gone, short: its mood and the next message's price, `cold ~$1.66`. */
export const goneShort = (mood: 'cold' | 'compacted', estimate: string): string => `${mood} ${estimate}`

/** The cache's words for its mood, as the cards, pulse and the board say
 *  them; chips' row says its own. `left` and `leftShort` are the countdown,
 *  empty while not counting; `price` is the re-warm, spoken. */
const moodWords = (f: CacheFacts, left: string, leftShort: string, price: string): MoodWords => {
  switch (f.mood) {
    case 'unmeasured':
      return {
        figure: [[UNKNOWN, 'value']],
        figureShort: UNKNOWN,
        amber: undefined,
        cardHead: [['not measured yet', 'value']],
        cardNote: "Countdown starts with Claude's next reply.",
        estimateLabel: 're-warm if cold',
        alt: MOOD_ALT.unmeasured,
      }
    case 'warming':
      return {
        figure: [['warming', 'value']],
        figureShort: 'warming',
        amber: undefined,
        cardHead: [['warming', 'value']],
        cardNote: 'First message builds the cache.',
        estimateLabel: 're-warm if cold',
        alt: MOOD_ALT.warming,
      }
    case 'compacted':
      return {
        figure: [['compacted', 'value'], [' · next ', 'label'], [f.estimate, 'value']],
        figureShort: goneShort('compacted', f.estimate),
        amber: undefined,
        cardHead: [['compacted', 'value']],
        cardNote: 'Compacted while idle: next message writes the summary.',
        estimateLabel: 'next message',
        alt: altOf('cache', 'compacted while idle', `next message about ${price}`),
      }
    case 'cold':
      return {
        figure: [['cold', 'value'], [' · re-warm ', 'label'], [f.estimate, 'value']],
        figureShort: goneShort('cold', f.estimate),
        amber: undefined,
        cardHead: [['cold', 'value']],
        cardNote: undefined,
        estimateLabel: 'next message',
        alt: altOf('cache', 'cold', `re-warm about ${price}`),
      }
    case 'warm':
    case 'expiring': {
      // Warm while Claude works: every step restarts the TTL, so nothing counts down.
      const expiring = f.mood === 'expiring'
      const value = f.coldInMs !== undefined ? left : f.mood
      return {
        figure: [[value, 'value']],
        figureShort: f.coldInMs !== undefined ? leftShort : value,
        amber: expiring ? AMBER.cache(leftShort, f.estimate) : undefined,
        // The card counts down as chips' row always has: `1h 05m`, `0:47`.
        cardHead: f.coldInMs !== undefined ? [[fmtCountdown(f.coldInMs), 'value'], [' left', 'label']] : [[value, 'value']],
        cardNote: f.idleCompactSoon ? `Claude Code may compact it ${IDLE_COMPACT_AT}.` : undefined,
        estimateLabel: 're-warm if cold',
        alt:
          f.coldInMs !== undefined
            ? altOf('cache', fmtLeftSpoken(f.coldInMs), expiring ? 'cooling' : 'warm', expiring ? `re-warm about ${price}` : undefined)
            : altOf('cache', 'warm', 'Claude is working'),
      }
    }
  }
}

/** What woke a session, as a card's value names it and as a sentence's subject. */
const WAKER_WORDS: Readonly<Record<Waker, Readonly<{ noun: string; subject: string }>>> = {
  task: { noun: 'background task', subject: 'a background task' },
  schedule: { noun: 'schedule', subject: 'a schedule' },
  session: { noun: 'another session', subject: 'another session' },
  channel: { noun: 'channel message', subject: 'a channel message' },
  plugin: { noun: 'plugin', subject: 'a plugin' },
  claude: { noun: 'Claude Code', subject: 'Claude Code' },
}

/** Whether the cache has gone since: what the last turn did no longer holds. */
const goneMoods: ReadonlySet<CacheFacts['mood']> = new Set(['cold', 'compacted'])

/** A turn the user didn't type, as a hover says it: `a background task
 *  re-warmed it`, `another session kept it warm`; the cache gone since,
 *  `last turn by a background task`. */
export const wakeSaid = (wake: Wake, mood: CacheFacts['mood']): string => {
  const { subject } = WAKER_WORDS[wake.by]
  return goneMoods.has(mood) ? `last turn by ${subject}` : `${subject} ${wake.reWarm ? 're-warmed it' : 'kept it warm'}`
}

/** The Cache card's row for a turn the user didn't type: what it did, while
 *  that still holds, and who started it. */
const wakeRowOf = (wake: Wake, mood: CacheFacts['mood']): Fact => ({
  label: goneMoods.has(mood) ? 'last turn by' : wake.reWarm ? 're-warmed by' : 'kept warm by',
  value: WAKER_WORDS[wake.by].noun,
})

/** Who started a turn the user didn't type, in the fewest words that stay true. */
const wakeShortOf = (wake: Wake, mood: CacheFacts['mood']): string =>
  `${goneMoods.has(mood) ? 'last turn by' : 'by'} ${WAKER_WORDS[wake.by].noun}`

/** The cache in words, from its facts: its mood's, and the measures every
 *  mood says alike. It counts down only while `coldInMs` is set. */
export const cacheWords = (f: CacheFacts): CacheWords => {
  const counting = f.coldInMs !== undefined
  const left = counting ? fmtLeft(f.coldInMs) : ''
  const leftShort = counting ? fmtLeftShort(f.coldInMs) : ''
  // Recalled from the session's last reply, its time is an estimate until a reply measures it.
  const recalledTime = counting && f.recalled && !f.measured
  // Spoken, a price is never marked ~: the alt says "about".
  const price = f.reWarmUsd !== null ? fmtSmallCost(f.reWarmUsd) : `${fmtTokens(f.window)} tokens`
  const m = moodWords(f, left, leftShort, price)
  const wakeShort = f.wake === undefined ? undefined : wakeShortOf(f.wake, f.mood)
  return {
    heartAlt: MOOD_ALT[f.mood],
    bandName: 'cache',
    amber: m.amber,
    savedText: f.measured && f.savedUsd !== null ? fmtEstimate(f.savedUsd) : undefined,
    hitText: f.hitFrac === undefined ? undefined : fmtPct(f.hitFrac),
    // Unpinned, an hour is assumed until a pin or the transcript says it.
    lastsText: `${f.ttl} idle${!f.ttlPinned && f.ttl === '1h' ? ' · assumed' : ''}`,
    rebuildsText: f.misses > 0 ? String(f.misses) : undefined,
    idleText: f.recalled && f.idleMs !== null ? fmtAgo(f.idleMs) : undefined,
    wakeRow: f.wake === undefined ? undefined : wakeRowOf(f.wake, f.mood),
    wakeShort,
    wakeHead: wakeShort === undefined ? undefined : [[` · ${wakeShort}`, 'label']],
    cardHead: m.cardHead,
    cardNote: m.cardNote,
    estimateLabel: m.estimateLabel,
    alt: m.alt,
    // The time marked ~ while it is recalled.
    figure: recalledTime ? `~${left}` : joined(m.figure),
    figureShort: recalledTime ? `~${leftShort}` : m.figureShort,
  }
}

/** The context in words, measured toward compaction when it is on; unknown
 *  while the engine reports none, never 0%. */
export const contextWords = (f: ContextFacts): ContextWords => {
  const value = f.known ? f.pct : UNKNOWN
  const towardText = f.compactAt !== undefined ? 'toward compaction' : 'of the window'
  const roomText = !f.known || f.compactAt === undefined ? undefined : roomOf(f.toCompact)
  const amber = f.tone !== 'amber' ? undefined : f.compactAt !== undefined ? AMBER.context(f.frac, f.toCompact) : AMBER.contextNoCompaction(f.frac)
  const cardHead: Say = [[`${f.pct}${f.compactAt === undefined ? severityMark(f.frac) : ''}`, 'value'], [' full', 'label']]
  const compactsAtText = f.compactAt === undefined ? undefined : fmtTokens(f.compactAt)
  // Near compaction, the room before it; else where it compacts.
  const compaction = f.compactAt === undefined ? undefined : amber !== undefined ? compactsIn(f.toCompact) : `compacts at ${fmtTokens(f.compactAt)}`
  const inContext = f.known ? fmtTokens(f.used) : UNKNOWN
  return {
    valueText: value,
    amber,
    inContextText: inContext,
    compactsAtText,
    roomText,
    bandName: 'context',
    windowText: fmtTokens(f.window),
    cardHead,
    fact: {
      label: 'in context',
      values: said([`${inContext} of ${fmtTokens(f.window)}`, compaction]),
    },
    alt: f.known
      ? altOf('context', `${Math.round(f.frac * 100)} percent ${towardText}`, f.tone === 'amber' ? 'near the limit' : 'fine')
      : altOf('context', EMPTY.context),
  }
}

/** The session's cost and tokens in words, the tokens split by kind. */
export const spendWords = (f: SpendFacts): SpendWords => {
  const tokensByLabel: Readonly<Record<SpendSplit['label'], number>> = { input: f.sent, output: f.back, 'cache reads': f.cached }
  const totalText = fmtCost(f.totalUsd)
  return {
    bandName: 'spend',
    totalText,
    lastText: f.lastTurnUsd === null ? undefined : fmtSmallCost(f.lastTurnUsd),
    tokensText: fmtTokens(f.total),
    split: SPLIT_LABELS.map(label => {
      const tokens = tokensByLabel[label]
      return { label, tokens, text: fmtTokens(tokens), frac: f.total > 0 ? tokens / f.total : 0 }
    }),
  }
}

/** A limit window in words; once it has passed, only that it reset: its
 *  facts carry no pace, reset or fill to say. */
export const limitWords = (f: LimitFacts, frame: Frame): LimitWords => {
  const zone = frame.zone
  // The time to the reset, while one is to come.
  const span = f.reset?.kind === 'in' ? f.reset.text : undefined
  const projected = f.projectedPct
  const fills = projected !== undefined && fillsBeforeReset(projected)
  const lands = projected !== undefined && !fills
  const landing = lands ? `about ${Math.round(projected)} percent at its reset, ${AVERAGE_PACE_SPOKEN}` : undefined
  const fullIn = f.etaMs !== null ? fmtEta(f.etaMs) : undefined
  const valueText = f.passed ? 'reset' : f.value
  const say: Say = [[`${f.name} `, 'label'], [valueText, 'value']]
  const resetAt = f.resetInMs === undefined ? undefined : frame.now + f.resetInMs
  const resetClock = resetAt !== undefined && zone !== undefined ? fmtDayClock(resetAt, zone, frame.now) : undefined
  const pace = paceText(f)
  const resetIn = span === undefined ? undefined : `in ${span}`
  const resetWhen = resetClock ?? resetIn
  // A day's window says the fill's day; a shorter one its clock too, as its reset does.
  const fillDay = f.key === '7d' ? fmtDay : fmtDayClock
  const fillAt = f.fillInMs === undefined ? undefined : zone !== undefined ? `~${fillDay(fillTime(frame.now + f.fillInMs, f.fillInMs, zone), zone, frame.now)}` : `in ${fmtEta(f.fillInMs)}`
  const amberValue = f.tone !== 'amber' ? undefined : AMBER.limit(f.name, f.percentUsed)
  const amber = fullIn !== undefined && amberValue !== undefined ? AMBER.limitPace(f.name, fullIn) : amberValue
  const fact: Fact =
    f.passed ? { label: f.name, value: valueText }
    : amber !== undefined && fullIn !== undefined ? { label: `${f.name} full in`, value: fullIn }
    : resetWhen !== undefined ? { label: `${f.name} resets`, value: resetWhen }
    : { label: f.name, value: pace === '' ? valueText : pace }
  return {
    valueText,
    valueMarked: `${f.value}${severityMark(f.frac)}`,
    resetAndPace: span === undefined ? undefined : saidJoined([`resets ${span}`, pace], ' · '),
    resetWhen,
    text: joined(say),
    say,
    pace,
    // The average's fill says whose it is; a measured one is the pace's own.
    fillText: fillAt === undefined ? undefined : `full ${fillAt}${f.etaMs === null ? ` ${AVERAGE_PACE}` : ''}`,
    bandName: f.name,
    line: amber?.long ?? joined(say),
    fullIn,
    fullShort: fullIn === undefined ? undefined : `full ${fullIn}`,
    amber,
    amberValue,
    fact,
    alt: altOf(
      `${f.name} limit`,
      f.passed ? 'reset' : `${Math.round(f.percentUsed)} percent used`,
      f.tone === 'amber' ? 'needs attention' : 'fine',
      f.etaMs !== null
        ? `full in ${fmtEtaSpoken(f.etaMs)}`
        : fills
          ? `full before its reset, ${AVERAGE_PACE_SPOKEN}`
          : landing,
    ),
  }
}

/** What the history says: the costs' numbers, and each trail's trend for a reader. */
export type HistoryWords = Readonly<{
  /** '$0.21' */
  lastText: string | undefined
  /** 'last $0.21' */
  numbersShort: string
  /** The newest `count` costs for a reader, as a chart draws them: 'cost of
   *  the last 14 messages, steady, average $0.18, max $0.84 re-warm', then
   *  ', the newest a re-warm' when it was: the average leaves re-warms out. */
  costsAltOf: (count: number) => string
  /** 'context over the conversation, rising, compacts at 190k'; with compaction off, no compaction point. */
  contextTrailAlt: string
  /** `no costs yet`, beside the flat trace, only while there is no cost at
   *  all: none recorded and a total of $0. A resumed conversation's total
   *  says there were costs. */
  costsNote: string | undefined
  /** Pulse's spend card's fact: `last message · avg` and `$0.21 · ~$0.20`,
   *  or before a warm cost `last message` alone; undefined before any cost. */
  costFact: Fact | undefined
}>

/** A message above this many times the warm average is rising; below the average divided by it, falling. */
const TREND_FACTOR = 1.5
/** The context trail's trend, first point to last: a compaction can leave it falling. */
const contextTrendOf = (tokens: readonly number[]): 'rising' | 'falling' | 'steady' => {
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  return first === undefined || last === undefined || last === first ? 'steady' : last > first ? 'rising' : 'falling'
}

/** What the history says, from its trails and `avg`, their warm average. */
export const historyWords = (record: Trails, context: ContextFacts, spend: Readonly<{ totalUsd: number }>, avg: number | undefined): HistoryWords => {
  const last = lastCostOf(record)
  const lastText = last === null ? undefined : fmtSmallCost(last)
  const trend =
    last === null || avg === undefined
      ? 'steady'
      : last > avg * TREND_FACTOR
        ? 'rising'
        : last < avg / TREND_FACTOR
          ? 'falling'
          : 'steady'
  const costsAltOf = (count: number): string => {
    const drawn = record.costs.slice(-count)
    const drawnAvg = warmAverageOf(drawn)
    const max = drawn.reduce<CostEntry | undefined>((top, e) => (top === undefined || e.usd > top.usd ? e : top), undefined)
    return saidJoined(
      [
        `cost of ${drawn.length === 1 ? 'the last message' : `the last ${drawn.length} messages`}`,
        trend,
        drawnAvg === undefined ? undefined : `average ${fmtSmallCost(drawnAvg)}`,
        max === undefined ? undefined : `max ${fmtSmallCost(max.usd)}${max.reWarm ? ' re-warm' : ''}`,
        drawn.at(-1)?.reWarm ? 'the newest a re-warm' : undefined,
      ],
      ', ',
    )
  }
  const compactsAt = context.compactAt === undefined ? '' : `, compacts at ${fmtTokens(context.compactAt)}`
  const numbersShort = lastText === undefined ? '' : `last ${lastText}`
  return {
    lastText,
    numbersShort,
    costsAltOf,
    contextTrailAlt: `context over the conversation, ${contextTrendOf(record.context)}${compactsAt}`,
    costsNote: record.costs.length === 0 && !(spend.totalUsd > 0) ? EMPTY.costsShort : undefined,
    costFact:
      lastText === undefined ? undefined
      : avg === undefined ? { label: 'last message', value: lastText }
      : { label: 'last message · avg', value: `${lastText} · ${fmtEstimate(avg)}` },
  }
}

/** Pulse's limits card's headline: each window's name and value, `5h 26% ·
 *  7d 41%`; with neither reported, the other windows'. */
export const limitsHead = (limits: ReadonlyArray<Pick<LimitFacts, 'key' | 'name'> & Pick<LimitWords, 'valueText'>>): Say => {
  const windows = limits.filter(l => l.key !== 'other')
  return (windows.length > 0 ? windows : limits).flatMap((l, i): Say => [[`${i === 0 ? '' : ' · '}${l.name} `, 'label'], [l.valueText, 'value']])
}

/** What the week says of its slices as drawn, for a reader. */
export type WeekWords = Readonly<{
  /** 'weekly limit by day: Sunday 66%, Monday about 34% and fills it, Tuesday to Saturday none left' */
  daysAlt: string
  /** The 5h window whole, start to reset: '5h window from start to reset, 26%
   *  used, about 33% at the window's average pace'; no pace where none is known, '' with no 5h window. */
  windowAlt: string
}>

/** The slices known or guessed, each named, a guess said as about, the one
 *  that fills the limit so, and the run after it as none left. */
const slicesSpoken = (title: string, names: readonly string[], marks: readonly SliceMark[]): string => {
  const spoken = marks.flatMap((m, i) => {
    const name = names[i] ?? ''
    const pct = fmtPercent(m.pct)
    return m.kind === 'measured' ? [`${name} ${pct}`] : m.kind === 'guess' ? [`${name} about ${pct}`] : m.kind === 'fills' ? [`${name} about ${pct} and fills it`] : []
  })
  const spent = names.filter((_, i) => marks[i]?.kind === 'spent')
  const none = spent.length === 0 ? [] : [`${spent.length === 1 ? spent[0] : `${spent[0]} to ${spent.at(-1)}`} none left`]
  const all = [...spoken, ...none]
  return `${title}: ${all.length === 0 ? 'not known yet' : all.join(', ')}`
}

/** The week in words: its days as drawn, and the 5h window whole. */
export const weekWords = (
  w: Pick<DrawnWeek, 'days' | 'dayMarks'>,
  five?: Pick<LimitWords, 'valueText'> & Readonly<{ projectedPct: number | undefined; passed: boolean }>,
): WeekWords => ({
  daysAlt: slicesSpoken('weekly limit by day', w.days.map(d => d.name), w.dayMarks),
  windowAlt:
    five === undefined || five.passed
      ? ''
      : `5h window from start to reset, ${five.valueText} used${five.projectedPct === undefined ? '' : `, about ${fmtPercent(five.projectedPct)} ${AVERAGE_PACE_SPOKEN}`}`,
})
