// Hover cards: one per pill, drawn over the row at the pill it explains.

import type { ElementTable, RenderChildren } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { makeKit } from '../hooks/kit'
import { DESKTOP, ROW_SLACK, cellsOf } from '../hooks/layout'
import { DARK, LIGHT, type Palette } from '../hooks/palette'
import {
  BUILD_100K,
  DESKTOP_START,
  BUILD_155K,
  LONG,
  START,
  respond,
  textOf,
  cards,
  cardText,
  fakeEl,
  firstRow,
  isCard,
  byKey,
  walk,
  widthOf,
  turn,
  type Node,
  HOUR_1,
  setup,
  mountBand,
} from './helpers'
import { partCovered } from './cover'
import { kitOf, snapOf } from './matrix'

/** A card drawn inverted against `palette`, so it can't pass for a chip:
 *  its tooltip ground and ink. On a text surface its two ends are half blocks in the ground's
 *  colour on the band's own background, either side of a ground two cells
 *  narrower than the card, so the ends read as rounded edges; the desktop
 *  draws the ground alone. */
const expectInvertedCard = (card: Node, surface: 'terminal' | 'desktop', palette: Readonly<Palette>) => {
  const kids = (card.children ?? []) as Node[]
  if (surface === 'desktop') {
    expect(card.props?.backgroundColor).toBe(palette.tooltipBg)
    expect(kids).toHaveLength(1)
    expect(kids[0]?.props).toMatchObject({ color: palette.tooltipFg, wrap: 'truncate-end' })
    return
  }
  expect(card.props?.backgroundColor).toBeUndefined()
  expect(kids.map(textOf)).toEqual(['▐', cardText(card), '▌'])
  for (const cap of [kids[0], kids[2]]) {
    expect(cap?.type).toBe('Text')
    expect(cap?.props?.color).toBe(palette.tooltipBg)
    expect(cap?.props?.backgroundColor).toBeUndefined()
  }
  const ground = kids[1]
  expect(ground?.props).toMatchObject({ backgroundColor: palette.tooltipBg, paddingX: 1, width: Number(card.props?.width) - 2 })
  expect((ground?.children as Node[] | undefined)?.[0]?.props).toMatchObject({ color: palette.tooltipFg, wrap: 'truncate-end' })
}

/** The ▵ toggle that ends chips' `row`. */
const toggleOf = (row: unknown): Node | undefined => {
  const kids = ((row as Node).children ?? []).filter(Boolean) as Node[]
  const toggle = kids[kids.length - 1]
  expect(byKey(toggle, 'more', 'Button')).toBeDefined()
  return toggle
}

/** The columns a card in chips' row, `cols` wide, may span: the row short of
 *  its ▵ toggle and the gap before it. The desktop has no exact count of its
 *  own to check against, so its room comes from the band's measure. */
const roomBefore = (toggle: Node | undefined, cols: number, surface: 'terminal' | 'desktop'): number =>
  surface === 'terminal' ? cols - widthOf(toggle) - 1 : Math.floor(cols - cellsOf(toggle as RenderChildren, DESKTOP) - 1)

/** What every hover card in the band's `row`, `cols` wide, holds to: drawn
 *  after every pill, so it paints over them all, and before ▵, which stacks
 *  over it and so stays pressable; revealed by the scope it shares with its
 *  own pill; a hidden one-line Box with no key, on the tooltip ground in the
 *  tooltip ink, ending short of ▵. On the terminal, where cells are exact, a
 *  card covers its own pill and every pill it enters whole, its ▐ and ▌ in
 *  the gaps either side, and is no wider than its text and those pills need:
 *  the pills it leaves whole still switch it. */
