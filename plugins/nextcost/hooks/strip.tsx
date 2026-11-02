// The workspace strip: the line that says where the session is, its
// project, its git branch or worktree, changes and ahead/behind.
// A bare line, no border or fill: the panel's heading, not a fifth metric.
// Its text lines up with the cards' text. It sits on the host's own ground,
// so its text takes theme keys and its icons the BARE hexes. The desktop
// spaces pieces with gaps and icons; a text surface says them in words,
// between ` · `. One row always: nothing in it wraps.

import type { RenderChildren, RenderElement } from 'claude-code'
import { plural } from './format'
import { ALT } from './icons'
import type { CardPlace, Kit } from './kit'
import { clipMiddle, spansOf, squeezeToFit } from './layout'
import type { Span } from './layout'
import { BARE } from './palette'
import { gitSummary, splitPath } from './workspace'
import type { GitState, Workspace } from './workspace'

/** What the strip gives up as it narrows, least important first. The path,
 *  the branch and the change count's word shorten; the extras go whole, and
 *  the path's hover card still says everything. Uncommitted changes never
 *  go: they are what a narrow line must still say. */
const GIVE_WAY = [
  'clean',
  'parent',
  'changedWord',
  'branchLong',
  'worktreeOf',
  'aheadBehind',
  'branchShort',
  'worktree',
  'nameLong',
  'nameShort',
] as const
type Piece = (typeof GIVE_WAY)[number]

/** Push and pull in words, leaving out a side with nothing on it. */
const tracking = (g: GitState): string => {
  if (g.ahead === undefined) return 'no upstream'
  const sides = [g.ahead ? `${plural(g.ahead, 'commit')} to push` : '', g.behind ? `${g.behind} to pull` : ''].filter(Boolean)
  return sides.length === 0 ? 'up to date with its upstream' : sides.join(', ')
}
/** One side of push and pull in text: `↑2`, or in the ascii tier `ahead 2`,
 *  since `+2 -1` there reads like a diff's counts. */
const aheadBehind = (kit: Kit, side: 'ahead' | 'behind', n: number): string =>
  kit.glyphs === 'ascii' ? `${side} ${n}` : `${side === 'ahead' ? '↑' : '↓'}${n}`

/** Where a strip sits: on top, under a row of air, its text lined up with
 *  the cards' (`edge` is their border width); in the footer, in the room the
 *  buttons leave. */
const stripPlacement = (place: 'top' | 'footer', edge: number) =>
  place === 'top' ? { paddingX: 1 + edge / 2, marginTop: 1 } : { flexGrow: 1, flexShrink: 1, minWidth: 0 }

/** A part of a side's line: what it draws, and if it explains itself, its
 *  key and the card text it reveals on hover. A separator takes no room of a
 *  piece's for a card to cover whole. */
type Part = Readonly<{ node: RenderChildren; card?: Readonly<{ key: string; text: string }>; separator?: true }>

/** What the strip says at a squeeze: the path's side and the state's. */
type Said = Readonly<{ where: Part[]; state: Part[] }>

