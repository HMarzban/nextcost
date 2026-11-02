// What the band remembers across sessions, in the plugin's own store: when
// each session last had a reply and the model it was billed under, what a
// token costs on each model, the layout the band draws in, and a week's
// worth of limit samples. With the first two a reopened session, or a
// reload, says whether its cache is cold and what the next message costs,
// before any reply of its own, and with the samples the week shows the days
// before this session. What the store leaves unknown of a last reply is
// recalled off the transcript.

import type { RecalledReply } from './cache'
import { MINUTE_MS, SEVEN_DAY_MS } from './format'
import { modelName } from './prices'
import { splitLimits } from './snapshot'
import type { ReportedLimit } from './snapshot'
import { isRecord, lastRequestAt, lastReplyModel, rateFromTranscript } from './transcript'

/** Store keys. */
export const SESSIONS_KEY = 'sessions'
export const RATES_KEY = 'rates'
export const LAYOUT_KEY = 'layout'
export const LIMIT_SAMPLES_KEY = 'limitSamples'

/** Sessions kept, newest reply first; the rest are forgotten. */
export const MAX_SESSIONS = 50

/** A session's last main-loop reply: when it was, and the model it was
 *  billed under, as the API names it. A version before 0.19.0 wrote `lastAt`
 *  alone and reads past `billed`; `billed` is data, read only where used. */
type SessionRecord = Readonly<{ lastAt: number; billed?: unknown }>

/** Each session's last main-loop reply, by session id. */
type Sessions = Readonly<Record<string, SessionRecord>>

/** The base input rate per token, solved from a session's own bill, by model. */
type Rates = Readonly<Record<string, number>>

/** The store's sessions, keeping only well-formed entries taken by `now`: it
 *  is data, not trusted, and a reply dated later, from a clock that ran
 *  ahead, would count down for good and hold a place among the newest. */
export const asSessions = (v: unknown, now: number): Sessions =>
  isRecord(v)
    ? Object.fromEntries(
        Object.entries(v).filter(
          (entry): entry is [string, SessionRecord] =>
            isRecord(entry[1]) && typeof entry[1].lastAt === 'number' && Number.isFinite(entry[1].lastAt) && entry[1].lastAt <= now,
        ),
      )
    : {}

/** The store's rates, keeping only positive finite numbers. */
export const asRates = (v: unknown): Rates =>
  isRecord(v)
    ? Object.fromEntries(
        Object.entries(v).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0),
      )
    : {}

/** The key a rate is kept and found under: the model it was billed under,
 *  its window aside, as every released version has kept it. */
const rateKey = (model: string): string => modelName(model)

/** The rate stored for `model`; an inherited property of Object, such as a
 *  model named `constructor`, is none. */
const rateFor = (rates: Rates, model: string): number | undefined => (Object.hasOwn(rates, rateKey(model)) ? rates[rateKey(model)] : undefined)

/** The store's rates with `rate` kept for `model`, the one billed. */
export const rememberRate = (stored: unknown, model: string, rate: number): Rates => ({ ...asRates(stored), [rateKey(model)]: rate })

/** `sessions` with `id`'s reply at `lastAt`, billed under `billed` where
 *  known, the oldest dropped past MAX_SESSIONS. */
export const rememberReply = (sessions: Sessions, id: string, lastAt: number, billed?: string): Sessions =>
  Object.fromEntries(
    Object.entries({ ...sessions, [id]: billed === undefined ? { lastAt } : { lastAt, billed } })
      .sort(([, a], [, b]) => b.lastAt - a.lastAt)
      .slice(0, MAX_SESSIONS),
  )

/** The limits at one moment, each with the reset that names its window
 *  (epoch ms). A plan without a window leaves its pair out; released
 *  versions wrote both, always. */
export type Sample = Readonly<{ at: number; fivePct?: number; fiveResetAt?: number; sevenPct?: number; sevenResetAt?: number }>

const BUCKET_MS = 15 * MINUTE_MS
/** A week of buckets. */
export const MAX_SAMPLES = SEVEN_DAY_MS / BUCKET_MS

/** The 15-minute bucket `at` falls in. */
const bucketOf = (at: number): number => Math.floor(at / BUCKET_MS)

/** Whether two samples fall in one bucket. */
export const sameBucket = (a: Sample, b: Sample): boolean => bucketOf(a.at) === bucketOf(b.at)

/** Two lists as one: one per bucket, the later winning, sorted, capped. */
export const mergeSamples = (a: readonly Sample[], b: readonly Sample[]): Sample[] => {
  const byBucket = new Map<number, Sample>()
  for (const s of [...a, ...b]) {
    const bucket = bucketOf(s.at)
    const had = byBucket.get(bucket)
    if (had === undefined || s.at >= had.at) byBucket.set(bucket, s)
  }
  return [...byBucket.values()].sort((x, y) => x.at - y.at).slice(-MAX_SAMPLES)
}

