// The prompt cache, as the band models it from each response's token counts.
// One model per session, made at session.start and fed each hook's facts in
// that hook's own shape; the order they must be applied in is kept here. What
// it was billed is cache-bill.ts's, and what its view means, cache-facts.ts's.

import type { RenderSurface } from 'claude-code'
import { NO_BILL, billAtRedraw, billAtStep, billAtTurnStart, billOfNewConversation, bookResponse, ratePerToken, rememberedRate, savedUsdOf, spentUsd, weighResponse, writesReadAs } from './cache-bill'
import type { Bill, Pricing, Response } from './cache-bill'
import { MINUTE_MS } from './format'
import { NO_TOKENS, WRITE_MULT, addTokens, modelName, readMultiplier, tierFactor } from './prices'
import type { TokenCounts, Ttl } from './prices'

export type { CacheFacts } from './cache-facts'
export type { Ttl }
export const TTL_MS: Readonly<Record<Ttl, number>> = { '5m': 5 * MINUTE_MS, '1h': 60 * MINUTE_MS }

// A response that read this much less than the cache held, both in tokens and
// as a share of it, missed the cache.
const MISS_MIN_TOKENS = 2000
const MISS_MIN_SHARE = 0.05

/** A response with more input than this that read and wrote no cache isn't
 *  caching. Below a model's minimum, reading and writing none is expected, and
 *  this is the largest minimum the API's docs list (Opus 4.6, Opus 4.5 and
 *  Haiku 4.5, as of 2026-11): platform.claude.com/docs/en/build-with-claude/prompt-caching */
const UNCACHED_MIN_TOKENS = 4096

/** With no read of the lifetime, what a request after a gap reads of a cache
 *  gone cold: only what other sessions keep warm, the shared system prompt.
 *  Over 1,383 real transcripts such reads had a median of 27k and a p90 of
 *  45k; more than this is a change in part of the prefix, no cold cache. */
const COLD_READ_MAX_TOKENS = 50_000

/** Claude Code compacts a conversation left idle on the hour's cache about
 *  this long after its last request, before the cache runs out: its docs say
 *  about an hour. */
export const IDLE_COMPACT_MS = 54 * MINUTE_MS
/** A compaction this long after the last request, with no turn under way, is
 *  an idle one: an auto-compaction comes as a turn starts, not half an hour on. */
const IDLE_GAP_MS = 30 * MINUTE_MS

/** What started a main-loop turn the user didn't type: a background task's
 *  notification, a schedule, another session, a channel, a plugin, or Claude
 *  Code going on by itself. */
export type Waker = 'task' | 'schedule' | 'session' | 'channel' | 'plugin' | 'claude'

const WAKERS: Readonly<Record<string, Waker>> = {
  'task-notification': 'task',
  observer: 'task',
  'observer-activity': 'task',
  'scheduled-trigger': 'schedule',
  peer: 'session',
  'peer-send-message': 'session',
  'projects-relay': 'session',
  coordinator: 'session',
  channel: 'channel',
  'slack-ping': 'channel',
  plugin: 'plugin',
  'auto-continuation': 'claude',
}

/** What woke the session, by the origin of the prompt that started its turn;
 *  undefined for the user's own (typed at the terminal, from a phone, or
 *  through the desktop app's SDK host), one no engine could place, and a
 *  kind a newer engine adds. */
export const wakerOf = (kind: string): Waker | undefined => (Object.hasOwn(WAKERS, kind) ? WAKERS[kind] : undefined)

/** The last main-loop turn, when the user didn't type it: what started it,
 *  and whether it rebuilt the cache. */
export type Wake = Readonly<{ by: Waker; reWarm: boolean }>

/** What a conversation has spent: its dollars and its tokens. */
export type Spend = Readonly<{ usd: number; tokens: TokenCounts }>

/** What the engine says of a resumed conversation's cache: when its last
 *  reply was, whether its cache has likely expired, and what re-caching it
 *  costs. */
export type ResumedCache = Readonly<{ lastAt: number; expired: boolean | undefined; reWarmUsd: number | undefined }>

/** What a resumed conversation's transcript shows: its spend before this
 *  process, and the TTL of its last cache write. */
export type TranscriptFacts = Readonly<{ spend: Spend | undefined; ttl: Ttl | undefined }>

/** What the band recalls of a conversation's last reply, before its own:
 *  when it was, the base rate per token on its model, and the model it was
 *  billed under, where its transcript names one. */
