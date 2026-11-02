// Numbers the engine hands the band, taken as data: a count it leaves out or
// gets wrong, a ledger below zero, a model named like a property of Object.
// None may reach the drawing as NaN, a negative dollar sum or a function.

import { test, expect } from 'claude-code/testing'
import type { ModelUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { fromStore, recallOf } from '../hooks/memory'
import { readMultiplier, tierFactor, weightedTokens } from '../hooks/prices'
import { BUILD_80K, READ_100K, START, TURN_DONE, TURN_START, USAGE, engine, mountBand, respond, setup, textOf, usage, wordsOf } from './helpers'

/** Everything the tree says, and every number in it that is not finite. */
const drawnOf = (tree: unknown): string =>
  `${wordsOf(tree)} ${textOf(tree)} ${JSON.stringify(tree, (_k, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? 'NONFINITE' : v))}`

/** The band after `steps`, shut and open, as one string. */
const drawnAfter = async ($: Engine, steps: () => Promise<void>): Promise<string> => {
  await $.session.start(START)
  await $.turn.start(TURN_START)
  await steps()
  await $.turn.complete(TURN_DONE)
  const ui = await mountBand($, 'terminal', 140)
  const shut = drawnOf(await ui.drawn())
  await ui.press({ key: 'more' })
  const open = drawnOf(await ui.drawn())
  await ui.unmount()
  return `${shut} ${open}`
}

/** A response with `field` left out, as a host that doesn't report it. */
const without = (field: keyof ModelUsage, from: ModelUsage = BUILD_80K): ModelUsage => {
  const copy: Record<string, unknown> = { ...from }
  delete copy[field]
  return copy as ModelUsage
}

test('a response that leaves a count out adds nothing for it, and the rest of the session still adds up', async ($, on) => {
  setup(on)
  const drawn = await drawnAfter($, async () => {
    await respond($, without('cache_read_input_tokens'))
    await respond($, READ_100K)
  })
  expect(drawn).not.toMatch(/NaN|NONFINITE|Infinity/)
})

test('a count that is not a count adds nothing: text, a negative, infinity', async ($, on) => {
  setup(on)
  const drawn = await drawnAfter($, async () => {
    await respond($, { ...BUILD_80K, output_tokens: -500, cache_read_input_tokens: '9' as unknown as number })
    await respond($, { ...READ_100K, input_tokens: Infinity })
  })
  expect(drawn).not.toMatch(/NaN|NONFINITE|Infinity/)
})

test('a ledger below zero is no cost: no negative dollars are drawn', async ($, on) => {
  setup(on, { usage: { ...USAGE, cost: { usd: -3 } } })
  const drawn = await drawnAfter($, async () => {
    await respond($, BUILD_80K)
  })
  expect(drawn).not.toMatch(/\$-|-\$|NaN|NONFINITE/)
})

test('a ledger that sinks below zero mid-session draws no negative cost for the message', async ($, on) => {
  setup(on)
  const drawn = await drawnAfter($, async () => {
    await respond($, BUILD_80K)
    usage.current = { ...USAGE, cost: { usd: -3 } }
  })
  expect(drawn).not.toMatch(/\$-|-\$|NaN|NONFINITE/)
})

test('a model named like a property of Object is priced like any other model', async ($, on) => {
  setup(on)
  engine.model = 'constructor'
  const drawn = await drawnAfter($, async () => {
    await respond($, BUILD_80K, { model: 'constructor' })
    await respond($, READ_100K, { model: 'constructor' })
  })
  expect(drawn).not.toMatch(/NaN|NONFINITE|function/)
})

test('a cache read costs the default share on a model Object has a property of that name', () => {
  for (const model of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    expect(readMultiplier(model)).toBe(0.1)
    expect(Number.isFinite(weightedTokens({ uncached: 1, written: 1, writtenHour: 0, read: 1, output: 1 }, model))).toBe(true)
    expect(tierFactor(model, 1_000_000)).toBe(1)
  }
})

test('no rate is stored for a model named like a property of Object', () => {
  for (const model of ['constructor', 'toString', '__proto__']) {
    const stored = fromStore({ sessions: { s1: { lastAt: 5, billed: model } }, rates: {} }, 's1', model, 10)
    expect(stored.rate).toBeNull()
    expect(recallOf(fromStore({ sessions: {}, rates: {} }, 's1', model, 10), `${JSON.stringify({ type: 'assistant', timestamp: new Date(5).toISOString(), message: { role: 'assistant', model } })}\n`, 10).rate).toBeNull()
  }
})
