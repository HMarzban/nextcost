// Every invariant check, proven on a tree that breaks it.

import { test, expect } from 'claude-code/testing'
import type { RenderChildren } from 'claude-code'
import { DESKTOP, ROW_SLACK, TERMINAL, cellsOf } from '../hooks/layout'
import { flaps } from '../hooks/flaps'
import { flapWords, type Node } from './helpers'
import { invariantErrors, kitOf, orderErrors, visualRows, type InvariantContext } from './matrix'

const t = (s: string, props: Record<string, unknown> = {}) => ({ type: 'Text', props, children: [s] })
const toggle = (label = '▵') => ({ type: 'Button', props: { label } })
const row = (...kids: unknown[]) => ({ type: 'Box', props: { flexDirection: 'row' }, children: kids })
const svg = (props: Record<string, unknown>) => ({ type: 'Svg', props: { source: '<svg/>', height: 12, ...props } })
const view = (lines: unknown[], rest: unknown[] = []) => ({
  type: 'Box',
  props: { flexDirection: 'column' },
  children: [{ type: 'Box', props: { key: 'collapsed', flexDirection: 'column', paddingX: 1 }, children: lines }, ...rest],
})
// Chips' rules, the loosest: pulse and departures add the order and ▵ last.
const CTX: InvariantContext = {
  layout: 'chips',
  surface: 'terminal',
  appearance: 'dark',
  cols: 120,
  maxRows: 40,
  scenario: 'calm',
  glyphs: 'unicode',
  expanded: false,
}
/** The names of the checks a tree fails. */
const failed = (tree: unknown, over: Partial<InvariantContext> = {}): string[] =>
  invariantErrors(tree as Node, { ...CTX, ...over }).map(e => e.split(':')[0] ?? '')
const GOOD = view([row(t('cache 52m left'), toggle())])

