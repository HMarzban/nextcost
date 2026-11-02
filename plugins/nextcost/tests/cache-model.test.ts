// The cache model as the band shows it: TTL inference, rebuilds, subagents, the re-warm rate.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { TTL_MS, newCache, type CacheModel } from '../hooks/cache'
import {
  BUILD_100K,
  BUILD_80K,
  READ_100K,
  BUILD_155K,
  LONG,
  USAGE,
  SUMMARY,
  COMPACTED_TO,
  START,
  MIN,
  HOUR,
  resp,
  respond,
  pillOf,
  shown,
  rebuilds,
  engine,
  fact,
  cardOf,
  setup,
  mountBand,
  usage,
} from './helpers'
import { cacheView } from './matrix'

/** Whether the turn's end finds the cache rebuilt. */
const rebuilt = (c: CacheModel): boolean => c.turnEnded(undefined).rebuilt
const OPUS_BUILD = { ...BUILD_155K, model: 'claude-opus-5-5' }
test('a request after the TTL ran out rebuilt the cache, and the turn takes the mark once', () => {
  const c = newCache()
  c.responded(OPUS_BUILD, 0, true)
  expect(rebuilt(c)).toBe(false) // the first build is warming, not a re-warm
  c.responded(OPUS_BUILD, 61 * MIN, true)
  expect(rebuilt(c)).toBe(true)
  expect(rebuilt(c)).toBe(false)
})
test('the first reply after a resume or a reload rebuilds a cache already cold', () => {
  const resumed = newCache()
  resumed.resumed({ cache: { lastAt: 0, expired: true, reWarmUsd: 1 }, transcript: undefined })
  expect(resumed.leftMs(48 * HOUR)).toBe(0)
  resumed.responded(OPUS_BUILD, 48 * HOUR, true)
  expect(rebuilt(resumed)).toBe(true)
  const reloaded = (): CacheModel => {
    const c = newCache()
    c.loaded({ priceModel: undefined, ledger: 5 })
    c.recalled({ lastAt: 0, rate: null, billed: undefined })
    return c
  }
  const cold = reloaded()
  cold.responded(OPUS_BUILD, 3 * HOUR, true)
  expect(rebuilt(cold)).toBe(true)
  // Recalled warm, the first reply reads the cache it found.
  const warm = reloaded()
  warm.responded({ ...resp(2_000, 196_000, 4_000, 3_000), model: 'claude-opus-5-5' }, 10 * MIN, true)
  expect(rebuilt(warm)).toBe(false)
})
test('a miss within the lifetime rebuilt the cache too, and the turn takes the mark once', () => {
  const c = newCache()
  c.responded(OPUS_BUILD, 0, true)
  expect(rebuilt(c)).toBe(false)
  // Two minutes on, well within the hour: the reply reads a tenth of what was cached.
  c.responded({ ...resp(2_000, 15_000, 4_000, 3_000), model: 'claude-opus-5-5' }, 2 * MIN, true)
  expect(cacheView(c, 2 * MIN).misses).toBe(1)
  expect(rebuilt(c)).toBe(true)
  expect(rebuilt(c)).toBe(false)
})

test('a warm read is no re-warm', () => {
  const c = newCache()
  c.responded(OPUS_BUILD, 0, true)
  c.turnEnded(undefined)
  c.responded({ ...resp(2_000, 196_000, 4_000, 3_000), model: 'claude-opus-5-5' }, MIN, true)
  expect(rebuilt(c)).toBe(false)
})

test('an assumed hour is corrected to a guessed 5m when a gap past 5m rebuilt the cache', LONG, async ($, on) => {
  const clock = setup(on, { env: {} })
  await $.session.start(START)
  await respond($, BUILD_80K)
  await clock.advance(12 * MIN)
  await respond($, resp(82_500, 0, 82_500, 300))

  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(fact(tree, 'expires')).toBe('5m idle · assumed')
  expect(rebuilds(tree)).toBe(0)
  await ui.unmount()
})

test('a prefix the cache should have served but did not is an unexpected rebuild', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_80K)
  await clock.advance(30_000)
  await respond($, resp(82_500, 0, 82_500, 300))

  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(rebuilds(await ui.drawn())).toBe(1)
  await ui.unmount()
})

