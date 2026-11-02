// The drawing kit: what every part of the band draws with, made once per
// draw from the surface's element table and the snapshot. JSX compiles to the
// global h(), so nothing here, or anywhere, is named h.

import type { ElementTable, RenderChildren, RenderElement, TextProps } from 'claude-code'
import type { Tone } from './facts'
import { ASCII_WORDS, asciiText, asciiTree, drawnTier } from './glyphs'
import { ALT, GLYPH, ICON_PATHS, ICON_PX } from './icons'
import type { Icon } from './icons'
import { DESKTOP, TERMINAL, clipWords, textCells } from './layout'
import type { Span } from './layout'
import type { BandSnapshot } from './snapshot'

/** Where a hover card sits in its row, which has `room` columns: by `left`,
 *  its piece's first column, or by `right`, how far short of the row's right
 *  edge its piece ends. `pieces` are the row's pieces, counted from the same
 *  side, at least a column apart. */
export type CardPlace = Readonly<({ left: number } | { right: number }) & { room: number; pieces: readonly Span[] }>

/** The columns a card `cells` wide takes at `place`, counted from its side.
 *  It starts a column before its piece, where its cap sits in the gap, slid
 *  back only as far as it must to end within the room. Then it covers whole
 *  pieces: each piece it enters, the column either side included, so no
 *  piece shows in part, all within the room. A row has none to give where
 *  it has no room. */
const cardSpan = (place: CardPlace, cells: number) => {
  const { room } = place
  const width = Math.max(0, Math.min(cells, room))
  let from = Math.max(0, Math.min(('right' in place ? place.right : place.left) - 1, room - width))
  let to = from + width
  for (const [start, end] of place.pieces) {
    if (start < to && end > from) {
      from = Math.min(from, start - 1)
      to = Math.max(to, end + 1)
    }
  }
  const near = Math.max(0, from)
  const span = { width: Math.max(0, Math.min(room, to) - near) }
  return 'right' in place ? { right: near, ...span } : { left: near, ...span }
}

/** An Svg's size and how it sits: see the kit's `svg`. */
type SvgSpec = Readonly<{ key: string; alt: string; width: number; height: number; air?: number; stretch?: boolean }>

