// The workspace strip: the first line of the expanded view, saying where the
// session is: its project, the branch, a worktree, changes and ahead/behind.

import { test, expect } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import { ROW_SLACK } from '../hooks/layout'
import { LAYOUT_NAMES } from '../hooks/snapshot'
import { BARE, LIGHT } from '../hooks/palette'
import { partCovered } from './cover'
import { bandOf } from './matrix'
import {
  DESKTOP_START,
  GIT_CLEAN,
  GIT_MAIN_TREE,
  PROJECT,
  START,
  DARK_HOSTS,
  LIGHT_HOSTS,
  byKey,
  cards,
  contrast,
  engine,
  firstRow,
  cardText,
  hoverCardOf,
  isCard,
  shown,
  svgsOf,
  walk,
  widthOf,
  type Node,
  HOUR_1,
  LONG,
  setup,
  mountBand,
} from './helpers'

const HOME = { ...HOUR_1, HOME: '/Users/me' }
const DIRTY = `# branch.oid 1a2b3c4d5e6f\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/a.ts\n1 M. N... 100644 100644 100644 a b src/b.ts\n? notes.md\n`
const DETACHED = `# branch.oid 1a2b3c4d5e6f\n# branch.head (detached)\n`
const WORKTREE = '/Users/me/workspace/nextcost/.claude/worktrees/band-strip'
const WORKTREE_DIRS = `${PROJECT}/.git/worktrees/band-strip\n${PROJECT}/.git\n${WORKTREE}\n`

const stripOf = (tree: unknown): Node | undefined => byKey(tree, 'strip', 'Box')

/** The expanded band on `surface`, after the git read has settled. Opening
 *  is the session's, so it presses only while the band is shut: short of
 *  rows an open band may have no cards, but always its Collapse. */
const expanded = async ($: Engine, clock: MockClock, surface: 'desktop' | 'terminal', cols = 120, maxRows = 40) => {
  await clock.settle()
  const ui = await mountBand($, surface, cols, { maxRows })
  if (byKey(await ui.drawn(), 'collapse', 'Button') === undefined) await ui.press({ key: 'more' })
  await clock.settle()
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

test('the strip opens the expanded view: the project, home as ~, its name bold, and the branch', async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(DESKTOP_START)
  const tree = await expanded($, clock, 'desktop')
  const kids = ((tree as Node).children ?? []).filter(Boolean) as Node[]
  expect(kids.map(k => k.props?.key)).toEqual(['row', 'strip', 'cards', 'actions'])
  const strip = stripOf(tree)
  expect(shown(strip)).toMatch(/^~\/workspace\/nextcost.*main.*clean$/)
  let bold: unknown
  walk(strip, n => {
    if (n.type === 'Text' && n.props?.bold) bold = shown(n)
  })
  expect(bold).toBe('nextcost')
  expect(svgsOf(strip).map(n => n.props?.alt)).toEqual(['folder', 'branch'])
})

test('the collapsed band has no strip', async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  await clock.settle()
  const ui = await mountBand($, 'desktop', 120)
  expect(stripOf(await ui.drawn())).toBeUndefined()
  await ui.unmount()
})

test('a dirty tree counts its changes, and ahead/behind shows only what differs', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.git = { status: DIRTY, dirs: GIT_MAIN_TREE }
  await $.session.start(DESKTOP_START)
  const tree = stripOf(await expanded($, clock, 'desktop'))
  const strip = shown(tree)
  expect(strip).toMatch(/3 changed/)
  expect(strip).not.toMatch(/clean/)
  // on the desktop the arrows are icons a reader names: "ahead 2", "behind 1"
  const piece = (key: string) => byKey(tree, key)
  expect(svgsOf(piece('ws:ahead')).map(n => n.props?.alt)).toEqual(['ahead'])
  expect(shown(piece('ws:ahead'))).toBe('2')
  expect(svgsOf(piece('ws:behind')).map(n => n.props?.alt)).toEqual(['behind'])
  expect(shown(piece('ws:behind'))).toBe('1')
})

