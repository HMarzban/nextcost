// The insights' pure logic: the conversation's trails, last turn's cost and
// the 5h pace ETA.

import { test, expect } from 'claude-code/testing'
import { fmtEta } from '../hooks/format'
import { COST_TRAIL, CONTEXT_TRAIL, newInsights } from '../hooks/insights'
import { BUILD_155K, MIN, endTurn, fact, mountBand, respond, setup, START, startTurn, turn } from './helpers'

const cents = (n: number | null): number | null => (n === null ? null : Math.round(n * 100))
const RESET_IN_3H = 3 * 60 * MIN

test('the cost trail keeps the last 24 messages', () => {
  const i = newInsights()
  for (let n = 0; n < 30; n++) i.pushCost(n, false)
  const { costs } = i.trails()
  expect(costs).toHaveLength(COST_TRAIL)
  expect([costs[0]?.usd, costs.at(-1)?.usd]).toEqual([6, 29])
})
test('the context trail keeps the last 40 turns', () => {
  const i = newInsights()
  for (let n = 0; n < 50; n++) i.pushContext(n * 1000)
  expect(i.trails().context).toHaveLength(CONTEXT_TRAIL)
})
test('/clear empties the conversation trails', () => {
  const i = newInsights()
  i.pushCost(1, false)
  i.pushContext(1000)
  i.conversationEnded()
  expect(i.trails()).toEqual({ costs: [], context: [] })
})
test('trails taken for a snapshot stay as they stood', () => {
  const i = newInsights()
  i.pushCost(1, false)
  i.pushContext(1000)
  const held = i.trails()
  i.pushCost(2, true)
  i.conversationEnded()
  expect(held).toEqual({ costs: [{ usd: 1, reWarm: false }], context: [1000] })
})
test("last turn's cost is the ledger's rise across one turn", () => {
  const i = newInsights()
  i.noteTurnStart('t1', 2.0)
  expect(cents(i.noteTurnEnd('t1', 2.41))).toBe(41)
})

test('a turn that never started leaves nothing to show', () => {
  const i = newInsights()
  expect(i.noteTurnEnd('never-started', 5)).toBe(null)
})

test('a turn without a ledger leaves nothing to show', () => {
  const i = newInsights()
  i.noteTurnStart('t1', undefined)
  expect(i.noteTurnEnd('t1', 3)).toBe(null)
})

test('a turn that spent nothing leaves nothing to show', () => {
  const i = newInsights()
  i.noteTurnStart('t2', 3)
  expect(i.noteTurnEnd('t2', 3)).toBe(null)
})

test('the ETA needs ten minutes of evidence', () => {
  const i = newInsights()
  i.noteFiveHour(0, 40, RESET_IN_3H)
  i.noteFiveHour(8 * MIN, 46, RESET_IN_3H)
  expect(i.fiveHourEtaMs(8 * MIN)).toBe(null)
})

test('the ETA needs a two-point rise', () => {
  const i = newInsights()
  i.noteFiveHour(0, 40, RESET_IN_3H)
  i.noteFiveHour(12 * MIN, 41, RESET_IN_3H)
  expect(i.fiveHourEtaMs(12 * MIN)).toBe(null)
})

test('the ETA projects the pace from the first to the newest sample', () => {
  const i = newInsights()
  i.noteFiveHour(0, 40, RESET_IN_3H)
  i.noteFiveHour(12 * MIN, 46, RESET_IN_3H) // 0.5 points a minute, 54 to go
  expect(i.fiveHourEtaMs(12 * MIN)).toBe(108 * MIN)
  expect(fmtEta(108 * MIN)).toBe('~1h 45m')
})

test('the ETA hides when the samples go stale', () => {
  const i = newInsights()
  i.noteFiveHour(0, 40, RESET_IN_3H)
  i.noteFiveHour(12 * MIN, 46, RESET_IN_3H)
  expect(i.fiveHourEtaMs(27 * MIN)).not.toBe(null) // exactly 15 minutes: still fresh
  expect(i.fiveHourEtaMs(28 * MIN)).toBe(null) // 16 minutes: stale
})

test('the ETA hides once the time it projects has passed, rather than saying ~5m for a quarter of an hour', () => {
  const i = newInsights()
  i.noteFiveHour(0, 90, RESET_IN_3H)
  i.noteFiveHour(12 * MIN, 96, RESET_IN_3H) // half a point a minute, 4 to go: full at 20m
  expect(i.fiveHourEtaMs(19 * MIN)).toBe(MIN)
  expect(i.fiveHourEtaMs(20 * MIN)).toBe(null)
  expect(i.fiveHourEtaMs(21 * MIN)).toBe(null)
})

