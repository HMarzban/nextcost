// The card shell chips' and pulse's open views share, so their cards read as
// one family: which cards there are and their marks, a limit's accent, a
// card's ground and edge, its title and headline, its fact rows, how many
// cards a line holds, the grid they sit in, and the alert drawn where none
// fits.

import type { RenderChildren, RenderElement } from 'claude-code'
import type { SplitPart } from '../charts'
import type { Icon } from '../icons'
import type { Kit } from '../kit'
import { CARD_TEXT, DESKTOP, cellsOf } from '../layout'
import type { LimitKey, Tone } from '../facts'
import type { Readings } from '../reading'
import type { Palette } from '../palette'
import { CARD_TITLES } from '../words'
import type { Say } from '../words'

/** The cards, in the order they are drawn. */
export const CARD_NAMES = ['cache', 'spend', 'context', 'limits'] as const
export type CardName = (typeof CARD_NAMES)[number]

/** Each card's mark: the chips' own icons, so the band speaks one language. */
const CARD_ICONS: Readonly<Record<CardName, readonly [Icon, Exclude<keyof Palette, 'filled'>]>> = {
  cache: ['cache', 'warm'],
  spend: ['cost', 'coin'],
  context: ['context', 'label'],
  limits: ['limits', 'fiveAccent'],
}

/** A limit's accent: its window's, or `meterFill` for any other. */
export const limitAccent = (palette: Palette, key: LimitKey): string =>
  key === '5h' ? palette.fiveAccent : key === '7d' ? palette.weekAccent : palette.meterFill

/** The cards the readings have something for: the context once it is
 *  reported, the limits once any window is. */
export const cardsPresent = (read: Readings): Readonly<Record<CardName, boolean>> => ({
  cache: true,
  spend: true,
  context: read.context.known,
  limits: read.limits.length > 0,
})

/** `items`, `perLine` to a line. */
export const linesOf = <T,>(items: readonly T[], perLine: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / perLine) }, (_, i) => items.slice(i * perLine, (i + 1) * perLine))

/** The cards, line by line, a row of air between lines. Chips aligns a
 *  line's cards to one top edge, as a grid's, so their heads line up; pulse
 *  stretches them to the line's height, so their facts line up. */
export const cardGrid = (kit: Kit, lines: ReadonlyArray<readonly RenderChildren[]>, o: Readonly<{ marginTop: number; align: 'flex-start' | 'stretch' }>): RenderElement => {
  const { Box } = kit
  return (
    <Box key="cards" flexDirection="column" rowGap={1} marginTop={o.marginTop}>
      {lines.map((line, i) => (
        <Box key={`cards:${i}`} flexDirection="row" alignItems={o.align} columnGap={1}>
          {line}
        </Box>
      ))}
    </Box>
  )
}

/** Where no card fits, an amber window only the cards draw (the collapsed
 *  lines never draw the engine's other windows) still says it needs you, on
 *  the row they would have started on; null when none is amber. */
export const alertLine = (kit: Kit, read: Readings): RenderElement | null => {
  const { Box, palette, oneLine } = kit
  const alerts = read.limits.flatMap(l => (l.key === 'other' && l.amber !== undefined ? [l.amber.long] : []))
  return alerts.length === 0 ? null : <Box key="alert" marginTop={1}>{oneLine({ key: 'alert', color: palette.amberFg }, alerts.join(' · '))}</Box>
}

/** Whether a card draws its edge: the desktop's always, a terminal's only
 *  in plain, which has no fill to stand on; a terminal card with a fill
 *  draws none, since its border would cost two columns. */
const cardBordered = (kit: Kit): boolean => kit.Svg !== undefined || !kit.palette.filled

/** A desktop card's edge: a line of a pixel either side. */
const DESKTOP_EDGE_PX = 2

/** A line of cards as the shell lays it out. */
export type CardLine = Readonly<{
  /** How many cards a line holds: as many as hold their text, else half
   *  of them, else one. */
  perLine: number
  /** The columns inside a card, its share of the line less its padding
   *  and edge. */
  inner: number
  /** The px inside a desktop card: its share of the line's px, less its
   *  padding and its edge's lines, so a chart drawn this wide ends where its
   *  fact row does. */
  innerPx: number
  /** The columns a card's edge takes. */
  edge: number
  /** Whether a card's edge is a line of pixels, as the desktop draws it,
   *  rather than a row of text above and below. */
  pxEdge: boolean
  /** The rows a card's edge takes: a terminal's border two, the desktop's
   *  line and its padding one, a terminal fill none. */
  edgeRows: number
}>

