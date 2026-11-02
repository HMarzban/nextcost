// Pulse's collapsed row as tiles: each reading on its own ground, as chips'
// pills sit, its name in a label's ink, then its figure, then its own chart;
// an amber reading led by its amber words, which name it. As the row
// narrows, charts give way before words shorten, an amber reading's chart
// last, and nothing ever overflows.

import type { RenderChildren } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { DESKTOP, ROW_SLACK, TERMINAL, cellsOf } from '../hooks/layout'
import { DARK, LIGHT, PLAIN, type Palette } from '../hooks/palette'
import { readingsOf } from '../hooks/reading'
import type { BandSnapshot } from '../hooks/snapshot'
import { HOUR, LONG, MIN, SAMPLES, byKey, firstRow, shown, svgAlts, svgsOf, walk, type Node } from './helpers'
import { ASCII_TIER, CALM_LIMITS, COLD_CACHE, HISTORY, LAST_MINUTE_CACHE, NEAR_COMPACTION, bandOf, limitAt, snapOf } from './matrix'

const KEYS = ['cache', 'spend', 'context', '5h', '7d'] as const

/** Pulse's collapsed row at `columns`, with history and samples. */
const rowOf = (over: Partial<BandSnapshot> = {}): Node =>
  firstRow(bandOf({ layout: 'pulse', columns: 160, maxRows: 40, history: HISTORY, samples: SAMPLES, ...CALM_LIMITS, ...over })) as Node

/** The ink a colour is in a palette, by its role's name. */
const inkOf = (p: Readonly<Palette>, colour: unknown): string =>
  colour === p.label ? 'label' : colour === p.value ? 'value' : colour === p.amberFg ? 'amber' : String(colour)

/** A tile's pieces in order: each leaf Text as `text|ink`, each Svg as `svg`;
 *  a text surface's column of air, a Text of one space, left out. */
const piecesOf = (tile: unknown, p: Readonly<Palette> = DARK): string[] => {
  const out: string[] = []
  walk(tile, n => {
    if (n.type === 'Svg') out.push('svg')
    const kids = n.children ?? []
    if (n.type === 'Text' && kids.length > 0 && kids.every(k => typeof k === 'string') && kids.join('').trim() !== '') out.push(`${kids.join('')}|${inkOf(p, n.props?.color)}`)
  })
  return out
}

const BRAILLE = /^[⠀-⣿]+\|/