export type RecalledReply = Readonly<{ lastAt: number | undefined; rate: number | null; billed: string | undefined }>

/** The cache as the model measured it, the snapshot's to carry to the band. */
export type CacheView = Readonly<{
  requests: number
  /** The cache's time left: 0 once cold. */
  leftMs: number
  /** When the cache goes or went cold, epoch ms; null when not known. */
  coldAt: number | null
  ttl: Ttl
  /** The TTL is known, not assumed: pinned by the environment, or seen on
   *  the transcript's last cache write before this band's first reply. */
  ttlPinned: boolean
  window: number
  hitRatio: number | null
  misses: number
  reWarmUsd: number | null
  /** What reading from the cache saved against full input price. */
  savedUsd: number | null
  /** A cache read's price against input, on the model in force. */
  readShare: number
  /** The conversation is known to start here; else, before its first
   *  reply, the band has not measured the cache yet. */
  fresh: boolean
  /** Claude Code compacted the conversation while it sat idle: the cache
   *  is gone, and the next message writes the summary. */
  compacted: boolean
  /** It was compacted while idle, rather than by /compact or in a turn. */
  compactedIdle: boolean
  /** The last response had a prompt too large for the minimum and read and
   *  wrote no cache: nothing is cached, so nothing counts down or re-warms. */
  notCaching: boolean
  /** /model names another model than the last turn ran under: each has its
   *  own cache, so the next message rebuilds. */
  modelChanged: boolean
  /** Claude Code may compact this conversation when it sits idle on the
   *  hour's cache: where it does that, idle compaction on, and the context
   *  past its threshold. */
  idleCompacts: boolean
  /** Before the first reply the band saw, the cache is as recalled: from
   *  the session's last reply, remembered or read off its transcript. */
  recalled: boolean
  /** How long since that recalled reply. */
  idleMs: number | null
  /** A resumed conversation's spend and tokens from before this process
   *  are counted, as its transcript records them. */
  recovered: boolean
  /** Every token since the conversation began, subagents included. */
  tokens: Readonly<{ sent: number; back: number; cached: number }>
  /** The last turn restarted the countdown though the user didn't type it. */
  wake: Wake | undefined
}>

/** A cache model's facts, plain data, for a reload to carry on from. */
export type CacheState = {
  ttl: Ttl
  /** Set by the environment, so never inferred. */
  ttlPinned: boolean
  /** A subagent's TTL: five minutes, unless the environment pins an hour. */
  subagentTtl: Ttl
  /** The TTL the transcript's last cache write was made at, until this
   *  band's first reply: it speaks for the recalled cache, never for the next
   *  request, and the environment's pin still wins. */
  ttlSeen: Ttl | undefined
  /** `ttl` was read off the transcript's last cache write, at a turn's end,
   *  so it isn't assumed. */
  ttlRead: boolean
  /** When the request behind the main loop's last write unread went: a turn
   *  whose last step only read still wrote earlier, and one that wrote nothing
   *  has nothing new to read. */
  writeUnreadSince: number | undefined
  /** The context, in tokens, from which Claude Code compacts this session
   *  when it sits idle; undefined when it never does (idleCompactFrom). */
  idleCompactFrom: number | undefined
  /** A main-loop turn is under way: a compaction then is no idle one. */
  turnOpen: boolean
  /** What started the turn under way, when the user didn't type it. */
  turnWaker: Waker | undefined
  /** The turn under way has made a request of its own, in the main loop. */
  turnMeasured: boolean
  /** Who started the last main-loop turn that made a request, when the user
   *  didn't type it. */
  lastWake: Wake | undefined
  /** Main-loop requests this conversation. */
  requests: number
  /** Every token since the conversation began, subagents included. */
  tokens: TokenCounts
  /** What the session has been billed, and by which model's steps. */
  bill: Bill
  /** Requests that missed a cache that should have been warm. */
  misses: number
  /** When the last main-loop request was sent. */
  lastAt: number
  /** The last main-loop request's whole window, its response included. */
  window: number
  /** What that request left in the cache; the response is only written on
   *  the next request, never read. */
  cached: number
  /** The next request rebuilds the cache on purpose (a compaction). */
  rebuilding: boolean
  /** When the conversation was last compacted, until the next reply: the
   *  cache it held is given up, and the next request writes the summary. */
  compactedAt: number | undefined
  /** That compaction was Claude Code's, while the conversation sat idle. */
  compactedIdle: boolean
  /** The last main-loop response read and wrote no cache, on a prompt too
   *  large for that to be the minimum. */
  notCaching: boolean
  /** How many messages the last main-loop request carried: fewer in the next
   *  means a /rewind, which reads back to an earlier cache entry. */
  messageCount: number | undefined
  /** The model the last main-loop request ran on; a switch rebuilds the cache. */
  model: string | undefined
  /** Since the turn's end last read it, a main-loop request rebuilt a cache
   *  that existed. */
  lastRebuilt: boolean
  /** The conversation is known to start here (a new session, a /clear), so
   *  its cache is warming; after a reload mid-conversation it is unmeasured. */
  knownFresh: boolean
  /** The engine said this conversation was resumed, so it never starts here,
   *  whatever the ledger says. */
  resumed: boolean
  /** What the engine said of the resumed conversation's cache, when it said;
   *  before this band's first reply it stands over anything recalled. */
  resumedCache: ResumedCache | undefined
  /** Before this band's first reply: when the conversation's last reply was,
   *  and the base rate per token on its model, as recalled. */
  recall: Readonly<{ lastAt: number; rate: number | null }> | undefined
  /** A resumed conversation's spend before this process, as its transcript
   *  records it. */
  prior: Spend | undefined
  /** The model /model has in force, as it names it: perhaps an alias. */
  priceModel: string | undefined
  /** What /model named when the main loop's last request went: the model the
   *  cache was written for, as /model names it. */
  requestModel: string | undefined
  /** The last request's rounds were a guess, so `window` is too. */
  windowGuessed: boolean
  /** The model the main loop's last reply was billed under, as the API names
   *  it. Where known, the tokens are priced at it. */
  billedModel: string | undefined
}

