// The shared open view: chips' cards and footer, a layout's lens in each
// card's head, and no card repeating what the collapsed lines show.

import { test, expect } from 'claude-code/testing'
import type { RenderChildren, RenderElement } from 'claude-code'
import { fixedZone } from '../hooks/format'
import { makeKit } from '../hooks/kit'
import { DESKTOP, HOTKEY_MARK, TERMINAL, cellsOf } from '../hooks/layout'
import { readingsOf } from '../hooks/reading'
import type { BandSnapshot } from '../hooks/snapshot'
import { chipsOpen } from '../hooks/views/chips-open'
import { cardLine, limitAccent } from '../hooks/views/shell'
import { cachePill, chipsPills, chipsView, limitPill, pillRow } from '../hooks/views/chips'
import { drawView, toggleButton, type Keeps } from '../hooks/views/frame'
import type { View } from '../hooks/views/view'
import { canon } from './golden/hash'
import { BARE, DARK, PLAIN } from '../hooks/palette'
import { boldOf, byKey, cardFirstRow, cardHead, cardOf, fact, fakeEl, shown, walk, type Node } from './helpers'
import { NO_ACT, kitOf, snapOf, visualRows } from './matrix'

const text = (s: string) => ({ type: 'Text', props: {}, children: [s] }) as unknown as RenderElement
/** Cards beneath `count` collapsed lines, as a layout of that many rows would draw them. */
const linesView = (count: number): View => ({
  rows: { desktop: count, terminal: count },
  collapsed: () => ({ type: 'Box', props: { flexDirection: 'column' }, children: Array.from({ length: count }, (_, i) => text(`LINE ${i}`)) }) as unknown as RenderElement,
  open: chipsOpen,
})
const drawn = (view: View, snap: BandSnapshot) => drawView(view, makeKit(fakeEl, snap), readingsOf(snap), NO_ACT)
const opened = (over: Partial<BandSnapshot> = {}): Node => {
  const snap = snapOf({ expanded: true, maxRows: 40, ...over })
  return { type: 'Box', props: {}, children: chipsOpen(makeKit(fakeEl, snap), readingsOf(snap), NO_ACT, 1) } as unknown as Node
}

