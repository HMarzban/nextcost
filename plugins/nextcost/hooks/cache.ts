// The prompt cache, as the band models it from each response's token counts,
// and what it means for the band: its mood, its charge, its last call. One
// model per session, made at session.start and fed each hook's facts in that
// hook's own shape; the order they must be applied in is kept here.

import type { ModelUsage } from 'claude-code'
import type { Tone } from './facts'
import { LAST_CALL_MS, MINUTE_MS, SOON_MS, fmtEstimate, fmtTokens } from './format'
import { NO_TOKENS, WRITE_MULT, addTokens, modelName, readMultiplier, tierFactor, weightedTokens } from './prices'
import type { TokenCounts, Ttl } from './prices'

export type { Ttl }
export const TTL_MS: Readonly<Record<Ttl, number>> = { '5m': 5 * MINUTE_MS, '1h': 60 * MINUTE_MS }

// A response that read this much less than the cache held, both in tokens and
// as a share of it, missed the cache.
const MISS_MIN_TOKENS = 2000
const MISS_MIN_SHARE = 0.05

/** Claude Code compacts a conversation left idle on the hour's cache about
 *  this long after its last request, before the cache runs out. */
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
  /** Claude Code may compact this conversation when it sits idle on the
   *  hour's cache: a terminal session, idle compaction on, and the context
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
  /** What requests in an upper price tier weigh beyond their tokens at the
   *  base rate, so the rate solved is still the lower tier's. */
  premium: number
  /** Cache reads counted at the lower tier's prices: an upper-tier request's
   *  reads count `factor` times, so what reading saved is priced as billed. */
  tieredReads: number
  /** What steps with a server-side tool loop (the advisor) were billed, and
   *  their weighted tokens: the tool's own round is billed but never in the
   *  usage, so the rate is solved without them. */
  offBookUsd: number
  offBookWeight: number
  /** The ledger as the last step or turn start read it, from which a step's
   *  bill is told. A redraw's read leaves it, so it never hides a step's. */
  ledgerSeen: number | undefined
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
  /** When Claude Code compacted the conversation while it sat idle: the
   *  cache it held is given up, and the next request writes the summary. */
  compactedAt: number | undefined
  /** The model the last main-loop request ran on; a switch rebuilds the cache. */
  model: string | undefined
  /** Since the turn's end last read it, a main-loop request rebuilt a cache
   *  that existed. */
  lastRebuilt: boolean
  /** The ledger when this conversation's first turn began, so spend from
   *  before it (a /clear, a resume, a reload) can't inflate the rate the
   *  re-warm price is solved from. */
  costBase: number
  baselined: boolean
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
  /** The model the main loop's last reply was billed under, as the API names
   *  it. Where known, the tokens are priced at it. */
  billedModel: string | undefined
}

const INITIAL: Readonly<CacheState> = {
  ttl: '1h',
  ttlPinned: false,
  subagentTtl: '5m',
  ttlSeen: undefined,
  idleCompactFrom: undefined,
  turnOpen: false,
  turnWaker: undefined,
  turnMeasured: false,
  lastWake: undefined,
  requests: 0,
  tokens: NO_TOKENS,
  premium: 0,
  tieredReads: 0,
  offBookUsd: 0,
  offBookWeight: 0,
  ledgerSeen: undefined,
  misses: 0,
  lastAt: 0,
  window: 0,
  cached: 0,
  rebuilding: false,
  compactedAt: undefined,
  model: undefined,
  lastRebuilt: false,
  costBase: 0,
  baselined: false,
  knownFresh: false,
  resumed: false,
  resumedCache: undefined,
  recall: undefined,
  prior: undefined,
  priceModel: undefined,
  billedModel: undefined,
}

// ---- what the state says ----------------------------------------------------

/** When the conversation's last reply was, before this band's own: as the
 *  engine said on a resume, else as recalled. */
const recalledAt = (s: CacheState): number | undefined => s.resumedCache?.lastAt ?? s.recall?.lastAt

/** Whether the cache stands as recalled: no reply seen yet, a conversation
 *  that didn't start here, and something to recall. */
const isRecalled = (s: CacheState): boolean => s.requests === 0 && !s.knownFresh && recalledAt(s) !== undefined

/** The TTL the cache stands at: the pin, else one seen on the transcript,
 *  else the one assumed or inferred. */