const INITIAL: Readonly<CacheState> = {
  ttl: '1h',
  ttlPinned: false,
  subagentTtl: '5m',
  ttlSeen: undefined,
  ttlRead: false,
  writeUnreadSince: undefined,
  idleCompactFrom: undefined,
  turnOpen: false,
  turnWaker: undefined,
  turnMeasured: false,
  lastWake: undefined,
  requests: 0,
  tokens: NO_TOKENS,
  bill: NO_BILL,
  misses: 0,
  lastAt: 0,
  window: 0,
  cached: 0,
  rebuilding: false,
  compactedAt: undefined,
  compactedIdle: false,
  notCaching: false,
  messageCount: undefined,
  model: undefined,
  lastRebuilt: false,
  knownFresh: false,
  resumed: false,
  resumedCache: undefined,
  recall: undefined,
  prior: undefined,
  priceModel: undefined,
  requestModel: undefined,
  windowGuessed: false,
  billedModel: undefined,
}

// ---- what the state says ----------------------------------------------------

/** When the conversation's last reply was, before this band's own: as the
 *  engine said on a resume, else as recalled. A time after `now` is a clock
 *  that ran ahead, or data that isn't a time: unknown. */
const recalledAt = (s: CacheState, now: number): number | undefined => {
  const at = s.resumedCache?.lastAt ?? s.recall?.lastAt
  return at !== undefined && at <= now ? at : undefined
}

/** Whether the cache stands as recalled: no reply seen yet, a conversation
 *  that didn't start here, something to recall, and no compaction since. */
const isRecalled = (s: CacheState, now: number): boolean => s.requests === 0 && !s.knownFresh && s.compactedAt === undefined && recalledAt(s, now) !== undefined

/** The TTL the cache stands at: the pin, else one seen on the transcript,
 *  else the one assumed or inferred. */
const effectiveTtl = (s: CacheState): Ttl => (s.ttlPinned ? s.ttl : (s.ttlSeen ?? s.ttl))

/** The model the tokens are priced at: the one replies are billed under, else
 *  what /model names, which may be an alias such as `opus[1m]`. */
const pricedModel = (s: CacheState): string | undefined => s.billedModel ?? (s.priceModel === undefined ? undefined : modelName(s.priceModel))

/** What the bill needs of the model priced and its reads. */
const pricingOf = (s: CacheState): Pricing => ({ model: pricedModel(s), reads: s.tokens.read })

/** Every token since the conversation began: a resumed one's earlier tokens
 *  with this process's. */
const allTokens = (s: CacheState): TokenCounts => (s.prior === undefined ? s.tokens : addTokens(s.tokens, s.prior.tokens))

