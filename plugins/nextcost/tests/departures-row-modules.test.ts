// Departures' collapsed row as modules: each reading on its own rounded
// panel of the board's ground, a column of padding either side, holding its
// ITEM in its own ink and then its cell, white or amber; the band's own
// background between modules, a real space on a text surface. Plain draws no
// ground and sets them two columns apart. As the row narrows, the give-way
// is the one it always was, the padding going last of all (in plain, its
// second column of air and the brackets between a reading's runs), and
// nothing overflows at any width the board draws in.

import type { RenderChildren } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { fixedZone } from '../hooks/format'
import { DESKTOP, ROW_SLACK, TERMINAL, cellsOf } from '../hooks/layout'
import { DARK, LIGHT, PLAIN } from '../hooks/palette'
import { readingsOf } from '../hooks/reading'
import type { BandSnapshot } from '../hooks/snapshot'
import { ITEM_INK } from '../hooks/views/departures-board'
import { LONG, byKey, firstRow, flapWords, shown, svgsOf, walk, wordsOf, type Node } from './helpers'
import { ASCII_TIER, CALM_LIMITS, COLD_CACHE, LAST_MINUTE_CACHE, NEAR_COMPACTION, bandOf, limitAt, snapOf } from './matrix'

const EXPIRING = { cache: LAST_MINUTE_CACHE }
const NEAR = { context: NEAR_COMPACTION }
const KEYS = ['cache', 'spend', 'context', '5h', '7d'] as const

/** Departures at 160 columns, its limits calm, in UTC. */
const DEPARTURES: Partial<BandSnapshot> = { layout: 'departures', columns: 160, maxRows: 13, zone: fixedZone(0), ...CALM_LIMITS }
/** Departures' collapsed row. */
const rowOf = (over: Partial<BandSnapshot> = {}): Node => firstRow(bandOf({ ...DEPARTURES, ...over })) as Node
const moduleOf = (row: unknown, key: string): Node | undefined => byKey(row, key, 'Box')
/** The board's rows the row draws from, by key. */
const boardRow = (over: Partial<BandSnapshot>, key: string) => readingsOf(snapOf({ ...DEPARTURES, ...over })).board().rows.find(r => r.key === key)

/** What a text surface draws: Texts' strings alone, since it draws no bare string in a Box. */
const drawnText = (n: unknown, inText = false): string => {
  if (typeof n === 'string' || typeof n === 'number') return inText ? String(n) : ''
  if (n === null || typeof n !== 'object') return ''
  const node = n as Node
  return (node.children ?? []).map(k => drawnText(k, inText || node.type === 'Text')).join('')
}

/** A module's runs in their inks, on a text surface: each run's Text. */
const runsOf = (module: unknown): Array<[string, unknown]> => {
  const out: Array<[string, unknown]> = []
  walk(module, n => {
    const kids = n.children ?? []
    if (n.type === 'Text' && kids.length > 0 && kids.every(k => typeof k === 'string') && kids.join('').trim() !== '') out.push([kids.join(''), n.props?.color])
  })
  return out
}
/** A module's tiles on the desktop, each character and its fill, out of its Svg. */
const tilesOf = (module: unknown): Array<[string, unknown]> =>
  [...String(svgsOf(module)[0]?.props?.source).matchAll(/fill="([^"]*)">([^<]*)<\/text>/g)].map(m => [m[2] ?? '', m[1]])
/** The tiles runs draw: each run's characters in its ink. */
const tilesFor = (runs: ReadonlyArray<readonly [string | undefined, unknown]>): Array<[string, unknown]> =>
  runs.flatMap(([text, ink]) => [...(text ?? '')].map(ch => [ch, ink] as [string, unknown]))
/** What a module draws, in its inks: the desktop's tiles, a text surface's runs. */
const inked = (surface: 'desktop' | 'terminal', module: unknown) => (surface === 'desktop' ? tilesOf(module).filter(([ch]) => ch !== ' ') : runsOf(module))
/** What a module should draw: on the desktop, its characters' tiles, blanks
 *  left out, which carry no reading's ink of their own. */
const want = (surface: 'desktop' | 'terminal', runs: ReadonlyArray<readonly [string | undefined, unknown]>) =>
  surface === 'desktop' ? tilesFor(runs).filter(([ch]) => ch !== ' ') : runs