const effectiveTtl = (s: CacheState): Ttl => (s.ttlPinned ? s.ttl : (s.ttlSeen ?? s.ttl))

/** The model the tokens are priced at: the one replies are billed under, else
 *  what /model names, which may be an alias such as `opus[1m]`. */
const pricedModel = (s: CacheState): string | undefined => s.billedModel ?? (s.priceModel === undefined ? undefined : modelName(s.priceModel))

/** What the session has cost, to show: the ledger, or for a resumed
 *  conversation the larger of the ledger and its transcript's total, with
 *  the ledger's growth since the conversation's first turn on top. Never
 *  both summed: a host may restore the ledger on a resume, or may not, and
 *  may restore it only after the transcript is read, so the growth counts
 *  from the baseline that turn takes, never from the ledger at the read. */
const spentUsd = (s: CacheState, ledgerNow: number | undefined): number => {
  const ledger = ledgerNow ?? 0
  const prior = s.prior
  if (prior === undefined) return ledger
  const growth = s.baselined ? ledger - s.costBase : 0
  return Math.max(ledger, prior.usd + growth)
}

/** Every token since the conversation began: a resumed one's earlier tokens
 *  with this process's. */
const allTokens = (s: CacheState): TokenCounts => (s.prior === undefined ? s.tokens : addTokens(s.tokens, s.prior.tokens))

/** The base rate per token, in dollars.
 *
 *  No pricing table is available to a mod, so the rate is solved from the
 *  session's own bill since its baseline, which leaves one unknown:
 *
 *    cost - costBase = r * (weightedTokens(tokens) + premium)
 *
 *  where premium weighs each upper-tier request again, so r is the lower
 *  tier's rate on a model with two, and a step with a server-side tool loop
 *  is left out of both sides, its tool's round billed with no tokens shown.
 *
 *  It self-calibrates to whatever model and plan are in force, and it is an
 *  estimate on top of an estimate (the session cost is itself computed at list
 *  price), so what it prices is always shown with a "~". */
const ratePerToken = (s: CacheState, sessionCost: number | undefined): number | null => {
  if (sessionCost === undefined) return null
  const weighted = weightedTokens(s.tokens, pricedModel(s)) + s.premium - s.offBookWeight
  const billed = sessionCost - s.costBase - s.offBookUsd
  return weighted > 0 && billed > 0 ? billed / weighted : null
}

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
const coldAtOf = (s: CacheState): number | null => {
  if (s.compactedAt !== undefined) return s.compactedAt
  const measured = measuredColdAt(s)
  if (measured !== null) return measured
  if (s.resumedCache?.expired === true) return null
  const recalled = isRecalled(s) ? recalledAt(s) : undefined
  return recalled === undefined ? null : recalled + TTL_MS[effectiveTtl(s)]
}

/** The cache's time left: from the last reply this band saw, else the one
 *  it recalls, none if the engine called it expired; a full lifetime before
 *  either. */
const leftMsOf = (s: CacheState, now: number): number => {
  if (s.compactedAt !== undefined) return 0
  if (s.requests === 0 && s.resumedCache?.expired === true) return 0
  const at = coldAtOf(s)
  return at === null ? TTL_MS[effectiveTtl(s)] : Math.max(0, at - now)
}

/** How long the recalled reply has sat idle at `now`; null unless the
 *  cache stands as recalled. */
const idleMsOf = (s: CacheState, now: number): number | null => {
  const lastAt = recalledAt(s)
  return isRecalled(s) && lastAt !== undefined ? now - lastAt : null
}

/** The cache as the band shows it, at `now`: measured once a reply has been
 *  seen, recalled before that. `contextTokens` is the context as it stands,
 *  which a recalled cold cache would rebuild. */