/** The line `count` cards are laid out on. */
export const cardLine = (kit: Kit, count: number): CardLine => {
  const { columns, measure } = kit
  const bordered = cardBordered(kit)
  const edge = bordered ? 2 : 0
  const pxEdge = measure === DESKTOP
  const minCard = Math.ceil(CARD_TEXT * measure.text) + 2 + edge
  const fits = (n: number) => n * minCard + (n - 1) <= columns
  const perLine = [count, Math.ceil(count / 2)].find(fits) ?? 1
  return {
    perLine,
    inner: Math.max(4, Math.floor((columns - (perLine - 1)) / perLine) - 2 - edge),
    innerPx: Math.floor(((columns - (perLine - 1)) * measure.pxPerCell) / perLine - 2 * measure.pxPerCell - (bordered ? DESKTOP_EDGE_PX : 0)),
    edge,
    pxEdge,
    edgeRows: !bordered ? 0 : pxEdge ? 1 : 2,
  }
}

/** A label and its value at either end of a line; `swatch` keys a legend
 *  in its part's colour and fill. */
export const factRow = (kit: Kit, label: string, value: string, swatch?: SplitPart): RenderElement => {
  const { Box, Text, palette } = kit
  return (
    <Box key={`fact:${label}`} flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Text color={palette.label}>
        {swatch === undefined ? null : <Text key="sw" color={swatch.color}>{`${swatch.mark} `}</Text>}
        {label}
      </Text>
      <Text color={palette.cardValue}>{value}</Text>
    </Box>
  )
}

/** A line of words in a label's ink, cut to its row. */
export const clippedNote = (kit: Kit, key: string, text: string): RenderElement => {
  const { Box, palette, oneLine } = kit
  return <Box key={key}>{oneLine({ color: palette.label }, text)}</Box>
}

/** The longest of `forms` that fits `room` columns, else the shortest: a
 *  value that says what it covers where its row has room, so a row never
 *  wraps for it. */
export const fitForm = (kit: Kit, forms: readonly string[], room: number): string =>
  forms.find(form => cellsOf(form, kit.measure) <= room) ?? forms.at(-1) ?? ''

/** A headline: bold on its figure alone, its words in label ink, or
 *  amber's; amber words make the figure amber too. */
export const headline = (kit: Kit, say: Say, tone: Tone): RenderElement => {
  const { Text, palette, onTone, oneLine } = kit
  const figure = onTone(say.some(([, role]) => role === 'amber') ? 'amber' : tone, palette.value)
  return oneLine(
    {},
    say.map(([text, role], i) =>
      role === 'value' ? (
        <Text key={`say${i}`} color={figure} bold>
          {text}
        </Text>
      ) : (
        <Text key={`say${i}`} color={role === 'amber' ? palette.amberFg : palette.label}>
          {text}
        </Text>
      ),
    ),
  )
}

/** A card's title: on the desktop its mark, then its name. */
const cardTitle = (kit: Kit, name: CardName): RenderElement => {
  const { Box, Text, Svg, palette, icon } = kit
  const [mark, ink] = CARD_ICONS[name]
  return (
    <Box key="title" flexDirection="row" flexShrink={0}>
      {/* Desktop alone: a terminal title stays plain text. */}
      {Svg ? icon(mark, palette[ink]) : null}
      <Text color={palette.label}>{CARD_TITLES[name].toUpperCase()}</Text>
    </Box>
  )
}

/** Whether a card of `inner` columns holds `say` whole beside its title: a
 *  phrase that may not fit is measured first, since the line would cut it. */
export const headHolds = (kit: Kit, name: CardName, say: Say, tone: Tone, inner: number): boolean =>
  cellsOf(cardTitle(kit, name), kit.measure) + 1 + cellsOf(headline(kit, say, tone), kit.measure) <= inner

type CardSpec = Readonly<{
  /** The card's key, `card:cache`. */
  key: string
  /** Which card: its title, and its mark, drawn on the desktop alone. */
  name: CardName
  /** Its headline, at the head's other end. */
  head: RenderElement
  /** What follows the head, line by line. */
  body: RenderChildren
}>

/** A card: its title and headline on one line, then its body. Each grows
 *  alike from no width, so the cards of a line share it equally. */
export const cardShell = (kit: Kit, { key, name, head, body }: CardSpec): RenderElement => {
  const { Box, palette } = kit
  return (
    <Box
      key={key}
      flexDirection="column"
      flexGrow={1}
      width={0}
      minWidth={0}
      paddingX={1}
      {...(palette.filled ? { backgroundColor: palette.cardBg } : {})}
      {...(cardBordered(kit) ? { borderStyle: 'round', borderColor: palette.cardBorder } : {})}
    >
      <Box key="head" flexDirection="row" justifyContent="space-between" columnGap={1}>
        {cardTitle(kit, name)}
        {head}
      </Box>
      {body}
    </Box>
  )
}