/** The row's pieces, as `line` wraps them, between the first module and the toggle's air. */
const piecesOf = (row: Node): Node[] => ((row.children ?? []) as Node[]).filter(n => n?.type === 'Box' && n.props?.key !== 'air' && byKey(n, 'more', 'Button') === undefined)
/** Whether a wrapped piece is a reading's module. */
const isModule = (piece: Node): boolean => KEYS.some(k => byKey(piece, k, 'Box') !== undefined)

for (const [name, p] of [['dark', DARK], ['light', LIGHT]] as const)
  for (const surface of ['desktop', 'terminal'] as const)
    test(`${name} ${surface}: each reading its own module, on the board's ground, a column of padding either side`, () => {
      const row = rowOf({ surface, palette: p })
      expect(KEYS.map(k => moduleOf(row, k)?.props?.backgroundColor)).toEqual(KEYS.map(() => p.boardBg))
      expect(KEYS.map(k => moduleOf(row, k)?.props?.paddingX)).toEqual(KEYS.map(() => 1))
      // A module holds its own reading's flaps alone: one Svg on the desktop.
      if (surface === 'desktop') expect(KEYS.map(k => svgsOf(moduleOf(row, k)).length)).toEqual([1, 1, 1, 1, 1])
      // No module sits inside another.
      for (const k of KEYS) expect(KEYS.filter(o => o !== k && byKey(moduleOf(row, k), o, 'Box') !== undefined)).toEqual([])
      // An amber reading's module keeps the board's ground.
      expect(moduleOf(rowOf({ surface, palette: p, ...EXPIRING }), 'cache')?.props?.backgroundColor).toBe(p.boardBg)
    })

for (const surface of ['desktop', 'terminal'] as const)
  test(`${surface}: a module's ITEM in its own ink, then its cell in the flaps' white`, () => {
    const row = rowOf({ surface })
    for (const k of KEYS) {
      const r = boardRow({ surface }, k)
      expect(`${k} ${JSON.stringify(inked(surface, moduleOf(row, k)))}`).toBe(`${k} ${JSON.stringify(want(surface, [[r?.item, DARK[ITEM_INK[k]]], [r?.cell, DARK.flapText]]))}`)
    }
  })

for (const surface of ['desktop', 'terminal'] as const)
  test(`${surface}: an amber reading's cell in amber, LAST CALL and its time, its ITEM still its own`, () => {
    const row = rowOf({ surface, ...EXPIRING })
    const r = boardRow({ surface, ...EXPIRING }, 'cache')
    expect(r?.cell).toMatch(/^! LAST CALL /)
    expect(inked(surface, moduleOf(row, 'cache'))).toEqual(want(surface, [['CACHE', DARK.flapItemCache], [r?.cell, DARK.flapAmber]]))
    // A calm reading beside it keeps the white.
    const spend = boardRow({ surface, ...EXPIRING }, 'spend')
    expect(inked(surface, moduleOf(row, 'spend'))).toEqual(want(surface, [['SPEND', DARK.flapItemSpend], [spend?.cell, DARK.flapText]]))
  })

test('the terminal draws real spaces between modules, in a Text, and no Box holds a bare string', () => {
  for (const palette of [DARK, LIGHT, PLAIN])
    for (const glyphs of ['unicode', 'ascii'] as const) {
      const row = rowOf({ surface: 'terminal', palette, glyphs })
      const said = drawnText(row)
      // Each module's last character, a space, then the next module's ITEM.
      for (const next of ['SPEND', 'CONTEXT', '5H', '7D']) expect(`${glyphs} ${said}`).toMatch(new RegExp(`\\S {${palette.filled ? 1 : 2},}\\[?${next}`))
      walk(row, n => {
        if (n.type === 'Box') expect((n.children ?? []).filter(k => typeof k === 'string')).toEqual([])
      })
    }
})
for (const surface of ['desktop', 'terminal'] as const)
  test(`${surface}: modules sit a column apart on the band's own background, and the last a column short of ▵`, () => {
    const row = rowOf({ surface })
    const pieces = piecesOf(row)
    const m = surface === 'desktop' ? DESKTOP : TERMINAL
    expect(pieces.filter(isModule)).toHaveLength(5)
    // Module, air, module, air, …: every module followed by its air.
    pieces.forEach((piece, i) => expect(`${i} ${isModule(piece)}`).toBe(`${i} ${i % 2 === 0}`))
    for (const air of pieces.filter(p => !isModule(p))) {
      expect(cellsOf(air as unknown as RenderChildren, m)).toBe(1)
      walk(air, n => expect(n.props?.backgroundColor).toBeUndefined())
    }
  })