test('a calm tile on the desktop: its name in a label\'s ink, its figure in a value\'s, then its own chart', () => {
  const row = rowOf({ surface: 'desktop' })
  expect(KEYS.map(k => piecesOf(byKey(row, k, 'Box')))).toEqual([
    ['cache|label', '52m left|value', 'svg'],
    ['spend|label', '$3.19 · last $0.21|value', 'svg'],
    ['context|label', '40%|value', 'svg'],
    ['5h|label', '26%|value', 'svg'],
    ['7d|label', '41%|value', 'svg'],
  ])
  // Each chart is its own reading's.
  expect(KEYS.map(k => String(svgsOf(byKey(row, k, 'Box'))[0]?.props?.alt).split(' ')[0])).toEqual(['cache', 'cost', 'context', '5h', 'weekly'])
})
test('a calm tile on the terminal: name, figure, then its braille, a space apart', () => {
  const row = rowOf({ surface: 'terminal' })
  const spend = piecesOf(byKey(row, 'spend', 'Box'))
  expect(spend.slice(0, 2)).toEqual(['spend|label', '$3.19 · last $0.21|value'])
  expect(spend.slice(2).every(s => BRAILLE.test(s))).toBe(true)
  expect(shown(byKey(row, 'cache', 'Box'))).toBe('cache 52m left')
  expect(shown(byKey(row, 'context', 'Box'))).toMatch(/^context 40% [⠀-⣿]+$/)
  expect(shown(byKey(row, '5h', 'Box'))).toMatch(/^5h 26% [⠀-⣿]+$/)
  // The week's cells are the desktop's: in text the 7d is words.
  expect(shown(byKey(row, '7d', 'Box'))).toBe('7d 41%')
})
test('an amber tile is led by its amber words, which name it, in amber; its chart after them', () => {
  const row = rowOf({ surface: 'desktop', cache: LAST_MINUTE_CACHE, context: NEAR_COMPACTION, sevenDay: limitAt(85, 67) })
  expect(piecesOf(byKey(row, 'cache', 'Box'))).toEqual(['! 30s left · re-warm ~$1.66|amber', 'svg'])
  expect(piecesOf(byKey(row, 'context', 'Box'))).toEqual(['! context 95% · compacts in ~10k|amber', 'svg'])
  expect(piecesOf(byKey(row, '7d', 'Box'))).toEqual(['! 7d 85%|amber', 'svg'])
  // A calm tile beside them keeps its name.
  expect(piecesOf(byKey(row, '5h', 'Box')).slice(0, 2)).toEqual(['5h|label', '26%|value'])
})
for (const [name, p] of [['dark', DARK], ['light', LIGHT]] as const)
  for (const surface of ['desktop', 'terminal'] as const) {
    test(`${name} ${surface}: tiles on chips' grounds, the surface, 5h and 7d in their tints, a column of padding each side, no battery`, () => {
      const row = rowOf({ surface, palette: p })
      expect(KEYS.map(k => byKey(row, k, 'Box')?.props?.backgroundColor)).toEqual([p.surface, p.surface, p.surface, p.fiveBg, p.weekBg])
      expect(KEYS.map(k => byKey(row, k, 'Box')?.props?.paddingX)).toEqual([1, 1, 1, 1, 1])
      // An amber tile takes amber's ground, as chips' amber pill does.
      expect(byKey(rowOf({ surface, palette: p, cache: LAST_MINUTE_CACHE }), 'cache', 'Box')?.props?.backgroundColor).toBe(p.amberBg)
      // Tiles sit a column apart, as chips' pills do.
      expect(row.props?.columnGap).toBe(1)
      // The cache's tile is its heartbeat, never chips' battery.
      expect(svgAlts(row).some(a => /battery/.test(a))).toBe(false)
    })
  }
test('plain: no ground anywhere, the name before each figure, readings two columns apart', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    const row = rowOf({ surface, palette: PLAIN })
    const grounds: unknown[] = []
    walk(row, n => {
      if (n.props?.backgroundColor !== undefined || n.props?.paddingX !== undefined) grounds.push(n.props?.backgroundColor ?? n.props?.paddingX)
    })
    expect(grounds).toEqual([])
    expect(row.props?.columnGap).toBeGreaterThanOrEqual(2)
    expect(KEYS.map(k => piecesOf(byKey(row, k, 'Box'), PLAIN).slice(0, 2))).toEqual([
      ['cache|label', '52m left|value'],
      ['spend|label', '$3.19 · last $0.21|value'],
      ['context|label', '40%|value'],
      ['5h|label', '26%|value'],
      ['7d|label', '41%|value'],
    ])
  }
})
test('the ascii tier: tiles in words alone, ascii only', () => {
  const row = rowOf({ surface: 'terminal', glyphs: 'ascii' })
  expect(shown(row)).toMatch(ASCII_TIER)
  expect(KEYS.map(k => shown(byKey(row, k, 'Box')))).toEqual(['cache 52m left', 'spend $3.19, last $0.21', 'context 40%', '5h 26%', '7d 41%'])
})

/** What a text surface draws: Texts' strings alone, since it draws no bare string in a Box. */
const drawnText = (n: unknown, inText = false): string => {
  if (typeof n === 'string' || typeof n === 'number') return inText ? String(n) : ''
  if (n === null || typeof n !== 'object') return ''
  const node = n as Node
  return (node.children ?? []).map(k => drawnText(k, inText || node.type === 'Text')).join('')
}
test('the terminal draws one column between a name and its figure, and between the figure and its chart, in every appearance and tier', () => {
  for (const palette of [DARK, LIGHT, PLAIN])
    for (const glyphs of ['unicode', 'ascii'] as const) {
      const row = rowOf({ surface: 'terminal', palette, glyphs })
      const said = drawnText(row)
      for (const want of ['cache 52m left', 'spend $3.19', 'context 40%', '5h 26%', '7d 41%'])
        expect(`${glyphs} ${said.includes(want)}`).toBe(`${glyphs} true`)
      if (glyphs === 'unicode') for (const charted of [/\$0\.21 [⠀-⣿]+/, /context 40% [⠀-⣿]+/, /5h 26% [⠀-⣿]+/]) expect(said).toMatch(charted)
      // No Box holds a bare string, which a text surface would drop.
      walk(row, n => {
        if (n.type === 'Box') expect((n.children ?? []).filter(k => typeof k === 'string')).toEqual([])
      })
    }
})