/** `samples` with `s` added, as mergeSamples keeps them. */
export const addSample = (samples: readonly Sample[], s: Sample): Sample[] => mergeSamples(samples, [s])

/** The samples taken by `now`: one dated later, from a clock that ran ahead,
 *  would stay last and open a new bucket every turn. */
export const samplesUpTo = (samples: readonly Sample[], now: number): Sample[] => samples.filter(s => s.at <= now)

const finite = (v: unknown): boolean => Number.isFinite(v)
/** Whether a window's pair is whole or wholly absent, and which. */
const pairOf = (v: Readonly<Record<string, unknown>>, pct: string, reset: string): 'whole' | 'absent' | 'torn' =>
  finite(v[pct]) && finite(v[reset]) ? 'whole' : v[pct] === undefined && v[reset] === undefined ? 'absent' : 'torn'

/** A well-formed sample: its time, and at least one window whole, the
 *  other whole or absent, never half a pair. */
const isSample = (v: unknown): v is Sample => {
  if (!isRecord(v) || !finite(v.at)) return false
  const pairs = [pairOf(v, 'fivePct', 'fiveResetAt'), pairOf(v, 'sevenPct', 'sevenResetAt')]
  return !pairs.includes('torn') && pairs.includes('whole')
}

/** The store's samples, keeping only well-formed ones, one per bucket, sorted. */
export const asLimitSamples = (v: unknown): Sample[] => (Array.isArray(v) ? mergeSamples([], v.filter(isSample)) : [])

/** The limits now, as one sample: each window reported with a reset;
 *  undefined with none. */
export const sampleOf = (now: number, limits: readonly ReportedLimit[]): Sample | undefined => {
  const { five, seven } = splitLimits(limits)
  const fiveAt = five?.resetsAt
  const sevenAt = seven?.resetsAt
  const fiveWindow = five === undefined || fiveAt === undefined ? {} : { fivePct: five.percentUsed, fiveResetAt: fiveAt }
  const sevenWindow = seven === undefined || sevenAt === undefined ? {} : { sevenPct: seven.percentUsed, sevenResetAt: sevenAt }
  return Object.keys(fiveWindow).length + Object.keys(sevenWindow).length === 0 ? undefined : { at: now, ...fiveWindow, ...sevenWindow }
}

/** What the band's own store recalls of a session's last reply: when it
 *  was, the model it was billed under, and the rate on that model, else on
 *  the model /model names; with every rate stored, for the model a
 *  transcript names. */
type StoreRecall = Readonly<{ rates: Rates; model: string; lastAt: number | undefined; billed: string | undefined; rate: number | null }>

/** The billed model a session's record names; undefined for anything else. */
const billedOf = (record: SessionRecord | undefined): string | undefined =>
  typeof record?.billed === 'string' && record.billed !== '' ? record.billed : undefined

/** What the store recalls of `sessionId`'s last reply, on `model` as /model
 *  names it. With the billed model recorded, the rate is the one kept under
 *  that name; a record from before 0.19.0 names none, and the rate under the
 *  /model name stands in, which is the billed one when /model names it in full. */
export const fromStore = (stored: Readonly<{ sessions: unknown; rates: unknown }>, sessionId: string, model: string, now: number): StoreRecall => {
  const rates = asRates(stored.rates)
  const record = asSessions(stored.sessions, now)[sessionId]
  const billed = billedOf(record)
  const key = rateKey(model)
  return { rates, model: key, lastAt: record?.lastAt, billed, rate: rateFor(rates, billed ?? key) ?? null }
}

/** Whether the store leaves a fact unknown that the transcript may give. */
export const needsTranscript = (r: StoreRecall): boolean => r.lastAt === undefined || r.rate === null

/** The last reply as recalled: the store's facts first; what they leave
 *  unknown off the transcript's end, when one was read: its last reply's
 *  time and the model it was billed under, and the rate on that model, as
 *  stored under its name or else solved from the transcript's cost record. */
export const recallOf = (r: StoreRecall, transcript: string | undefined, now: number): RecalledReply => {
  if (transcript === undefined) return { lastAt: r.lastAt, rate: r.rate, billed: r.billed }
  // /model may name an alias; the last reply names the model it was billed under.
  const billed = lastReplyModel(transcript) ?? r.billed
  const logged = lastRequestAt(transcript)
  return {
    // A request logged after now is unknown, not the time recalled.
    lastAt: r.lastAt ?? (logged !== undefined && logged <= now ? logged : undefined),
    rate: r.rate ?? (billed === undefined ? rateFromTranscript(transcript, r.model) : (rateFor(r.rates, billed) ?? rateFromTranscript(transcript, billed))),
    billed,
  }
}