test('plain: no ground and no padding anywhere on the row, and modules at least two columns apart', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    const row = rowOf({ surface, palette: PLAIN })
    const grounds: unknown[] = []
    walk(row, n => {
      if (n.props?.backgroundColor !== undefined || n.props?.paddingX !== undefined) grounds.push(n.props?.backgroundColor ?? n.props?.paddingX)
    })
    expect(grounds).toEqual([])
    const m = surface === 'desktop' ? DESKTOP : TERMINAL
    const airs = piecesOf(row).filter(p => !isModule(p))
    expect(airs).toHaveLength(5)
    for (const air of airs) expect(cellsOf(air as unknown as RenderChildren, m)).toBeGreaterThanOrEqual(2)
  }
})

test('the ascii tier: modules in ascii alone, a real space between them', () => {
  const row = rowOf({ surface: 'terminal', glyphs: 'ascii', ...EXPIRING })
  expect(shown(row)).toMatch(ASCII_TIER)
  expect(drawnText(row)).toMatch(/CACHE\s*! LAST CALL \S+ SPEND/)
})

// ---- give-way --------------------------------------------------------------

const WIDTHS = Array.from({ length: 141 }, (_, i) => 200 - i)

for (const surface of ['desktop', 'terminal'] as const)
  test(`${surface}: as the row narrows, remarks then SPEND, CONTEXT and 5H give way, in that order; CACHE and 7D never`, LONG, () => {
    const gone: string[] = []
    for (const columns of WIDTHS) {
      const row = rowOf({ surface, columns })
      expect(`${columns} ${['cache', '7d'].every(k => moduleOf(row, k) !== undefined)}`).toBe(`${columns} true`)
      for (const k of ['spend', 'context', '5h'])
        if (moduleOf(row, k) === undefined && !gone.includes(k)) gone.push(k)
      // Once gone, a reading stays gone at every narrower width.
      for (const k of gone) expect(`${columns} ${k} ${moduleOf(row, k) === undefined}`).toBe(`${columns} ${k} true`)
      // A reading goes only once the remarks have.
      if (gone.length > 0) expect(`${columns} ${wordsOf(row)}`).not.toMatch(/ON PACE|FULL|RESET/)
    }
    // SPEND and CONTEXT go by 60; 5H, if at all, after them.
    expect(gone.length).toBeGreaterThanOrEqual(2)
    expect(['spend', 'context', '5h'].slice(0, gone.length)).toEqual(gone)
  })

const AMBERS: ReadonlyArray<Partial<BandSnapshot>> = [
  NEAR,
  { ...EXPIRING, ...NEAR },
  { ...EXPIRING, ...NEAR, fiveHour: { ...limitAt(88, 3), etaMs: null }, sevenDay: limitAt(85, 67) },
]
for (const surface of ['desktop', 'terminal'] as const)
  test(`${surface}: an amber reading keeps its module and its whole cell until every calm reading has gone`, LONG, () => {
    let short = 0
    for (const over of AMBERS) {
      const calm = KEYS.filter(k => boardRow(over, k)?.tone !== 'amber')
      const whole = boardRow(over, 'context')?.cell
      expect(boardRow(over, 'context')?.tone).toBe('amber')
      for (const columns of WIDTHS) {
        const row = rowOf({ surface, columns, ...over })
        const context = moduleOf(row, 'context')
        expect(`${columns} ${context !== undefined}`).toBe(`${columns} true`)
        if (`${flapWords(context)} ${shown(context)}`.includes(String(whole))) continue
        short++
        // Past the amber step only CACHE and 7D of the calm readings are left.
        expect(`${columns} ${calm.filter(k => k !== 'cache' && k !== '7d' && moduleOf(row, k) !== undefined)}`).toBe(`${columns} `)
      }
    }
    // The amber step is reached at the narrowest widths.
    expect(short).toBeGreaterThan(0)
  })

