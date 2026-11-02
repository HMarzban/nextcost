// Pulse, the session's trace: the cache a heartbeat, each message a beat,
// context and the 5h window as lines, the week by day, in the one order.
// Open, its cards: tests/pulse-open-cards.test.ts.

import type { RenderChildren } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { ROW_SLACK, TERMINAL, cellsOf } from '../hooks/layout'
import { DARK } from '../hooks/palette'
import { readingsOf } from '../hooks/reading'
import type { BandSnapshot } from '../hooks/snapshot'
import { EMPTY } from '../hooks/words'
import { HOUR, MIN, SAMPLES, USAGE, byKey, expectNear, firstRow, shown, svgAlts, svgsOf, type Node } from './helpers'
import {
  NO_HISTORY, AMBER_WEEK_LIMITS, CALM_LIMITS, COLD_CACHE, HISTORY, LAST_MINUTE_CACHE, bandOf, cacheWith, caseKey, drawCases, snapOf, viewSuite, visualRows, withLimits,
} from './matrix'

viewSuite('pulse')

/** The band as pulse draws it at 160 columns, with history. */
const band = (over: Partial<BandSnapshot> = {}): Node =>
  bandOf({ layout: 'pulse', columns: 160, maxRows: 40, history: HISTORY, samples: SAMPLES, ...over })
const rowOf = (over: Partial<BandSnapshot> = {}): Node => firstRow(band(over)) as Node

const CLASS = (alt: string) => (/^cache/.test(alt) ? 'cache' : /^cost of/.test(alt) ? 'cost' : /^context/.test(alt) ? 'context' : /^5h/.test(alt) ? '5h' : /^weekly/.test(alt) ? '7d' : alt)
const beatOf = (tree: unknown) => svgsOf(firstRow(tree)).find(s => /^cache/.test(String(s.props?.alt)))