/** What writing `tokens` to the cache costs at a base `rate` per token, for
 *  the lifetime the cache stands at: the re-warm's prompt is the whole
 *  window, which sets its tier. */
const reWarmAt = (s: CacheState, rate: number, tokens: number): number =>
  rate * WRITE_MULT[effectiveTtl(s)] * tokens * tierFactor(pricedModel(s), tokens)

/** When a measured cache goes or went cold: a lifetime after the last reply
 *  this band saw; none before one. */
const measuredColdAt = (s: CacheState): number | null => (s.requests > 0 ? s.lastAt + TTL_MS[effectiveTtl(s)] : null)

/** When the cache goes or went cold: measured from the last reply, else
 *  recalled; null with nothing to go by, or a resume the engine called expired. */
const coldAtOf = (s: CacheState, now: number): number | null => {
  if (s.compactedAt !== undefined) return s.compactedAt
  if (s.notCaching) return null
  const measured = measuredColdAt(s)
  // A reply dated after now cools a lifetime from now at the latest.
  if (measured !== null) return Math.min(measured, now + TTL_MS[effectiveTtl(s)])
  if (s.resumedCache?.expired === true) return null
  const recalled = isRecalled(s, now) ? recalledAt(s, now) : undefined
  return recalled === undefined ? null : recalled + TTL_MS[effectiveTtl(s)]
}

/** The cache's time left: from the last reply this band saw, else the one
 *  it recalls, none if the engine called it expired; a full lifetime before
 *  either. */
const leftMsOf = (s: CacheState, now: number): number => {
  if (s.compactedAt !== undefined || s.notCaching) return 0
  if (s.requests === 0 && s.resumedCache?.expired === true) return 0
  const at = coldAtOf(s, now)
  const lifetime = TTL_MS[effectiveTtl(s)]
  return at === null ? lifetime : Math.min(lifetime, Math.max(0, at - now))
}

/** How long the recalled reply has sat idle at `now`; null unless the
 *  cache stands as recalled. */
const idleMsOf = (s: CacheState, now: number): number | null => {
  const lastAt = recalledAt(s, now)
  return isRecalled(s, now) && lastAt !== undefined ? now - lastAt : null
}

/** Where Claude Code compacts an idle conversation, of where the band draws:
 *  an interactive terminal, the VS Code panel, the desktop's Code tab. */
const idleCompactsOn = (surface: RenderSurface | undefined): boolean => surface !== 'mobile'

/** Whether /model names another model than the last turn took, while there
 *  is a cache to lose. Name against name, as /model gives them, since a name
 *  may be an alias that the API's own name for it would never match. */
const modelChangedTo = (s: CacheState, modelNow: string | undefined, now: number): boolean =>
  (s.requests > 0 || isRecalled(s, now)) && modelNow !== undefined && (s.requestModel ?? s.priceModel) !== undefined && modelName(modelNow) !== modelName(s.requestModel ?? s.priceModel ?? '')

/** The cache as the band shows it, at `now`: measured once a reply has been
 *  seen, recalled before that. `contextTokens` is the context as it stands,
 *  which a recalled cold cache would rebuild. */