const saidOf = (kit: Kit, ws: Workspace, kept: (piece: Piece) => boolean): Said => {
  const { Box, Text, Svg, oneLine, explains, icon } = kit
  const git = ws.git
  const { parent, name: fullName } = splitPath(ws.path)
  /** A name cut in the middle as the squeeze shortens it: whole, then 24
   *  columns, then 12. */
  const shortened = (text: string, long: Piece, short: Piece): string => clipMiddle(text, kept(long) ? Infinity : kept(short) ? 24 : 12)
  const name = shortened(fullName, 'nameLong', 'nameShort')
  const shortParent = parent === '' ? '' : parent.startsWith('~/') ? '~/…/' : '…/'
  const parentShown = kept('parent') || shortParent.length >= parent.length ? parent : shortParent
  const clipped = parentShown !== parent || name !== fullName

  /** A piece keyed `key` that draws `body` and reveals `text` on hover: a text
   *  surface's cards, the kit's hoverCard, are drawn after the strip. */
  const explaining = (key: string, text: string, ...body: RenderChildren[]): Part => {
    const { props, card } = explains(key, text)
    return {
      node: (
        <Box key={key} flexDirection="row" {...props}>
          {body}
          {card}
        </Box>
      ),
      card: { key, text },
    }
  }

  const where: Part[] = [
    explaining(
      'ws:path',
      git === undefined ? ws.path : `${ws.path}: ${gitSummary(git)}`,
      Svg ? icon('folder', BARE.icon, clipped ? `folder ${ws.path}` : ALT.folder) : null,
      parentShown === '' ? null : oneLine({ color: BARE.label }, parentShown),
      oneLine({ color: BARE.value, bold: true }, name),
    ),
  ]
  if (git?.branch !== undefined) {
    const branch = shortened(git.branch, 'branchLong', 'branchShort')
    where.push(
      explaining(
        'ws:head',
        `Branch ${git.branch}${git.commit === undefined ? ', no commits yet' : ''}: ${tracking(git)}`,
        Svg ? icon('branch', BARE.branch, branch === git.branch ? ALT.branch : `branch ${git.branch}`) : <Text color={BARE.label}>{'on '}</Text>,
        oneLine({ color: BARE.value }, branch),
      ),
    )
  } else if (git !== undefined) {
    where.push(
      explaining(
        'ws:head',
        'HEAD is detached: new commits belong to no branch',
        Svg ? icon('commit', BARE.icon) : null,
        <Text color={BARE.label}>{git.commit === undefined ? 'detached' : 'detached at '}</Text>,
        git.commit === undefined ? null : <Text color={BARE.value}>{git.commit}</Text>,
      ),
    )
  }
  if (git?.worktree !== undefined && kept('worktree')) {
    const of = kept('worktreeOf') && ws.repoName !== undefined ? ws.repoName : undefined
    const text =
      ws.repoName === undefined
        ? 'A linked worktree: its own checkout of the repository'
        : `A linked worktree: its own checkout, sharing ${ws.repoName}'s history`
    where.push(
      explaining(
        'ws:worktree',
        text,
        Svg ? icon('worktree', BARE.icon) : null,
        <Text color={BARE.label}>
          {of === undefined ? 'worktree' : 'worktree of '}
          {of === undefined ? null : <Text key="of" color={BARE.value}>{of}</Text>}
        </Text>,
      ),
    )
  }

  const state: Part[] = []
  if (git !== undefined && git.changed > 0) {
    const word = kept('changedWord')
    state.push(
      explaining(
        'ws:changes',
        plural(git.changed, 'uncommitted change'),
        Svg ? icon('changes', BARE.icon) : null,
        <Text color={BARE.value}>
          {`${!word && !Svg ? '±' : ''}${git.changed}`}
          {word ? <Text key="w" color={BARE.label}>{' changed'}</Text> : null}
        </Text>,
      ),
    )
  } else if (git !== undefined && kept('clean')) {
    state.push({
      node: (
        <Text key="ws:clean" color={BARE.label}>
          clean
        </Text>
      ),
    })
  }
  if (git !== undefined && (git.ahead || git.behind) && kept('aheadBehind')) {
    if (Svg) {
      // Icons a reader names, "ahead 2, behind 1", where ↑ ↓ read as arrows.
      for (const [side, n] of [['ahead', git.ahead], ['behind', git.behind]] as const) {
        if (n)
          state.push(
            explaining(`ws:${side}`, tracking(git), icon(side, BARE.icon), <Text color={BARE.value}>{String(n)}</Text>),
          )
      }
    } else {
      state.push(
        explaining('ws:ab', tracking(git), <Text color={BARE.value}>{[git.ahead ? aheadBehind(kit, 'ahead', git.ahead) : '', git.behind ? aheadBehind(kit, 'behind', git.behind) : ''].filter(Boolean).join(' ')}</Text>),
      )
    }
  }
  return { where, state }
}

/** The strip at a squeeze, in `room` columns: the path's side, the fill,
 *  the state's side, then on a text surface each piece's hover card, placed
 *  at its piece. */