test('a warm follow-up to a long answer is not a rebuild', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, resp(2_000, 0, 80_000, 5_000))
  await clock.advance(30_000)
  await respond($, resp(300, 80_000, 7_000, 400))

  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(fact(tree, 'expires')).toBe('1h idle')
  expect(rebuilds(tree)).toBe(0)
  await ui.unmount()
})

test("a subagent's steps leave the main countdown and window alone", LONG, async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 0 } } }) // no ledger: the pill names the window in tokens
  await $.session.start(START)
  await respond($, resp(2_000, 0, 150_000, 1_000))
  await clock.advance(50 * MIN)
  await respond($, resp(500, 0, 12_000, 800), { agentId: 'agent-1' })
  await clock.advance(9 * MIN + 30_000)

  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /0:30 left · re-warm 153k tokens/ })).toBeDefined()
  await ui.press({ key: 'more' })
  expect(rebuilds(await ui.drawn())).toBe(0)
  await ui.unmount()
})

test("a subagent's tokens still count toward the rate the re-warm is solved from", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_100K)
  await respond($, resp(3_000, 20_000, 10_000, 4_000), { agentId: 'agent-1' })
  await clock.advance(61 * MIN)

  // ENABLE_PROMPT_CACHING_1H, which setup pins, asks an hour of both buckets,
  // so every write weighs 2×; reads at Opus 5.5's 0.05×: weighted = 10k +
  // 2*100k + 5*2k + 3k + 2*10k + 0.05*20k + 5*4k = 264k; a re-warm is an
  // hour's write: 2*112k*2.41/264k = 2.04 (without the subagent's tokens, 2.45)
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$2\.04/ })).toBeDefined()
  await ui.unmount()
})

test("the re-warm estimate is solved from every response's tokens", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_100K)
  await respond($, READ_100K)
  await respond($, resp(1_000, 110_000, 2_000, 1_000))
  await clock.advance(61 * MIN)

  // writes for the pinned hour at 2×, reads at Opus 5.5's 0.05×: weighted =
  // 15k + 2*108k + 0.05*210k + 5*6k = 271.5k; 2*114k*2.41/271.5k = 2.02
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$2\.02/ })).toBeDefined()
  await ui.unmount()
})

test('a compaction is an expected rebuild', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, resp(2_000, 0, 150_000, 1_000))
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  await respond($, resp(500, 0, 20_000, 300)) // reads nothing: the prefix changed

  const ui = await mountBand($, 'terminal', 160)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(cardOf(tree, 'cache')).toBeDefined()
  expect(rebuilds(tree)).toBe(0)
  await ui.unmount()
})

test('after a compaction the cold price is for the compacted size', LONG, async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 0 } } }) // no ledger: the pill names tokens
  await $.session.start(START)
  await respond($, resp(2_000, 0, 150_000, 1_000))
  await $.session.compact({ trigger: 'auto', messages: SUMMARY })
  await clock.advance(61 * MIN)

  const ui = await mountBand($, 'terminal', 160)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/compacted · next 20k tokens/)
  await ui.unmount()
})

test('a model switch is an expected rebuild and keeps the assumed hour', async ($, on) => {
  const clock = setup(on, { env: {} }) // TTL unpinned
  await $.session.start(START)
  await respond($, BUILD_80K)
  await clock.advance(6 * MIN)
  await respond($, resp(82_500, 0, 82_500, 300), { model: 'claude-sonnet-5-5' })

  const ui = await mountBand($, 'terminal', 160)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(fact(tree, 'expires')).toBe('1h idle · assumed')
  expect(rebuilds(tree)).toBe(0)
  await ui.unmount()
})


/** Rebuilds counted after a 150k prefix, a compaction, then a request that
 *  reads nothing: 0 when the compaction was noted, 1 when it wasn't. */
const rebuildsAfterCompaction = async (
  $: Engine,
  compact: { trigger?: 'manual' | 'auto' | 'precompute'; agentId?: string } = {},
): Promise<number> => {
  await $.session.start(START)
  await respond($, resp(2_000, 0, 150_000, 1_000))
  await $.session.compact({ trigger: 'manual', messages: SUMMARY, ...compact })
  await respond($, resp(500, 0, 20_000, 300))
  const ui = await mountBand($, 'terminal', 160)
  await ui.press({ key: 'more' })
  const n = rebuilds(await ui.drawn())
  await ui.unmount()
  return n
}