const viewOf = (s: CacheState, now: number, sessionCost: number | undefined, contextTokens: number, autoCompactOff: boolean, at: Readonly<{ modelNow?: string | undefined; surface?: RenderSurface }>): CacheView => {
  const recalled = isRecalled(s, now)
  const recallRate = s.recall?.rate ?? null
  // A resume's price is the engine's own; else it is solved from the rate recalled.
  // With no context known, there's nothing to price it at.
  const recalledPrice = s.resumedCache?.reWarmUsd ?? (recallRate === null || contextTokens <= 0 ? null : reWarmAt(s, recallRate, contextTokens))
  // A step with a server tool sums rounds a mod isn't told, so Claude Code's
  // own count of the context speaks for it, where it has one.
  const window = recalled || (s.windowGuessed && contextTokens > 0) ? contextTokens : s.window
  const pricing = pricingOf(s)
  const rate = ratePerToken(s.bill, pricing, sessionCost)
  const tokens = allTokens(s)
  const input = tokens.read + tokens.written + tokens.uncached
  const share = readMultiplier(pricedModel(s))
  return {
    requests: s.requests,
    leftMs: leftMsOf(s, now),
    coldAt: coldAtOf(s, now),
    ttl: effectiveTtl(s),
    // Known, not assumed: pinned, or seen on the transcript's last cache write.
    ttlPinned: s.ttlPinned || s.ttlSeen !== undefined || s.ttlRead,
    window,
    hitRatio: input > 0 ? tokens.read / input : null,
    misses: s.misses,
    // A measured cold cache rebuilds with a cache write of the whole window.
    reWarmUsd: recalled ? recalledPrice : rate === null ? null : reWarmAt(s, rate, window),
    recalled,
    idleMs: idleMsOf(s, now),
    // Every cache read saved the rest of the base rate against full input price.
    savedUsd: tokens.read <= 0 ? null : savedUsdOf(s.bill, pricing, sessionCost, rate, s.prior?.tokens.read ?? 0),
    readShare: share,
    fresh: s.knownFresh,
    compacted: s.compactedAt !== undefined,
    compactedIdle: s.compactedIdle,
    notCaching: s.notCaching,
    modelChanged: modelChangedTo(s, at.modelNow, now),
    idleCompacts: idleCompactsOn(at.surface) && s.idleCompactFrom !== undefined && !autoCompactOff && contextTokens >= s.idleCompactFrom,
    recovered: s.prior !== undefined,
    tokens: { sent: tokens.uncached + tokens.written, back: tokens.output, cached: tokens.read },
    wake: s.lastWake,
  }
}

// ---- what changes it --------------------------------------------------------

/** A resumed conversation didn't start here, whatever the ledger says; what
 *  the engine knows of its cache, when it says, stands over anything
 *  recalled. A resume's facts replace any noted before them. */
const noteResume = (s: CacheState, said: ResumedCache | undefined): void => {
  s.knownFresh = false
  s.resumed = true
  s.resumedCache = said
  s.prior = undefined
  s.ttlSeen = undefined
}

/** What a resumed conversation's transcript shows: its spend before this
 *  process, and the TTL of its last cache write, which speaks for the cache
 *  until this band's first reply. */
const noteTranscript = (s: CacheState, facts: TranscriptFacts): void => {
  if (facts.spend !== undefined) s.prior = facts.spend
  if (facts.ttl !== undefined && s.requests === 0) s.ttlSeen = facts.ttl
}

/** A compaction replaces the conversation with a summary: the next request
 *  rebuilds the cache on purpose, at the summary's size, 0 where it wasn't told. */
const noteCompaction = (s: CacheState, sizeAfter: number | undefined): void => {
  s.rebuilding = true
  s.window = sizeAfter ?? 0
  s.cached = 0
}

/** The lifetime the transcript's last cache write was made for, as read at a
 *  turn's end: the countdown runs on it, and the writes weighed at the other
 *  lifetime since the last read move to this one, so the rate is solved from
 *  what was really billed. A pin wins, and a read that ends after the next
 *  turn began waits for that turn's. */
const noteWrittenFor = (s: CacheState, ttl: Ttl): void => {
  if (s.ttlPinned || s.turnOpen) return
  s.ttl = ttl
  s.ttlRead = true
  const { bill, hourTokens } = writesReadAs(s.bill, ttl)
  s.bill = bill
  s.tokens = { ...s.tokens, writtenHour: s.tokens.writtenHour + hourTokens }
}

/** Whether a main-loop request that read `hit` tokens read short of what
 *  the cache held, by enough tokens and enough of it; undefined with nothing
 *  to measure it by: no prefix, one rebuilt on purpose, or another model. */
const shortOf = (s: CacheState, hit: number, switched: boolean): boolean | undefined => {
  const prefix = s.cached
  if (prefix <= 0 || s.rebuilding || switched) return undefined
  const shortfall = prefix - hit
  return shortfall >= MISS_MIN_TOKENS && shortfall > prefix * MISS_MIN_SHARE
}

/** A main-loop response, sent at `sentAt`, as a measure of the cache: a
 *  miss or a rebuild, what it leaves in the cache, and the model its reply
 *  was billed under. A
 *  subagent's prefix is its own, so it says nothing of the main conversation's
 *  cache or its countdown. Over `rounds` of a server-side tool loop each round
 *  read the prefix again, so the cache is measured by a round's share; where
 *  those are guessed, not `roundsSure`, the share may be half a whole read, so
 *  it counts as no miss. `messages` is how many messages it carried, where told. */
