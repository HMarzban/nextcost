// What every layout's frame shares: the toggle on the row nearest the
// prompt, the rows an open view is given beneath the collapsed lines, the
// footer, how a collapsed row gives way to fit its room, and the line pulse
// and departures lay.

import type { RenderChildren, RenderElement } from 'claude-code'
import type { Tone } from '../facts'
import type { Kit } from '../kit'
import { HOTKEY_MARK, ROW_SLACK, cellsOf, isDrawn, squeezeToFit } from '../layout'
import { BARE } from '../palette'
import type { Readings } from '../reading'
import type { BandActions } from '../snapshot'
import { drawStrip } from '../strip'
import { rowsOf } from './view'
import type { View } from './view'
import type { Amber } from '../words'
import type { Workspace } from '../workspace'

/** The rows a body gets: the band's, less the collapsed rows, a row of air
 *  above the body and above the buttons, the buttons, and the strip. */
export const bodyRowsFor = (maxRows: number, collapsedRows: number, stripRows: number): number =>
  Math.max(0, maxRows - collapsedRows - 3 - stripRows)

/** ▵ while shut, ▿ while open: chips' own toggle, at the end of its row.
 *  It points the way the band will move, since the band is anchored to the
 *  prompt and grows upward when it opens, so in every layout it sits on the
 *  row nearest the prompt, the bottom of its line. It comes after the row's
 *  hover cards, which paint over only what comes before them. Exported for
 *  its tests. */
export const toggleButton = (kit: Kit, read: Readings, act: BandActions): RenderElement => {
  const { Box, Button, Svg } = kit
  return (
    <Box flexShrink={0} position="relative" alignSelf="flex-end">
      {/* A Button holds text alone, so its icon is a glyph. The outlined
          triangles are measured centred in the line, within half a pixel,
          and wider than tall like a disclosure icon; arrowhead chevrons sit
          5 px low. On the desktop in a native frame like Collapse's, in the
          terminal bare. */}
      <Button
        key="more"
        label={read.frame.expanded ? '▿' : '▵'}
        {...(Svg ? { variant: 'secondary' as const } : { plain: true as const })}
        onPress={act.toggleExpanded}
      />
    </Box>
  )
}

/** A view drawn: its collapsed row, the toggle at its end, and while open,
 *  what opens beneath it, given the rows the view declares where it is drawn. */
export const drawView = (view: View, kit: Kit, read: Readings, act: BandActions): RenderElement => {
  const { Box } = kit
  return (
    <Box flexDirection="column">
      {view.collapsed(kit, read, toggleButton(kit, read, act))}
      {read.frame.expanded ? view.open(kit, read, act, rowsOf(view, kit)) : null}
    </Box>
  )
}

const buttonsOf = (kit: Kit, act: BandActions): RenderElement[] => {
  const { Button } = kit
  return [
    <Button key="collapse" label="Collapse" variant="secondary" hotkey="c" onPress={act.toggleExpanded} />,
    <Button key="hide" label="Hide band" variant="secondary" hotkey="h" onPress={act.hide} />,
  ]
}

/** The columns a row may take: the band's, less its slack. */
export const rowRoom = (kit: Kit): number => kit.columns - ROW_SLACK

/** The columns the footer's row leaves beside `buttons`: the row's, less
 *  the buttons with their hotkey marks. */
const roomBeside = (kit: Kit, buttons: readonly RenderElement[]): number => rowRoom(kit) - cellsOf(buttons, kit.measure) - 2 * HOTKEY_MARK

/** The columns the footer's strip takes beside `buttons`: the room they
 *  leave, less a column of gap before each of the two. Exported for the
 *  whole-pieces check. */
export const footerStripRoom = (kit: Kit, buttons: readonly RenderElement[]): number => roomBeside(kit, buttons) - 2

/** The workspace strip heading an open view, its text lined up with cards
 *  whose edge is `edge` columns. */
export const topStrip = (kit: Kit, ws: Workspace, edge: number): RenderElement => drawStrip(kit, ws, 'top', edge, rowRoom(kit))

