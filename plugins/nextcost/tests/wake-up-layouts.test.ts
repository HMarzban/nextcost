// Who restarted the countdown, in pulse's and departures' open views, at the
// desktop's real height: 13 rows, where a row or a remark that fits at 40 is
// gone. Pulse's headline says it; the board's CACHE line keeps it in REMARKS
// when every other remark has given way.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelUsage, PromptOrigin, RenderChildren } from 'claude-code'
import type { Wake, Waker } from '../hooks/cache'
import { DESKTOP, TERMINAL, cellsOf } from '../hooks/layout'
import { PLAIN } from '../hooks/palette'
import { readingsOf } from '../hooks/reading'
import type { BandSnapshot } from '../hooks/snapshot'
import { BUILD_100K, DESKTOP_START, LONG, MIN, READ_100K, byKey, endTurn, fact, mountBand, respond, runCommand, setup, shown, startTurn, svgsOf, type Node } from './helpers'
import { ASCII_TIER, CALM_LIMITS, COLD_CACHE, HISTORY, LAST_MINUTE_CACHE, bandOf, cacheWith, limitAt, otherLimits, snapOf, visualRows } from './matrix'

const turnFrom = async ($: Engine, id: string, origin: PromptOrigin, u: ModelUsage, from: number, to: number): Promise<void> => {
  await $.prompt.submit({ text: 'x', wait: false, origin })
  await startTurn($, id, from)
  await respond($, u, { turnId: id })
  await endTurn($, id, to)
}

/** Each waker as a card and the board name it. */
const NOUNS: ReadonlyArray<readonly [Waker, string]> = [
  ['task', 'background task'],
  ['schedule', 'schedule'],
  ['session', 'another session'],
  ['channel', 'channel message'],
  ['plugin', 'plugin'],
  ['claude', 'Claude Code'],
]
const TASK_KEPT: Wake = { by: 'task', reWarm: false }
const TASK_REWARMED: Wake = { by: 'task', reWarm: true }
const WARM = cacheWith({ wake: TASK_KEPT })

const SURFACES = ['desktop', 'terminal'] as const
const measureOf = (surface: (typeof SURFACES)[number]) => (surface === 'desktop' ? DESKTOP : TERMINAL)

// ---- pulse ------------------------------------------------------------------

const pulse = (over: Partial<BandSnapshot> = {}): Node =>
  bandOf({ layout: 'pulse', columns: 94, maxRows: 13, history: HISTORY, expanded: true, ...CALM_LIMITS, cache: WARM, ...over })
const pulseHead = (tree: Node): string => shown(byKey(byKey(tree, 'pulse:cache', 'Box'), 'head', 'Box'))

test("a real turn from a background task: at the desktop's 13 rows, pulse's Cache head says who, and the card keeps its price", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(DESKTOP_START)
  await runCommand($, 'layout pulse')
  await turnFrom($, 't1', { kind: 'composer' }, BUILD_100K, 0, 1)
  await clock.advance(20 * MIN)
  await turnFrom($, 't2', { kind: 'task-notification' }, READ_100K, 1, 1.1)
  const ui = await mountBand($, 'desktop', 94, { maxRows: 13 })
  await ui.press({ key: 'more' })
  const tree = (await ui.drawn()) as Node
  await ui.unmount()
  expect(pulseHead(tree)).toMatch(/left · by background task$/)
  expect(fact(byKey(tree, 'pulse:cache', 'Box'), 're-warm if cold')).toBeDefined()
  expect(visualRows(tree, 'desktop')).toBeLessThanOrEqual(13)
})

test('pulse says it in the head, so the wake costs no chart, no card and no row', () => {
  for (const surface of SURFACES) {
    const woken = pulse({ surface, cache: WARM })
    const typed = pulse({ surface, cache: cacheWith({}) })
    expect(pulseHead(woken)).toBe(`${pulseHead(typed)} · by background task`)
    const charts = (tree: Node) => svgsOf(tree).map(s => `${String(s.props?.key)} ${String(s.props?.height)}`)
    expect(charts(woken)).toEqual(charts(typed))
    expect(visualRows(woken, surface)).toBe(visualRows(typed, surface))
  }
})

test("pulse's head by the cache's mood: kept warm or re-warmed alike, led by its mark in amber, and once gone only whose turn was last", () => {
  expect(pulseHead(pulse({ surface: 'terminal', cache: cacheWith({ wake: TASK_REWARMED }) }))).toMatch(/· by background task$/)
  expect(pulseHead(pulse({ surface: 'terminal', cache: { ...LAST_MINUTE_CACHE, wake: TASK_KEPT } }))).toBe('CACHE! 0:30 left · by background task')
  // `cold · by …` would blame it for the cold.
  expect(pulseHead(pulse({ surface: 'terminal', cache: { ...COLD_CACHE, wake: TASK_KEPT } }))).toBe('CACHEcold · last turn by background task')
})

