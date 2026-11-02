// Whole pieces: on a text surface, in the frame a hover card shows in, every
// piece of its row is covered whole or left whole, so no sliver of a chip reads as a value of
// its own. Golden holds each of chips' frames to it, and the hover and
// strip tests the frames they draw.
import type { RenderChildren, RenderElement } from 'claude-code'
import { DESKTOP, cellsOf, isDrawn } from '../hooks/layout'
import { footerStripRoom, rowRoom } from '../hooks/views/frame'
import { byKey, isCard, textOf, widthOf, type Node } from './helpers'
import { kitOf } from './matrix'

type Surface = 'terminal' | 'desktop'
/** The columns a drawn piece takes, [start, end), as this check counts them. */
type DrawnSpan = readonly [number, number]

/** Columns a drawn piece takes: counted exactly on the terminal; on the
 *  desktop by the band's measure, the only count it has. */
const cellsIn = (n: unknown, surface: Surface): number => (surface === 'terminal' ? widthOf(n) : cellsOf(n as RenderChildren, DESKTOP))

/** Each of `items`' columns, [start, end), from `from`, `gap` columns apart. */
const drawnSpans = (items: readonly unknown[], gap: number, surface: Surface, from: number): DrawnSpan[] => {
  let at = from
  return items.map(n => {
    const start = at
    at += cellsIn(n, surface)
    const span: DrawnSpan = [start, at]
    at += gap
    return span
  })
}

const kidsOf = (n: Node | undefined): Node[] => ((n?.children ?? []) as unknown[]).filter(isDrawn) as Node[]

/** A strip's separator: the ` · ` Text between two pieces, in either tier,
 *  which is air. */
const isSeparator = (n: Node): boolean => n.type === 'Text' && /^ ?[·,-] ?$/.test(textOf(n))

/** The columns `card` takes, counted from the side its `left` or `right`
 *  counts from. */
const columnsOf = (card: Node): DrawnSpan => {
  const from = Number(card.props?.left ?? card.props?.right)
  return [from, from + Number(card.props?.width)]
}

/** The desktop's measure is an estimate, so it is allowed half a column. */
const slackOn = (surface: Surface): number => (surface === 'desktop' ? 0.5 : 0)

/** Whether a card over [from, to) leaves a piece at [start, end) alone. */
const isApart = ([from, to]: DrawnSpan, [start, end]: DrawnSpan, surface: Surface): boolean =>
  to <= start + slackOn(surface) || from >= end - slackOn(surface)

/** Whether a card over [from, to) covers a piece at [start, end) whole. */
const isWhole = ([from, to]: DrawnSpan, [start, end]: DrawnSpan, surface: Surface): boolean =>
  from <= start + slackOn(surface) && to >= end - slackOn(surface)

/** The part of a span within `room`. */
const within = (room: number) => ([start, end]: DrawnSpan): DrawnSpan => [Math.min(start, room), Math.min(end, room)]

/** Each piece a card covers in part, as `<card's piece> over <piece>`, for
 *  chips' row, `cols` wide, and the workspace strip. A card ends within its
 *  room, short of ▵ in the row, so a piece that runs on past it, as an
 *  all-amber row or a narrow strip clips, is held to its part within it. A
 *  strip card covers its own side's pieces whole or not at all, and never
 *  reaches the other side's, as `<card's piece> reaches <piece>`: the fill
 *  between the sides has no width the band knows, so the other side is
 *  placed as near as it may be drawn, with the strip only its room wide. */
export const partCovered = (tree: unknown, surface: Surface, cols: number): string[] => {
  const errors: string[] = []
  /** `cards` against `pieces` at `spans`, each from the cards' own side;
   *  `apartOnly` for pieces a card must leave alone. */
  const check = (cards: readonly Node[], pieces: readonly Node[], spans: readonly DrawnSpan[], apartOnly = false) => {
    for (const card of cards)
      pieces.forEach((piece, i) => {
        const span = spans[i]
        const cover = columnsOf(card)
        if (span === undefined || isApart(cover, span, surface) || (!apartOnly && isWhole(cover, span, surface))) return
        errors.push(`${String(card.hover?.scope)} ${apartOnly ? 'reaches' : 'over'} ${String(piece.props?.key)} [${span.join(', ')}) at ${String(card.props?.left ?? `right ${card.props?.right}`)}+${String(card.props?.width)}`)
      })
  }
  const row = kidsOf(tree as Node)[0]
  const kids = kidsOf(row)
  const pills = kids.slice(0, Math.max(0, kids.findIndex(isCard))).filter(k => k.props?.key !== undefined)
  const room = Math.floor(cols - cellsIn(kids.at(-1), surface) - 1)
  check(kids.filter(isCard), pills, drawnSpans(pills, 1, surface, 0).map(within(room)))

  const strip = byKey(tree, 'strip', 'Box')
  if (strip !== undefined) {
    const pad = Number(strip.props?.paddingX ?? 0)
    // In the footer the strip shares its line with the buttons, as chips gives it room.
    const actions = byKey(tree, 'actions', 'Box')
    const inFooter = byKey(actions, 'strip', 'Box') !== undefined
    const buttons = kidsOf(actions).filter(k => k.type === 'Button') as RenderElement[]
    const kit = kitOf({ surface, columns: cols })
    const stripRoom = inFooter ? footerStripRoom(kit, buttons) : rowRoom(kit)
    const stripCards = kidsOf(strip).filter(isCard)
    /** A side's pieces, less its separators, at their spans from its own
     *  end, held to the part of each within `to`. */
    const sideOf = (key: 'ws:where' | 'ws:state', to: number) => {
      const box = byKey(strip, key, 'Box')
      const line = key === 'ws:where' ? kidsOf(box) : kidsOf(box).reverse()
      const spans = drawnSpans(line, Number(box?.props?.columnGap ?? 0), surface, pad)
      const kept = line.map((n, i) => [n, spans[i] ?? [0, 0]] as const).filter(([n]) => !isSeparator(n))
      return { pieces: kept.map(([n]) => n), spans: kept.map(([, span]) => within(to)(span)), end: spans.at(-1)?.[1] }
    }
    const state = sideOf('ws:state', stripRoom)
    // The path's side shrinks, leaving the fill its two columns before the state's.
    const where = sideOf('ws:where', state.end === undefined ? stripRoom : stripRoom - state.end - 2)
    /** A span from one end, counted from the other. */
    const flipped = ([start, end]: DrawnSpan): DrawnSpan => [stripRoom - end, stripRoom - start]
    for (const [anchor, own, other] of [['left', where, state], ['right', state, where]] as const) {
      const sideCards = stripCards.filter(card => card.props?.[anchor] !== undefined)
      check(sideCards, own.pieces, own.spans)
      check(sideCards, other.pieces, other.spans.map(flipped), true)
    }
  }
  return errors
}