const viewOf = (s: CacheState, now: number, sessionCost: number | undefined, contextTokens: number, autoCompactOff: boolean): CacheView => {
  const recalled = isRecalled(s)
  const recallRate = s.recall?.rate ?? null
  // A resume's price is the engine's own; else it is solved from the rate recalled.
  const recalledPrice = s.resumedCache?.reWarmUsd ?? (recallRate === null ? null : reWarmAt(s, recallRate, contextTokens))
  const rate = ratePerToken(s, sessionCost)
  const tokens = allTokens(s)
  const input = tokens.read + tokens.written + tokens.uncached
  const share = readMultiplier(pricedModel(s))
  return {
    requests: s.requests,
    leftMs: leftMsOf(s, now),
    coldAt: coldAtOf(s),
    ttl: effectiveTtl(s),
    // Known, not assumed: pinned, or seen on the transcript's last cache write.
    ttlPinned: s.ttlPinned || s.ttlSeen !== undefined,
    window: recalled ? contextTokens : s.window,
    hitRatio: input > 0 ? tokens.read / input : null,
    misses: s.misses,
    // A measured cold cache rebuilds with a cache write of the whole window.
    reWarmUsd: recalled ? recalledPrice : rate === null ? null : reWarmAt(s, rate, s.window),
    recalled,
    idleMs: idleMsOf(s, now),
    // Every cache read saved the rest of the base rate against full input price.
    savedUsd: rate === null || tokens.read <= 0 ? null : rate * (1 - share) * (s.tieredReads + (s.prior?.tokens.read ?? 0)),
    readShare: share,
    fresh: s.knownFresh,
    compacted: s.compactedAt !== undefined,
    idleCompacts: s.idleCompactFrom !== undefined && !autoCompactOff && contextTokens >= s.idleCompactFrom,
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

/** The engine may reset the ledger on /clear: once it reads below the
 *  baseline, it counts this conversation alone, so the baseline is 0. */
const noteLedger = (s: CacheState, costNow: number | undefined): void => {
  if (costNow !== undefined && costNow < s.costBase) s.costBase = 0
}

/** The ledger read after a response. A step with a server-side tool loop,
 *  `offBook` its weighted tokens, is billed what the ledger grew by since
 *  the last step, kept off the rate's books with its tokens. Only a bill
 *  that grew is kept off: with nothing to tell it by, the step stays on. */
const noteStepLedger = (s: CacheState, costNow: number | undefined, offBook: number | undefined): void => {
  const before = s.ledgerSeen
  noteLedger(s, costNow)
  if (costNow === undefined) return
  s.ledgerSeen = costNow
  if (offBook !== undefined && before !== undefined && costNow > before) {
    s.offBookUsd += costNow - before
    s.offBookWeight += offBook
  }
}

/** A compaction replaces the conversation with a summary: the next request
 *  rebuilds the cache on purpose, at the summary's size. */
const noteCompaction = (s: CacheState, sizeAfter: number | undefined): void => {
  s.rebuilding = true
  if (sizeAfter !== undefined) {
    s.window = sizeAfter
    s.cached = 0
  }
}

/** A response's tokens toward the bill: every response's, a subagent's
 *  included, since the session's bill includes every subagent and the rate
 *  is solved from it. Its writes last `ttl`, its bucket's. Over `rounds` of
 *  a server-side tool loop, the usage sums every round's. Returns the
 *  response's weighted tokens. */
const billResponse = (s: CacheState, usage: Response, rounds: number, ttl: Ttl): number => {
  const hit = usage.cache_read_input_tokens
  const written = usage.cache_creation_input_tokens
  const uncached = usage.input_tokens
  const request = { uncached, written, writtenHour: ttl === '1h' ? written : 0, read: hit, output: usage.output_tokens }
  s.tokens = addTokens(s.tokens, request)
  // A request is priced by its whole prompt, cache reads and writes included:
  // each round's, where a tool loop sums them.
  const factor = tierFactor(usage.model, (uncached + hit + written) / rounds)
  const weighted = factor * weightedTokens(request, usage.model)
  s.premium += weighted - weightedTokens(request, usage.model)
  s.tieredReads += factor * hit
  return weighted
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
 *  was billed under. A subagent's prefix is its own, so it says nothing of
 *  the main conversation's cache or its countdown. Over `rounds` of a
 *  server-side tool loop each round read the prefix again, so the cache is
 *  measured by a round's share. */
const measureCache = (s: CacheState, usage: Response, sentAt: number, rounds: number): void => {
  const model = usage.model
  const perRound = (n: number): number => Math.round(n / rounds)
  const hit = perRound(usage.cache_read_input_tokens)
  const written = perRound(usage.cache_creation_input_tokens)
  if (model) s.billedModel = model

  // Read as cold already: a resume the engine called expired, or a recalled
  // reply past its TTL.
  const coldBefore = isRecalled(s) && leftMsOf(s, sentAt) === 0
  const gap = s.requests > 0 ? sentAt - s.lastAt : 0
  // Another model has its own cache: reading nothing after a switch is no miss.
  const switched = s.model !== undefined && model !== undefined && model !== s.model
  const short = shortOf(s, hit, switched)
  // Unpinned, the TTL is read off a request after five idle minutes: one that
  // read short found only what other sessions keep warm, the system prompt,
  // so the cache lived five minutes; one that read it all, an hour. Claude
  // Code switches as a subscription goes onto usage credits, or back off.
  if (!s.ttlPinned && short !== undefined && gap > TTL_MS['5m'] && gap <= TTL_MS['1h']) s.ttl = short ? '5m' : '1h'
  // Short of a cache that should have been warm: within its TTL.
  const missed = short === true && gap <= TTL_MS[s.ttl]
  if (missed) s.misses += 1

  // A rebuild of a cache that existed: its time ran out, it missed, a
  // compaction rebuilt it, or the model changed. The first build is warming,
  // unless the cache it rebuilt was already read as cold.
  if (coldBefore || (s.requests > 0 && (gap > TTL_MS[s.ttl] || missed || s.rebuilding || switched))) s.lastRebuilt = true

  s.requests += 1
  // The next request's TTL follows the config in force, not the transcript's.
  s.ttlSeen = undefined
  // Every round's output stays in the conversation, so it is counted whole.
  s.window = perRound(usage.input_tokens) + hit + written + usage.output_tokens
  s.cached = hit + written
  s.lastAt = sentAt
  s.rebuilding = false
  s.compactedAt = undefined
  s.model = model ?? s.model
}

// ---- the model --------------------------------------------------------------

/** A response, as turn.step has it. */
type Response = Pick<ModelUsage, 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'> &
  Readonly<{ model?: string }>

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
   *  tokens the usage sums; and the ledger as the hook read it after. */
  responded: (usage: Response, sentAt: number, isMain: boolean, after?: Readonly<{ serverTools?: number; ledger?: number | undefined }>) => void
  /** A compaction of the main conversation at `now`, to `sizeAfter` tokens.
   *  With no turn under way, not /compact, and long after the last request,
   *  it is Claude Code compacting the conversation before its cache ran out
   *  (the trigger it names isn't matched, so a new one still counts); else
   *  the cache is rebuilt on purpose. */
  compacted: (o: Readonly<{ now: number; sizeAfter?: number; manual?: boolean }>) => void
  /** turn.complete of a main-loop turn: whether a request in it rebuilt the
   *  cache (TTL run out, a miss, a compaction, a model switch), taken once
   *  per turn, though the rebuild is usually its first request; and, once a
   *  reply has been seen, what to remember at `ledger`. */
  turnEnded: (ledger: number | undefined) => Readonly<{ rebuilt: boolean; remember: Remembered | undefined }>
  /** session.end: another conversation in the same process, at `ledger`. A
   *  /clear starts one here; a /resume moves to one already under way. */
  conversationEnded: (ledger: number, resumed: boolean) => void
  /** ui.render, with the ledger as it reads now: the cache's view, and what
   *  the session has cost, to show. */
  view: (o: Readonly<{ now: number; ledger: number | undefined; contextTokens: number; autoCompactOff: boolean }>) => Readonly<{ cache: CacheView; costUsd: number }>
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
      if (ledger !== undefined) s.ledgerSeen = ledger
      // The ledger as this conversation's first turn starts: its baseline.
      if (ledger !== undefined && !s.baselined) {
        s.costBase = ledger
        s.baselined = true
      }
    },
    responded: (usage, sentAt, isMain, after = {}) => {
      const rounds = (after.serverTools ?? 0) + 1
      // A reply that sent no tokens made no request: it read and kept no cache.
      const sent = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      if (isMain && sent > 0) {
        measureCache(s, usage, sentAt, rounds)
        s.turnMeasured = true
      }
      // Its writes last as long as its bucket's TTL: the main loop's as just
      // measured, a subagent's its own.
      const weighted = billResponse(s, usage, rounds, isMain ? effectiveTtl(s) : s.subagentTtl)
      noteStepLedger(s, after.ledger, rounds > 1 ? weighted : undefined)
    },
    compacted: ({ now, sizeAfter, manual = false }) => {
      const idle = !s.turnOpen && !manual && s.requests > 0 && now - s.lastAt >= IDLE_GAP_MS
      noteCompaction(s, sizeAfter)
      // An idle one's cache counts as gone from then, at the summary's size.
      if (idle && sizeAfter !== undefined) s.compactedAt = now
    },
    turnEnded: ledger => {
      s.turnOpen = false
      const rebuilt = s.lastRebuilt
      s.lastRebuilt = false
      // A turn that made no request (a limit hit, a lost connection) left the
      // countdown where it was, so what it says stays too.
      if (s.turnMeasured) s.lastWake = s.turnWaker === undefined ? undefined : { by: s.turnWaker, reWarm: rebuilt }
      s.turnWaker = undefined
      s.turnMeasured = false
      return { rebuilt, remember: s.requests === 0 ? undefined : { lastAt: s.lastAt, rate: ratePerToken(s, ledger), billed: s.billedModel, priceModel: s.priceModel } }
    },
    conversationEnded: (ledger, resumed) => {
      // The billing mode, its TTL and the session's settings carry over;
      // everything measured starts again. The baseline is provisional until
      // the next turn starts and takes the ledger then.
      const { ttl, ttlPinned, subagentTtl, priceModel, billedModel, idleCompactFrom, turnOpen } = s
      Object.assign(s, INITIAL, { ttl, ttlPinned, subagentTtl, priceModel, billedModel, idleCompactFrom, turnOpen, costBase: ledger, ledgerSeen: ledger, knownFresh: !resumed })
    },
    view: ({ now, ledger, contextTokens, autoCompactOff }) => {
      noteLedger(s, ledger)
      return { cache: viewOf(s, now, ledger, contextTokens, autoCompactOff), costUsd: spentUsd(s, ledger) }
    },
    leftMs: now => leftMsOf(s, now),
    idleMs: now => idleMsOf(s, now),
  }
}