test('a detached HEAD says so, with its short commit', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.git = { status: DETACHED, dirs: GIT_MAIN_TREE }
  await $.session.start(DESKTOP_START)
  const strip = stripOf(await expanded($, clock, 'desktop'))
  expect(shown(strip)).toMatch(/detached at 1a2b3c4/)
  expect(svgsOf(strip).map(n => n.props?.alt)).toContain('HEAD')
})

test('a linked worktree names the repository it belongs to', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = WORKTREE
  engine.git = { status: GIT_CLEAN, dirs: WORKTREE_DIRS }
  await $.session.start(DESKTOP_START)
  const strip = stripOf(await expanded($, clock, 'desktop', 160))
  expect(shown(strip)).toMatch(/band-strip.*main.*worktree of nextcost/)
  expect(svgsOf(strip).map(n => n.props?.alt)).toContain('linked')
})

test('outside a repository, or with git unable to run, the strip is the path alone', async ($, on) => {
  const clock = setup(on, { env: HOME })
  for (const git of ['none', 'fail'] as const) {
    engine.git = git
    await $.session.start(DESKTOP_START)
    const strip = stripOf(await expanded($, clock, 'desktop'))
    expect(shown(strip)).toBe('~/workspace/nextcost')
    expect(svgsOf(strip).map(n => n.props?.alt)).toEqual(['folder'])
  }
})

test('the terminal strip is words, with no icons and no bare spaces', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.git = { status: DIRTY, dirs: GIT_MAIN_TREE }
  await $.session.start(START)
  const strip = stripOf(await expanded($, clock, 'terminal'))
  expect(shown(strip)).toMatch(/^~\/workspace\/nextcost · on main.*3 changed · ↑2 ↓1$/)
  expect(svgsOf(strip)).toHaveLength(0)
})

test('on the desktop no strip child is a whitespace-only string', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.git = { status: DIRTY, dirs: GIT_MAIN_TREE }
  await $.session.start(DESKTOP_START)
  const bare: string[] = []
  walk(stripOf(await expanded($, clock, 'desktop')), n => {
    for (const k of n.children ?? []) if (typeof k === 'string' && k.trim() === '') bare.push(String(n.props?.key))
  })
  expect(bare).toEqual([])
})

for (const cols of [50, 70]) {
  test(`at ${cols} columns the strip fits one line and keeps the project and the branch`, async ($, on) => {
    const clock = setup(on, { env: HOME })
    engine.root = WORKTREE
    engine.git = { status: DIRTY.replace('branch.head main', 'branch.head claude/a-rather-long-feature-branch'), dirs: WORKTREE_DIRS }
    await $.session.start(START)
    const strip = stripOf(await expanded($, clock, 'terminal', cols))
    expect(widthOf(strip)).toBeLessThanOrEqual(cols)
    expect(shown(strip)).toMatch(/band-strip/)
    expect(shown(strip)).toMatch(/on claude/) // the branch keeps its prefix
  })
}

test('a band too short for a strip row puts it in the footer, in place of the hint', async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(DESKTOP_START)
  const footerOf = (tree: unknown): Node | undefined => byKey(tree, 'actions', 'Box')
  // 13 rows, as the desktop gives: each card keeps one fact, so no row is spare
  const short = await expanded($, clock, 'desktop', 95, 13)
  const footer = footerOf(short)
  expect(stripOf(footer)).toBeDefined()
  expect(shown(stripOf(footer))).toMatch(/nextcost.*main/)
  expect(shown(footer)).not.toMatch(/Bring it back/)
  // the footer strip leaves the buttons their room
  expect(widthOf(stripOf(footer))).toBeLessThanOrEqual(95 - 30)
  // with rows to spare it heads the view, and the hint is back
  const tall = await expanded($, clock, 'desktop', 95, 40)
  expect(stripOf(footerOf(tall))).toBeUndefined()
  expect(stripOf(tall)).toBeDefined()
  expect(shown(footerOf(tall))).toMatch(/Bring it back/)
})

