// The limit samples every session shares: one per 15-minute bucket, read
// back at start and at each new bucket, written over nothing other
// sessions stored, and never thrown for.

import { test, expect } from 'claude-code/testing'
import { asLimitSamples } from '../hooks/memory'
import { HOUR, HOUR_1, LONG, MIN, START, USAGE, engine, setup, turn, usage } from './helpers'

const rising = (i: number) => {
  usage.current = { ...USAGE, rateLimits: [
    { kind: 'five_hour', percentUsed: 4 + i, resetsAt: new Date(3 * 3600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 30 + i, resetsAt: new Date(67 * 3600_000).toISOString() },
  ] }
}
test('samples are written once per new 15-minute bucket, the percentages rising', LONG, async ($, on) => {
  const clock = setup(on, { env: HOUR_1 })
  await $.session.start(START)
  for (let i = 0; i < 24; i++) {
    rising(i)
    await turn($, `t${i}`, 2.41 + i * 0.1, 2.51 + i * 0.1)
    await clock.advance(5 * MIN)
  }
  const writes = engine.storeSets.filter(k => k === 'limitSamples').length
  expect(writes).toBeGreaterThanOrEqual(8)
  expect(writes).toBeLessThanOrEqual(9)
  const kept = asLimitSamples(engine.store.limitSamples).map(x => x.sevenPct)
  // Each write holds one bucket more, the last one the newest.
  expect(kept).toHaveLength(writes)
  expect(kept.every((pct, i) => i === 0 || (pct ?? 0) > (kept[i - 1] ?? Infinity))).toBe(true)
})
test('a plan with no 5-hour limit records the week all the same', async ($, on) => {
  setup(on, { usage: { ...USAGE, rateLimits: [{ kind: 'seven_day', percentUsed: 30, resetsAt: new Date(67 * 3600_000).toISOString() }] } })
  await $.session.start(START)
  await turn($, 't1', 2.41, 2.5)
  expect(asLimitSamples(engine.store.limitSamples)).toEqual([{ at: 0, sevenPct: 30, sevenResetAt: 67 * HOUR }])
})
test('a session reads the stored samples at start and at each new bucket, never within one', async ($, on) => {
  setup(on, { store: { limitSamples: [] } })
  await $.session.start(START)
  expect(engine.storeGets.filter(k => k === 'limitSamples')).toHaveLength(1)
  await turn($, 't1', 2.41, 2.5)
  await turn($, 't2', 2.5, 2.6)
  expect(engine.storeGets.filter(k => k === 'limitSamples')).toHaveLength(2)
})
test('a stored sample dated ahead of the clock is dropped, so one bucket writes once', async ($, on) => {
  const ahead = { at: 168 * HOUR, fivePct: 90, sevenPct: 90, fiveResetAt: 171 * HOUR, sevenResetAt: 235 * HOUR }
  const clock = setup(on, { store: { limitSamples: [ahead] } })
  await $.session.start(START)
  await turn($, 't1', 2.41, 2.5)
  await clock.advance(5 * MIN)
  await turn($, 't2', 2.5, 2.6)
  expect(engine.storeSets.filter(k => k === 'limitSamples')).toHaveLength(1)
  expect(asLimitSamples(engine.store.limitSamples).map(x => x.sevenPct)).toEqual([30])
})
test('a failing store never throws, and nothing is written', async ($, on) => {
  const clock = setup(on)
  engine.storeFails = true
  await $.session.start(START)
  await clock.settle()
  // A hook that throws is dropped silently: its closing redraw shows it ran to the end.
  const redraws = engine.invalidates
  await turn($, 't1', 2.41, 2.5)
  expect(engine.store.limitSamples).toBeUndefined()
  expect(engine.invalidates).toBeGreaterThan(redraws)
})
test('a failed read writes nothing over what other sessions stored, and the next bucket writes', LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  engine.storeReadFails = true
  rising(0)
  await turn($, 't1', 2.41, 2.5)
  expect(engine.storeSets.filter(k => k === 'limitSamples')).toHaveLength(0)
  engine.storeReadFails = false
  await clock.advance(15 * MIN)
  rising(1)
  await turn($, 't2', 2.5, 2.6)
  expect(asLimitSamples(engine.store.limitSamples).map(x => x.sevenPct)).toEqual([30, 31])
})
