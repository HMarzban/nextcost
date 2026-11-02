// A /model switch waiting on the next message: each model has its own cache,
// so that message rebuilds, however warm the old model's cache still is.

import { test, expect, type Engine } from 'claude-code/testing'
import { newCache } from '../hooks/cache'
import { LAYOUT_NAMES } from '../hooks/snapshot'
import { BUILD_155K, LONG, MIN, START, TURN_DONE, TURN_START, engine, mountBand, resp, respond, setup, textOf } from './helpers'
import { cacheView } from './matrix'

const drawn = async ($: Engine): Promise<string> => {
  const ui = await mountBand($, 'terminal', 160)
  const shut = textOf(await ui.drawn())
  await ui.press({ key: 'more' })
  const open = textOf(await ui.drawn())
  await ui.unmount()
  return `${shut}\n${open}`
}

const SAID = /model changed/i

for (const layout of LAYOUT_NAMES)
  test(`${layout} says the next message rebuilds, in tokens, and counts down no more`, LONG, async ($, on) => {
    const clock = setup(on, { store: { layout } })
    await $.session.start(START)
    await $.turn.start(TURN_START)
    await respond($, resp(2_000, 0, 155_000, 500))
    await $.turn.complete(TURN_DONE)
    await clock.advance(MIN)
    expect(await drawn($)).not.toMatch(SAID)
    engine.model = 'claude-sonnet-5-5'
    const text = await drawn($)
    expect(text).toMatch(SAID)
    expect(text).toMatch(/157\.?\d?k tokens|158k tokens/i)
    expect(text).not.toMatch(/\d+m left|DEPARTS|re-warm|\bcache \d/i)
  })

test('the next turn takes the new model, and the countdown is back', LONG, async ($, on) => {
  setup(on)
  await $.session.start(START)
  await $.turn.start(TURN_START)
  await respond($, resp(2_000, 0, 155_000, 500))
  await $.turn.complete(TURN_DONE)
  engine.model = 'claude-sonnet-5-5'
  expect(await drawn($)).toMatch(SAID)
  await $.turn.start(TURN_START)
  await respond($, resp(2_000, 0, 155_000, 500), { model: 'claude-sonnet-5-5' })
  expect(await drawn($)).not.toMatch(SAID)
})

test('an alias /model named all along, and its [1m] form, are no switch', () => {
  const c = newCache()
  c.loaded({ priceModel: 'opus[1m]', ledger: 0 })
  c.turnStarted({ priceModel: 'opus[1m]', ledger: 0 })
  c.responded({ ...resp(2_000, 0, 155_000, 500), model: 'claude-opus-5-5' }, 0, true)
  expect(cacheView(c, MIN, { modelNow: 'opus[1m]' }).modelChanged).toBe(false)
  expect(cacheView(c, MIN, { modelNow: 'opus' }).modelChanged).toBe(false)
  expect(cacheView(c, MIN, { modelNow: undefined }).modelChanged).toBe(false)
  expect(cacheView(c, MIN, { modelNow: 'sonnet' }).modelChanged).toBe(true)
})

test('before any request there is no cache to lose', () => {
  const c = newCache()
  c.loaded({ priceModel: 'opus', ledger: 0 })
  expect(cacheView(c, MIN, { modelNow: 'sonnet' }).modelChanged).toBe(false)
})

test('model changed compares with what the last request went on: a turn that sent none still says it, and a new conversation starts clean', () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: undefined })
  c.turnStarted({ priceModel: 'opus', ledger: 0 })
  c.responded({ ...BUILD_155K, model: 'claude-opus-5-5' }, 0, true)
  c.turnEnded(0)
  const changed = (modelNow: string) => cacheView(c, MIN, { ledger: 0, contextTokens: 100_000, modelNow }).modelChanged
  expect(changed('opus')).toBe(false)
  expect(changed('haiku')).toBe(true)
  // A turn on Haiku that never reached the API: the cache is still Opus's.
  c.turnStarted({ priceModel: 'haiku', ledger: 0 })
  c.turnEnded(0)
  expect(changed('haiku')).toBe(true)
  c.conversationEnded(0, true)
  expect(changed('sonnet')).toBe(false)
})