test("a head says nothing of a turn the user typed", () => {
  expect(pulseHead(pulse({ surface: 'terminal', cache: cacheWith({}) }))).toBe('CACHE52m left')
})

test("at every width and at 13 rows, pulse's head says the waker whole or leaves it out, and fits its card; from 94 columns up, the head or a spare row says it", LONG, () => {
  for (const surface of SURFACES)
    for (const [by, noun] of NOUNS)
      for (const cache of [cacheWith({ wake: { by, reWarm: false } }), { ...COLD_CACHE, wake: { by, reWarm: false } }, { ...LAST_MINUTE_CACHE, wake: { by, reWarm: false } }])
        for (let columns = 40; columns <= 200; columns += 3) {
          const tree = pulse({ surface, columns, cache })
          const card = byKey(tree, 'pulse:cache', 'Box')
          const at = `${surface} ${by} ${columns}`
          expect(`${at} ${visualRows(tree, surface) <= 13}`).toBe(`${at} true`)
          if (card === undefined) continue
          const head = byKey(card, 'head', 'Box')
          const lines = (byKey(tree, 'cards', 'Box')?.children ?? []) as Node[]
          const perLine = (lines.find(l => byKey(l, 'pulse:cache', 'Box') !== undefined)?.children ?? []).length
          const inner = Math.floor((columns - (perLine - 1)) / perLine) - 2 - (card.props?.borderStyle === undefined ? 0 : 2)
          expect(`${at} ${cellsOf(head as unknown as RenderChildren, measureOf(surface)) <= inner}`).toBe(`${at} true`)
          const said = shown(head)
          if (/ · /.test(said)) expect(said).toMatch(new RegExp(`(by|last turn by) ${noun}$`))
          if (columns >= 94) expect(`${at} ${shown(card).includes(noun)}`).toBe(`${at} true`)
        }
})

test('a card too narrow for it says it on a row of its own, while one is spare; short of rows, charts and cards win', () => {
  // Four to a line on the desktop, each too narrow for the head.
  const wide = pulse({ surface: 'desktop', columns: 133, cache: { ...COLD_CACHE, wake: TASK_KEPT } })
  expect(pulseHead(wide)).not.toMatch(/last turn/)
  expect(fact(byKey(wide, 'pulse:cache', 'Box'), 'last turn by')).toBe('background task')
  expect(fact(byKey(wide, 'pulse:cache', 'Box'), 'next message')).toBeDefined()
  // One to a line in a narrow terminal, the body full: the cards stay as a typed turn's.
  const stacked = (cache: BandSnapshot['cache']) => pulse({ surface: 'terminal', columns: 40, maxRows: 9, cache })
  const cards = (t: Node) => ['cache', 'spend', 'context', 'limits'].filter(c => byKey(t, `pulse:${c}`, 'Box') !== undefined)
  expect(cards(stacked({ ...COLD_CACHE, wake: TASK_KEPT }))).toEqual(cards(stacked(COLD_CACHE)))
})

test('pulse draws the wake plain and in the ascii tier', () => {
  expect(pulseHead(pulse({ surface: 'desktop', palette: PLAIN }))).toMatch(/· by background task$/)
  expect(shown(byKey(pulse({ surface: 'terminal', glyphs: 'ascii' }), 'pulse:cache', 'Box'))).toMatch(ASCII_TIER)
})

// ---- departures -------------------------------------------------------------

const OTHER = otherLimits(0)
/** Two amber windows of a gateway's: lines with a remark each, so at 13 rows the board's remarks give way. */
const AMBER_OTHERS: BandSnapshot['otherLimits'] = [{ kind: 'spend_limit', ...limitAt(92, 5, 0) }, { kind: 'credit_limit', ...limitAt(95, 9, 0) }]
const departures = (over: Partial<BandSnapshot> = {}): Node =>
  bandOf({ layout: 'departures', columns: 94, maxRows: 13, expanded: true, ...CALM_LIMITS, cache: WARM, ...over })
const remarkOf = (tree: Node, key = 'row:cache'): string => shown(byKey(byKey(byKey(tree, 'board', 'Box'), key, 'Box'), 'remarks'))

test("a real turn from a background task: at the desktop's 13 rows, the board's CACHE line says who", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(DESKTOP_START)
  await runCommand($, 'layout departures')
  await turnFrom($, 't1', { kind: 'composer' }, BUILD_100K, 0, 1)
  await clock.advance(20 * MIN)
  await turnFrom($, 't2', { kind: 'task-notification' }, READ_100K, 1, 1.1)
  const ui = await mountBand($, 'desktop', 94, { maxRows: 13 })
  await ui.press({ key: 'more' })
  const tree = (await ui.drawn()) as Node
  await ui.unmount()
  expect(shown(byKey(tree, 'row:cache', 'Box'))).toMatch(/BY BACKGROUND TASK · RE-WARM/)
  expect(visualRows(tree, 'desktop')).toBeLessThanOrEqual(13)
})