test('collapsed desktop: one row; its charts in the one order', () => {
  const row = rowOf({ surface: 'desktop', ...CALM_LIMITS })
  expect(svgAlts(row).map(CLASS)).toEqual(['cache', 'cost', 'context', '5h', '7d'])
  expect(visualRows(row, 'desktop')).toBe(1)
})
test('collapsed terminal: every reading in words, in order, then ▵', () => {
  const row = rowOf({ surface: 'terminal', ...CALM_LIMITS })
  expect(shown(row)).toMatch(/cache[\s\S]*\$3\.19[\s\S]*context[\s\S]*5h[\s\S]*7d/)
  expect(byKey(row.children?.at(-1), 'more', 'Button')?.props?.label).toBe('▵')
})
test('the beats: 14 wide, a path', () => {
  const beats = svgsOf(rowOf({ surface: 'desktop', ...CALM_LIMITS })).find(s => /^cost of the last 14/.test(String(s.props?.alt)))
  expect(String(beats?.props?.source)).toMatch(/<path class="beats"/)
})
// One drawCases a test: the engine's hooks are registered before its first call.
for (const [scenario, mark] of [['calm', /<circle[^>]*fill="#/], ['cold', /<line/], ['unmeasured', /fill="none"/], ['warming', /fill="none"/]] as const) {
  test(`the heartbeat per mood: ${scenario}`, async ($, on) => {
    const drawn = await drawCases($, on, { scenario, appearance: 'dark', layout: 'pulse' }, [{ surface: 'desktop', cols: 160 }])
    expect(String(beatOf(Object.values(drawn)[0])?.props?.source)).toMatch(mark)
  })
}
test('the heartbeat: its source unchanged as the last minute counts down', () => {
  const tick = (leftMs: number) => beatOf(band({ surface: 'desktop', ...CALM_LIMITS, cache: cacheWith({ requests: 1, leftMs, coldAt: leftMs }) }))
  expect([tick(40_000)?.props?.source, tick(40_000)?.props?.alt]).toEqual([tick(39_000)?.props?.source, tick(39_000)?.props?.alt])
})
test('recalled carries ~ on its time', async ($, on) => {
  const recalled = await drawCases($, on, { scenario: 'recalled', appearance: 'dark', layout: 'pulse' }, [{ surface: 'terminal', cols: 160 }])
  expect(shown(firstRow(Object.values(recalled)[0]))).toMatch(/cache[^·]*~/)
})
test('working shows no countdown', async ($, on) => {
  const working = await drawCases($, on, { scenario: 'working', appearance: 'dark', layout: 'pulse' }, [{ surface: 'terminal', cols: 160 }])
  expect(shown(firstRow(Object.values(working)[0]))).not.toMatch(/\d+m left|\d+s left/)
})
test("no costs yet: the flat trace only beside `no costs yet`, while the total is $0; a known total alone, no trace", () => {
  const none = { history: NO_HISTORY }
  for (const surface of ['desktop', 'terminal'] as const) {
    // A resumed conversation: its total known, no message's cost recorded.
    const resumed = byKey(rowOf({ surface, ...none }), 'spend', 'Box')
    expect(shown(resumed)).toMatch(/^spend ?\$3\.19$/)
    expect(svgsOf(resumed)).toHaveLength(0)
    const fresh = rowOf({ surface, ...none, costUsd: 0 })
    expect(shown(byKey(fresh, 'spend', 'Box'))).toMatch(surface === 'desktop' ? /^spend\$0\.00 · no costs yet$/ : /^spend \$0\.00 · no costs yet ⣀{7}$/)
    // As the row narrows, no step leaves the trace without its word.
    for (let columns = 160; columns >= 40; columns--) {
      const spend = byKey(rowOf({ surface, columns, ...none, costUsd: 0 }), 'spend', 'Box')
      if (spend === undefined) continue
      const traced = surface === 'desktop' ? svgsOf(spend).length > 0 : /⣀/.test(shown(spend))
      expect(`${surface} ${columns} ${traced && !shown(spend).includes(EMPTY.costsShort) ? 'bare' : 'ok'}`).toBe(`${surface} ${columns} ok`)
    }
  }
  const flat = svgsOf(byKey(rowOf({ surface: 'desktop', ...none, costUsd: 0 }), 'spend', 'Box'))
  expect(flat.map(s => s.props?.alt)).toEqual([EMPTY.costsAlt])
  expect(String(flat[0]?.props?.source)).toMatch(new RegExp(`<line class="flat"[^>]* stroke="${DARK.label}"`))
  expect(shown(byKey(band({ surface: 'desktop', expanded: true, ...none }), 'pulse:spend', 'Box'))).toContain(EMPTY.costs)
})
test('no limits: no 5h or 7d; no samples: 5h and 7d in words only', () => {
  expect(shown(rowOf({ fiveHour: undefined, sevenDay: undefined }))).not.toMatch(/5h|7d/)
  const bare = rowOf({ surface: 'desktop', ...CALM_LIMITS, samples: [] })
  expect(svgAlts(bare).map(CLASS)).not.toContain('5h')
  expect(shown(bare)).toMatch(/5h ?26%[\s\S]*7d ?41%/)
})
test('at 40 and 45 columns, full amber: the cache and the 7d stay, in order, ▵ last, and the row fits', async ($, on) => {
  const drawn = await drawCases($, on, { scenario: 'lastMinute', appearance: 'dark', layout: 'pulse', usage: { ...USAGE, rateLimits: withLimits(30, 82) } }, [40, 45].map(cols => ({ surface: 'terminal' as const, cols })))
  for (const cols of [40, 45]) {
    const row = firstRow(drawn[caseKey({ surface: 'terminal', cols }, 'shut')]) as Node
    // The cache's amber words, led by '! ', then the 7d's.
    expect(shown(row)).toMatch(/^! \d+s[\s\S]*7d/)
    expect(shown(byKey(row, 'cache', 'Box'))).toMatch(/^! \d+s/)
    expect(byKey(row.children?.at(-1), 'more', 'Button')?.props?.label).toBe('▵')
    expect(cellsOf(row as unknown as RenderChildren, TERMINAL)).toBeLessThanOrEqual(cols - ROW_SLACK)
  }
})
test('narrow and calm, spend gives way, then context, then 5h; the cache and 7d stay, and the row fits', () => {
  // A cold cache says its re-warm, so at 40 columns even 5h has gone.
  const cold = { ...CALM_LIMITS, cache: COLD_CACHE }
  const keys = (columns: number) => ['cache', 'spend', 'context', '5h', '7d'].filter(k => byKey(rowOf({ columns, ...cold }), k, 'Box') !== undefined)
  expect(shown(byKey(rowOf(cold), 'cache', 'Box'))).toMatch(/^cache cold/)
  expect(keys(40)).toEqual(['cache', '7d'])
  // The widest row without each group: spend's is the widest, then context's, then 5h's.
  const widths = Array.from({ length: 121 }, (_, i) => 160 - i)
  const goneAt = (k: string) => widths.find(columns => !keys(columns).includes(k)) ?? 0
  const [spend, context, five] = [goneAt('spend'), goneAt('context'), goneAt('5h')]
  expect([spend > context, context > five, five > 40]).toEqual([true, true, true])
  expect(keys(spend)).toEqual(['cache', 'context', '5h', '7d'])
  expect(keys(context)).toEqual(['cache', '5h', '7d'])
  for (const columns of widths) expect(cellsOf(rowOf({ columns, ...cold }) as unknown as RenderChildren, TERMINAL)).toBeLessThanOrEqual(columns - ROW_SLACK)
})
test('one cost, or every cost a re-warm: no NaN', () => {
  for (const costs of [[{ usd: 0.2, reWarm: false }], [{ usd: 0.8, reWarm: true }, { usd: 0.9, reWarm: true }]]) {
    const src = svgsOf(rowOf({ surface: 'desktop', ...CALM_LIMITS, history: { ...HISTORY, costs } })).map(s => String(s.props?.source)).join('')
    expect(src).not.toMatch(/NaN|Infinity/)
  }
})
test('terminal: braille after the numbers, in their tile', () => {
  expect(shown(rowOf({ surface: 'terminal', ...CALM_LIMITS }))).toMatch(/spend \$3\.19 · last \$0\.21 [⠀-⣿]+/)
})
test("terminal: the cache and the 7d in words alone, as the three-layouts spec §4.1's table draws them", () => {
  const row = rowOf({ surface: 'terminal', ...CALM_LIMITS })
  expect(shown(byKey(row, 'cache', 'Box'))).toMatch(/^cache 52m left$/)
  expect(shown(byKey(row, '7d', 'Box'))).toMatch(/^7d 41%$/)
})
test("no costs yet: the name, the total in a value's ink, its words then the flat trace in a label's", () => {
  const spend = byKey(rowOf({ surface: 'terminal', history: NO_HISTORY, costUsd: 0 }), 'spend', 'Box')
  const inks: string[] = []
  const visit = (x: unknown): void => {
    const node = x as Node | null
    if (node === null || typeof node !== 'object') return
    const text = (node.children ?? []).every(k => typeof k === 'string') ? (node.children ?? []).join('') : ''
    // A text surface's column of air, a Text of one space, says nothing.
    if (node.type === 'Text' && text.trim() !== '') inks.push(`${text}|${node.props?.color === DARK.label ? 'label' : node.props?.color === DARK.value ? 'value' : String(node.props?.color)}`)
    for (const k of node.children ?? []) visit(k)
  }
  visit(spend)
  expect(inks).toEqual(['spend|label', '$0.00|value', ` · ${EMPTY.costsShort}|label`, '⣀⣀⣀⣀⣀⣀⣀|label'])
})
// ---- the amber cache, and where the 5h and 7d charts start and stop ------

test("a 5h window first seen mid-window: its chart, shut and open, starts at the first hour it knows, its level now the window's", () => {
  // Samples from hour 3 on, as when the window opened on another device.
  const sample = (at: number, fivePct: number) => ({ at, fivePct, sevenPct: 30, fiveResetAt: 5 * HOUR, sevenResetAt: 67 * HOUR })
  const mid = { surface: 'desktop', now: 4.5 * HOUR, fiveHour: { percentUsed: 30, resetsAt: 5 * HOUR, etaMs: null }, samples: [sample(3.2 * HOUR, 26), sample(4.2 * HOUR, 30)] } as const
  for (const tree of [rowOf(mid), byKey(band({ ...mid, expanded: true }), 'pulse:limits', 'Box')]) {
    const five = svgsOf(tree).find(s => /^5h window/.test(String(s.props?.alt)))
    const solid = /<polyline points="([^"]+)"/.exec(String(five?.props?.source))?.[1]?.split(' ') ?? []
    // Hour 3's end, then now's: two points, not five from 0%.
    expect(solid).toHaveLength(2)
  }
})
test("pulse's amber cache is led by '! ', on the row and open", () => {
  const row = rowOf({ surface: 'terminal', cache: LAST_MINUTE_CACHE })
  expect(shown(byKey(row, 'cache', 'Box'))).toMatch(/^! 30s left/)
  const open = band({ surface: 'desktop', expanded: true, cache: LAST_MINUTE_CACHE })
  expect(shown(byKey(byKey(open, 'pulse:cache', 'Box'), 'head', 'Box'))).toMatch(/^CACHE! 0:30 left$/)
})
test("an expiring cache's heartbeat is drawn in amber", () => {
  expect(String(beatOf(band({ surface: 'desktop', cache: LAST_MINUTE_CACHE }))?.props?.source)).toMatch(new RegExp(`fill="${DARK.amberFg}"`))
})
test("7d at 85% on a fast pace: the guessed days, drawn, never pass what is left of the week", () => {
  const snap = { surface: 'desktop' as const, ...AMBER_WEEK_LIMITS }
  // The raw guesses would pass the 15 points left.
  const days = readingsOf(snapOf({ layout: 'pulse', samples: SAMPLES, ...snap })).week().days
  expect(days.filter(d => d.guess).reduce((n, d) => n + (d.pct ?? 0), 0)).toBeGreaterThan(15)
  for (const expanded of [false, true]) {
    const cells = svgsOf(band({ ...snap, expanded })).filter(s => /^weekly limit by day/.test(String(s.props?.alt)))
    expect(cells.length).toBeGreaterThan(0)
    for (const c of cells) {
      const source = String(c.props?.source)
      const inner = Number(/<rect class="edge"[^>]* height="([\d.]+)"/.exec(source)?.[1]) - 1
      const guessed = [...source.matchAll(/<rect class="guess"[^>]* height="([\d.]+)"/g)].reduce((n, [, h]) => n + (Number(h) / inner) * 100, 0)
      expect(guessed).toBeLessThanOrEqual(15.5)
    }
  }
})

