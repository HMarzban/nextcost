// The 5h and 7d limit chips: usage, pace, resets and their toasts.

import { test, expect } from 'claude-code/testing'
import { DARK } from '../hooks/palette'
import { resetsOf, snapshotOf } from '../hooks/snapshot'
import {
  BUILD_80K,
  DESKTOP_START,
  SPEND_LIMIT,
  BUILD_155K,
  LONG,
  USAGE,
  START,
  MIN,
  HOUR,
  hostClock,
  MODERN,
  usageAt,
  CLEAR,
  respond,
  usage,
  toasts,
  firstRow,
  pillOf,
  shown,
  svgsOf,
  svgRect,
  fact,
  cardOf,
  cardText,
  hoverCardOf,
  setup,
  mountBand,
} from './helpers'
import { SNAP_PARTS, snapOf } from './matrix'

test('the 5h and 7d chips show usage on a fill with no thumb, and the reset countdown', async ($, on) => {
  setup(on) // 5h 4%, resets in 3h; 7d 30%, resets in 67h
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_155K)

  const ui = await mountBand($, 'desktop', 160)
  const tree = await ui.drawn()
  const five = pillOf(tree, '5h')
  const week = pillOf(tree, '7d')
  expect(shown(five)).toMatch(/5h.*4%.*3h 00m/)
  expect(shown(week)).toMatch(/7d.*30%.*2d 19h/)
  expect(five?.props?.backgroundColor).toBe(DARK.fiveBg)
  expect(week?.props?.backgroundColor).toBe(DARK.weekBg)
  // the fill ends bare: the number beside it says where, and no bright knob
  for (const n of [five, week]) {
    const bar = svgsOf(n).find(s => /% used/.test(String(s.props?.alt)))
    const source = String(bar?.props?.source)
    expect(source).not.toMatch(/class="(tick|notch|thumb)"/)
    expect(source).not.toContain(`fill="${DARK.value}"`)
    expect(svgRect(source, 'fill')?.y).toBe(1)
  }
  const alts = svgsOf(firstRow(tree)).map(s => String(s.props?.alt))
  expect(alts).toContain('five-hour')
  expect(alts).toContain('week')
  // The reset is ↻, a glyph as the board draws it, never the clock icon.
  expect(alts).not.toContain('resets')
  expect(shown(five)).toMatch(/│ ↻ 3h 00m/)
  await ui.unmount()
})

test('context and 5h escalate to amber at 80% and mark 95%', async ($, on) => {
  setup(on, {
    usage: {
      ...USAGE,
      context: { tokens: 164_000, window: 200_000, percent: 82 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 96, resetsAt: new Date(3600_000).toISOString() }],
    },
  })
  await $.session.start(START)

  const ui = await mountBand($, 'terminal', 110)
  const ctx = await ui.find({ type: 'Text', text: /164k \/ 200k!$/ })
  expect(ctx?.props?.color).toBe(DARK.amberFg)
  const five = await ui.find({ type: 'Text', text: /96%!!/ })
  expect(five?.props?.color).toBe(DARK.amberFg)
  await ui.unmount()
})

test('the 7d chip turns amber at 80%', async ($, on) => {
  setup(on, { usage: { ...USAGE, rateLimits: [{ kind: 'seven_day', percentUsed: 85, resetsAt: new Date(30 * 3600_000).toISOString() }] } })
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 140)
  const week = pillOf(await ui.drawn(), '7d')
  expect(week?.props?.backgroundColor).toBe(DARK.amberBg)
  expect(shown(week)).toMatch(/85%!/)
  await ui.unmount()
})

test('the 5h pill shows your pace once there is enough evidence, and drops it when stale', LONG, async ($, on) => {
  const resetsAt = new Date(3 * 3600_000).toISOString()
  const at = (pct: number) => ({ ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt }] })
  const clock = setup(on, { usage: at(40) })
  await $.session.start(START)
  const measure = async (pct: number) => {
    usage.current = at(pct)
    const u = usage.current
    await $.session.measure({ context: u.context, rateLimits: u.rateLimits, cost: u.cost, changed: ['rateLimits'] })
  }
  await measure(40)
  await clock.advance(12 * 60_000)
  await measure(46)

  const ui = await mountBand($, 'terminal', 110)
  const five = await ui.find({ type: 'Text', text: /full in ~1h 45m/ })
  expect(five).toBeDefined()
  expect(five?.props?.color).toBe(DARK.amberFg)

  await clock.advance(16 * 60_000)
  expect(await ui.find({ type: 'Text', text: /full in/ })).toBeUndefined()
  await ui.unmount()
})

test('only a measure that moved the limits takes a pace point: a stale reading is never stamped as now', LONG, async ($, on) => {
  const resetsAt = new Date(6 * 3600_000).toISOString()
  const at = (pct: number) => ({ ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt }] })
  const clock = setup(on, { usage: at(40) })
  await $.session.start(START)
  const measure = async (pct: number, changed: Array<'context' | 'rateLimits' | 'cost'>) => {
    usage.current = at(pct)
    const u = usage.current
    await $.session.measure({ context: u.context, rateLimits: u.rateLimits, cost: u.cost, changed })
  }
  await measure(40, ['rateLimits'])
  await clock.advance(12 * MIN)
  await measure(46, ['rateLimits'])
  await clock.advance(8 * MIN)
  // The cost moved; the 5h reading is the one from 8 minutes ago.
  await measure(46, ['cost'])
  await clock.advance(8 * MIN)

  // 16 minutes on from the reading that did move, the pace has gone stale.
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /full in/ })).toBeUndefined()
  await ui.unmount()
})

