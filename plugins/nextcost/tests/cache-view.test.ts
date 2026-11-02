// The cache's view for the band, straight from the model: measured once a
// reply has been seen, recalled before that, and one rule between the two.

import { test, expect } from 'claude-code/testing'
import { newCache } from '../hooks/cache'
import { cacheFactsOf } from '../hooks/cache-facts'
import type { CacheModel } from '../hooks/cache'
import { BUILD_155K, MIN } from './helpers'

const RATE = 0.00001

/** The cache's view at `now`, with the ledger at `ledger` and `contextTokens` in context. */
const viewAt = (c: CacheModel, now: number, ledger: number | undefined, contextTokens: number) =>
  c.view({ now, ledger, contextTokens, autoCompactOff: false }).cache

/** Loaded with `ledger` on it, the last reply recalled at 0 with `rate`. */
const recalledAt0 = (ledger: number, rate: number | null, namedModel?: string): CacheModel => {
  const c = newCache()
  c.loaded({ namedModel, ledger })
  c.recalled({ lastAt: 0, rate, billed: undefined })
  return c
}

test('recalled, the cache counts down from the last reply and prices the whole context', () => {
  // Spend on the ledger: the conversation started before the band.
  const view = viewAt(recalledAt0(2.41, RATE), 10 * MIN, 2.41, 76_000)
  expect(view.recalled).toBe(true)
  expect(view.leftMs).toBe(50 * MIN) // the assumed hour, from the last reply
  expect(view.window).toBe(76_000)
  // A re-warm on the hour writes for an hour, at 2× base input.
  expect(Math.abs((view.reWarmUsd ?? 0) - 2 * RATE * 76_000)).toBeLessThan(1e-9)
  expect(view.idleMs).toBe(10 * MIN)
})

test("the timer reads the recalled cache's time left and idle time as its view does", () => {
  const c = recalledAt0(2.41, RATE)
  expect([c.leftMs(10 * MIN), c.idleMs(10 * MIN)]).toEqual([50 * MIN, 10 * MIN])
  c.responded({ input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 80_000 }, 15 * MIN, true)
  expect(c.idleMs(20 * MIN)).toBeNull()
})

test('with no rate recalled, the re-warm price is unknown, not guessed', () => {
  expect(viewAt(recalledAt0(2.41, null), 10 * MIN, 2.41, 76_000).reWarmUsd).toBeNull()
})

test('a conversation known to start here ignores anything recalled', () => {
  const c = newCache()
  c.conversationEnded(0, false)
  c.recalled({ lastAt: 0, rate: RATE, billed: undefined })
  const view = viewAt(c, 10 * MIN, 0, 76_000)
  expect(view.recalled).toBe(false)
  expect(view.idleMs).toBeNull()
})

test("once a reply is seen, the measured cache stands and the recall doesn't", () => {
  const c = recalledAt0(2.41, RATE)
  c.responded({ input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 80_000 }, 5 * MIN, true)
  const view = viewAt(c, 10 * MIN, 2.41, 76_000)
  expect(view.recalled).toBe(false)
  expect(view.leftMs).toBe(55 * MIN) // from the reply this band saw
  expect(view.window).toBe(81_500)
})

test('a new session forgets the recall and the model the tokens were priced at', () => {
  expect(viewAt(recalledAt0(2.41, RATE, 'claude-opus-5-5'), 0, 2.41, 0).readShare).toBe(0.05)
  const c = newCache()
  c.loaded({ namedModel: undefined, ledger: 2.41 })
  const view = viewAt(c, 0, 2.41, 0)
  expect(view.recalled).toBe(false)
  expect(view.readShare).toBe(0.1)
})

test('coldAt: null before a reply, the reply plus the lifetime after, null once a resume is called expired', () => {
  const c = newCache()
  expect(viewAt(c, 0, undefined, 0).coldAt).toBeNull()
  c.responded({ input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000 }, 5 * MIN, true)
  const v = viewAt(c, 10 * MIN, undefined, 0)
  expect(v.coldAt).toBe(10 * MIN + v.leftMs)
  const resumed = newCache()
  resumed.resumed({ cache: { lastAt: 0, expired: true, reWarmUsd: 0.5 }, transcript: undefined })
  expect(viewAt(resumed, MIN, undefined, 0).coldAt).toBeNull()
  expect(viewAt(resumed, MIN, undefined, 0).leftMs).toBe(0)
})

test("a ledger that has spent nothing is a new conversation; one that can't be read is not known to be", () => {
  const spent = newCache()
  spent.loaded({ namedModel: undefined, ledger: 0 })
  expect(viewAt(spent, 0, 0, 0).fresh).toBe(true)
  expect(spent.wantsRecall()).toBe(false)
  const unread = newCache()
  unread.loaded({ namedModel: undefined, ledger: undefined })
  expect(viewAt(unread, 0, undefined, 0).fresh).toBe(false)
  expect(unread.wantsRecall()).toBe(true)
})

test('what the view means: warm, then its last call and last minute, then cold, from one reply', () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: undefined })
  c.responded(BUILD_155K, 0, true)
  const at = (now: number, isWorking = false) => cacheFactsOf(viewAt(c, now, undefined, 0), isWorking)
  expect([at(10 * MIN).mood, at(10 * MIN).coldInMs, at(10 * MIN).lastCall]).toEqual(['warm', 50 * MIN, false])
  // While Claude works the battery is full and nothing counts down.
  expect([at(10 * MIN, true).charge, at(10 * MIN, true).coldInMs]).toEqual([1, undefined])
  expect([at(55 * MIN).lastCall, at(55 * MIN).tone]).toEqual([true, 'calm'])
  expect([at(59.5 * MIN).mood, at(59.5 * MIN).tone]).toEqual(['expiring', 'amber'])
  expect([at(61 * MIN).mood, at(61 * MIN).charge]).toEqual(['cold', 0])
})

test('idle compaction soon: on the hour, a context past its threshold, before the ~54-minute mark', () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: 200_000 })
  c.responded(BUILD_155K, 0, true)
  const soon = (now: number, contextTokens: number, autoCompactOff = false) =>
    cacheFactsOf(c.view({ now, ledger: undefined, contextTokens, autoCompactOff }).cache, false).idleCompactSoon
  expect([soon(10 * MIN, 250_000), soon(10 * MIN, 150_000), soon(10 * MIN, 250_000, true), soon(56 * MIN, 250_000)]).toEqual([true, false, false, false])
})