test("the strip has no ground of its own, so its text takes the host theme's colours", async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.git = { status: DIRTY, dirs: GIT_MAIN_TREE }
  await $.session.start(DESKTOP_START)
  const colors: string[] = []
  const visit = (n: Node | undefined): void => {
    if (n === undefined || n === null || typeof n !== 'object' || n.props?.position === 'absolute') return
    if (n.type === 'Text' && typeof n.props?.color === 'string') colors.push(n.props.color)
    for (const k of (n.children ?? []) as Node[]) visit(k)
  }
  visit(stripOf(await expanded($, clock, 'desktop')))
  // hover cards paint their own ground; everything on the bare line is a theme key
  expect(colors.filter(c => c.startsWith('#'))).toEqual([])
})

test('its icons, which need hex, hold 3:1 on dark and light grounds alike', () => {
  for (const ground of [...DARK_HOSTS, ...LIGHT_HOSTS, '#ededf2']) {
    expect(contrast(BARE.icon, ground)).toBeGreaterThanOrEqual(3)
    expect(contrast(BARE.branch, ground)).toBeGreaterThanOrEqual(3)
  }
})

test('the light palette label holds 4.5:1 on every light surface', () => {
  for (const ground of [...LIGHT_HOSTS, LIGHT.surface, LIGHT.cardBg]) expect(contrast(LIGHT.label, ground)).toBeGreaterThanOrEqual(4.5)
})

test('a folder name too long for the line shortens, and the strip stays one row', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = '/Users/me/workspace/an-unusually-long-project-folder-name-here'
  engine.repoRoot = engine.root
  engine.git = { status: DIRTY, dirs: GIT_MAIN_TREE }
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const strip = stripOf(await expanded($, clock, surface, 40))
    if (surface === 'terminal') expect(widthOf(strip)).toBeLessThanOrEqual(40)
    expect(strip?.props?.height).toBe(1)
    expect(shown(strip)).toMatch(/an-unu.*…/)
  }
})

test('a narrow strip never hides uncommitted changes', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = WORKTREE
  engine.git = { status: DIRTY.replace('branch.head main', 'branch.head claude/a-rather-long-feature-branch'), dirs: WORKTREE_DIRS }
  await $.session.start(START)
  expect(shown(stripOf(await expanded($, clock, 'terminal', 40)))).toMatch(/±3/)
})

test('a clipped branch or path keeps its whole name for a reader', async ($, on) => {
  const clock = setup(on, { env: HOME })
  const long = 'claude/a-rather-long-feature-branch'
  engine.root = WORKTREE
  engine.git = { status: DIRTY.replace('branch.head main', `branch.head ${long}`), dirs: WORKTREE_DIRS }
  await $.session.start(DESKTOP_START)
  const alts = svgsOf(stripOf(await expanded($, clock, 'desktop', 60))).map(n => String(n.props?.alt))
  expect(alts).toContain(`branch ${long}`)
  expect(alts).toContain('folder ~/workspace/nextcost/.claude/worktrees/band-strip')
})

test("the path's hover card says the whole state, so nothing a narrow line drops is lost", async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.git = { status: DIRTY, dirs: GIT_MAIN_TREE }
  await $.session.start(DESKTOP_START)
  const card = hoverCardOf(stripOf(await expanded($, clock, 'desktop')), 'ws:path')
  expect(cardText(card)).toBe('~/workspace/nextcost: branch main, 3 changed, 2 ahead, 1 behind')
})