test('the ETA ages from the newest reading, not from the last time the percent moved', () => {
  const i = newInsights()
  i.noteFiveHour(0, 84, RESET_IN_3H)
  i.noteFiveHour(12 * MIN, 86, RESET_IN_3H) // a point every 6 minutes, 14 to go: full at 96m
  i.noteReading(20 * MIN)
  i.noteReading(26 * MIN) // replies, and no new point since 12m
  expect(i.fiveHourEtaMs(28 * MIN)).toBe(68 * MIN) // 16 minutes past the last point, but 2 past a reading
  // Idle, with no reading, it still hides a quarter of an hour after the last.
  expect(i.fiveHourEtaMs(41 * MIN)).not.toBe(null)
  expect(i.fiveHourEtaMs(42 * MIN)).toBe(null)
})

test('readings that keep arriving with no move say the pace is flatter than measured: the ETA hides', () => {
  const i = newInsights()
  i.noteFiveHour(0, 84, RESET_IN_3H)
  i.noteFiveHour(12 * MIN, 86, RESET_IN_3H) // one point should take 6 minutes
  i.noteReading(29 * MIN) // 17 minutes on, not yet three points' time
  expect(i.fiveHourEtaMs(30 * MIN)).not.toBe(null)
  i.noteReading(31 * MIN) // 19 minutes and no point: well past
  expect(i.fiveHourEtaMs(32 * MIN)).toBe(null)
})

test('the ETA hides when the window resets first', () => {
  const i = newInsights()
  const soon = 30 * MIN
  i.noteFiveHour(0, 40, soon)
  i.noteFiveHour(12 * MIN, 46, soon) // fills at 120m, resets at 30m
  expect(i.fiveHourEtaMs(12 * MIN)).toBe(null)
})

test('no ETA once the window is full', () => {
  const i = newInsights()
  i.noteFiveHour(0, 90, RESET_IN_3H)
  i.noteFiveHour(12 * MIN, 100, RESET_IN_3H)
  expect(i.fiveHourEtaMs(12 * MIN)).toBe(null)
})

test('jitter in resetsAt keeps the samples; a real reset clears them', () => {
  const i = newInsights()
  i.noteFiveHour(0, 40, 3 * 60 * MIN)
  i.noteFiveHour(12 * MIN, 46, 3 * 60 * MIN + 2_000) // 2s jitter
  expect(i.fiveHourEtaMs(12 * MIN)).not.toBe(null)
  i.noteFiveHour(13 * MIN, 2, 8 * 60 * MIN) // new window
  expect(i.fiveHourEtaMs(13 * MIN)).toBe(null)
})

test('old samples fall out of the 30-minute window', () => {
  const i = newInsights()
  i.noteFiveHour(0, 10, RESET_IN_3H)
  i.noteFiveHour(40 * MIN, 12, RESET_IN_3H)
  i.noteFiveHour(52 * MIN, 13, RESET_IN_3H) // only 40m and 52m remain: 1 point
  expect(i.fiveHourEtaMs(52 * MIN)).toBe(null)
})

test('the ETA rounds to 5 minutes under an hour and 15 from an hour', () => {
  expect(fmtEta(2 * MIN)).toBe('~5m')
  expect(fmtEta(38 * MIN)).toBe('~40m')
  expect(fmtEta(58 * MIN)).toBe('~1h')
  expect(fmtEta(67 * MIN)).toBe('~1h')
  expect(fmtEta(68 * MIN)).toBe('~1h 15m')
  expect(fmtEta(130 * MIN)).toBe('~2h 15m')
})

test("a subagent's turn inside an open turn doesn't change what the last message cost", async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)
  await startTurn($, 'main-1', 2.41)
  await endTurn($, 'sub-1', 2.5, { agentId: 'agent-1' })
  await endTurn($, 'main-1', 2.62)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'last message')).toBe('$0.21')
  await ui.unmount()
})

test('a turn that spent nothing keeps the last cost: every layout reads the one pulse charts', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)
  await turn($, 't1', 2.41, 2.62)
  await turn($, 't2', 2.62, 2.62)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'last message')).toBe('$0.21')
  await ui.unmount()
})

test("a subagent's turn.start doesn't take over the open turn it runs in", async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)
  await startTurn($, 'main-1', 2.41)
  // Since 2.1.299 a subagent's turn raises turn.start; this one shares its parent's turnId.
  await startTurn($, 'main-1', 2.5, 'agent-1')
  await endTurn($, 'main-1', 2.55, { agentId: 'agent-1' })
  await endTurn($, 'main-1', 2.62)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'last message')).toBe('$0.21')
  await ui.unmount()
})