const measureCache = (s: CacheState, usage: Response, sentAt: number, rounds: number, roundsSure: boolean, messages: number | undefined): void => {
  const model = usage.model
  const perRound = (n: number): number => Math.round(n / rounds)
  const hit = perRound(usage.cache_read_input_tokens)
  const written = perRound(usage.cache_creation_input_tokens)
  if (model) s.billedModel = model

  // Read as cold already: a resume the engine called expired, or a recalled
  // reply past its TTL.
  const coldBefore = isRecalled(s, sentAt) && leftMsOf(s, sentAt) === 0
  const gap = s.requests > 0 ? sentAt - s.lastAt : 0
  // Another model has its own cache: reading nothing after a switch is no miss.
  const switched = s.model !== undefined && model !== undefined && model !== s.model
  // Nothing read or written of a prompt past every minimum: no cache to miss.
  const uncached = hit === 0 && written === 0 && perRound(usage.input_tokens) > UNCACHED_MIN_TOKENS
  // Fewer messages than last time: a /rewind, which reads the earlier entry.
  const rewound = messages !== undefined && s.messageCount !== undefined && messages < s.messageCount
  const short = uncached || rewound || !roundsSure ? undefined : shortOf(s, hit, switched)
  // The lifetime is read off the transcript at each turn's end. Until a read
  // succeeds, it is inferred from a request after five idle minutes: one that
  // read all it could, an hour; one that found only what other sessions keep
  // warm, the system prompt, five minutes. A read of more is a change to part
  // of the prefix (tool results cleared, the tools changed), which says
  // nothing of the lifetime.
  if (!s.ttlPinned && !s.ttlRead && short !== undefined && gap > TTL_MS['5m'] && gap <= TTL_MS['1h']) {
    if (!short) s.ttl = '1h'
    else if (hit <= COLD_READ_MAX_TOKENS) s.ttl = '5m'
  }
  // Short of a cache that should have been warm: within its TTL.
  const missed = short === true && gap <= TTL_MS[s.ttl]
  if (missed) s.misses += 1

  // A rebuild of a cache that existed: its time ran out, it missed, a
  // compaction rebuilt it, or the model changed. The first build
  // is warming, unless the cache it rebuilt was already read as cold. With
  // caching off on either side, nothing was rebuilt.
  if (!uncached && !s.notCaching && (coldBefore || (s.requests > 0 && (gap > TTL_MS[s.ttl] || missed || s.rebuilding || switched)))) s.lastRebuilt = true

  s.requests += 1
  // The next request's TTL follows the config in force, not the transcript's.
  s.ttlSeen = undefined
  // Every round's output stays in the conversation, so it is counted whole.
  s.window = perRound(usage.input_tokens) + hit + written + usage.output_tokens
  s.cached = hit + written
  s.lastAt = sentAt
  s.rebuilding = false
  s.compactedAt = undefined
  s.compactedIdle = false
  s.notCaching = uncached
  s.messageCount = messages ?? s.messageCount
  s.requestModel = s.priceModel
  if (usage.cache_creation_input_tokens > 0) s.writeUnreadSince = sentAt
  s.windowGuessed = !roundsSure
  s.model = model ?? s.model
}

// ---- the model --------------------------------------------------------------

/** What a session remembers of a turn, for when it is reopened or the band
 *  reloads: when its last reply was sent, the rate its bill solves to, the
 *  model that reply was billed under, and the model /model names. */
export type Remembered = Readonly<{ lastAt: number; rate: number | null; billed: string | undefined; priceModel: string | undefined }>

/** One session's cache model. Each entry is a hook's facts, in its shape,
 *  and each that is handed the ledger notes it before it reads it. */