test("the desktop's 13 rows with a gateway's amber limits drop every remark but the waker's", () => {
  const tree = departures({ surface: 'desktop', otherLimits: AMBER_OTHERS })
  expect(byKey(byKey(byKey(tree, 'board', 'Box'), 'row:context', 'Box'), 'remarks')).toBeUndefined()
  expect(remarkOf(tree)).toBe('BY BACKGROUND TASK')
  expect(shown(byKey(tree, 'row:headings', 'Box'))).toMatch(/REMARKS$/)
  expect(visualRows(tree, 'desktop')).toBeLessThanOrEqual(13)
})

test('REMARKS say the most the column holds, the waker first: what it did and the price, then who and the price, then who', () => {
  const said = (columns: number, cache = WARM) => remarkOf(departures({ surface: 'terminal', columns, maxRows: 40, cache }))
  expect(said(200)).toMatch(/^KEPT WARM BY BACKGROUND TASK · IN 52 MIN · RE-WARM ~\$1\.66 IF MISSED$|^KEPT WARM BY BACKGROUND TASK · RE-WARM ~\$1\.66 IF MISSED$/)
  expect(said(94)).toMatch(/BACKGROUND TASK/)
  expect(said(94)).toMatch(/RE-WARM ~\$1\.66/)
  expect(said(60)).toMatch(/BY BACKGROUND TASK/)
  expect(said(200, cacheWith({ wake: TASK_REWARMED }))).toMatch(/^RE-WARMED BY BACKGROUND TASK · /)
})

test('once gone, the board says only whose turn was last, and the next price where it fits', () => {
  const cold = { ...COLD_CACHE, wake: TASK_KEPT }
  expect(remarkOf(departures({ surface: 'terminal', columns: 120, cache: cold }))).toBe('LAST TURN BY BACKGROUND TASK · RE-WARM ~$1.66')
})

test('the collapsed row reads as it did: a wake changes only the open remark', () => {
  const words = (cache: BandSnapshot['cache']) => readingsOf(snapOf({ cache })).board().rows.find(r => r.key === 'cache')
  for (const base of [cacheWith({}), COLD_CACHE, LAST_MINUTE_CACHE]) {
    const [typed, woken] = [words(base), words({ ...base, wake: TASK_KEPT })]
    expect([woken?.status, woken?.time, woken?.remarks, woken?.cell, woken?.cellShort, woken?.alt]).toEqual([typed?.status, typed?.time, typed?.remarks, typed?.cell, typed?.cellShort, typed?.alt])
    expect(typed?.woken).toBeUndefined()
  }
})

test('a typed turn leaves the remark as it was', () => {
  expect(remarkOf(departures({ surface: 'terminal', columns: 120, cache: cacheWith({}) }))).not.toMatch(/ BY /)
})

test('at every width and at 13 rows, the board names the waker, whole from 74 columns, and keeps its rows', LONG, () => {
  for (const surface of SURFACES)
    for (const [by, noun] of NOUNS)
      for (const over of [{ otherLimits: [] }, { otherLimits: OTHER }, { otherLimits: AMBER_OTHERS }]) {
        for (let columns = 60; columns <= 200; columns += 3) {
          const tree = departures({ surface, columns, cache: cacheWith({ wake: { by, reWarm: false } }), ...over })
          const at = `${surface} ${by} ${columns}`
          const said = remarkOf(tree)
          // A narrow column cuts it, as every remark, after the waker's first
          // words; under REMARKS_LEAST, amber's long STATUS leaves no column at all.
          if (columns >= 74) expect(`${at} ${said.includes(`BY ${noun.toUpperCase()}`)}`).toBe(`${at} true`)
          else expect(`${at} ${said === '' ? over.otherLimits === AMBER_OTHERS : said.startsWith(`BY ${noun.toUpperCase().slice(0, 5)}`)}`).toBe(`${at} true`)
          expect(`${at} ${visualRows(tree, surface) <= 13}`).toBe(`${at} true`)
        }
      }
})

test('the board draws the wake plain and in the ascii tier', () => {
  expect(remarkOf(departures({ surface: 'desktop', palette: PLAIN }))).toMatch(/BY BACKGROUND TASK/)
  expect(shown(byKey(departures({ surface: 'terminal', glyphs: 'ascii' }), 'board', 'Box'))).toMatch(ASCII_TIER)
})

// ---- chips' words, which pulse's share ---------------------------------------

test('once gone, the head chips draws says the same: `cold · last turn by`', () => {
  const r = readingsOf(snapOf({ cache: { ...COLD_CACHE, wake: TASK_KEPT } }))
  expect(r.cache.wakeHead).toEqual([[' · last turn by background task', 'label']])
  const warm = readingsOf(snapOf({ cache: WARM }))
  expect(warm.cache.wakeHead).toEqual([[' · by background task', 'label']])
})
