// The registry and the dispatch: every layout name has its view, a view's
// rows follow where Svg draws, and drawBand draws the stored layout from 40
// columns, chips below them or in place of a view that throws.

import { test, expect } from 'claude-code/testing'
import type { RenderElement } from 'claude-code'
import { drawBand } from '../hooks/band'
import { makeKit } from '../hooks/kit'
import { DARK, PLAIN } from '../hooks/palette'
import { readingsOf } from '../hooks/reading'
import { LAYOUT_NAMES } from '../hooks/snapshot'
import { drawView } from '../hooks/views/frame'
import { VIEWS } from '../hooks/views/index'
import { rowsOf, type View } from '../hooks/views/view'
import { EMPTY } from '../hooks/words'
import { byKey, fakeEl, shown, walk } from './helpers'
import { NO_HISTORY, NO_ACT, bandOf, kitOf, snapOf } from './matrix'

const marker: View = { rows: { desktop: 1, terminal: 1 }, collapsed: () => ({ type: 'Text', props: {}, children: ['PULSE'] }) as unknown as RenderElement, open: () => null }
const boom: View = { ...marker, collapsed: () => { throw new Error('boom') } }

test('every layout name has a view', () => {
  expect(Object.keys(VIEWS).sort()).toEqual([...LAYOUT_NAMES].sort())
})
test('the rows a view declares follow where Svg draws', () => {
  const rows = { rows: { desktop: 2, terminal: 1 } }
  expect(rowsOf(rows, kitOf({ surface: 'desktop' }))).toBe(2)
  expect(rowsOf(rows, kitOf({ surface: 'desktop', palette: PLAIN }))).toBe(1)
  expect(rowsOf(rows, kitOf({ surface: 'terminal' }))).toBe(1)
})
test('drawn outside a mount, the band reads as it does mounted', () => {
  expect(shown(bandOf())).toMatch(/cache 52m/)
})
test('the stored layout draws, from 40 columns', () => {
  expect(shown(drawBand(fakeEl, snapOf({ layout: 'pulse', columns: 40 }), NO_ACT, { ...VIEWS, pulse: marker }))).toBe('PULSE')
})
test('below 40 columns every layout draws chips', () => {
  const band = shown(drawBand(fakeEl, snapOf({ layout: 'pulse', columns: 39 }), NO_ACT, { ...VIEWS, pulse: marker }))
  expect(band).not.toMatch(/PULSE/)
  expect(band).toMatch(/cache 52m/)
})
test('a view that throws falls back to chips', () => {
  expect(shown(drawBand(fakeEl, snapOf({ layout: 'pulse' }), NO_ACT, { ...VIEWS, pulse: boom }))).toMatch(/\$3\.19/)
})
test('every layout\'s toggle points the way the band will move: up while shut, down while open', () => {
  // The band is anchored to the prompt and grows upward when it opens. The
  // ascii tier is the terminal's: the desktop draws its own glyphs.
  const tiers = [
    { surface: 'terminal', glyphs: 'unicode', shut: '▵', open: '▿' },
    { surface: 'terminal', glyphs: 'ascii', shut: '^', open: 'v' },
    { surface: 'desktop', glyphs: 'unicode', shut: '▵', open: '▿' },
  ] as const
  for (const layout of LAYOUT_NAMES)
    for (const { surface, glyphs, shut, open } of tiers)
      for (const expanded of [false, true]) {
        const band = bandOf({ layout, surface, glyphs, expanded })
        expect({ layout, surface, glyphs, expanded, label: byKey(band, 'more', 'Button')?.props?.label })
          .toEqual({ layout, surface, glyphs, expanded, label: expanded ? open : shut })
      }
})
test('every layout that says an empty state draws it in a label\'s ink', () => {
  // Pulse says one in its rows; the rest leave out what isn't known, as a
  // card with nothing known is left out.
  const saysNone: ReadonlySet<string> = new Set(['chips', 'departures'])
  const layouts = LAYOUT_NAMES.filter(name => !saysNone.has(name))
  const phrases = Object.values(EMPTY)
  const inks: string[] = []
  for (const layout of layouts)
    for (const surface of ['terminal', 'desktop'] as const)
      for (const expanded of [false, true])
        for (const columns of [160, 40]) {
          const snap = snapOf({
            layout, surface, expanded, columns, maxRows: 40,
            history: NO_HISTORY,
            context: { tokens: undefined, window: 200_000, percent: undefined, compactAt: undefined },
            fiveHour: undefined, sevenDay: undefined,
          })
          walk(drawView(VIEWS[layout], makeKit(fakeEl, snap), readingsOf(snap), NO_ACT), n => {
            const text = (n.children ?? []).every(k => typeof k === 'string') ? (n.children ?? []).join('') : ''
            if (n.type === 'Text' && phrases.some(e => text.includes(e))) inks.push(`${layout} ${surface} ${columns}${expanded ? ' open' : ''} "${text}" ${String(n.props?.color === DARK.label ? 'label' : n.props?.color)}`)
          })
        }
  expect(new Set(inks.map(i => i.split(' ')[0]))).toEqual(new Set(layouts))
  // Not every phrase: 'not reported' was gauges' alone; pulse says the costs'.
  expect(inks.some(i => i.includes(EMPTY.costs))).toBe(true)
  expect(inks.filter(i => !i.endsWith(' label'))).toEqual([])
})