export type CacheModel = Readonly<{
  /** Everything it holds, for the next model after a reload to start from. */
  kept: () => CacheState
  /** session.start, after a resume of this session is noted: the model
   *  /model names, and the ledger. A ledger that has spent nothing is a new
   *  conversation, unless the engine said it resumed one; one that can't be
   *  read says neither, so the band recalls the last reply. */
  loaded: (o: Readonly<{ priceModel: string | undefined; ledger: number | undefined }>) => void
  /** Whether to recall the last reply: none seen, and the engine said neither
   *  that the conversation starts here nor when its last reply was. */
  wantsRecall: () => boolean
  /** What the band recalls of the last reply, noted until this band's first
   *  reply, which speaks for itself; and what a resumed conversation's
   *  transcript shows, once read. */
  recalled: (reply: RecalledReply | undefined, transcript?: TranscriptFacts) => void
  /** session.start, once its settings are read: the TTL they pin, a
   *  subagent's TTL they pin, and where idle compaction runs from. */
  configured: (o: Readonly<{ ttl: Ttl | undefined; idleCompactFrom: number | undefined; subagentTtl?: Ttl | undefined }>) => void
  /** classic.SessionStart, a resume or fork: the engine's word on its cache,
   *  and its transcript's once read. */
  resumed: (o: Readonly<{ cache: ResumedCache | undefined; transcript: TranscriptFacts | undefined }>) => void
  /** turn.start of a main-loop turn: the model /model names now, the
   *  ledger, which the conversation's first turn takes as its baseline, and
   *  what started the turn, when the user didn't type it. */
  turnStarted: (o: Readonly<{ priceModel: string | undefined; ledger: number | undefined; wokenBy?: Waker }>) => void
  /** turn.step: a response's tokens, sent at `sentAt`; how many tool calls
   *  the API ran itself in it (the advisor), each starting a round whose
   *  tokens the usage sums; the ledger as the hook read it, as the step was
   *  sent and after; and how many messages the request carried. */
  responded: (usage: Response, sentAt: number, isMain: boolean, after?: Readonly<{ serverTools?: number; ledger?: number | undefined; ledgerBefore?: number | undefined; messages?: number }>) => void
  /** A compaction of the main conversation at `now`, to `sizeAfter` tokens:
   *  the cache it held is given up until the next reply. With no turn under
   *  way, not /compact, and long after the last request, it is Claude Code
   *  compacting the conversation before its cache ran out (the trigger it
   *  names isn't matched, so a new one still counts). */
  compacted: (o: Readonly<{ now: number; sizeAfter?: number; manual?: boolean }>) => void
  /** turn.complete of a main-loop turn: whether a request in it rebuilt the
   *  cache (TTL run out, a miss, a compaction, a model switch), taken once
   *  per turn, though the rebuild is usually its first request; and, once a
   *  reply has been seen, what to remember at `ledger`; and, where it wrote to
   *  the cache and no setting pins the lifetime, when the request behind its
   *  last write went, to read off the transcript the lifetime it was for. */
  turnEnded: (ledger: number | undefined) => Readonly<{ rebuilt: boolean; lifetimeSince: number | undefined; remember: Remembered | undefined }>
  /** The lifetime the transcript's last main-loop cache write was made for. */
  wroteFor: (ttl: Ttl) => void
  /** session.end: another conversation in the same process, at `ledger`. A
   *  /clear starts one here; a /resume moves to one already under way. */
  conversationEnded: (ledger: number, resumed: boolean) => void
  /** ui.render, with the ledger as it reads now, the model /model names now
   *  and the surface drawn on: the cache's view, and what the session has
   *  cost, to show. */
  view: (o: Readonly<{ now: number; ledger: number | undefined; contextTokens: number; autoCompactOff: boolean; modelNow?: string | undefined; surface?: RenderSurface }>) => Readonly<{ cache: CacheView; costUsd: number }>
  /** The cache's time left at `now`, for the timer's repaint. */
  leftMs: (now: number) => number
  /** How long a recalled cache has sat idle at `now`, for the timer's
   *  repaint; null unless it stands as recalled. */
  idleMs: (now: number) => number | null
}>

/** A session's cache model: before anything is known of it, or carrying on
 *  from what the model before a reload `kept`. */