const STATES: ReadonlyArray<readonly [string, Partial<BandSnapshot>]> = [
  ['calm', {}],
  ['cold', { cache: COLD_CACHE }],
  ['last call', EXPIRING],
  ['context near', NEAR],
  ['two amber', { ...EXPIRING, ...NEAR }],
  ['limits amber', { fiveHour: { ...limitAt(88, 3), etaMs: null }, sevenDay: limitAt(85, 67) }],
  ['all amber', { ...EXPIRING, ...NEAR, fiveHour: { ...limitAt(88, 3), etaMs: null }, sevenDay: limitAt(85, 67) }],
  ['all amber, filling', { ...EXPIRING, ...NEAR, fiveHour: { ...limitAt(88, 3), etaMs: 20 * 60_000 }, sevenDay: limitAt(85, 67) }],
  ['all amber, no zone', { ...EXPIRING, ...NEAR, fiveHour: { ...limitAt(88, 3), etaMs: null }, sevenDay: limitAt(85, 67), zone: undefined }],
  ['all amber, compaction off', { ...EXPIRING, context: { tokens: 180_000, window: 200_000, percent: 90, compactAt: undefined, autoCompactOff: true }, fiveHour: { ...limitAt(88, 3), etaMs: null }, sevenDay: limitAt(85, 67) }],
  ['calm, a large spend', { costUsd: 1234.56 }],
  ['all amber, other limits', { ...EXPIRING, ...NEAR, fiveHour: { ...limitAt(88, 3), etaMs: null }, sevenDay: limitAt(85, 67), otherLimits: [{ kind: 'spend_limit', percentUsed: 92, resetsAt: undefined }] }],
]

// About 7 s here, so CI's slower runners need more than LONG.
test('no overflow from 200 columns to 60: every state, both surfaces, every palette, unicode and ascii; ▵ at the end', { timeoutMs: 120_000 }, () => {
  for (const [name, over] of STATES)
    for (const surface of ['desktop', 'terminal'] as const)
      for (const palette of [DARK, LIGHT, PLAIN])
        for (const glyphs of surface === 'terminal' ? (['unicode', 'ascii'] as const) : (['unicode'] as const))
          for (const columns of WIDTHS) {
            const row = rowOf({ surface, palette, glyphs, columns, ...over })
            const cells = cellsOf(row as unknown as RenderChildren, surface === 'desktop' ? DESKTOP : TERMINAL)
            const said = `${name} ${surface} ${palette.filled ? 'filled' : 'plain'} ${glyphs} ${columns}`
            // The terminal fits its row less its slack, as each line is
            // squeezed to; the desktop's estimate keeps the row's width.
            expect(`${said} ${cells <= (surface === 'terminal' ? columns - ROW_SLACK : columns)}`).toBe(`${said} true`)
            expect(`${said} ${byKey(row, 'more', 'Button') !== undefined}`).toBe(`${said} true`)
          }
})
test("plain's last step: four amber readings at 60 each bracketed once, a column apart and led by its !, where wider each run has its own", () => {
  const all = Object.fromEntries(STATES)['all amber'] as Partial<BandSnapshot>
  for (const surface of ['terminal', 'desktop'] as const) {
    const m = surface === 'desktop' ? DESKTOP : TERMINAL
    const narrow = rowOf({ surface, palette: PLAIN, columns: 60, ...all })
    expect(KEYS.map(k => moduleOf(narrow, k) === undefined ? '-' : drawnText(moduleOf(narrow, k)))).toEqual(['[CACHE ! 30S]', '-', '[CONTEXT ! 95%]', '[5H ! 88%]', '[7D ! 85%]'])
    for (const air of piecesOf(narrow).filter(p => !isModule(p))) expect(cellsOf(air as unknown as RenderChildren, m)).toBe(1)
    const wide = rowOf({ surface, palette: PLAIN, columns: 200, ...all })
    expect(drawnText(moduleOf(wide, 'cache'))).toMatch(/^\[CACHE\]\[/)
    for (const air of piecesOf(wide).filter(p => !isModule(p))) expect(cellsOf(air as unknown as RenderChildren, m)).toBeGreaterThanOrEqual(2)
  }
})
test('four amber readings at 60 on the desktop: past the amber step the modules drop their padding, keeping their ground, and the row fits', () => {
  const all = Object.fromEntries(STATES)['all amber'] as Partial<BandSnapshot>
  const row = rowOf({ surface: 'desktop', columns: 60, ...all })
  const kept = KEYS.filter(k => moduleOf(row, k) !== undefined)
  expect(kept).toEqual(['cache', 'context', '5h', '7d'])
  expect(kept.map(k => [moduleOf(row, k)?.props?.backgroundColor, moduleOf(row, k)?.props?.paddingX])).toEqual(kept.map(() => [DARK.boardBg, undefined]))
  // A calm width keeps every module's padding.
  expect(KEYS.map(k => moduleOf(rowOf({ surface: 'desktop', columns: 200, ...all }), k)?.props?.paddingX)).toEqual([1, 1, 1, 1, 1])
})