test('a compaction result that carries an empty skip is still a compaction', async ($, on) => {
  setup(on)
  engine.compact = { messages: SUMMARY, tokensAfter: COMPACTED_TO, skip: undefined }
  expect(await rebuildsAfterCompaction($)).toBe(0)
})

test('a skipped compaction rebuilds nothing, so a later miss still counts', async ($, on) => {
  setup(on)
  engine.compact = { skip: 'nothing to compact' }
  expect(await rebuildsAfterCompaction($)).toBe(1)
})

test('a precomputed compaction installs nothing yet', async ($, on) => {
  setup(on)
  expect(await rebuildsAfterCompaction($, { trigger: 'precompute' })).toBe(1)
})

test("a subagent's compaction leaves the main cache alone", async ($, on) => {
  setup(on)
  expect(await rebuildsAfterCompaction($, { agentId: 'agent-1' })).toBe(1)
})

test('a step that stops for compaction makes the next rebuild expected', async ($, on) => {
  setup(on)
  await $.session.start(START)
  engine.stop = 'compaction'
  await respond($, resp(2_000, 0, 150_000, 1_000))
  engine.stop = 'end_turn'
  await respond($, resp(500, 0, 20_000, 300))
  const ui = await mountBand($, 'terminal', 160)
  await ui.press({ key: 'more' })
  expect(rebuilds(await ui.drawn())).toBe(0)
  await ui.unmount()
})

test('switching model and back within a pinned hour is no miss', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_80K)
  await clock.advance(30_000)
  await respond($, resp(82_500, 0, 82_500, 300), { model: 'claude-sonnet-5-5' })
  await clock.advance(30_000)
  await respond($, resp(500, 82_500, 1_000, 300))
  const ui = await mountBand($, 'terminal', 160)
  await ui.press({ key: 'more' })
  expect(rebuilds(await ui.drawn())).toBe(0)
  await ui.unmount()
})

// An advisor step: two message rounds read the same ~280k prefix, and the
// usage the API reports sums them; the advisor's own round is billed apart.
const ADVISOR_STEP = resp(4, 563_500, 1_800, 1_200)

test("an advisor step's summed usage counts its prefix once", () => {
  const c = newCache()
  c.responded(resp(2_000, 0, 280_000, 500), 0, true)
  c.responded(ADVISOR_STEP, MIN, true, { serverTools: 1 })
  // (4 + 563.5k + 1.8k) / 2 rounds, then its output: 282,652 + 1,200.
  expect(cacheView(c, MIN).window).toBe(283_852)
  c.responded(resp(2, 282_100, 2_500, 900), 2 * MIN, true)
  expect(cacheView(c, 2 * MIN).misses).toBe(0)
})

/** An advisor reply after a 100k cache. Claude Code hands a mod a step's four
 *  token counts alone, never `iterations`, so its rounds are a guess. */
const advisor = (read: number) => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: undefined })
  c.responded({ ...resp(100, 0, 100_000, 100), model: 'claude-opus-5-5' }, 0, true)
  c.responded({ ...resp(100, read, 500, 100), model: 'claude-opus-5-5' }, MIN, true, { serverTools: 1 })
  return cacheView(c, MIN)
}

test('a read a server tool may have halved counts no miss', () => {
  expect(advisor(100_000).misses).toBe(0)
})

test("an advisor step's own bill stays out of the rate the re-warm is solved from", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_100K) // the ledger reads $2.41: 220k weighted, its writes an hour's
  // The step's message rounds and the advisor's own round bill $1.29 more.
  usage.current = { ...usage.current, context: { tokens: 102_002, window: 200_000, percent: 51 } }
  engine.serverTools = 1
  await respond($, resp(4, 200_000, 2_000, 1_000), { billsTo: 3.7009 })
  engine.serverTools = 0
  await clock.advance(61 * MIN)

  // The rate stays 2.41/220k, on the 102,002 of context Claude Code reports:
  // 2 * 102,002 * 2.41 / 220k = 2.23 (with the step's bill and tokens in,
  // 2 * 102,002 * 3.7009 / 239,004 = 3.16).
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$2\.23/ })).toBeDefined()
  await ui.unmount()
})