const expectCardsAt = (row: unknown, found: Array<[string, Node]>, cols: number, surface: 'terminal' | 'desktop') => {
  const kids = ((row as Node).children ?? []).filter(Boolean) as Node[]
  const toggle = toggleOf(row)
  expect(toggle?.props?.position).toBe('relative')
  const first = kids.findIndex(isCard)
  expect(first).toBeGreaterThan(0)
  expect(kids.slice(first, -1)).toEqual(found.map(([, card]) => card))
  const pills = kids.slice(0, first).filter(k => k.props?.key !== undefined)
  const room = roomBefore(toggle, cols, surface)
  const spans = pills.map((pill, i) => {
    const start = pills.slice(0, i).reduce((at, before) => at + widthOf(before) + 1, 0)
    return [start, start + widthOf(pill)] as const
  })
  const spanOf = (key: string) => {
    const span = spans[pills.findIndex(pill => pill.props?.key === key)]
    expect(span).toBeDefined()
    return span ?? [0, 0]
  }
  /** Whether a column falls inside a pill. */
  const inPill = (column: number) => spans.some(([start, end]) => start <= column && column < end)
  expect(new Set(found.map(([, card]) => card.hover?.scope)).size).toBe(found.length)
  for (const [key, card] of found) {
    expect(typeof card.hover?.scope).toBe('string')
    expect(card.props).toMatchObject({ top: 0, display: 'none' })
    expect(card.props?.right).toBeUndefined()
    expect(card.props?.key).toBeUndefined()
    expect(card.hover?.display).toBe('flex')
    expectInvertedCard(card, surface, DARK)
    const left = Number(card.props?.left)
    const width = Number(card.props?.width)
    expect(Number.isInteger(left) && left >= 0).toBe(true)
    if (surface === 'terminal') {
      const [start, end] = spanOf(key)
      const right = left + width
      const at = `${key} ${left}+${width} in ${room}`
      expect(`${at} ${left <= start && right >= end && right <= room}`).toBe(`${at} true`)
      expect(width).toBeGreaterThanOrEqual(Math.min(cardText(card).length + 4, room))
      // ▐ and ▌ sit in gaps, short of the row's ends.
      expect(`${at} ${left === 0 || !inPill(left)} ${right === room || !inPill(right - 1)}`).toBe(`${at} true true`)
      // No wider than it must be: past its text, it ends where a pill it enters does.
      const snug = right === left + Math.min(cardText(card).length + 4, room) || right === room || spans.some(([, e]) => e === right - 1)
      expect(`${at} ${snug}`).toBe(`${at} true`)
      expect(partCovered({ children: [row] }, surface, cols)).toEqual([])
    } else {
      expect(left + width).toBeLessThanOrEqual(room)
    }
  }
}

/** The pills a wide row draws once a reply has landed, in order. */
const PILLS = ['cache', 'cost', 'ctx', '5h', '7d', 'tokens']

test('every pill explains itself on hover, on a card drawn over the row at its pill', async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await turn($, 't1', 2.0, 2.41)
  await respond($, BUILD_155K)

  for (const [surface, cols] of [['desktop', 120], ['terminal', 160]] as const) {
    const ui = await mountBand($, surface, cols)
    const tree = await ui.drawn()
    const found = cards(tree)
    expect(found.map(([key]) => key)).toEqual(PILLS)
    expectCardsAt(firstRow(tree), found, cols, surface)
    for (const [, card] of found) expect(cardText(card).length).toBeLessThan(70)
    // Each leads with its value, then what changes, then what it means, so a
    // short row's cut only ever takes the description.
    expect(cardText(found[0]?.[1])).toBe('1h 00m left; warm cache bills input at 5%, expires 1h after a request')
    expect(cardText(found[1]?.[1])).toBe('$0.41 spent during your last message, subagents included')
    expect(cardText(found[2]?.[1])).toBe('76k of 200k (38%); older turns get summarized near full')
    expect(cardText(found[3]?.[1])).toBe('Resets in 3h 00m; 5-hour limit, all your Claude use')
    expect(cardText(found[4]?.[1])).toBe('Resets in 2d 19h; weekly limit, all your Claude use')
    expect(cardText(found[5]?.[1])).toBe('input 196k · output 12k · cache reads 0')
    await ui.unmount()
  }
})

test('on a wide terminal row each card starts a column before its own pill, its ▐ in the gap, so it covers none to its left', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)
  const ui = await mountBand($, 'terminal', 160)
  const row = firstRow(await ui.drawn()) as Node
  const pills = ((row.children ?? []) as Node[]).filter(k => k?.props?.key !== undefined)
  expect(pills.map(pill => pill.props?.key)).toEqual(PILLS)
  let at = 0
  for (const pill of pills) {
    expect(cards(row).find(([key]) => key === pill.props?.key)?.[1].props?.left).toBe(Math.max(0, at - 1))
    at += widthOf(pill) + 1
  }
  await ui.unmount()
})

