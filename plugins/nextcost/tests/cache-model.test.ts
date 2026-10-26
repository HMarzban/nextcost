// The cache model as the band shows it: TTL inference, rebuilds, subagents, the re-warm rate.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { newCache, type CacheModel } from '../hooks/cache'
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
test('a warm read is no re-warm', () => {
  const c = newCache()
  c.responded(OPUS_BUILD, 0, true)
  c.turnEnded(undefined)
  c.responded({ ...resp(2_000, 196_000, 4_000, 3_000), model: 'claude-opus-5-5' }, MIN, true)
  expect(rebuilt(c)).toBe(false)
})

test('an assumed hour is corrected to 5m when a gap past 5m rebuilt the cache', LONG, async ($, on) => {
  const clock = setup(on, { env: {} })
  await $.session.start(START)
  await respond($, BUILD_80K)
  await clock.advance(12 * MIN)
  await respond($, resp(82_500, 0, 82_500, 300))

  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(fact(tree, 'expires')).toBe('5m idle')
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

  // reads at Opus 5.5's 0.05×: weighted = 13k + 1.25*110k + 0.05*20k + 5*6k = 181.5k;
  // 1.25*112k*2.41/181.5k = 1.86 (without the subagent's tokens it would be 2.33)
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$1\.86/ })).toBeDefined()
  await ui.unmount()
})

test("the re-warm estimate is solved from every response's tokens", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_100K)
  await respond($, READ_100K)
  await respond($, resp(1_000, 110_000, 2_000, 1_000))
  await clock.advance(61 * MIN)

  // reads at Opus 5.5's 0.05×: weighted = 15k + 1.25*108k + 0.05*210k + 5*6k = 190.5k;
  // 1.25*114k*2.41/190.5k = 1.80
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$1\.80/ })).toBeDefined()
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
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/next message 20k tokens/)
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
  expect(c.view({ now: MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false }).cache.window).toBe(283_852)
  c.responded(resp(2, 282_100, 2_500, 900), 2 * MIN, true)
  expect(c.view({ now: 2 * MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false }).cache.misses).toBe(0)
})

test("an advisor step's own bill stays out of the rate the re-warm is solved from", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_100K) // the ledger reads $2.41
  // Its message rounds cost 2.41/145k * 17,504 weighted = $0.29, the advisor $1.00 more.
  usage.current = { ...USAGE, cost: { usd: 3.7009 } }
  engine.serverTools = 1
  await respond($, resp(4, 200_000, 2_000, 1_000))
  engine.serverTools = 0
  await clock.advance(61 * MIN)

  // The rate stays 2.41/145k, on a window of 202,004/2 + 1,000 = 102,002:
  // 1.25 * 102,002 * 2.41 / 145k = 2.12 (with the advisor's bill in, 2.90).
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$2\.12/ })).toBeDefined()
  await ui.unmount()
})

test('a reply that sent no tokens leaves the cache as it was measured', () => {
  const c = newCache()
  c.responded(OPUS_BUILD, 0, true)
  c.responded({ ...resp(0, 0, 0, 0), model: '<synthetic>' }, 30 * MIN, true)
  const { cache } = c.view({ now: 30 * MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false })
  expect(cache.requests).toBe(1)
  expect(cache.coldAt).toBe(HOUR)
  expect(cache.window).toBe(208_000)
  expect(cache.readShare).toBe(0.05) // still priced as Opus 5.5
})

/** The TTL and misses the model reads at `now`. */
const ttlAt = (c: CacheModel, now: number) => {
  const { cache } = c.view({ now, ledger: undefined, contextTokens: 0, autoCompactOff: false })
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
    return m.view({ now: 61 * MIN, ledger: 3.7009, contextTokens: 0, autoCompactOff: false }).cache.reWarmUsd
  }
  expect(rewarm(true)).toBe(rewarm(false))
  expect(Math.abs((rewarm(false) ?? 0) - 2.1192) < 1e-3).toBe(true)
})