test("a server tool's step prices the context Claude Code reports, not a guess at its rounds", () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: undefined })
  c.responded(OPUS_BUILD, 0, true)
  c.responded({ ...resp(100, 200_000, 500, 100), model: 'claude-opus-5-5' }, MIN, true, { serverTools: 1 })
  const at = (contextTokens: number) => cacheView(c, 2 * MIN, { contextTokens }).window
  expect(at(203_000)).toBe(203_000)
  // With none reported, the round's share stands.
  expect(at(0)).toBeLessThan(110_000)
})

test('a reply that sent no tokens leaves the cache as it was measured', () => {
  const c = newCache()
  c.responded(OPUS_BUILD, 0, true)
  c.responded({ ...resp(0, 0, 0, 0), model: '<synthetic>' }, 30 * MIN, true)
  const cache = cacheView(c, 30 * MIN)
  expect(cache.requests).toBe(1)
  expect(cache.coldAt).toBe(HOUR)
  expect(cache.window).toBe(208_000)
  expect(cache.readShare).toBe(0.05) // still priced as Opus 5.5
})

/** The TTL and misses the model reads at `now`. */
const ttlAt = (c: CacheModel, now: number) => {
  const cache = cacheView(c, now)
  return { ttl: cache.ttl, misses: cache.misses }
}

test('a cold read that still finds the shared system prompt corrects an assumed hour to 5m', () => {
  const c = newCache()
  c.responded(resp(2_000, 0, 500_000, 1_000), 0, true)
  // The prompt other sessions in the folder keep warm is read; the conversation isn't.
  c.responded(resp(2_000, 44_323, 458_000, 1_000), 10 * MIN, true)
  expect(ttlAt(c, 10 * MIN)).toEqual({ ttl: '5m', misses: 0 })
  expect(rebuilt(c)).toBe(true)
})

test('on a small conversation the shared prompt is most of what a cold read finds, and it is still 5m', () => {
  const c = newCache()
  c.responded(resp(2_000, 0, 60_000, 1_000), 0, true)
  c.responded(resp(2_000, 44_323, 18_000, 1_000), 10 * MIN, true)
  expect(ttlAt(c, 10 * MIN)).toEqual({ ttl: '5m', misses: 0 })
})

test('an inferred 5m goes back to the hour when a read after five idle minutes finds it all', () => {
  const c = newCache()
  c.responded(resp(2_000, 0, 500_000, 1_000), 0, true)
  c.responded(resp(2_000, 44_323, 458_000, 1_000), 10 * MIN, true)
  c.turnEnded(undefined)
  c.responded(resp(2_000, 502_000, 3_000, 1_000), 30 * MIN, true)
  expect(ttlAt(c, 30 * MIN)).toEqual({ ttl: '1h', misses: 0 })
  expect(rebuilt(c)).toBe(false)
})

test('a short read within five minutes is still a miss, and a pinned TTL is never inferred', () => {
  const quick = newCache()
  quick.responded(resp(2_000, 0, 500_000, 1_000), 0, true)
  quick.responded(resp(2_000, 44_323, 458_000, 1_000), 2 * MIN, true)
  expect(ttlAt(quick, 2 * MIN)).toEqual({ ttl: '1h', misses: 1 })
  const pinned = newCache()
  pinned.configured({ ttl: '1h', idleCompactFrom: undefined })
  pinned.responded(resp(2_000, 0, 500_000, 1_000), 0, true)
  pinned.responded(resp(2_000, 44_323, 458_000, 1_000), 10 * MIN, true)
  expect(ttlAt(pinned, 10 * MIN)).toEqual({ ttl: '1h', misses: 1 })
})

