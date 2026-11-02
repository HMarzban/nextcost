// The context chip, its compaction countdown and toasts, and the tokens chip.

import { test, expect } from 'claude-code/testing'
import { DARK } from '../hooks/palette'
import {
  BUILD_100K,
  READ_100K,
  USAGE,
  START,
  respond,
  toasts,
  textOf,
  pillOf,
  cardText,
  hoverCardOf,
  breakdown,
  fact,
  setup,
  mountBand,
} from './helpers'

test('the context chip shows tokens of the window', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 110)
  expect(textOf(pillOf(await ui.drawn(), 'ctx'))).toMatch(/76k \/ 200k/)
  await ui.unmount()
})

test('near auto-compaction the context chip turns amber and counts down', async ($, on) => {
  const near = {
    ...USAGE,
    context: {
      tokens: 152_000,
      window: 200_000,
      percent: 76,
      breakdown: breakdown({ autoCompactThreshold: 160_000, isAutoCompactEnabled: true }),
    },
  }
  setup(on, { usage: near })
  await $.session.start(START)
  await $.session.measure({ context: { tokens: 152_000, window: 200_000, percent: 76 }, rateLimits: near.rateLimits, cost: near.cost, changed: [] })

  const ui = await mountBand($, 'terminal', 110)
  const ctx = await ui.find({ type: 'Text', text: /compacts in ~8\.0k/ })
  expect(ctx).toBeDefined()
  expect(ctx?.props?.color).toBe(DARK.amberFg)
  // Its card leads with the figure, as every card does.
  expect(cardText(hoverCardOf(await ui.drawn(), 'ctx'))).toBe('152k of the 160k auto-compaction point (95%); model window 200k; auto-compacts in ~8.0k')
  await ui.unmount()
})

test('toasts fire once per threshold crossing and re-arm below 75%', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const at = async (percent: number) =>
    $.session.measure({ context: { window: 200_000, percent }, rateLimits: [], changed: [] })

  await at(82)
  await at(84)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/Context is 82% full/)
  await at(96)
  expect(toasts).toHaveLength(2)
  await at(70)
  await at(81)
  expect(toasts).toHaveLength(3)
})

test('near auto-compaction the context toast says so, as the pill does', async ($, on) => {
  const near = {
    ...USAGE,
    context: {
      tokens: 146_000,
      window: 200_000,
      percent: 73,
      breakdown: breakdown({ autoCompactThreshold: 160_000, isAutoCompactEnabled: true }),
    },
  }
  setup(on, { usage: near })
  await $.session.start(START)
  await $.session.measure({ context: { tokens: 146_000, window: 200_000, percent: 73 }, rateLimits: [], changed: [] })
  expect(toasts.some(t => /Auto-compaction in ~14k tokens/.test(t))).toBe(true)
})

test('with auto-compaction off the context toast says the conversation will run out of room', async ($, on) => {
  const off = {
    ...USAGE,
    context: { tokens: 164_000, window: 200_000, percent: 82, breakdown: breakdown({ isAutoCompactEnabled: false }) },
  }
  setup(on, { usage: off })
  await $.session.start(START)
  await $.session.measure({ context: { tokens: 164_000, window: 200_000, percent: 82 }, rateLimits: [], changed: [] })
  expect(toasts.some(t => /82% full.*auto-compaction is off/.test(t))).toBe(true)
})

test('the tokens chip totals every token and breaks them down', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_100K)
  await respond($, READ_100K)

  const ui = await mountBand($, 'terminal', 140)
  const drawn = await ui.drawn()
  expect(textOf(pillOf(drawn, 'tokens'))).toMatch(/225k/)
  expect(cardText(hoverCardOf(drawn, 'tokens'))).toBe('input 120k · output 5.0k · cache reads 100k · since the band loaded')
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(fact(tree, 'input')).toBe('120k')
  expect(fact(tree, 'output')).toBe('5.0k')
  expect(fact(tree, 'cache reads')).toBe('100k')
  await ui.unmount()
})


test('auto-compaction on without a threshold gets the plain wording, not "off"', async ($, on) => {
  setup(on, { usage: { ...USAGE, context: { tokens: 164_000, window: 200_000, percent: 82, breakdown: breakdown({ isAutoCompactEnabled: true }) } } })
  await $.session.start(START)
  await $.session.measure({ context: { tokens: 164_000, window: 200_000, percent: 82 }, rateLimits: [], changed: [] })
  expect(toasts).toContain('Context is 82% full.')
})
