// What the band remembers across sessions: the store's entries taken as
// untrusted data, the newest sessions and a week of limit samples kept, and
// a session recalled from the store and its transcript.

import { test, expect } from 'claude-code/testing'
import {
  MAX_SAMPLES,
  MAX_SESSIONS,
  addSample,
  asLimitSamples,
  asRates,
  asSessions,
  fromStore,
  mergeSamples,
  needsTranscript,
  recallOf,
  rememberRate,
  rememberReply,
  sampleOf,
} from '../hooks/memory'
import { HOUR, costRecord, jsonl, rateNear, replyLine } from './helpers'

// ── the store, as untrusted data ───────────────────────────────────────

test('remembered sessions keep only entries with a finite reply time', () => {
  const stored = {
    good: { lastAt: 5 },
    extra: { lastAt: 1, note: 'kept as stored' },
    text: { lastAt: 'yesterday' },
    infinite: { lastAt: Infinity },
    nan: { lastAt: NaN },
    missing: {},
    none: null,
    list: [],
    bare: 7,
  }
  expect(asSessions(stored)).toEqual({ good: { lastAt: 5 }, extra: { lastAt: 1, note: 'kept as stored' } })
})

test('remembered sessions that are not a record are none', () => {
  for (const stored of [undefined, null, 'sessions', 3, [{ lastAt: 1 }]]) expect(asSessions(stored)).toEqual({})
})

test('remembered rates keep only positive finite numbers', () => {
  const stored = { opus: 0.00001, zero: 0, negative: -1, infinite: Infinity, nan: NaN, text: '0.00001', none: null }
  expect(asRates(stored)).toEqual({ opus: 0.00001 })
})

test('remembered rates that are not a record are none', () => {
  for (const stored of [undefined, null, 'rates', 3, [0.00001]]) expect(asRates(stored)).toEqual({})
})

// ── the sessions kept ──────────────────────────────────────────────────

const fifty = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`s${i}`, { lastAt: i }]))

test('a new reply joins the newest 50 sessions, and the oldest is forgotten', () => {
  const kept = rememberReply(fifty, 'new', 100)
  expect(Object.keys(kept)).toHaveLength(50)
  expect(kept.new).toEqual({ lastAt: 100 })
  expect(kept.s0).toBeUndefined()
  expect(kept.s1).toEqual({ lastAt: 1 })
})

test('a reply older than all 50 kept is itself the one forgotten', () => {
  const kept = rememberReply(fifty, 'old', -5)
  expect(Object.keys(kept)).toHaveLength(50)
  expect(kept.old).toBeUndefined()
  expect(kept.s0).toEqual({ lastAt: 0 })
})

test("a session's newer reply replaces its older one", () => {
  expect(rememberReply({ a: { lastAt: 1 }, b: { lastAt: 2 } }, 'a', 9)).toEqual({ a: { lastAt: 9 }, b: { lastAt: 2 } })
})

test('a stored record past the cap is written back as its newest sessions, malformed entries dropped', () => {
  const stored = { ...Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`s${i}`, { lastAt: i }])), infinite: { lastAt: Infinity }, text: { lastAt: '999' } }
  const kept = rememberReply(asSessions(stored), 'new', 1_000)
  expect(Object.keys(kept)).toHaveLength(MAX_SESSIONS)
  expect([kept.new, kept.s451, kept.s450, kept.infinite, kept.text]).toEqual([{ lastAt: 1_000 }, { lastAt: 451 }, undefined, undefined, undefined])
})

test('a reply billed under a model it names is remembered with that name', () => {
  expect(rememberReply({}, 'a', 9, 'claude-haiku-5-5')).toEqual({ a: { lastAt: 9, billed: 'claude-haiku-5-5' } })
})