test("today's fill, with no reading inside today yet, draws as the alt says it: a guess of what is left, else the 7d in words", () => {
  const at = (m: number, sevenPct: number) => ({ at: m * MIN, fivePct: 0, sevenPct, fiveResetAt: 3 * HOUR, sevenResetAt: 67 * HOUR })
  const late = [at(-120, 70), at(-90, 74), at(-60, 78), at(-30, 82), at(-5, 85)]
  const unzoned = (samples: ReturnType<typeof at>[], expanded: boolean) =>
    band({ surface: 'desktop', zone: undefined, expanded, ...AMBER_WEEK_LIMITS, samples })
  const cellsOf7d = (tree: Node) => svgsOf(tree).filter(s => /^weekly limit by day/.test(String(s.props?.alt)))
  // No day measured: no cells, shut or open, and the 7d's words stay.
  for (const expanded of [false, true]) {
    expect(cellsOf7d(unzoned(late, expanded))).toHaveLength(0)
    expect(shown(firstRow(unzoned(late, expanded)))).toMatch(/7d 85%/)
  }
  // Wednesday measured: today's cell is a guess filling about 15 of its 100.
  for (const expanded of [false, true]) {
    const [cells] = cellsOf7d(unzoned([at(-30 * 60, 60), ...late], expanded))
    const source = String(cells?.props?.source)
    expect(cells?.props?.alt).toMatch(/Thursday about 15% and fills it/)
    const inner = Number(/<rect class="edge"[^>]* height="([\d.]+)"/.exec(source)?.[1]) - 1
    const guesses = [...source.matchAll(/<rect class="guess"[^>]* height="([\d.]+)"/g)].map(([, h]) => (Number(h) / inner) * 100)
    expect(guesses).toHaveLength(1)
    expectNear(guesses[0], 15, 2)
  }
})