export const newCache = (kept?: CacheState): CacheModel => {
  const s: CacheState = { ...INITIAL, ...kept }
  return {
    kept: () => ({ ...s }),
    loaded: ({ priceModel, ledger }) => {
      s.priceModel = priceModel
      if (!s.resumed && kept === undefined) s.knownFresh = ledger === 0
    },
    wantsRecall: () => s.requests === 0 && !s.knownFresh && s.resumedCache === undefined,
    recalled: (reply, transcript) => {
      if (s.requests === 0) {
        if (reply?.billed !== undefined) s.billedModel = reply.billed
        if (reply?.lastAt !== undefined) s.recall = { lastAt: reply.lastAt, rate: reply.rate }
      }
      if (transcript !== undefined) noteTranscript(s, transcript)
    },
    configured: ({ ttl, idleCompactFrom, subagentTtl }) => {
      if (ttl !== undefined) {
        s.ttl = ttl
        s.ttlPinned = true
      } else if (s.ttlPinned) {
        // Pinned before a reload and no longer: assumed again, as a new session's is.
        s.ttl = INITIAL.ttl
        s.ttlPinned = false
        s.ttlRead = false
      }
      s.subagentTtl = subagentTtl ?? '5m'
      s.idleCompactFrom = idleCompactFrom
    },
    resumed: ({ cache, transcript }) => {
      noteResume(s, cache)
      if (transcript !== undefined) noteTranscript(s, transcript)
    },
    turnStarted: ({ priceModel, ledger, wokenBy }) => {
      s.turnOpen = true
      s.turnWaker = wokenBy
      s.turnMeasured = false
      s.priceModel = priceModel
      s.bill = billAtTurnStart(s.bill, ledger)
    },
    responded: (usage, sentAt, isMain, after = {}) => {
      const rounds = (after.serverTools ?? 0) + 1
      // A reply that sent no tokens made no request: it read and kept no cache.
      const sent = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      const { bill: ledgered, told } = billAtStep(s.bill, after.ledgerBefore, after.ledger)
      s.bill = ledgered
      if (isMain && sent > 0) {
        // Claude Code hands a mod no list of a step's rounds, and a server
        // tool's block doesn't always start one, so a step with one is a guess.
        measureCache(s, usage, sentAt, rounds, rounds === 1, after.messages)
        s.turnMeasured = true
      }
      // Its writes last as long as its bucket's TTL: the main loop's as just
      // measured, a subagent's its own.
      const ttl = isMain ? effectiveTtl(s) : s.subagentTtl
      const weighed = weighResponse(usage, rounds, ttl)
      s.tokens = addTokens(s.tokens, weighed.request)
      // Only a bill that grew is kept off: with nothing to tell it by, the step stays on.
      const standing = told === undefined ? 'untold' : rounds === 1 ? 'told' : 'offBook'
      s.bill = bookResponse(s.bill, { ...weighed, model: usage.model, priced: pricedModel(s), standing, usd: told ?? 0, ttl, unread: isMain && rounds === 1 })
    },
    compacted: ({ now, sizeAfter, manual = false }) => {
      const idle = !s.turnOpen && !manual && s.requests > 0 && now - s.lastAt >= IDLE_GAP_MS
      noteCompaction(s, sizeAfter)
      s.compactedAt = now
      s.compactedIdle = idle
    },
    wroteFor: ttl => noteWrittenFor(s, ttl),
    turnEnded: ledger => {
      s.turnOpen = false
      const rebuilt = s.lastRebuilt
      const lifetimeSince = s.ttlPinned ? undefined : s.writeUnreadSince
      s.writeUnreadSince = undefined
      s.lastRebuilt = false
      // A turn that made no request (a limit hit, a lost connection) left the
      // countdown where it was, so what it says stays too.
      if (s.turnMeasured) s.lastWake = s.turnWaker === undefined ? undefined : { by: s.turnWaker, reWarm: rebuilt }
      s.turnWaker = undefined
      s.turnMeasured = false
      return { rebuilt, lifetimeSince, remember: s.requests === 0 ? undefined : { lastAt: s.lastAt, rate: rememberedRate(s.bill, pricingOf(s), ledger), billed: s.billedModel, priceModel: s.priceModel } }
    },
    conversationEnded: (ledger, resumed) => {
      // The billing mode, its TTL and the session's settings carry over;
      // everything measured starts again. The baseline is provisional until
      // the next turn starts and takes the ledger then.
      const { ttl, ttlPinned, ttlRead, subagentTtl, priceModel, billedModel, idleCompactFrom, turnOpen } = s
      Object.assign(s, INITIAL, { ttl, ttlPinned, ttlRead, subagentTtl, priceModel, billedModel, idleCompactFrom, turnOpen, bill: billOfNewConversation(ledger), knownFresh: !resumed })
    },
    view: ({ now, ledger, contextTokens, autoCompactOff, modelNow, surface }) => {
      s.bill = billAtRedraw(s.bill, ledger)
      return { cache: viewOf(s, now, ledger, contextTokens, autoCompactOff, { modelNow, ...(surface === undefined ? {} : { surface }) }), costUsd: spentUsd(s.bill, s.prior?.usd, ledger) }
    },
    leftMs: now => leftMsOf(s, now),
    idleMs: now => idleMsOf(s, now),
  }
}
