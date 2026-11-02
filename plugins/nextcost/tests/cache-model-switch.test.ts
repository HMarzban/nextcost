// A /model switch waiting on the next message: each model has its own cache,
// so that message rebuilds, however warm the old model's cache still is.

import { test, expect, type Engine } from 'claude-code/testing'
import { newCache } from '../hooks/cache'
import { LONG, MIN, START, TURN_DONE, TURN_START, engine, mountBand, resp, respond, setup, textOf } from './helpers'

const drawn = async ($: Engine): Promise<string> => {
  const ui = await mountBand($, 'terminal', 160)
  const shut = textOf(await ui.drawn())
  await ui.press({ key: 'more' })
  const open = textOf(await ui.drawn())
  await ui.unmount()
  return `${shut}\n${open}`
}

const SAID = /model changed/i

for (const layout of ['chips', 'pulse', 'departures'])
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
    expect(text).toMatch(/157\.?\d?k tokens|158k tokens|157K TOKENS|158K TOKENS/i)
    expect(text).not.toMatch(/\d+m left|DEPARTS|re-warm/i)
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

const view = (c: ReturnType<typeof newCache>, modelNow: string | undefined) =>
  c.view({ now: MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false, modelNow }).cache

test('an alias /model named all along, and its [1m] form, are no switch', () => {
  const c = newCache()
  c.loaded({ priceModel: 'opus[1m]', ledger: 0 })
  c.turnStarted({ priceModel: 'opus[1m]', ledger: 0 })
  c.responded({ ...resp(2_000, 0, 155_000, 500), model: 'claude-opus-5-5' }, 0, true)
  expect(view(c, 'opus[1m]').interrupted).toBe(undefined)
  expect(view(c, 'opus').interrupted).toBe(undefined)
  expect(view(c, undefined).interrupted).toBe(undefined)
  expect(view(c, 'sonnet').interrupted).toBe('switched')
})

test('before any request there is no cache to lose', () => {
  const c = newCache()
  c.loaded({ priceModel: 'opus', ledger: 0 })
  expect(view(c, 'sonnet').interrupted).toBe(undefined)
})