test("chips' open view is chipsOpen's, with one collapsed row and nothing to skip", () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const snap = snapOf({ expanded: true, surface })
    const kit = makeKit(fakeEl, snap)
    const read = readingsOf(snap)
    const open = (drawView(chipsView, kit, read, NO_ACT) as unknown as Node).children?.flat().slice(1)
    expect(canon(open)).toEqual(canon(chipsOpen(kit, read, NO_ACT, 1).filter(Boolean)))
  }
})
test('the cards take only the rows the collapsed lines leave', () => {
    for (const surface of ['terminal', 'desktop'] as const) {
    for (const count of [1, 2]) {
      const view = linesView(count)
      // From 13 rows, where every line of cards keeps a row of body. A
      // desktop card's edge takes a row above and below, which visualRows
      // leaves out, so each line of them adds two.
      for (const maxRows of [13, 14, 20, 40]) {
        const snap = snapOf({ surface, expanded: true, maxRows, workspace: { path: '/Users/me/workspace/nextcost', git: undefined, repoName: undefined } })
        const tree = drawn(view, snap)
        const edges = surface === 'desktop' ? 2 * (byKey(tree, 'cards')?.children ?? []).length : 0
        // The desktop's two lines at 13 rows, the gauges board's case, leave
        // its two lines of cards no row of body. Each card keeps one anyway,
        // as chipsOpen holds every card to a fact at least, so the band is a
        // row over.
        const over = surface === 'desktop' && count === 2 && maxRows === 13
        const at = `${surface} ${count} at ${maxRows}`
        expect(`${at}: ${visualRows(tree, surface) + edges <= maxRows}`).toBe(`${at}: ${!over}`)
        if (over) expect(((cardOf(tree, 'cache')?.children ?? []) as Node[]).flat().filter(Boolean).length).toBe(2)
      }
    }
  }
})
test('short of a row for a fact under each head, the cards give way whole, so the buttons stay in view', () => {
  const view = linesView(2)
  for (const maxRows of [4, 6, 7]) {
    const snap = snapOf({ expanded: true, maxRows })
    const tree = drawn(view, snap)
    expect([maxRows, byKey(tree, 'cards'), visualRows(tree, 'terminal') <= maxRows, byKey(tree, 'hide', 'Button') !== undefined]).toEqual([maxRows, undefined, true, true])
  }
})
test('with the cards given way, a window only they draw still says it needs you, on the row they would start on', () => {
  const view = linesView(2)
  const spend = { otherLimits: [{ kind: 'spend_limit' as const, percentUsed: 92, resetsAt: undefined }] }
  const draw = (maxRows: number, over = {}) => {
    const snap = snapOf({ expanded: true, maxRows, ...over })
    return drawn(view, snap)
  }
  const tree = draw(6, spend)
  expect([shown(byKey(tree, 'alert', 'Box')), visualRows(tree, 'terminal')]).toEqual(['! spend 92%', 6])
  expect(byKey(byKey(tree, 'alert', 'Box'), 'alert', 'Text')?.props?.color).toBe(DARK.amberFg)
  // Calm, or with no row for it, there is none.
  expect([byKey(draw(6), 'alert'), byKey(draw(4, spend), 'alert')]).toEqual([undefined, undefined])
})
test('shut, a cards view draws its collapsed lines alone', () => {
  const snap = snapOf()
  const tree = drawn(linesView(1), snap)
  expect(shown(tree)).toBe('LINE 0')
})
/** Every piece kept: a row's first step. */
const KEEP_ALL: Keeps<string> = { has: () => true, calm: () => true, part: () => true, amber: a => a.long }
test("a layout composes chips' pills: chips' row is its pills in a pill row", () => {
  const snap = snapOf({ columns: 200 })
  const kit = makeKit(fakeEl, snap)
  const read = readingsOf(snap)
  const row = (drawView(chipsView, kit, read, NO_ACT) as unknown as Node).children?.[0]
  expect(canon(row)).toEqual(canon(pillRow(kit, toggleButton(kit, read, NO_ACT), chipsPills(kit, read, KEEP_ALL))))
  const mine = pillRow(kit, toggleButton(kit, read, NO_ACT), [limitPill(kit, read, '7d', KEEP_ALL, false), cachePill(kit, read, true)].filter(p => p !== undefined))
  expect(shown(mine)).toBe('7d ██░░░░ 30% │ ↻ 2d 19h ◷ cache 52m ')
  expect(byKey(mine, 'more', 'Button')?.props?.label).toBe('▵')
  expect(limitPill(kit, readingsOf(snapOf({ sevenDay: undefined })), '7d', KEEP_ALL, false)).toBeUndefined()
})
test('a card head is bold on its figure alone, its words in label ink', () => {
  const tree = opened()
  expect(['cache', 'spend', 'context', 'limits'].map(name => boldOf(cardHead(tree, name)))).toEqual([['52m'], ['$3.19'], ['40%'], ['30%']])
  expect(shown(cardHead(tree, 'limits'))).toBe('LIMITS7d 30%')
  const label = byKey(cardHead(tree, 'cache'), 'say1', 'Text')
  expect([shown(label), label?.props?.color]).toEqual([' left', DARK.label])
})
test("LIMITS leads with the worst window's reset and pace, never the collapsed row's value", () => {
  const zoned = { zone: fixedZone(0), maxRows: 13 }
  expect(cardFirstRow(opened(zoned), 'limits')).toBe('resetsSat 19:00 · ~50% at avg pace')
  expect(cardFirstRow(opened({ maxRows: 13 }), 'limits')).toBe('resetsin 2d 19h · ~50% at avg pace')
  // Taller, every window follows; the worst's own reset line isn't said twice.
  const tall = opened({ zone: fixedZone(0) })
  expect([fact(tall, '5h'), fact(tall, '7d'), fact(tall, '5h pace'), fact(tall, '7d pace')]).toEqual(['4%', '30%', '5h resets 3h 00m · ~10% at avg pace', undefined])
})
test('every line of cards shares one top edge: each card top-aligned, its head row level with its neighbours\'', () => {
  for (const columns of [120, 160]) {
    const lines = (byKey(opened({ columns }), 'cards', 'Box')?.children ?? []) as Node[]
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line.props?.alignItems).toBe('flex-start')
  }
})
test("the footer's hint gives way where it and both buttons run past the band; the buttons always stay", () => {
  // A terminal's footer at 60 columns would be 62 cells; the desktop's measure holds it to 55.
  for (const [surface, columns] of [['terminal', 60], ['desktop', 50]] as const) {
    const footer = (at: number) => byKey(opened({ surface, columns: at }), 'actions', 'Box')
    expect(shown(footer(95))).toMatch(/Bring it back with \/nextcost/)
    const narrow = footer(columns)
    expect(shown(narrow)).not.toMatch(/Bring it back/)
    expect([byKey(narrow, 'collapse', 'Button'), byKey(narrow, 'hide', 'Button')].map(b => b?.props?.label)).toEqual(['Collapse', 'Hide band'])
    expect(cellsOf(narrow as unknown as RenderChildren, surface === 'desktop' ? DESKTOP : TERMINAL) + 2 * HOTKEY_MARK).toBeLessThanOrEqual(columns)
  }
})
test("the footer's hint and the strip's words are inked in the theme's legible grey, on any host's ground", () => {
  const hint = byKey(byKey(opened(), 'actions', 'Box'), 'hint', 'Box')
  const inks: unknown[] = []
  walk(hint, n => {
    if (n.type === 'Text') inks.push(n.props?.color)
  })
  expect([...new Set(inks)]).toEqual([BARE.label])
  // `subtle` is 2.07:1 on Claude Code's dark terminal ground; `inactive` about 5.8:1.
  expect(BARE.label).toBe('inactive')
  expect(PLAIN.label).toBe('subtle')
})
test("the shell answers a line of cards' geometry: how many to a line, their insides, and their edge", () => {
  const line = (over: Partial<BandSnapshot>, count = 4) => cardLine(kitOf(over), count)
  // A terminal card with a fill draws no edge; plain's border takes two columns and two rows.
  expect(line({ columns: 200 })).toMatchObject({ perLine: 4, inner: 47, edge: 0, edgeRows: 0, pxEdge: false })
  expect(line({ columns: 200, palette: PLAIN })).toMatchObject({ perLine: 4, inner: 45, edge: 2, edgeRows: 2, pxEdge: false })
  // The desktop's edge is a line of pixels: its px come off the card's inside.
  expect(line({ columns: 200, surface: 'desktop' })).toMatchObject({ perLine: 4, inner: 45, innerPx: 470, edge: 2, edgeRows: 1, pxEdge: true })
  // Short of room for every card, half of them; else one.
  expect([line({ columns: 95 }).perLine, line({ columns: 60 }).perLine, line({ columns: 40 }).perLine]).toEqual([2, 1, 1])
})
test("a limit's accent is its window's, or the meter's for any other", () => {
  expect(limitAccent(DARK, '5h')).toBe(DARK.fiveAccent)
  expect(limitAccent(DARK, '7d')).toBe(DARK.weekAccent)
  expect(limitAccent(DARK, 'other')).toBe(DARK.meterFill)
})