export const makeKit = (el: ElementTable, snap: BandSnapshot) => {
  const { Box, Button, Text } = el
  const palette = snap.palette
  const measure = snap.surface === 'desktop' ? DESKTOP : TERMINAL
  // Svg draws on the desktop alone (other surfaces hold the element but drop
  // it), and its markup takes hex: theme keys can't reach inside it, so plain
  // appearance keeps text.
  const Svg = snap.surface === 'desktop' && palette.filled && 'Svg' in el ? el.Svg : undefined
  const onTone = (tone: Tone, calm: string, amber: string = palette.amberFg) => (tone === 'amber' ? amber : calm)
  const glyphs = drawnTier(snap)
  /** `n` in the glyphs it is drawn in: band.tsx maps the tree last, so a
   *  piece is measured here where its cards are placed. */
  const asDrawn = (n: RenderChildren): RenderChildren => (glyphs === 'ascii' ? asciiTree(n) : n)

  /** How this surface draws a hover card: `lifted`, the desktop's, inside its
   *  piece; `placed`, a text surface's, after the pieces of its row; `none` in
   *  plain, whose open view says it all. */
  const cards = !palette.filled ? 'none' : snap.surface === 'desktop' ? 'lifted' : 'placed'

  // On a text surface, a piece and its card share this hover scope; see
  // hoverCard and CONTRIBUTING's hover-card rules.
  const scopeOf = (key: string) => `band-${key}`

  /** One line of text, cut where its box ends rather than wrapped. The
   *  unicode tier leaves the cut to the surface, which ends it with `…`; the
   *  ascii tier clips it to its row instead, at its last whole word, since
   *  that `…` is East-Asian-Ambiguous: a CJK terminal, the tier's own,
   *  draws it two columns wide where Ink counts one. */
  const oneLine = ({ key, ...props }: TextProps & { key?: string }, children: RenderChildren): RenderElement => {
    const keyed = key === undefined ? {} : { key }
    if (glyphs !== 'ascii')
      return (
        <Text {...keyed} {...props} wrap="truncate-end">
          {children}
        </Text>
      )
    return (
      <Box {...keyed} height={1} overflow="hidden">
        <Text {...props}>{children}</Text>
      </Box>
    )
  }

  /** What a keyed Box takes to explain itself, `text` being its one-line
   *  explanation, if any. `props` go on the Box: on a text surface they reveal
   *  the hoverCard drawn for `key`. `card` is the Box's last child: on the
   *  desktop, a hidden placed Box, with no scope of its own, inside a keyed
   *  Box above the prompt, is what the desktop lifts into a popover: it opens
   *  above its piece, or below where there's no room above, wraps at 360px,
   *  and takes the surface's own card ground and ink, which is why it names
   *  no size, ground or colour. */
  const explains = (key: string, text: string | undefined): Readonly<{ props: Readonly<{ hover?: { scope: string } }>; card: RenderChildren }> => ({
    props: text !== undefined && cards === 'placed' ? { hover: { scope: scopeOf(key) } } : {},
    card:
      text !== undefined && cards === 'lifted' ? (
        <Box position="absolute" display="none" hover={{ display: 'flex' }}>
          <Text>{text}</Text>
        </Box>
      ) : null,
  })

  /** A text surface's one-line explanation of `key`'s piece, for after the
   *  pieces of its row, placed as `place` says. It has no key: a keyed Box is
   *  its own hover scope, and a hidden one could never be hovered. It is
   *  inverted against the chips, and its ends are half blocks in its ground's
   *  colour on the band's own background, so they read as rounded edges where
   *  a one-row band has no room for a border. Past its text, the ground runs
   *  on to the end of the last piece it covers, so the card stays one slab. A
   *  card with no room past its padding and caps for one character isn't
   *  drawn. */
  const hoverCard = (key: string, text: string, place: CardPlace): RenderChildren => {
    if (cards !== 'placed') return null
    // The columns around the text: its padding and its caps.
    const chrome = 4
    // Sized in the glyphs it is drawn in: the ascii tier's are narrower.
    const shown = glyphs === 'ascii' ? asciiText(text) : text
    const span = cardSpan(place, textCells(shown) + chrome)
    if (span.width < chrome + 1) return null
    const shell = { position: 'absolute', top: 0, ...span, display: 'none', hover: { display: 'flex', scope: scopeOf(key) } } as const
    const ground = { backgroundColor: palette.tooltipBg, paddingX: 1 }
    // The ascii tier knows its room to the cell, so it makes its own cut, at
    // its last whole word with a `.`, as oneLine clips: the surface's would
    // end in a two-column `…`.
    const room = span.width - chrome
    const words =
      glyphs === 'ascii' ? (
        <Text color={palette.tooltipFg}>{clipWords(shown, room)}</Text>
      ) : (
        <Text color={palette.tooltipFg} wrap="truncate-end">
          {text}
        </Text>
      )
    return (
      <Box {...shell}>
        <Text color={palette.tooltipBg}>▐</Text>
        <Box {...ground} width={span.width - 2}>
          {words}
        </Box>
        <Text color={palette.tooltipBg}>▌</Text>
      </Box>
    )
  }

  /** `columns` of air that is always an element, for a Box whose children
   *  are all elements: the desktop's an empty Box, a text surface's a Text of
   *  spaces, since a text surface draws no bare string in a Box. */
  const air = (key: string, columns = 1): RenderElement =>
    snap.surface === 'desktop' ? <Box key={key} width={columns} flexShrink={0} /> : <Text key={key}>{' '.repeat(columns)}</Text>

  /** A column of air among text: a text surface keeps a bare space, but the
   *  desktop drops a string child that is only spaces, plain or not, so
   *  there it is `air`. */
  const gap = (key: string): RenderChildren => (snap.surface === 'desktop' ? air(key) : ' ')

  /** Marks in an Svg `width` by `height` px, one unit to a pixel: the one
   *  place an Svg is built. `air` sets the marks that many px down, under the
   *  air above them, and adds it to the height. A `stretch` Svg has no width
   *  of its own and a free aspect, so drawn wider than its slot it is capped
   *  by it and spans it. Null where Svg doesn't draw. */
  const svg = (o: SvgSpec, marks: string): RenderChildren => {
    if (!Svg) return null
    const { key, alt, width, air = 0, stretch = false } = o
    const height = o.height + air
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${stretch ? ' preserveAspectRatio="none"' : ''}>` +
      `${air > 0 ? `<g transform="translate(0 ${air})">${marks}</g>` : marks}</svg>`
    return stretch ? <Svg key={key} source={source} alt={alt} height={height} /> : <Svg key={key} source={source} alt={alt} width={width} height={height} />
  }

  /** What stands for an icon in text: its glyph, or in the ascii tier its word. */
  const mark = (name: Icon): string => (glyphs === 'ascii' ? ASCII_WORDS[name] : undefined) ?? GLYPH[name]

  /** An icon and the gap after it: an Svg on desktop, a glyph elsewhere. */
  const icon = (name: Icon, color: string, alt: string = ALT[name]): RenderChildren[] => {
    if (Svg) return [svg({ key: `i-${name}`, alt, width: ICON_PX, height: ICON_PX }, ICON_PATHS[name](color)), gap(`g-${name}`)]
    return mark(name) ? [<Text key={`i-${name}`} color={color}>{`${mark(name)} `}</Text>] : []
  }

  return { Box, Button, Text, Svg, palette, measure, columns: snap.columns, glyphs, asDrawn, onTone, oneLine, explains, hoverCard, gap, air, svg, icon, mark }
}

export type Kit = ReturnType<typeof makeKit>