test("a redraw that reads the ledger while an advisor step runs leaves its bill off the rate", () => {
  const rewarm = (redraw: boolean): number | null => {
    const m = newCache()
    m.responded(BUILD_100K, 0, true, { ledger: 2.41 })
    if (redraw) m.view({ now: MIN, ledger: 3.7009, contextTokens: 0, autoCompactOff: false })
    m.responded(resp(4, 200_000, 2_000, 1_000), MIN, true, { serverTools: 1, ledger: 3.7009 })
    return cacheView(m, 61 * MIN, { ledger: 3.7009 }).reWarmUsd
  }
  expect(rewarm(true)).toBe(rewarm(false))
  // r = 2.41/220k, its 1h writes at 2x; window 202,004/2 + 1,000 = 102,002: 2 * 102,002 * r = $2.2346
  expect(Math.abs((rewarm(false) ?? 0) - (2 * 102_002 * 2.41) / 220_000) < 1e-9).toBe(true)
})

// Claude Code's ledger bills a cache write by its lifetime, as Anthropic lists
// it: 1.25x base input for five minutes, 2x for an hour (checked to the cent
// against a session's cost record, 2026-10-26).

/** The re-warm a model prices at `now`, its ledger at `ledger`. */
const reWarmAt = (c: CacheModel, now: number, ledger: number): number | null =>
  cacheView(c, now, { ledger }).reWarmUsd
const near = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < 1e-6
const pinnedTo = (ttl: '5m' | '1h', subagentTtl?: '5m' | '1h'): CacheModel => {
  const c = newCache()
  c.configured({ ttl, idleCompactFrom: undefined, subagentTtl })
  return c
}

test("on the hour's cache the main loop's writes weigh 2x, and a re-warm is a 2x write", () => {
  const c = pinnedTo('1h')
  c.responded(BUILD_100K, 0, true, { ledger: 2.2 })
  // weighted = 10k + 2*100k + 5*2k = 220k, so r = $0.00001; re-warm = 2 * 112k * r = $2.24
  expect(near(reWarmAt(c, 61 * MIN, 2.2), 2.24)).toBe(true)
})

test("on five minutes' cache a write weighs 1.25x, as before", () => {
  const c = pinnedTo('5m')
  c.responded(BUILD_100K, 0, true, { ledger: 2.2 })
  // weighted = 10k + 1.25*100k + 5*2k = 145k; re-warm = 1.25 * 112k * 2.2/145k = $2.1241
  expect(near(reWarmAt(c, 10 * MIN, 2.2), (1.25 * 112_000 * 2.2) / 145_000)).toBe(true)
})

test("a subagent's writes weigh 1.25x on the hour's main cache, unless its own TTL is an hour", () => {
  const SUB = { ...resp(3_000, 20_000, 10_000, 4_000), model: 'claude-opus-5-5' }
  const MAIN = { ...BUILD_100K, model: 'claude-opus-5-5' }
  const five = pinnedTo('1h')
  five.responded(MAIN, 0, true, { ledger: 2.2 })
  five.responded(SUB, MIN, false, { ledger: 2.565 })
  // main 220k + subagent 3k + 1.25*10k + 0.05*20k + 5*4k = 36.5k: r = 2.565/256.5k = $0.00001
  expect(near(reWarmAt(five, 61 * MIN, 2.565), 2.24)).toBe(true)
  const hour = pinnedTo('1h', '1h')
  hour.responded(MAIN, 0, true, { ledger: 2.2 })
  hour.responded(SUB, MIN, false, { ledger: 2.565 })
  // the subagent's 10k written for an hour weigh 20k: 44k, r = 2.565/264k
  expect(near(reWarmAt(hour, 61 * MIN, 2.565), (2 * 112_000 * 2.565) / 264_000)).toBe(true)
})

test("a subagent's own TTL is read as Claude Code reads it, and an hour there prices its writes at 2x", LONG, async ($, on) => {
  const clock = setup(on, { env: { ENABLE_PROMPT_CACHING_1H: '1', CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: '5m' } })
  await $.session.start(START)
  await respond($, BUILD_100K) // main: weighted 220k
  await respond($, resp(3_000, 20_000, 10_000, 4_000), { agentId: 'agent-1', billsTo: 2.565 }) // 36.5k at five minutes
  await clock.advance(61 * MIN)
  // ENABLE_PROMPT_CACHING_1H asks an hour for both buckets, but the subagent's
  // own variable comes first: r = 2.565/256.5k; re-warm 2 * 112k * r = $2.24
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$2\.24/ })).toBeDefined()
  await ui.unmount()
})