test('every pill reveals a card of its own, in the order the pills are drawn', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountBand($, surface, 160)
    const row = firstRow(await ui.drawn()) as Node
    const pills = ((row.children ?? []) as Node[]).filter(k => k?.props?.key !== undefined)
    expect(pills.map(pill => pill.props?.key)).toEqual(PILLS)
    expect(cards(row).map(([key]) => key)).toEqual(PILLS)
    await ui.unmount()
  }
})

test('when narrower widths drop pills, each pill left keeps its card, slid to end short of ▵', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 50)
  const tree = await ui.drawn()
  const found = cards(tree)
  expect(found.length).toBeLessThan(6) // some pills gave way
  expectCardsAt(firstRow(tree), found, 50, 'terminal')
  await ui.unmount()
})

test('a cold cache explains what the next message rebuilds', LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await respond($, BUILD_100K)
  await clock.advance(61 * 60_000)
  const ui = await mountBand($, 'terminal', 110)
  const cache = cards(await ui.drawn()).find(([key]) => key === 'cache')
  expect(cardText(cache?.[1])).toMatch(/^Cold: next message rebuilds 112k tokens \(~\$\d+\.\d\d\)$/)
  await ui.unmount()
})

test('plain appearance draws no hover cards', async ($, on) => {
  setup(on, { env: { NEXTCOST_APPEARANCE: 'plain', ...HOUR_1 } })
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 110)
  expect(cards(await ui.drawn())).toHaveLength(0)
  await ui.unmount()
})

// One test per surface and band height, each its own LONG budget: a sweep of
// every width mounts the band hundreds of times.
for (const surface of ['terminal', 'desktop'] as const) {
  for (const maxRows of [40, 4]) {
    test(`on the ${surface}, ${maxRows} rows tall, every card, shut and open, ends within its row's room and covers whole pieces at every width from 20 to 200, its caps included`, LONG, async ($, on) => {
      setup(on)
      await $.session.start(START)
      await respond($, BUILD_155K)
      for (let cols = 20; cols <= 200; cols++) {
        const ui = await mountBand($, surface, cols, { maxRows })
        const shut = await ui.drawn()
        await ui.press({ key: 'more' })
        const open = await ui.drawn()
        await ui.press({ key: 'more' }) // being open is stored: shut it for the next mount
        for (const tree of [shut, open]) {
          expect(`${cols}x${maxRows} ${partCovered(tree, surface, cols).join('; ')}`).toBe(`${cols}x${maxRows} `)
          // A card in chips' row ends short of ▵; any other is the workspace
          // strip's, whose room is at most the band's row.
          const row = firstRow(tree)
          const inRow = new Set(cards(row).map(([, card]) => card))
          const rowRoom = roomBefore(toggleOf(row), cols, surface)
          for (const [key, card] of cards(tree)) {
            const room = inRow.has(card) ? rowRoom : cols - ROW_SLACK
            const width = Number(card.props?.width)
            const from = Number(card.props?.left ?? card.props?.right)
            const at = `${cols}x${maxRows} ${key} ${from}+${width} in ${room}`
            expect(`${at} ${from >= 0 && from + width <= room}`).toBe(`${at} true`)
            expectInvertedCard(card, surface, DARK)
            expect(width).toBeGreaterThanOrEqual(surface === 'terminal' ? 5 : 3) // its edges and one character
          }
        }
        await ui.unmount()
      }
    })
  }
}

test('in the ascii tier a card keeps its width, with a space for each cap, and covers whole pills', async ($, on) => {
  setup(on, { env: { NEXTCOST_GLYPHS: 'ascii', ...HOUR_1 } })
  await $.session.start(START)
  await respond($, BUILD_155K)
  const ui = await mountBand($, 'terminal', 160)
  const tree = await ui.drawn()
  const found = cards(tree)
  expect(found.map(([key]) => key)).toEqual(PILLS)
  expect(textOf(tree)).not.toMatch(/[▐▌]/)
  for (const [, card] of found) {
    const text = cardText(card)
    expect(((card.children ?? []) as Node[]).map(textOf)).toEqual([' ', text, ' '])
    expect(Number(card.props?.width)).toBeGreaterThanOrEqual(text.length + 4)
  }
  expect(partCovered(tree, 'terminal', 160)).toEqual([])
  await ui.unmount()
})