test('the limits say they are as of the last reply: in the hover and the card, with how long ago once it is more than a few minutes', LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)
  const ui = await mountBand($, 'terminal', 160)
  expect(cardText(hoverCardOf(await ui.drawn(), '5h'))).toBe('Resets in 3h 00m; 5-hour limit, all your Claude use; as of your last reply')
  await clock.advance(12 * MIN + 30_000)
  expect(cardText(hoverCardOf(await ui.drawn(), '5h'))).toBe('Resets in 2h 47m; 5-hour limit, all your Claude use; as of your last reply, 12m ago')
  await ui.press({ key: 'more' })
  expect(shown(cardOf(await ui.drawn(), 'limits'))).toContain('as of your last reply, 12m ago')
  // A measure that moved the limits is a new reading; one that didn't, isn't.
  await $.session.measure({ context: USAGE.context, rateLimits: USAGE.rateLimits, cost: USAGE.cost, changed: ['cost'] })
  expect(shown(cardOf(await ui.drawn(), 'limits'))).toContain('as of your last reply, 12m ago')
  await $.session.measure({ context: USAGE.context, rateLimits: USAGE.rateLimits, cost: USAGE.cost, changed: ['rateLimits'] })
  expect(shown(cardOf(await ui.drawn(), 'limits'))).toContain('as of your last reply')
  expect(shown(cardOf(await ui.drawn(), 'limits'))).not.toContain('ago')
  await ui.unmount()
})

test('reset countdowns keep moving while the cache is cold', LONG, async ($, on) => {
  const clock = setup(on) // 5h resets at 3h
  await $.session.start(START)
  await respond($, BUILD_80K)
  await clock.advance(70 * MIN) // cold

  const ui = await mountBand($, 'terminal', 160)
  expect(shown(pillOf(await ui.drawn(), '5h'))).toMatch(/1h 50m/)
  await clock.advance(45 * MIN)
  expect(shown(pillOf(await ui.drawn(), '5h'))).toMatch(/1h 05m/)
  await ui.unmount()
})

test('a window past its reset shows as reset, not as stale usage', LONG, async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: new Date(HOUR).toISOString() }] } })
  await $.session.start(START)
  await clock.advance(2 * HOUR)

  const ui = await mountBand($, 'terminal', 160)
  const five = pillOf(await ui.drawn(), '5h')
  expect(shown(five)).toMatch(/5h.*reset/)
  expect(shown(five)).not.toMatch(/92%/)
  expect(five?.props?.backgroundColor).toBe(DARK.fiveBg)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), '5h')).toBe('reset')
  await ui.unmount()
})

test('/clear keeps the 5h pace and does not repeat its toast', LONG, async ($, on) => {
  const resetsAt = new Date(3 * 3600_000).toISOString()
  const at = (pct: number) => ({ ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt }] })
  const clock = setup(on, { usage: at(80) })
  await $.session.start(START)
  const measure = async (pct: number) => {
    usage.current = at(pct)
    const u = usage.current
    await $.session.measure({ context: u.context, rateLimits: u.rateLimits, cost: u.cost, changed: ['rateLimits'] })
  }
  await measure(80)
  await clock.advance(12 * MIN)
  await measure(85)
  expect(toasts).toHaveLength(1)

  await $.session.end(CLEAR)
  await measure(85)
  expect(toasts).toHaveLength(1)
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /^ 85%!$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ full in ~/ })).toBeDefined()
  await ui.unmount()
})

test('a failing breakdown read keeps the 5h toast', async ($, on) => {
  const at85 = { ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: new Date(3 * HOUR).toISOString() }] }
  setup(on, { usage: at85 })
  usage.breakdownFails = true
  await $.session.start(START)
  await $.session.measure({ context: at85.context, rateLimits: at85.rateLimits, cost: at85.cost, changed: ['rateLimits'] })
  expect(toasts.some(t => /85% of your 5-hour limit/.test(t))).toBe(true)
})

test('no rate limits: the band draws without the 5h pill or limit facts', async ($, on) => {
  setup(on, { usage: { ...USAGE, rateLimits: [] } })
  await $.session.start(START)
  await respond($, BUILD_155K)

  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeUndefined()
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(cardOf(tree, 'cache')).toBeDefined()
  expect(cardOf(tree, 'limits')).toBeUndefined()
  await ui.unmount()
})

test('a gateway spend limit is listed in the expanded line', async ($, on) => {
  setup(on, { usage: usageAt(MODERN, { ...USAGE, rateLimits: [SPEND_LIMIT] }), now: MODERN })
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(fact(tree, 'spend')).toBe('92%!') // past 80%: marked, never colour alone
  // The worst window's reset leads the card, at its clock time; no window length, so no pace.
  expect(fact(tree, 'resets')).toBe(hostClock(MODERN + 5 * HOUR, MODERN))
  expect(fact(tree, 'spend pace')).toBeUndefined()
  await ui.unmount()
})

test("a snapshot reads the 5h and 7d by name and every other window apart, each reset parsed once, and draws each one's", () => {
  const snap = snapOf()
  const built = snapshotOf({
    ...SNAP_PARTS,
    usage: { ...USAGE, rateLimits: [SPEND_LIMIT, ...USAGE.rateLimits] },
    etaMs: 40 * MIN,
  })
  expect([built.fiveHour, built.sevenDay]).toEqual([{ percentUsed: 4, resetsAt: 3 * HOUR, etaMs: 40 * MIN }, snap.sevenDay])
  expect(built.otherLimits).toEqual([{ kind: 'spend_limit', percentUsed: 92, resetsAt: 5 * HOUR }])
  expect(resetsOf(built)).toEqual([3 * HOUR, 67 * HOUR, 5 * HOUR])
})