test('the sessions kept stay under 6,000 bytes of JSON, at UUIDs, 13-digit times and the longest model name', () => {
  const at = Date.UTC(2026, 9, 6)
  const uuid = (i: number) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`
  let kept = {}
  for (let i = 0; i < 2 * MAX_SESSIONS; i++) kept = rememberReply(kept, uuid(i), at + i, 'claude-sonnet-5-5')
  expect(Object.keys(kept)).toHaveLength(MAX_SESSIONS)
  expect(JSON.stringify(kept).length).toBeLessThan(6_000)
})

// ── the limit samples kept ─────────────────────────────────────────────

const T0 = Date.UTC(2026, 9, 6, 8, 40) // Tue 08:40 UTC, the 7d window's start
const s = (hours: number, seven: number, five = 0) => ({ at: T0 + hours * HOUR, fivePct: five, sevenPct: seven, fiveResetAt: T0 + (Math.floor(hours / 5) + 1) * 5 * HOUR, sevenResetAt: T0 + 168 * HOUR })

test('one sample per 15-minute bucket, the latest winning, capped', () => {
  const held = addSample(addSample([], s(0, 1)), { ...s(0, 2), at: T0 + 60_000 })
  expect(held).toHaveLength(1)
  expect(held[0]?.sevenPct).toBe(2)
  let all = held
  // At their widest: 99.9, as the engine gives a limit at most one decimal, at 13-digit times.
  for (let i = 1; i < 800; i++) all = addSample(all, s(i * 0.25, 99.9, 99.9))
  // 800 buckets, so the oldest 128 go.
  expect(all).toHaveLength(MAX_SAMPLES)
  expect([all[0]?.at, all.at(-1)?.at]).toEqual([T0 + 128 * 0.25 * HOUR, T0 + 799 * 0.25 * HOUR])
  expect(JSON.stringify(all).length).toBeLessThan(75_000)
})

test('an earlier sample in the same bucket never replaces a later one', () => {
  expect(addSample([{ ...s(0, 2), at: T0 + 60_000 }], s(0, 1)).map(x => x.sevenPct)).toEqual([2])
})

test('merging keeps one sample per bucket, the later winning, sorted', () => {
  expect(mergeSamples([s(0, 1), s(1, 2)], [{ ...s(0, 5), at: T0 + 60_000 }, s(0.5, 3)]).map(x => x.sevenPct)).toEqual([5, 3, 2])
})

test('the store is data, not trusted', () => {
  expect(asLimitSamples([s(0, 1), { at: 'x' }, { ...s(1, 1), fivePct: Infinity }, { ...s(2, 1), sevenPct: '5' }, null, 42])).toHaveLength(1)
  for (const stored of [undefined, null, 'limitSamples', 3, {}]) expect(asLimitSamples(stored)).toEqual([])
})

test('a stored list past the cap is read as its newest week, malformed entries dropped', () => {
  const read = asLimitSamples([...Array.from({ length: 800 }, (_, i) => s(i * 0.25, 1)), { ...s(300, 1), fiveResetAt: NaN }])
  expect(read).toHaveLength(MAX_SAMPLES)
  expect([read[0]?.at, read.at(-1)?.at]).toEqual([T0 + 128 * 0.25 * HOUR, T0 + 799 * 0.25 * HOUR])
})

test('a sample holds whichever windows are reported with a reset', () => {
  const five = { kind: 'five_hour', percentUsed: 4, resetsAt: T0 + 3 * HOUR }
  const seven = { kind: 'seven_day', percentUsed: 30, resetsAt: T0 + 67 * HOUR }
  expect(sampleOf(T0, [five, seven])).toEqual({ at: T0, fivePct: 4, sevenPct: 30, fiveResetAt: T0 + 3 * HOUR, sevenResetAt: T0 + 67 * HOUR })
  // A plan with no 5h limit records the week alone, and the reverse.
  expect(sampleOf(T0, [seven])).toEqual({ at: T0, sevenPct: 30, sevenResetAt: T0 + 67 * HOUR })
  expect(sampleOf(T0, [five])).toEqual({ at: T0, fivePct: 4, fiveResetAt: T0 + 3 * HOUR })
  // A window with no reset has no name, so it is left out; with none left, no sample.
  expect(sampleOf(T0, [{ ...five, resetsAt: undefined }, seven])).toEqual({ at: T0, sevenPct: 30, sevenResetAt: T0 + 67 * HOUR })
  expect(sampleOf(T0, [{ ...five, resetsAt: undefined }])).toBeUndefined()
  expect(sampleOf(T0, [])).toBeUndefined()
})

test('a stored sample of one window is read, and an old one with both still is; half a window is not', () => {
  const weekOnly = { at: T0, sevenPct: 30, sevenResetAt: T0 + 67 * HOUR }
  expect(asLimitSamples([weekOnly, s(1, 2), { at: T0 + HOUR }, { ...weekOnly, at: T0 + 2 * HOUR, sevenResetAt: undefined }])).toEqual([weekOnly, s(1, 2)])
})

// ── the recall ─────────────────────────────────────────────────────────

const OPUS_RATE = 0.00001

test('the store recalls a session\'s last reply and the rate under the model /model names, its window aside', () => {
  const stored = fromStore({ sessions: { s1: { lastAt: 5_000 } }, rates: { 'claude-opus-5-5': OPUS_RATE } }, 's1', 'claude-opus-5-5[1m]')
  expect(needsTranscript(stored)).toBe(false)
  expect(recallOf(stored, undefined)).toEqual({ lastAt: 5_000, rate: OPUS_RATE, billed: undefined })
})

test("a session's record names the model its reply was billed under, and the rate kept under that name", () => {
  const stored = fromStore({ sessions: { s1: { lastAt: 5_000, billed: 'claude-haiku-5-5' } }, rates: { 'claude-haiku-5-5': OPUS_RATE, haiku: 1 } }, 's1', 'haiku')
  expect(needsTranscript(stored)).toBe(false)
  expect(recallOf(stored, undefined)).toEqual({ lastAt: 5_000, rate: OPUS_RATE, billed: 'claude-haiku-5-5' })
})

test("a record's billed model that isn't a name is unknown, so the transcript says it", () => {
  for (const billed of [42, '', null]) {
    const stored = fromStore({ sessions: { s1: { lastAt: 5_000, billed } }, rates: {} }, 's1', 'opus')
    expect(needsTranscript(stored)).toBe(true)
    expect(recallOf(stored, jsonl(replyLine(7_000), costRecord('claude-opus-5-5'))).billed).toBe('claude-opus-5-5')
  }
})

test('what the store leaves unknown, the transcript gives: its last reply, and the rate stored for the model it was billed under', () => {
  const stored = fromStore({ sessions: {}, rates: { 'claude-opus-5-5': OPUS_RATE } }, 's1', 'opus')
  expect(needsTranscript(stored)).toBe(true)
  expect(recallOf(stored, jsonl(replyLine(7_000)))).toEqual({ lastAt: 7_000, rate: OPUS_RATE, billed: 'claude-opus-5-5' })
})

test("with no rate stored for either, the rate is solved from the transcript's cost record", () => {
  const stored = fromStore({ sessions: { s1: { lastAt: 5_000 } }, rates: 'not rates' }, 's1', 'claude-opus-5-5')
  const recalled = recallOf(stored, jsonl(replyLine(7_000), costRecord('claude-opus-5-5')))
  // The store's time stands over the transcript's.
  expect(recalled.lastAt).toBe(5_000)
  expect(rateNear(recalled.rate, 20 / 3_000_000)).toBe(true)
})

test('no transcript to read leaves unknown what the store does', () => {
  expect(recallOf(fromStore({ sessions: undefined, rates: undefined }, 's1', 'opus'), undefined)).toEqual({ lastAt: undefined, rate: null, billed: undefined })
})

test('a rate is kept beside the others stored, and over its own', () => {
  expect(rememberRate({ 'claude-sonnet-5-5': 2, 'claude-opus-5-5': 1, bad: -1 }, 'claude-opus-5-5', 3)).toEqual({ 'claude-sonnet-5-5': 2, 'claude-opus-5-5': 3 })
})