test("on a text surface the strip's hover cards are drawn after all of it, each sharing its own piece's scope", async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = WORKTREE
  engine.git = { status: DIRTY, dirs: WORKTREE_DIRS }
  await $.session.start(START)
  const strip = stripOf(await expanded($, clock, 'terminal'))
  const kids = ((strip?.children ?? []) as Node[]).filter(Boolean)
  const first = kids.findIndex(isCard)
  const found = cards(strip)
  expect(found.map(([key]) => key)).toEqual(['ws:path', 'ws:head', 'ws:worktree', 'ws:changes', 'ws:ab'])
  expect(kids.slice(first)).toEqual(found.map(([, card]) => card))
  expect(kids.slice(0, first).map(k => k.props?.key)).toEqual(['ws:where', 'ws:fill', 'ws:state'])
  expect(new Set(found.map(([, card]) => card.hover?.scope)).size).toBe(found.length)
  for (const [key, card] of found) {
    expect(byKey(strip, key, 'Box')?.hover?.scope).toBe(card.hover?.scope)
    expect(card.props).toMatchObject({ top: 0, display: 'none' })
    expect(card.props?.key).toBeUndefined()
    expect(card.hover?.display).toBe('flex')
  }
  expect(cardText(hoverCardOf(strip, 'ws:ab'))).toBe('2 commits to push, 1 to pull')
})

test("on the desktop each of the strip's hover cards sits inside its own piece, for the popover above it", async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = WORKTREE
  engine.git = { status: DIRTY, dirs: WORKTREE_DIRS }
  await $.session.start(START)
  const strip = stripOf(await expanded($, clock, 'desktop'))
  const kids = ((strip?.children ?? []) as Node[]).filter(Boolean)
  expect(kids.some(isCard)).toBe(false)
  const tracking = ['ws:ahead', 'ws:behind']
  expect(cards(strip).map(([key]) => key)).toEqual(['ws:path', 'ws:head', 'ws:worktree', 'ws:changes', ...tracking])
  for (const [key, card] of cards(strip)) {
    expect(card.hover).toEqual({ display: 'flex' })
    expect(card.props).toMatchObject({ position: 'absolute', display: 'none' })
    expect(byKey(strip, key, 'Box')?.hover).toBeUndefined()
  }
  // Ahead and behind, apart on the desktop, each explain the same.
  expect(new Set(tracking.map(key => cardText(hoverCardOf(strip, key))))).toEqual(new Set(['2 commits to push, 1 to pull']))
})

/** Where the terminal's top strip, `cols` wide, puts its cards: on the
 *  path's side from a column before its piece, slid left only as far as it
 *  must to end within its side's room; on the state's side ending a column
 *  after its piece. A side's room runs up to a column short of the other
 *  side, the path's side shrunk to leave the fill its two columns. Each card
 *  covers its own piece and any it enters whole, and is as wide as its text
 *  and caps where its room allows. */
const expectStripCardsAt = (strip: Node | undefined, cols: number) => {
  const pad = Number(strip?.props?.paddingX)
  const room = cols - ROW_SLACK
  const side = (key: string) => ((byKey(strip, key, 'Box')?.children ?? []) as Node[]).filter(Boolean)
  const endOf = (key: string) => side(key).reduce((at, piece) => at + widthOf(piece), pad)
  const stateEnd = endOf('ws:state')
  const whereEnd = Math.min(endOf('ws:where'), room - stateEnd - 2)
  /** That `card`, from `from`, covers its piece's [start, end) within its side's `sideRoom`, and fits its text where that allows. */
  const expectAt = (card: Node, from: number, start: number, end: number, sideRoom: number) => {
    const to = from + Number(card.props?.width)
    const at = `${String(card.hover?.scope)} ${from}+${String(card.props?.width)} over [${start}, ${end}) in ${sideRoom}`
    expect(`${at} ${from <= Math.max(0, start - 1) && to >= Math.min(end, sideRoom) && to <= sideRoom}`).toBe(`${at} true`)
    expect(Number(card.props?.width)).toBeGreaterThanOrEqual(Math.min(cardText(card).length + 4, sideRoom))
  }
  let at = pad
  for (const piece of side('ws:where')) {
    const card = hoverCardOf(strip, String(piece.props?.key))
    if (card !== undefined) expectAt(card, Number(card.props?.left), at, at + widthOf(piece), room - stateEnd - 1)
    at += widthOf(piece)
  }
  let end = pad
  for (const piece of side('ws:state').reverse()) {
    const card = hoverCardOf(strip, String(piece.props?.key))
    if (card !== undefined) {
      expect(card.props?.left).toBeUndefined()
      expectAt(card, Number(card.props?.right), end, end + widthOf(piece), room - whereEnd - 1)
    }
    end += widthOf(piece)
  }
  expect(partCovered(strip, 'terminal', cols)).toEqual([])
}