// ---- what it means ----------------------------------------------------------

/** Unmeasured: loaded mid-conversation, before its next reply. Compacted:
 *  cold because Claude Code compacted the conversation while it sat idle, so
 *  the next message writes the summary. */
type CacheMood = 'unmeasured' | 'warming' | 'warm' | 'expiring' | 'cold' | 'compacted'

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
    /** Measured, or recalled from the session's last reply: time and price known. */
    known: boolean
    /** No time to count yet, neither seen nor recalled: unmeasured, or warming. */
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
  c.requests === 0 && !c.recalled
    ? c.fresh
      ? 'warming'
      : 'unmeasured'
    : c.leftMs <= 0
      ? c.compacted
        ? 'compacted'
        : 'cold'
      : c.leftMs <= SOON_MS
        ? 'expiring'
        : 'warm'

/** What the cache's view means while Claude is working, or isn't. */
export const cacheFactsOf = (c: CacheView, isWorking: boolean): CacheFacts => {
  const mood = moodOf(c)
  const measured = c.requests > 0 || c.recovered
  // Mid-turn every step restarts the TTL, so a countdown would only bounce.
  const counting = mood === 'expiring' || (mood === 'warm' && !isWorking)
  const untimed = mood === 'unmeasured' || mood === 'warming'
  const timeless = untimed || mood === 'cold' || mood === 'compacted'
  return {
    ...c,
    mood,
    tone: mood === 'expiring' ? 'amber' : 'calm',
    charge: timeless ? 0 : mood === 'warm' && isWorking ? 1 : c.leftMs / TTL_MS[c.ttl],
    estimate: c.reWarmUsd !== null ? fmtEstimate(c.reWarmUsd) : `${fmtTokens(c.window)} tokens`,
    measured,
    known: measured || c.recalled,
    untimed,
    hitFrac: measured && c.hitRatio !== null ? c.hitRatio : undefined,
    coldInMs: counting ? c.leftMs : undefined,
    // A 5-minute cache is always under ten minutes from cold, so its last
    // call is its last minute, when chips turns amber too.
    lastCall: counting && (c.ttl === '5m' ? mood === 'expiring' : c.leftMs < LAST_CALL_MS),
    idleCompactSoon: counting && c.idleCompacts && c.ttl === '1h' && c.leftMs > TTL_MS['1h'] - IDLE_COMPACT_MS,
  }
}