// ---- give-way --------------------------------------------------------------

const WIDTHS = Array.from({ length: 161 }, (_, i) => 200 - i)
/** The charts a row keeps that give way, by their readings: the cache's
 *  heartbeat is its mark, which never does. */
const chartsOf = (row: Node): string[] =>
  KEYS.filter(k => k !== 'cache').filter(k => {
    const tile = byKey(row, k, 'Box')
    return tile !== undefined && (svgsOf(tile).length > 0 || /[⠀-⣿]/.test(shown(tile)))
  })

const COLD = { cache: COLD_CACHE }

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: as the row narrows, the charts go before any word shortens`, () => {
    let shortened = 0
    for (const state of [{}, COLD])
      for (const columns of WIDTHS) {
        const snap = { surface, columns, ...state }
        const { figure, figureShort } = readingsOf(snapOf({ layout: 'pulse', ...snap })).cache
        const said = shown(byKey(rowOf(snap), 'cache', 'Box'))
        // The cache's short form, `52m` or `cold ~$1.66`, comes only once every chart has gone.
        const short = said.endsWith(figureShort) && !said.endsWith(figure)
        if (short) shortened++
        expect(`${columns} ${short ? chartsOf(rowOf(snap)).join(',') : 'long'}`).toBe(`${columns} ${short ? '' : 'long'}`)
      }
    expect(shortened).toBeGreaterThan(0)
  })
  test(`${surface}: the context's trail goes first, then the 5h's, the beats last of the calm charts`, () => {
    const goneAt = (k: string) => WIDTHS.find(columns => !chartsOf(rowOf({ surface, columns })).includes(k)) ?? 0
    const [context, five, spend] = [goneAt('context'), goneAt('5h'), goneAt('spend')]
    expect([context > five, five > spend]).toEqual([true, true])
  })
}
test('an amber reading keeps its words and its chart past every calm chart', () => {
  const pace = { fiveHour: { percentUsed: 50, resetsAt: 3 * HOUR, etaMs: 40 * MIN } }
  for (const surface of ['desktop', 'terminal'] as const) {
    const calmGone = WIDTHS.find(columns => !chartsOf(rowOf({ surface, columns, ...pace })).includes('spend')) ?? 0
    const row = rowOf({ surface, columns: calmGone, ...pace })
    expect(`${surface} ${chartsOf(row).includes('5h')}`).toBe(`${surface} true`)
    expect(shown(byKey(row, '5h', 'Box'))).toMatch(/^! 5h full in ~40m/)
  }
})
test('at 40 columns a calm row of tiles is the cache and the 7d, a cold one too; the 5h is back as soon as it fits', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    const keys = (columns: number, over: Partial<BandSnapshot> = {}) => KEYS.filter(k => byKey(rowOf({ surface, columns, ...over }), k, 'Box') !== undefined)
    expect(`${surface} ${keys(40).join(',')}`).toBe(`${surface} cache,7d`)
    expect(`${surface} ${keys(40, COLD).join(',')}`).toBe(`${surface} cache,7d`)
    // Only what doesn't fit goes: a few columns wider, the 5h returns.
    const back = WIDTHS.filter(columns => keys(columns).includes('5h')).at(-1) ?? 0
    expect(`${surface} ${back > 40 && back <= 48}`).toBe(`${surface} true`)
  }
})

// ---- the 5h's forecast -----------------------------------------------------

test('no width draws the forecast as a bare time, which beside a reset reads as one', LONG, () => {
  const forecast = { fiveHour: { percentUsed: 85, resetsAt: 3 * HOUR, etaMs: 20 * MIN } }
  const amber = { cache: LAST_MINUTE_CACHE, context: NEAR_COMPACTION, sevenDay: { percentUsed: 90, resetsAt: 67 * HOUR } }
  for (const surface of ['desktop', 'terminal'] as const)
    for (const palette of [DARK, PLAIN])
      for (const state of [forecast, { ...forecast, ...amber }])
        for (let columns = 40; columns <= 200; columns++) {
          const five = shown(byKey(rowOf({ surface, palette, columns, ...state }), '5h', 'Box'))
          expect(`${surface} ${columns} ${/^\[?! 5h ~/.test(five)}`).toBe(`${surface} ${columns} false`)
        }
})
test('the row says the forecast short while it fits; past every other step, the 5h says its value', () => {
  const said = (columns: number) => shown(byKey(rowOf({ surface: 'terminal', columns, ...ALL_AMBER }), '5h', 'Box'))
  expect(said(120)).toMatch(/^! 5h full in ~20m/)
  expect(said(40)).toBe('! 5h 85%')
  const widths = Array.from({ length: 81 }, (_, i) => 40 + i)
  // Going wider: the value, then the forecast short, then the forecast long, never back.
  const forms = widths.map(columns => (/full in/.test(said(columns)) ? 2 : /full/.test(said(columns)) ? 1 : 0))
  expect(forms).toEqual([...forms].sort((a, b) => a - b))
  expect(forms).toContain(1)
})

// ---- no overflow -----------------------------------------------------------

const AMBER = {
  cache: { cache: LAST_MINUTE_CACHE },
  context: { context: NEAR_COMPACTION },
  five: { fiveHour: { percentUsed: 85, resetsAt: 3 * HOUR, etaMs: 20 * MIN } },
  seven: { sevenDay: { percentUsed: 90, resetsAt: 67 * HOUR } },
} as const
const ALL_AMBER = { ...AMBER.cache, ...AMBER.context, ...AMBER.five, ...AMBER.seven }

test('no width overflows: the tiles\' padding measured, every width from 40 to 200, calm, cold and amber, every palette', LONG, () => {
  const over: string[] = []
  const plainApart: string[] = []
  for (const surface of ['desktop', 'terminal'] as const)
    for (const palette of [DARK, LIGHT, PLAIN])
      for (const [name, state] of Object.entries({ calm: {}, cold: COLD, ...AMBER, all: ALL_AMBER }))
        for (let columns = 40; columns <= 200; columns++) {
          const row = rowOf({ surface, palette, columns, ...state })
          const width = cellsOf(row as unknown as RenderChildren, surface === 'desktop' ? DESKTOP : TERMINAL)
          const room = surface === 'terminal' ? columns - ROW_SLACK : columns
          if (width > room) over.push(`${surface} ${name} ${columns}: ${width}`)
          // Plain's readings stand a column apart only when each is led by its `!`.
          if (palette === PLAIN && Number(row.props?.columnGap) < 2) {
            const tiles = KEYS.map(k => byKey(row, k, 'Box')).filter(t => t !== undefined)
            if (!tiles.every(t => shown(t).startsWith('!'))) plainApart.push(`${surface} ${name} ${columns}`)
          }
        }
  expect(over).toEqual([])
  expect(plainApart).toEqual([])
})
test('last of all, every reading amber: the tiles drop their padding, their grounds kept; plain sets its readings a column apart, each led by its !', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    // At 40 columns, where every other step has been taken.
    const row = rowOf({ surface, columns: 40, ...ALL_AMBER })
    expect(KEYS.filter(k => k !== 'spend').map(k => byKey(row, k, 'Box')?.props?.paddingX)).toEqual([undefined, undefined, undefined, undefined])
    expect(byKey(row, 'cache', 'Box')?.props?.backgroundColor).toBe(DARK.amberBg)
    const plain = rowOf({ surface, palette: PLAIN, columns: 40, ...ALL_AMBER })
    // The terminal's plain row needs that last column; the desktop's fits before it.
    expect(`${surface} ${plain.props?.columnGap}`).toBe(`${surface} ${surface === 'terminal' ? 1 : 2}`)
    expect(shown(plain)).toMatch(/^! \d+s! ctx \d+%! 5h (full ~\d+m|\d+%)! 7d \d+%/)
    // Wider, the padding is back.
    expect(byKey(rowOf({ surface, columns: 120, ...ALL_AMBER }), 'cache', 'Box')?.props?.paddingX).toBe(1)
  }
})