test("on the terminal a card on the path's side starts at its piece, and one on the state's side ends at its own", async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = WORKTREE
  engine.git = { status: DIRTY, dirs: WORKTREE_DIRS }
  await $.session.start(START)
  const strip = stripOf(await expanded($, clock, 'terminal', 160))
  expectStripCardsAt(strip, 160)
  expect(hoverCardOf(strip, 'ws:changes')?.props?.right).toBeGreaterThan(Number(strip?.props?.paddingX))
})

test("on a narrow terminal a card on the state's side stops short of the path, whose own card still counts the changes", async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = WORKTREE
  engine.git = { status: DIRTY, dirs: WORKTREE_DIRS }
  await $.session.start(START)
  for (const cols of [24, 40]) {
    const strip = stripOf(await expanded($, clock, 'terminal', cols))
    expectStripCardsAt(strip, cols)
    expect(cardText(hoverCardOf(strip, 'ws:path'))).toMatch(/3 changed/)
  }
})

// A long branch and changes on the other side, so a wide card on either side
// would reach across the fill: at 60 columns the changes card cut the branch.
const LONG_BRANCH = DIRTY.replace('branch.head main', 'branch.head fix/hover-contrast')
for (const [surface, glyphs] of [['terminal', 'unicode'], ['terminal', 'ascii'], ['desktop', 'unicode']] as const) {
  test(`on the ${surface} in ${glyphs}, at every width from 20 to 160, a strip card never reaches the other side's pieces`, LONG, async ($, on) => {
    const clock = setup(on, { env: { ...HOME, NEXTCOST_GLYPHS: glyphs } })
    engine.root = WORKTREE
    engine.git = { status: LONG_BRANCH, dirs: WORKTREE_DIRS }
    await $.session.start(START)
    for (let cols = 20; cols <= 160; cols++) {
      const tree = await expanded($, clock, surface, cols)
      expect(`${cols} ${partCovered(tree, surface, cols).join('; ')}`).toBe(`${cols} `)
    }
  })
}

test('in the footer, in every layout, the strip takes all the room the buttons leave, so its cards have the room they are given', () => {
  const workspace = { path: '~/workspace/nextcost', repoName: 'nextcost', git: { branch: 'main', commit: '1a2b3c4', worktree: undefined, changed: 3, ahead: 2, behind: 1 } }
  for (const layout of LAYOUT_NAMES) {
    let footers = 0
    for (let maxRows = 4; maxRows <= 16; maxRows++) {
      const actions = byKey(bandOf({ layout, expanded: true, maxRows, workspace }), 'actions', 'Box')
      const kids = ((actions?.children ?? []) as Node[]).flat().filter(Boolean)
      if (!kids.some(k => k.props?.key === 'strip')) continue
      footers++
      expect(`${layout} ${maxRows} ${kids.filter(k => Number(k.props?.flexGrow) > 0).map(k => k.props?.key)}`).toBe(`${layout} ${maxRows} strip`)
    }
    expect(`${layout} ${footers > 0}`).toBe(`${layout} true`)
  }
})

test('a footer strip with no room for its cards still draws, and shows no card too narrow to read', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = WORKTREE
  engine.git = { status: DIRTY, dirs: WORKTREE_DIRS }
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const strip = stripOf(byKey(await expanded($, clock, surface, 24, 12), 'actions', 'Box'))
    expect(strip).toBeDefined()
    // Its padding, caps and one character, or the hover shows a bare patch; the desktop's popover sizes itself.
    if (surface === 'terminal') for (const [, card] of cards(strip)) expect(card.props?.width).toBeGreaterThanOrEqual(5)
  }
})