test('visualRows counts terminal lines and desktop rows of 24 px', () => {
  const two = { type: 'Box', props: { flexDirection: 'column' }, children: [t('a'), t('b')] }
  expect(visualRows(two, 'terminal')).toBe(2)
  const tile = { type: 'Box', props: { flexDirection: 'column' }, children: [t('52m'), t('cache'), svg({ width: 40, height: 4, alt: 'x' })] }
  expect(visualRows(tile, 'desktop')).toBe(2) // 24 + 24 + 4 = 52 px
  expect(visualRows(row(t('a'), svg({ width: 30, height: 30, alt: 'r' })), 'desktop')).toBe(1) // 30 px
  const aired = { type: 'Box', props: { flexDirection: 'column' }, children: [t('a'), { type: 'Box', props: { marginTop: 1 }, children: [t('b')] }] }
  expect(visualRows(aired, 'terminal')).toBe(3)
})
test('a good tree passes every check', () => {
  expect(failed(GOOD)).toEqual([])
})
test('rows: the collapsed part takes the rows its view declares', () => {
  expect(failed(view([row(t('a')), row(t('b'), toggle())]))).toContain('rows')
})
test('toggle: ▵ shut, ▿ open, once', () => {
  expect(failed(view([row(t('a'))]))).toContain('toggle')
  expect(failed(GOOD, { expanded: true })).toContain('toggle')
  expect(failed(view([row(t('a'), toggle(), toggle())]))).toContain('toggle')
  expect(failed(view([row(t('a'), toggle('^'))]), { glyphs: 'ascii' })).not.toContain('toggle')
})
test('width: no wider than the row less its slack on the terminal, the row on the desktop, except all-amber below 60', () => {
  expect(failed(view([row(t('x'.repeat(130)), toggle())]))).toContain('width')
  const wide = view([row(t('x'.repeat(100)), toggle())])
  const terminal = cellsOf(wide.children[0] as RenderChildren, TERMINAL)
  expect(failed(wide, { cols: terminal + ROW_SLACK })).not.toContain('width')
  expect(failed(wide, { cols: terminal + ROW_SLACK - 1 })).toContain('width')
  const desktop = Math.ceil(cellsOf(wide.children[0] as RenderChildren, DESKTOP))
  expect(failed(wide, { surface: 'desktop', cols: desktop })).not.toContain('width')
  const clipped = view([row(t(`! 30s left · re-warm ~$1.66 ${'x'.repeat(60)}`), toggle())])
  expect(failed(clipped, { scenario: 'lastMinute', cols: 50 })).not.toContain('width')
  // One amber reading still fits: only all-amber, which lastMinute stands for, clips.
  expect(failed(view([row(t(`! 5h 82% ${'x'.repeat(60)}`), toggle())]), { scenario: 'limit80', cols: 50 })).toContain('width')
})
test('whitespace: none alone on the desktop', () => {
  const spaced = view([{ type: 'Box', props: { flexDirection: 'row' }, children: [t('a'), ' ', toggle()] }])
  expect(failed(spaced, { surface: 'desktop' })).toContain('whitespace')
})
test('svgPlacement: Svg only where it draws', () => {
  expect(failed(view([row(t('a'), svg({ width: 20, alt: 'x' }), toggle())]))).toContain('svgPlacement')
  expect(failed(view([row(t('a'), svg({ width: 20, alt: 'x' }), toggle())]), { surface: 'desktop', appearance: 'plain' })).toContain('svgPlacement')
})
test('svgProps: every Svg has an alt and a width, but a bar stretched to its card', () => {
  expect(failed(view([row(t('a'), svg({ width: 20 }), toggle())]), { surface: 'desktop' })).toContain('svgProps')
  expect(failed(view([row(t('a'), svg({ alt: 'x' }), toggle())]), { surface: 'desktop' })).toContain('svgProps')
  // A card's bar stretched to its slot has none: the slot caps it.
  const stretched = svg({ alt: 'x', source: '<svg preserveAspectRatio="none"/>' })
  expect(failed(view([row(t('a'), stretched, toggle())]), { surface: 'desktop' })).not.toContain('svgProps')
})
test('svgProps: no Svg has an id, a gradient, a pattern or a clipPath', () => {
  const desk = { surface: 'desktop' } as const
  expect(failed(view([row(t('a'), svg({ width: 20, alt: 'x', id: 'bar' }), toggle())]), desk)).toContain('svgProps')
  for (const mark of ['<clipPath id="c"/>', '<linearGradient/>', '<radialGradient/>', '<pattern/>', '<rect id="x"/>'])
    expect(failed(view([row(t('a'), svg({ width: 20, alt: 'x', source: `<svg>${mark}</svg>` }), toggle())]), desk)).toContain('svgProps')
  const plain = svg({ width: 20, alt: 'x', source: '<svg><rect width="2" stroke-width="2"/></svg>' })
  expect(failed(view([row(t('a'), plain, toggle())]), desk)).not.toContain('svgProps')
})
test('colour: nothing is red', () => {
  expect(failed(view([row(t('a', { color: '#ff0000' }), toggle())]))).toContain('colour')
  const redFill = svg({ width: 20, alt: 'x', source: '<svg><rect fill="#e5484d"/></svg>' })
  expect(failed(view([row(t('a'), redFill, toggle())]), { surface: 'desktop' })).toContain('colour')
  expect(failed(view([row(t('a', { color: 'error' }), toggle())]), { appearance: 'plain' })).toContain('colour')
  for (const red of ['red', 'redBright', 'rgb(220, 38, 38)', '#f00', '#ff000080'])
    expect(failed(view([row(t('a', { color: red }), toggle())]))).toContain('colour')
  expect(failed(view([row({ type: 'Box', props: { hover: { color: '#ff0000' } }, children: [t('a')] }, toggle())]))).toContain('colour')
  for (const paint of ['fill="red"', "fill='red'", 'fill="rgb(220,38,38)"', 'stroke="#f00"', 'style="stop-color: #e5484d"'])
    expect(failed(view([row(t('a'), svg({ width: 20, alt: 'x', source: `<svg><rect ${paint}/></svg>` }), toggle())]), { surface: 'desktop' }))
      .toContain('colour')
  expect(failed(view([row({ type: 'Box', props: { key: 'error' }, children: [t('a')] }, toggle())]))).not.toContain('colour')
  expect(failed(view([row(t('PR #100'), toggle('#200'))]))).not.toContain('colour')
  const text = svg({ width: 20, alt: 'PR #100', source: '<svg><text fill="#e5e5e5">#823 52m&#8230;&#8212;</text></svg>' })
  expect(failed(view([row(t('a'), text, toggle())]), { surface: 'desktop' })).not.toContain('colour')
  expect(failed(view([row(t('a', { color: '#e5e5e5' }), toggle())]))).not.toContain('colour')
  expect(failed(view([row(t('a', { backgroundColor: '#7a4e06' }), toggle())]))).not.toContain('colour')
})
test('wording: never suggests sending a message', () => {
  expect(failed(view([row(t('send a message to keep it warm'), toggle())]))).toContain('wording')
})
test("amber: each of the scenario's triggers has its words", () => {
  expect(failed(GOOD, { scenario: 'lastMinute' })).toContain('amber')
  expect(failed(view([row(t('! 30s left · re-warm ~$1.66'), toggle())]), { scenario: 'lastMinute' })).not.toContain('amber')
})
test("amber: another limit's words are owed only open, where it is drawn, the cards' marked figure among them", () => {
  expect(failed(GOOD, { scenario: 'gatewaySpend' })).not.toContain('amber')
  const open = view([row(t('a'), toggle('▿'))], [t('spend 92%')])
  expect(failed(open, { scenario: 'gatewaySpend', expanded: true })).toContain('amber')
  expect(failed(view([row(t('a'), toggle('▿'))], [t('! spend 92%')]), { scenario: 'gatewaySpend', expanded: true })).not.toContain('amber')
  // Chips' cards' own mark for it, as its pills' are.
  expect(failed(view([row(t('a'), toggle('▿'))], [t('spend 92%!')]), { scenario: 'gatewaySpend', expanded: true })).not.toContain('amber')
})
test('estimate: a price or a fill time carries ~', () => {
  expect(failed(view([row(t('re-warm $1.66'), toggle())]))).toContain('estimate')
  expect(failed(view([row(t('next message $1.66'), toggle())]))).toContain('estimate')
  expect(failed(view([row(t('5h full 14:20'), toggle())]))).toContain('estimate')
  expect(failed(view([row(t('7d 50% at avg pace'), toggle())]))).toContain('estimate')
  expect(failed(view([row(t('last message $0.21'), toggle())]))).not.toContain('estimate')
  expect(failed(view([row(t('! 5h full ~14:20'), toggle())]))).not.toContain('estimate')
})
test('projection: a landing of 100% or more says full, never a figure', () => {
  expect(failed(view([row(t('7d ~112% at reset'), toggle())]), { scenario: 'sevenFullBeforeReset' })).toContain('projection')
  expect(failed(view([row(t('7d full at avg pace'), toggle())]), { scenario: 'sevenFullBeforeReset' })).not.toContain('projection')
})
test('unknown: context not reported never reads 0%', () => {
  for (const said of ['context 0%', 'ctx 0%', 'CONTEXT 0%']) expect(failed(view([row(t(said), toggle())]), { scenario: 'warming' })).toContain('unknown')
  expect(failed(view([row(t('context –'), toggle())]), { scenario: 'warming' })).not.toContain('unknown')
})
test('empty: no NaN, undefined, null or empty Text', () => {
  for (const said of ['context NaN%', '↻ undefined', 'null left', '↻ UNDEFINED'])
    expect(failed(view([row(t(said), toggle())]))).toContain('empty')
  expect(failed(view([row(t('a'), svg({ width: 20, alt: '5h undefined' }), toggle())]), { surface: 'desktop' })).toContain('empty')
  expect(failed(view([row(t('a'), t(''), toggle())]))).toContain('empty')
  // In the ascii tier a glyph-only Text, such as an icon's `↻ `, maps to nothing.
  expect(failed(view([row(t('a'), t(''), toggle('v'))]), { glyphs: 'ascii' })).not.toContain('empty')
})
test("emptyState: open, each empty state follows its own section's name", () => {
  const open = (body: unknown[], said = 'cache 52m left') => view([row(t(said), toggle('▿'))], body)
  expect(failed(open([t('none reported')]), { expanded: true })).toContain('emptyState')
  expect(failed(open([t('CONTEXT'), t('none reported')]), { expanded: true })).toContain('emptyState')
  expect(failed(open([t('LIMITS'), t('none reported'), t('Context'), t('not reported')]), { expanded: true })).not.toContain('emptyState')
  // The collapsed part says its own: `5h · 7d none reported`.
  expect(failed(open([t('LIMITS')], '5h · 7d none reported'), { expanded: true })).not.toContain('emptyState')
})
test("glyphs: the tier's own, and ASCII alone in the ascii tier", () => {
  expect(failed(view([row(t('◐ cache'), toggle())]))).toContain('glyphs')
  expect(failed(view([row(t('cache · 52m'), toggle('v'))]), { glyphs: 'ascii' })).toContain('glyphs')
  // A cut the surface makes ends in `…`, so ascii leaves none to it.
  const cut = { type: 'Text', props: { wrap: 'truncate-end' }, children: ['cache 52m'] }
  expect(failed(view([row(cut, toggle('^'))]), { glyphs: 'ascii' })).toContain('glyphs')
  expect(failed(view([row(cut, toggle())]))).not.toContain('glyphs')
})
test('size: at most 400 nodes shut, 1,500 open', () => {
  expect(failed(view([row(...Array.from({ length: 400 }, (_, i) => t(String(i % 10))), toggle())]))).toContain('size')
})
test("height: past maxRows, only chips' cards at their floor, a head and a row each, beneath the rows declared", () => {
  const card = (...rows: unknown[]) => ({ type: 'Box', props: { key: 'card:cache', flexDirection: 'column' }, children: [t('CACHE'), ...rows] })
  const footer = (...rows: unknown[]) => ({ type: 'Box', props: { key: 'actions', flexDirection: 'column', marginTop: 1 }, children: rows })
  const open = (lines: unknown[], rows: unknown[], buttons: unknown[] = [toggle('Collapse')]) => view(lines, [card(...rows), footer(...buttons)])
  const short = { layout: 'departures', expanded: true, maxRows: 2 } as const
  const shut = [row(t('a'), toggle('▿'))]
  expect(failed(open(shut, [t('b')]), short)).not.toContain('height')
  expect(failed(open(shut, [t('b'), t('c')]), short)).toContain('height')
  // At the floor, a collapsed row that wrapped or a footer past its row is still too tall.
  expect(failed(open([row(t('a')), row(t('a'), toggle('▿'))], [t('b')]), short)).toContain('height')
  expect(failed(open(shut, [t('b')], [t('hint'), toggle('Collapse')]), short)).toContain('height')
})
test('amber: a reason is said only in the words a live layout draws for it, naming its own reading', () => {
  const amber = (text: string, scenario: InvariantContext['scenario']) => failed(view([row(t(text), toggle())]), { scenario })
  // Pulse's, chips' and the board's words for each.
  for (const said of ['! 30s left', 'CACHE LAST CALL 30S']) expect(amber(said, 'lastMinute')).not.toContain('amber')
  for (const said of ['! context 94%', '! ctx 94%', 'CONTEXT ! COMPACTS IN ~10K']) expect(amber(said, 'nearCompaction')).not.toContain('amber')
  // Words no live layout draws don't count, nor another reading's words.
  for (const said of ['30s! cache', '! cache 30s', '! cooling · 30s left', '! last call']) expect(amber(said, 'lastMinute')).toContain('amber')
  for (const said of ['98%! context', '98%! cache']) expect(amber(said, 'nearCompaction')).toContain('amber')
})
test('the order check catches 7d before the cache', () => {
  const box = (key: string): Node => ({ type: 'Box', props: { key }, children: [] }) as Node
  const tree = { type: 'Box', props: { flexDirection: 'row' }, children: [box('7d'), box('cache')] } as Node
  expect(orderErrors(tree, { has7d: true })).toEqual(['order: 7d before cache'])
})
test('the order check: the cache always, the 7d when it is reported, and a subsequence keeps the order', () => {
  const box = (key: string): Node => ({ type: 'Box', props: { key }, children: [] }) as Node
  const row = (...keys: string[]) => ({ type: 'Box', props: { flexDirection: 'row' }, children: keys.map(box) }) as Node
  expect(orderErrors(row('cache', 'context', '7d'), { has7d: true })).toEqual([])
  expect(orderErrors(row('spend', '7d'), { has7d: true })).toEqual(['order: no cache'])
  expect(orderErrors(row('cache', '5h'), { has7d: true })).toEqual(['order: no 7d'])
  expect(orderErrors(row('cache', '5h'), { has7d: false })).toEqual([])
})
test('flapWords reads a flap Svg with its spaces', () => {
  const k = kitOf({ surface: 'desktop' })
  expect(flapWords(flaps(k, { key: 'f', alt: 'a', runs: [['CACHE', '#fff'], ['LAST CALL 47S', '#fff']], bg: '#222', seam: '#000' }))).toBe('CACHE LAST CALL 47S')
})
test("amber: the board's capitals name the reading, its item and cell joined, bracketed or a gap apart", () => {
  const amber = (text: string, scenario: InvariantContext['scenario']) => failed(view([row(t(text), toggle())]), { scenario })
  for (const said of ['CACHE LAST CALL 47S', 'CACHELAST CALL 47S', '[CACHE][! 47S]']) expect(amber(said, 'lastMinute')).not.toContain('amber')
  expect(amber('CONTEXT ! COMPACTS IN ~10K', 'nearCompaction')).not.toContain('amber')
  expect(amber('CONTEXT ! 94%', 'nearCompaction')).not.toContain('amber')
  expect(amber('CONTEXT! 85%', 'compactionOff')).not.toContain('amber')
  expect(amber('[CONTEXT][! 85%]', 'compactionOff')).not.toContain('amber')
  expect(amber('5H82% ↻ 17:50 ! NEAR LIMIT', 'limit80')).not.toContain('amber')
  expect(amber('[5H][20% ! FULL ~14:20]', 'fiveHourAhead')).not.toContain('amber')
  expect(amber('5H 82%', 'limit80')).toContain('amber')
  expect(amber('7D 82% ! NEAR LIMIT', 'limit80')).toContain('amber')
  const open = view([row(t('a'), toggle('▿'))], [t('SPEND LIMIT  ! NEAR LIMIT  05:00  92%')])
  expect(failed(open, { scenario: 'gatewaySpend', expanded: true })).not.toContain('amber')
})
test('width: pulse and departures fit their room at every width, amber or calm, ▵ last', () => {
  const at = (layout: 'pulse' | 'departures', scenario: InvariantContext['scenario'], cols: number, kids: unknown[]) =>
    failed(view([row(...kids)]), { layout, scenario, cols })
  const wide = t(`5H ! 82% ${'x'.repeat(60)}`)
  // Every calm piece gone and amber short, the row still fits, ▵ in view.
  for (const layout of ['pulse', 'departures'] as const) {
    expect(at(layout, 'limit80', 50, [wide, toggle()])).toContain('width')
    expect(at(layout, 'nearCompaction', 40, [wide, toggle()])).toContain('width')
    expect(at(layout, 'limit80', 60, [wide, toggle()])).toContain('width')
    expect(at(layout, 'calm', 50, [wide, toggle()])).toContain('width')
    expect(at(layout, 'limit80', 50, [toggle(), wide])).toContain('toggle')
  }
})
test('order: pulse and departures keep the one order on the collapsed row; chips its own', () => {
  const box = (key: string): Node => ({ type: 'Box', props: { key }, children: [t(key)] }) as Node
  const keyed = (...keys: string[]) => view([row(...keys.map(box), toggle())])
  for (const layout of ['pulse', 'departures'] as const) {
    expect(failed(keyed('cache', 'spend', 'context', '5h', '7d'), { layout })).not.toContain('order')
    expect(failed(keyed('7d', 'cache'), { layout })).toContain('order')
  }
  expect(failed(keyed('7d', 'cache'))).not.toContain('order')
})
test("amber: a limit's marked short form names it", () => {
  const amber = (text: string, scenario: InvariantContext['scenario']) => failed(view([row(t(text), toggle())]), { scenario })
  expect(amber('5H! 82%', 'limit80')).not.toContain('amber')
  expect(amber('[5H][! 50%]', 'fiveHourAhead')).not.toContain('amber')
  const open = (said: string) => failed(view([row(t('a'), toggle('▿'))], [t(said)]), { scenario: 'gatewaySpend', expanded: true })
  expect(open('SPEND LIMIT ! 92%')).not.toContain('amber')
  expect(open('SPEND LIMIT  ! NEAR LIMIT  05:00')).not.toContain('amber')
})
test('width: an open-only amber leaves the collapsed row calm, so departures is width-checked below 60', () => {
  const dep = (cols: number, text: string) => failed(view([row(t(text), toggle())]), { layout: 'departures', scenario: 'gatewaySpend', cols })
  expect(dep(50, 'x'.repeat(60))).toContain('width')
  expect(dep(50, 'x'.repeat(40))).not.toContain('width')
})
test("amber: a calm 5H beside an amber 7D is not the 5h's amber", () => {
  const said = (text: string) => failed(view([row(t(text), toggle())]), { scenario: 'limit80' })
  expect(said('5H 26% ↻ 17:50  7D 85% ↻ SAT 13:30 ! NEAR LIMIT')).toContain('amber')
  expect(said('5H26% ↻ 17:507D85% ! FULL IN ~2H')).toContain('amber')
  expect(said('5H 82% ↻ 17:50 ! NEAR LIMIT  7D 30%')).not.toContain('amber')
})