test('in the ascii tier a card too long for its row is cut by the band at its last whole word, with a `.`, never by the surface', async ($, on) => {
  setup(on, { env: { NEXTCOST_GLYPHS: 'ascii', ...HOUR_1 } })
  await $.session.start(START)
  await respond($, BUILD_155K)
  const wide = await mountBand($, 'terminal', 200)
  const whole = new Map(cards(await wide.drawn()).map(([key, card]) => [key, cardText(card)]))
  await wide.unmount()
  const ui = await mountBand($, 'terminal', 50)
  const found = cards(await ui.drawn())
  expect(found.length).toBeGreaterThan(0)
  let cut = 0
  for (const [key, card] of found) {
    const ground = ((card.children ?? []) as Node[])[1]
    const words = ((ground?.children ?? []) as Node[])[0]
    expect(words?.props?.wrap).toBeUndefined()
    const text = textOf(words)
    expect(text.length).toBeLessThanOrEqual(Number(ground?.props?.width) - 2)
    const full = whole.get(key) ?? ''
    if (text === full) continue
    cut++
    // What it keeps is the card's own words up to a word's end, then `.`.
    const kept = text.slice(0, -1)
    expect(`${key} ${text.endsWith('.') && full.startsWith(kept) && /^[\s,;:]/.test(full.slice(kept.length))}`).toBe(`${key} true`)
  }
  expect(cut).toBeGreaterThan(0) // 50 columns cut at least the longest
  await ui.unmount()
})

test('in the light palette a card is inverted too: a dark ground under light ink', async ($, on) => {
  setup(on, { env: { NEXTCOST_APPEARANCE: 'light', ...HOUR_1 } })
  await $.session.start(START)
  await respond($, BUILD_155K)
  for (const [surface, cols] of [['desktop', 120], ['terminal', 160]] as const) {
    const ui = await mountBand($, surface, cols)
    const found = cards(await ui.drawn())
    expect(found.map(([key]) => key)).toEqual(PILLS)
    for (const [, card] of found) expectInvertedCard(card, surface, LIGHT)
    await ui.unmount()
  }
})

test('a desktop whose element table holds no Svg still draws its cards without caps', () => {
  const { Box, Text, Button } = fakeEl
  const card = makeKit({ Box, Text, Button } as unknown as ElementTable, snapOf({ surface: 'desktop' })).hoverCard('cost', 'what it cost', { left: 0, room: 40, pieces: [] }) as Node
  expectInvertedCard(card, 'desktop', DARK)
  expect(card.props?.width).toBe(Math.ceil('what it cost'.length * 0.8) + 2)
})

test("a desktop card is sized by the surface's measure, about 0.8 columns a character, not one", () => {
  const kit = kitOf({ surface: 'desktop' })
  // The 7d text, 57 characters, measures about 453px in the desktop's font.
  const text = 'Resets in 2d 19h; weekly limit, all your Claude use today'
  const card = kit.hoverCard('7d', text, { left: 10, room: 200, pieces: [] }) as Node
  expect(card.props).toMatchObject({ left: 9, width: Math.ceil(text.length * 0.8) + 2 })
  expect(Number(card.props?.width) * DESKTOP.pxPerCell).toBeGreaterThanOrEqual(453)
})

// The desktop joins a Box to its hover group only when the hover also styles
// it: a bare `{ scope }` never lights, so the card it names never shows.
test('every piece that reveals a card carries a style beside its scope, its own ground where it has one', LONG, async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_155K)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await mountBand($, surface, 160)
    for (const tree of [await ui.drawn(), await ui.press({ key: 'more' }).then(() => ui.drawn())]) {
      let pieces = 0
      walk(tree, n => {
        const scope = n.hover?.scope
        if (scope === undefined || isCard(n)) return
        pieces += 1
        expect(typeof n.hover?.backgroundColor).toBe('string')
        if (n.props?.backgroundColor !== undefined) expect(n.hover?.backgroundColor).toBe(n.props.backgroundColor)
      })
      expect(pieces).toBeGreaterThan(0)
    }
    await ui.unmount()
  }
})