/** The open view's last row: the workspace strip, given one, in the room the
 *  buttons leave, else the hint while it fits; air; then Collapse and Hide
 *  band. A column of gap parts each of the row's pieces. */
export const footer = (kit: Kit, act: BandActions, ws?: Workspace): RenderElement => {
  const { Box, Text, measure, icon } = kit
  const buttons = buttonsOf(kit, act)
  const strip = ws === undefined ? undefined : drawStrip(kit, ws, 'footer', 0, footerStripRoom(kit, buttons))
  const hint = (
    <Box key="hint" flexDirection="row">
      {icon('info', BARE.icon)}
      <Text color={BARE.label}>Bring it back with /nextcost</Text>
    </Box>
  )
  // The hint, its air and the two buttons: three gaps.
  const hinted = cellsOf(hint, measure) + 3 <= roomBeside(kit, buttons)
  return (
    <Box key="actions" flexDirection="row" columnGap={1} marginTop={1}>
      {strip ?? (hinted ? hint : null)}
      {strip === undefined ? <Box flexGrow={1} /> : null}
      {buttons}
    </Box>
  )
}

// ---- the collapsed rows' give-way --------------------------------------------

/** A collapsed row's give-way order, first to last: its calm steps, then
 *  amber's, then any after them. Amber never gives way before calm: its
 *  steps come once every calm one is taken. */
type GiveWay<P extends string> = Readonly<{ calm: readonly P[]; amber: readonly P[]; last?: readonly P[] }>
/** The pieces an order names. */
export type PieceOf<G> = G extends GiveWay<infer P> ? P : never

/** What a line's build may ask at its squeeze. */
export type Keeps<P extends string> = Readonly<{
  /** Whether a piece is still kept: its step not yet taken. */
  has: (p: P) => boolean
  /** Whether a piece of this tone is kept: an amber one always is. */
  calm: (p: P, tone: Tone) => boolean
  /** Whether a part of a piece of this tone is kept: a calm one while its
   *  step holds, an amber one until amber's first step. */
  part: (p: P, tone: Tone) => boolean
  /** An amber reading's words: long until amber's first step, then short. */
  amber: (a: Amber) => string
}>

/** One collapsed line, the view's `row`: its pieces, each kept whole and
 *  `gap` columns apart, then air, then `end`, the toggle. Never wraps; past
 *  its room it clips, as chips' row does. */
export const line = (kit: Kit, pieces: readonly RenderChildren[], end: RenderChildren, gap: number): RenderElement => {
  const { Box } = kit
  return (
    <Box key="row" flexDirection="row" flexWrap="nowrap" overflow="hidden" columnGap={gap}>
      {pieces.filter(isDrawn).map((piece, i) => (
        <Box key={`p${i}`} flexShrink={0}>
          {piece}
        </Box>
      ))}
      <Box key="air" flexGrow={1} />
      {end}
    </Box>
  )
}

/** A piece's ground on a collapsed line: `color`, with a column of padding
 *  either side until the line's last step; plain draws no ground. */
export const groundOf = (kit: Kit, k: Keeps<'padding'>, color: string): Readonly<{ backgroundColor?: string; paddingX?: number }> =>
  kit.palette.filled ? { backgroundColor: color, ...(k.has('padding') ? { paddingX: 1 } : {}) } : {}

/** The columns between a collapsed line's pieces: one where they stand on
 *  their ground; in plain, which has none to part them, two until the
 *  line's last step. */
export const pieceGap = (kit: Kit, k: Keeps<'padding'>): number => (kit.palette.filled || !k.has('padding') ? 1 : 2)

/** A collapsed row squeezed by its give-way order to the first step at which
 *  it fits its room. */
export const fitLine = <P extends string>(kit: Kit, order: GiveWay<P>, build: (keeps: Keeps<P>) => RenderElement): RenderElement =>
  squeezeToFit([...order.calm, ...order.amber, ...(order.last ?? [])], rowRoom(kit), kit.measure, has => {
    const long = order.amber.every(has)
    return build({
      has,
      calm: (p, tone) => tone === 'amber' || has(p),
      part: (p, tone) => has(p) || (tone === 'amber' && long),
      amber: a => (long ? a.long : a.short),
    })
  })