const stripAt = (kit: Kit, ws: Workspace, kept: (piece: Piece) => boolean, place: 'top' | 'footer', edge: number, room: number): RenderElement => {
  const { Box, Text, Svg, measure, asDrawn, hoverCard } = kit
  const { where, state } = saidOf(kit, ws, kept)
  /** A side's pieces, a text surface's ` · ` between each. */
  const joined = (side: string, pieces: readonly Part[]): Part[] =>
    pieces.flatMap((piece, i): Part[] =>
      i === 0 || Svg ? [piece] : [{ node: <Text key={`${side}-sep${i}`} color={BARE.label}>{' · '}</Text>, separator: true }, piece],
    )

  // Each card at its piece: on the path's side from where the piece starts,
  // on the state's ending where it ends. A separator is a Text, not a Box, so
  // no card, and air a card may cover in part. A card covers whole pieces of
  // its own side and stops a column short of the other's: the fill between
  // the sides has no width the band knows, only that the strip is at least
  // its room wide.
  const placement = stripPlacement(place, edge)
  const pad = placement.paddingX ?? 0
  const spacing = Svg ? 2 : 0
  const whereLine = joined('where', where)
  const stateLine = joined('state', state)
  const stateFromRight = [...stateLine].reverse()
  /** The spans of `line`'s pieces, from its own end of the strip. */
  const spansFrom = (line: readonly Part[]): Span[] =>
    spansOf(line.map(part => asDrawn(part.node)), spacing, measure).map(([start, end]): Span => [pad + start, pad + end])
  const whereSpans = spansFrom(whereLine)
  const stateSpans = spansFrom(stateFromRight)
  // Where each side ends, from its own end: the state's side, if it has
  // anything; the path's side, which shrinks to leave the fill its two
  // columns before the state's.
  const stateEnd = stateSpans.at(-1)?.[1]
  const whereEnd = Math.min(whereSpans.at(-1)?.[1] ?? pad, room - (stateEnd ?? 0) - 2)
  /** A card's room from its side: up to a column short of where the other
   *  side ends, if it draws anything. */
  const shortOf = (otherEnd: number | undefined) => (otherEnd === undefined ? room : room - otherEnd - 1)
  /** The cards of `line`'s pieces, in its order, each placed by `at` from
   *  how far into the strip its piece's first column sits, among the spans
   *  of the line's pieces, its separators left out. */
  const cardsOf = (line: readonly Part[], spans: readonly Span[], at: (from: number, spans: readonly Span[]) => CardPlace) => {
    const pieceSpans = spans.filter((_, i) => line[i]?.separator !== true)
    return line.flatMap(({ card }, i) => (card === undefined ? [] : [hoverCard(card.key, card.text, at(spans[i]?.[0] ?? pad, pieceSpans))]))
  }
  const cards = [
    ...cardsOf(whereLine, whereSpans, (left, pieces) => ({ left, room: shortOf(stateEnd), pieces })),
    ...cardsOf(stateFromRight, stateSpans, (right, pieces) => ({ right, room: shortOf(whereEnd), pieces })).reverse(),
  ]

  return (
    <Box
      key="strip"
      flexDirection="row"
      flexWrap="nowrap"
      overflow="hidden"
      height={1}
      {...placement}
    >
      <Box key="ws:where" flexDirection="row" columnGap={spacing} flexShrink={1} minWidth={0} overflow="hidden">
        {whereLine.map(part => part.node)}
      </Box>
      <Box key="ws:fill" flexGrow={1} minWidth={2} />
      <Box key="ws:state" flexDirection="row" columnGap={spacing} flexShrink={0}>
        {stateLine.map(part => part.node)}
      </Box>
      {cards}
    </Box>
  )
}

/** The strip at the first squeeze that fits `room` columns. `place` is the
 *  view's top, or the footer when the band is short of rows; `edge` is the
 *  cards' border width, so the strip's text lines up with theirs. */
export const drawStrip = (kit: Kit, ws: Workspace, place: 'top' | 'footer', edge: number, room: number): RenderElement =>
  squeezeToFit(GIVE_WAY, room, kit.measure, kept => stripAt(kit, ws, kept, place, edge, room))