test('an advisor step that bills most of the session leaves the rate exactly as the rest solve it', () => {
  // In one long session the advisor's own rounds were 19% of a $613.84 bill,
  // none of it in the usage the steps report. Here it is $5 of $7.30.
  const c = pinnedTo('1h')
  const opus = (u: ReturnType<typeof resp>) => ({ ...u, model: 'claude-opus-5-5' })
  c.responded(opus(BUILD_100K), 0, true, { ledger: 2.2 }) // 220k weighted: r = $0.00001
  c.responded(opus(resp(4, 200_000, 2_000, 1_000)), MIN, true, { serverTools: 1, ledger: 7.2 })
  // 2 + 2*1k + 0.05*102k + 5*500 = 9,602 weighted at r: $0.09602.
  c.responded(opus(resp(2, 102_000, 1_000, 500)), 2 * MIN, true, { ledger: 7.29602 })
  // r stays $0.00001; re-warm = 2 * 103,502 * r = $2.07 (with the advisor's
  // bill in the rate, about $6).
  expect(near(reWarmAt(c, 63 * MIN, 7.29602), 2 * 103_502 * 0.00001)).toBe(true)
  expect(c.view({ now: 63 * MIN, ledger: 7.29602, contextTokens: 0, autoCompactOff: false }).costUsd).toBe(7.29602)
})

test('a lifetime pinned before a reload and no longer set stands unpinned, assumed again', () => {
  const before = newCache()
  before.configured({ ttl: '5m', idleCompactFrom: undefined })
  const reloaded = newCache(before.kept())
  reloaded.configured({ ttl: undefined, idleCompactFrom: undefined })
  const cache = cacheView(reloaded, 0)
  expect(cache.ttlPinned).toBe(false)
  expect(cache.ttl).toBe('1h')
})

test('a lifetime inferred before a reload stands, with nothing pinned on either side', () => {
  const before = newCache()
  before.responded(resp(1_000, 0, 100_000, 100), 0, true)
  before.responded(resp(1_000, 0, 100_000, 100), 6 * 60_000, true)
  const inferred = cacheView(before, 6 * 60_000).ttl
  expect(inferred).toBe('5m')
  const reloaded = newCache(before.kept())
  reloaded.configured({ ttl: undefined, idleCompactFrom: undefined })
  expect(cacheView(reloaded, 6 * 60_000).ttl).toBe('5m')
})

// ── a countdown never runs past its lifetime ────────────────────────────


test('a reply dated after now counts down one lifetime at most, whatever the clock says', () => {
  const c = newCache()
  c.responded(OPUS_BUILD, 6 * HOUR, true)
  for (const now of [0, HOUR]) {
    const cache = cacheView(c, now)
    expect(cache.leftMs).toBe(TTL_MS['1h'])
    expect(c.leftMs(now)).toBe(TTL_MS['1h'])
    expect(cache.coldAt).toBe(now + TTL_MS['1h'])
  }
})

test('a recalled reply dated after now is unknown: no countdown, no idle time', () => {
  for (const lastAt of [HOUR + 1, 6 * HOUR, 1e15]) {
    const c = newCache()
    c.loaded({ priceModel: undefined, ledger: 5 })
    c.recalled({ lastAt, rate: null, billed: undefined })
    const cache = cacheView(c, HOUR)
    expect([cache.recalled, cache.coldAt, cache.idleMs, c.idleMs(HOUR)]).toEqual([false, null, null, null])
    expect(cache.leftMs).toBeLessThanOrEqual(TTL_MS['1h'])
  }
})

test("a resume the engine dates after now is unknown too", () => {
  const c = newCache()
  c.resumed({ cache: { lastAt: 1e15, expired: false, reWarmUsd: undefined }, transcript: undefined })
  const cache = cacheView(c, HOUR)
  expect([cache.recalled, cache.coldAt, cache.idleMs]).toEqual([false, null, null])
})

test('a recalled reply at now is a reply just made, not unknown', () => {
  const c = newCache()
  c.loaded({ priceModel: undefined, ledger: 5 })
  c.recalled({ lastAt: HOUR, rate: null, billed: undefined })
  const cache = cacheView(c, HOUR)
  expect([cache.recalled, cache.idleMs, cache.leftMs]).toEqual([true, 0, TTL_MS['1h']])
})
