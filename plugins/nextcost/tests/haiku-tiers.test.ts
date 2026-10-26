// Claude Haiku 5.5 bills a request whose prompt is over 100,000 tokens at 5×
// every price (Anthropic's pricing page, 2026-10-19). Each request is priced
// on its own, by every input token it sends, cache reads and writes included.
import { test, expect } from 'claude-code/testing'
import { tierFactor } from '../hooks/prices'
import { LONG, MIN, START, USAGE, engine, fact, mountBand, pillOf, resp, respond, setup, shown } from './helpers'

/** A step billed on Haiku 5.5. */
const HAIKU = { model: 'claude-haiku-5-5' } as const

test("Haiku 5.5's upper tier starts past 100k prompt tokens; other models have one tier", () => {
  expect(tierFactor('claude-haiku-5-5', 100_000)).toBe(1)
  expect(tierFactor('claude-haiku-5-5', 100_001)).toBe(5)
  expect(tierFactor('claude-haiku-5-5[1m]', 150_000)).toBe(5)
  expect(tierFactor('claude-opus-5-5', 900_000)).toBe(1)
  expect(tierFactor(undefined, 900_000)).toBe(1)
})

test('a Haiku 5.5 session past 100k solves its lower-tier rate and prices the re-warm at the upper tier', LONG, async ($, on) => {
  // At $0.10 per million, writes for the pinned hour at 2×: a 20k-prompt
  // request weighs 43k tokens, a 150k one 268.8k at 5×, so the session costs
  // 1,387k × $0.0000001 = $0.1387.
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 0.1387 }, context: { tokens: 151_000, window: 1_000_000, percent: 15 } } })
  engine.model = 'claude-haiku-5-5'
  await $.session.start(START)
  await respond($, resp(2_000, 0, 18_000, 1_000), HAIKU)
  await respond($, resp(2_000, 18_000, 130_000, 1_000), HAIKU)
  await clock.advance(61 * MIN)

  // 151k written for an hour at the upper tier: 151k × 2 × $0.50 per million
  // = $0.151. One rate across both tiers would say ~$0.13.
  const ui = await mountBand($, 'terminal', 160)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/next message ~\$0\.15\b/)
  await ui.unmount()
})

test("on Haiku 5.5, what the cache saved is priced at each read's tier", LONG, async ($, on) => {
  // Two upper-tier requests at $0.10 per million below, writes at 2×: 303k
  // and 23.8k weighted tokens, at 5×, cost $0.1634.
  setup(on, { usage: { ...USAGE, cost: { usd: 0.1634 }, context: { tokens: 152_000, window: 1_000_000, percent: 15 } } })
  engine.model = 'claude-haiku-5-5'
  await $.session.start(START)
  await respond($, resp(2_000, 0, 148_000, 1_000), HAIKU)
  await respond($, resp(2_000, 148_000, 1_000, 1_000), HAIKU)

  // 148k read at $0.05 per million instead of $0.50: 0.9 × 148k × $0.50 per million.
  // At the lower tier it would say ~$0.01.
  const ui = await mountBand($, 'terminal', 160)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'saved by cache')).toBe('~$0.07')
  await ui.unmount()
})