test('one commit to push reads as one', async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.git = { status: DIRTY.replace('+2 -1', '+1 -0'), dirs: GIT_MAIN_TREE }
  await $.session.start(DESKTOP_START)
  const text: string[] = []
  walk(stripOf(await expanded($, clock, 'desktop')), n => {
    if (n.type === 'Box' && n.props?.position === 'absolute') text.push(shown({ ...n, props: {} }))
  })
  expect(text).toContain('1 commit to push')
  expect(text.join('|')).not.toMatch(/0 to pull/)
})

/** A Japanese project on a Japanese branch. */
const JAPANESE = { path: '/Users/me/workspace/設計メモ', repoName: undefined, git: { branch: '機能/表示幅', commit: '1a2b3c4', worktree: undefined, changed: 3, ahead: 2, behind: 1 } }
/** Columns a terminal draws `s` in: kana and CJK ideographs two each. */
const drawnWidth = (s: string): number => [...s].reduce((n, c) => n + (/[぀-ヿ一-鿿]/u.test(c) ? 2 : 1), 0)
for (const glyphs of ['unicode', 'ascii'] as const) {
  test(`${glyphs}: a Japanese project and branch keep their names, and the line still fits its row, shut and open`, () => {
    for (const layout of LAYOUT_NAMES)
      for (const columns of [70, 90, 120, 160]) {
        const at = `${layout} ${columns}`
        const draw = (expanded: boolean) => bandOf({ layout, columns, glyphs, expanded, maxRows: 40, workspace: JAPANESE })
        const shut = draw(false)
        expect(`${at} shut ${drawnWidth(shown(shut)) <= columns - ROW_SLACK}`).toBe(`${at} shut true`)
        const open = draw(true)
        const strip = byKey(open, 'strip', 'Box')
        const said = shown(strip)
        expect(`${at} ${said.includes('設計メモ')} ${said.includes('機能')}`).toBe(`${at} true true`)
        // In the footer the strip has the room the buttons, their hotkey marks
        // and the two gaps leave; on top, the row's, less its padding.
        const actions = byKey(open, 'actions', 'Box')
        const inFooter = byKey(actions, 'strip', 'Box') !== undefined
        const buttons = ((actions?.children ?? []) as Node[]).flat().filter(k => k?.type === 'Button').reduce((n, b) => n + drawnWidth(String(b.props?.label)) + 3 + 2, 0)
        const room = inFooter ? columns - ROW_SLACK - buttons - 2 : columns - ROW_SLACK - 2 * Number(strip?.props?.paddingX ?? 0)
        // The fill between its sides keeps two columns.
        expect(`${at} ${drawnWidth(said) + 2} <= ${room} ${drawnWidth(said) + 2 <= room}`).toMatch(/ true$/)
      }
  })
}

// ── names that would break a one-row strip ──────────────────────────────

const UNSAFE = /[\p{Cc}\u2028\u2029\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u

/** Every string a drawn tree holds, in its words and its props. */
const strings = (tree: unknown): string[] =>
  typeof tree === 'string' ? [tree] : Array.isArray(tree) ? tree.flatMap(strings) : typeof tree === 'object' && tree !== null ? Object.values(tree).flatMap(strings) : []

test('a project, branch or repository named with control or bidi characters is drawn printable, on one row, the band intact', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  engine.root = '/Users/me/pro\u0007ject\nx'
  engine.repoRoot = '/Users/me/re\u0001po'
  engine.git = { status: GIT_CLEAN.replace('branch.head main', 'branch.head feat\u202Eevil'), dirs: '/Users/me/r/.git/worktrees/w\n/Users/me/r/.git\n/Users/me/wt\u2067x\n' }
  await $.session.start(START)
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await expanded($, clock, surface, 140)
    const strip = shown(stripOf(tree))
    expect(strip).toContain('pro?ject?x')
    expect(strip).toContain('feat?evil')
    expect(strip).toContain('re?po')
    // Nowhere in the tree, the cards' words included, is one left.
    const said = strings(tree)
    expect(said.filter(text => UNSAFE.test(text))).toEqual([])
    expect(said.join(' ')).toContain('worktree wt?x')
    // The band around it still draws.
    expect(shown(byKey(firstRow(tree), 'cache', 'Box'))).toMatch(/cache/)
  }
})
