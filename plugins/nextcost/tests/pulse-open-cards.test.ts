// Pulse open: four cards in chips' grammar, CACHE, SPEND, CONTEXT and
// LIMITS, each its headline, its chart and its fact from the readings; the
// charts step down before a card gives way, and an amber card never does.

import type { RenderChildren } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { DESKTOP, TERMINAL, cellsOf } from '../hooks/layout'
import { DARK, LIGHT, PLAIN } from '../hooks/palette'
import { readingsOf } from '../hooks/reading'
import type { BandSnapshot } from '../hooks/snapshot'
import { EMPTY, limitsHead, markedHead } from '../hooks/words'
import { fixedZone } from '../hooks/format'
import { HOUR, MIN, SAMPLES, byKey, shown, svgsOf, walk, type Node } from './helpers'
import {
  AMBER_WEEK_LIMITS, CALM_LIMITS, COLD_CACHE, HISTORY, LAST_MINUTE_CACHE, NEAR_COMPACTION, WORKSPACE, bandOf, cacheWith, otherLimits, snapOf, visualRows,
} from './matrix'

/** The gateway's spend limit alone, of the two other windows. */
const OTHER = otherLimits().slice(0, 1)
const AMBER_OTHER: BandSnapshot['otherLimits'] = [{ kind: 'spend_limit', percentUsed: 92, resetsAt: 5 * HOUR }]
const CARDS = ['pulse:cache', 'pulse:spend', 'pulse:context', 'pulse:limits'] as const

/** Pulse drawn open, at 94 columns and 13 rows unless told otherwise. */
const open = (over: Partial<BandSnapshot> = {}): Node =>
  bandOf({ layout: 'pulse', columns: 94, maxRows: 13, history: HISTORY, samples: SAMPLES, expanded: true, ...CALM_LIMITS, ...over })
const cardOf = (tree: Node, name: string) => byKey(tree, `pulse:${name}`, 'Box')
const present = (tree: Node) => CARDS.filter(k => byKey(tree, k, 'Box') !== undefined)
/** A card's chart: its Svg keyed `chart`, or in text its line. */
const chartOf = (card: Node | undefined) => byKey(card, 'chart')
const tallest = (card: Node | undefined) => Math.max(0, ...svgsOf(card).filter(s => s.props?.key === 'chart').map(s => Number(s.props?.height)))

test('the four cards, in the one order, two to a line at 94 columns, then the footer', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    const tree = open({ surface })
    expect(present(tree)).toEqual([...CARDS])
    const lines = (byKey(tree, 'cards', 'Box')?.children ?? []) as Node[]
    expect(lines.map(l => (l.children ?? []).map(c => (c as Node).props?.key))).toEqual([['pulse:cache', 'pulse:spend'], ['pulse:context', 'pulse:limits']])
    expect(byKey(tree, 'collapse', 'Button')).toBeDefined()
    expect(visualRows(tree, surface)).toBeLessThanOrEqual(13)
  }
  // Wide, as chips: all four on one line; narrow, one to a line.
  expect(((byKey(open({ surface: 'desktop', columns: 160 }), 'cards', 'Box')?.children ?? []) as Node[]).length).toBe(1)
  const narrow = open({ surface: 'terminal', columns: 50, maxRows: 40 })
  expect(((byKey(narrow, 'cards', 'Box')?.children ?? []) as Node[]).length).toBe(4)
})

test('each card: its title in label ink, its headline from the readings, its fact', () => {
  const tree = open({ surface: 'terminal', zone: fixedZone(0) })
  const titles: string[] = []
  walk(byKey(tree, 'cards', 'Box'), n => {
    if (n.type === 'Text' && /^[A-Z]{4,}$/.test(shown(n))) titles.push(`${shown(n)}|${n.props?.color === DARK.label ? 'label' : String(n.props?.color)}`)
  })
  expect(titles).toEqual(['CACHE|label', 'SPEND|label', 'CONTEXT|label', 'LIMITS|label'])
  const heads = CARDS.map(k => shown(byKey(byKey(tree, k, 'Box'), 'head', 'Box')))
  expect(heads).toEqual(['CACHE52m left', 'SPEND$3.19', 'CONTEXT40% full', 'LIMITS5h 26% · 7d 41%'])
  expect(shown(cardOf(tree, 'cache'))).toMatch(/re-warm if cold~\$1\.66$/)
  expect(shown(cardOf(tree, 'spend'))).toMatch(/last message · avg\$0\.21 · ~\$0\.20$/)
  expect(shown(cardOf(tree, 'context'))).toMatch(/in context76k of 200k · compacts at 190k$/)
  expect(shown(cardOf(tree, 'limits'))).toMatch(/5h resets03:00[\s\S]*7d resetsSat 19:00/)
})

test("the charts: the cache's track, the beats over their average, the context's trail under compaction, the 5h window and the 7d's days", () => {
  const tree = open({ surface: 'desktop', maxRows: 40 })
  const alts = CARDS.map(k => svgsOf(cardOf(tree, k.slice(6))).filter(s => s.props?.key === 'chart').map(s => String(s.props?.alt)))
  expect(alts[0]?.[0]).toBe('cache 52 minutes left, warm')
  expect(alts[1]?.[0]).toMatch(/^cost of the last 24 messages/)
  expect(alts[2]?.[0]).toMatch(/^context over the conversation/)
  expect(alts[3]?.map(a => a.replace(/[:,].*/, ''))).toEqual(['5h window from start to reset', 'weekly limit by day'])
  const src = (k: string) => String(svgsOf(cardOf(tree, k)).find(s => s.props?.key === 'chart')?.props?.source)
  expect(src('cache')).toMatch(/class="now"/)
  expect(src('spend')).toMatch(/<line class="level"[^>]*stroke-dasharray="1 2"/)
  expect(src('context')).toMatch(/<line class="level"/)
})

test('a chart spans its card, to where its fact row ends: on the desktop its px, in text its cells, clipped to the card', () => {
  // The desktop: the card's share of the line's px, less 2 columns of padding and its edge's two 1 px lines.
  const widths = (tree: Node, name: string) => svgsOf(cardOf(tree, name)).filter(s => s.props?.key === 'chart').map(s => Number(s.props?.width))
  for (const [columns, perLine] of [[94, 2], [120, 2], [160, 4]] as const) {
    const tree = open({ surface: 'desktop', columns, maxRows: 40 })
    const px = Math.floor(((columns - (perLine - 1)) * DESKTOP.pxPerCell) / perLine - 2 * DESKTOP.pxPerCell - 2)
    for (const name of ['cache', 'spend', 'context']) expect(`${columns} ${name} ${widths(tree, name).join()}`).toBe(`${columns} ${name} ${px}`)
    // Limits: the 5h window in its half, the halves 2 columns apart.
    expect(`${columns} 5h ${widths(tree, 'limits')[0]}`).toBe(`${columns} 5h ${Math.floor((px - 2 * DESKTOP.pxPerCell) / 2)}`)
  }
  expect(widths(open({ surface: 'desktop', columns: 94, maxRows: 40 }), 'spend')).toEqual([443])
  // A line of one card, Limits gone, spans the whole line.
  const three = open({ surface: 'desktop', columns: 94, maxRows: 40, fiveHour: undefined, sevenDay: undefined })
  expect(widths(three, 'context')).toEqual([940 - 2 * DESKTOP.pxPerCell - 2])
  // In text: the card's inner cells, inside a box that clips to the card.
  for (const [columns, inner] of [[100, 47], [94, 44], [50, 48]] as const) {
    const tree = open({ surface: 'terminal', columns, maxRows: 40 })
    const card = cardOf(tree, 'cache')
    expect(`${columns} ${shown(chartOf(card)).length}`).toBe(`${columns} ${inner}`)
    expect(byKey(card, 'plot', 'Box')?.props?.overflow).toBe('hidden')
  }
})

test("the cache's track is inked by its mood: warm green while warm, amber in its last minute, grey cold, none while unknown", () => {
  const moods: ReadonlyArray<readonly [string, BandSnapshot['cache'], string]> = [
    ['warm', snapOf().cache, DARK.warm],
    ['expiring', LAST_MINUTE_CACHE, DARK.amberFg],
    ['cold', COLD_CACHE, DARK.label],
    ['unmeasured', cacheWith({ requests: 0, recalled: false, fresh: false }), 'none'],
    ['warming', cacheWith({ requests: 0, recalled: false, fresh: true }), 'none'],
  ]
  for (const [mood, cache, ink] of moods) {
    expect(readingsOf(snapOf({ cache })).cache.mood).toBe(mood)
    const card = cardOf(open({ surface: 'desktop', maxRows: 40, cache }), 'cache')
    const chart = chartOf(card)
    const drawn = chart === undefined ? 'none' : /<rect class="fill"[^>]* fill="([^"]+)"/.exec(String(chart.props?.source))?.[1]
    expect(`${mood} ${drawn}`).toBe(`${mood} ${ink}`)
  }
  // Unknown, its note says when it will be.
  expect(shown(cardOf(open({ surface: 'terminal', cache: moods[4]![1] }), 'cache'))).toContain('First message builds the cache.')
  // Cold, the estimate is the next message's.
  expect(shown(cardOf(open({ surface: 'terminal', cache: moods[2]![1] }), 'cache'))).toMatch(/next message~\$1\.66$/)
})

test('short of rows, the charts step down, two rows, then one, then none, before any card gives way', () => {
  const at = (maxRows: number) => open({ surface: 'desktop', maxRows })
  // A desktop chart is whole rows: 48 px, then 24.
  expect(tallest(cardOf(at(40), 'spend'))).toBe(48)
  expect(tallest(cardOf(at(13), 'spend'))).toBe(24)
  let lastCards: number = CARDS.length
  for (let rows = 40; rows >= 4; rows--) {
    const tree = at(rows)
    expect(byKey(tree, 'collapse', 'Button')).toBeDefined()
    expect(visualRows(tree, 'desktop')).toBeLessThanOrEqual(rows)
    const cards = present(tree)
    // While a card is gone, the charts of every card left are drawn no taller than the step before.
    if (cards.length < CARDS.length && cards.length === lastCards) continue
    if (cards.length < lastCards) {
      const before = at(rows + 1)
      expect(`${rows + 1} ${svgsOf(byKey(before, 'cards', 'Box')).filter(s => s.props?.key === 'chart').length}`).toBe(`${rows + 1} 0`)
    }
    lastCards = cards.length
  }
})

test('as rows run out, the calm cards give way in pulse\'s order, Context, Limits, the cache, Spend last', () => {
  const ORDER = ['pulse:context', 'pulse:limits', 'pulse:cache', 'pulse:spend']
  for (const surface of ['desktop', 'terminal'] as const) {
    let gone = 0
    for (let rows = 13; rows >= 4; rows--) {
      const tree = open({ surface, maxRows: rows, columns: 50 })
      expect(visualRows(tree, surface)).toBeLessThanOrEqual(rows)
      const kept = ORDER.map(k => byKey(tree, k, 'Box') !== undefined)
      const first = kept.indexOf(true)
      gone = Math.max(gone, first === -1 ? ORDER.length : first)
      expect(`${surface} ${rows} ${kept.slice(gone).every(Boolean) || kept.every(k => !k)}`).toBe(`${surface} ${rows} true`)
    }
  }
})

test('the other limits: a row of Limits, given way first; amber, it outlasts every card, and with no card a line of its own', () => {
  const wide = open({ surface: 'terminal', maxRows: 40, otherLimits: OTHER })
  expect(shown(byKey(cardOf(wide, 'limits'), 'others', 'Box'))).toBe('spend 40%')
  // Short of rows the charts step down first, then the calm row goes, before any card.
  const fewer = open({ surface: 'terminal', maxRows: 11, otherLimits: OTHER })
  expect([shown(byKey(fewer, 'others', 'Box')), CARDS.map(k => chartOf(byKey(fewer, k, 'Box')))]).toEqual(['spend 40%', [undefined, undefined, undefined, undefined]])
  const short = open({ surface: 'terminal', maxRows: 9, otherLimits: OTHER })
  expect([byKey(short, 'others', 'Box'), present(short).length]).toEqual([undefined, 4])
  const amber = open({ surface: 'terminal', maxRows: 7, otherLimits: AMBER_OTHER })
  expect(shown(byKey(amber, 'others', 'Box'))).toMatch(/! spend 92%/)
  // No room for any card: the amber window alone, on the body's row.
  const none = open({ surface: 'terminal', maxRows: 5, otherLimits: AMBER_OTHER })
  expect(present(none)).toEqual([])
  expect(shown(byKey(none, 'alert'))).toMatch(/! spend 92%/)
  expect(visualRows(none, 'terminal')).toBeLessThanOrEqual(5)
})

test('an amber card never gives way: near compaction Context stays, an expiring cache and an amber 7d too, where calm they go', () => {
  const cases = [['pulse:context', { context: NEAR_COMPACTION }], ['pulse:cache', { cache: LAST_MINUTE_CACHE }], ['pulse:limits', AMBER_WEEK_LIMITS]] as const
  for (const surface of ['terminal', 'desktop'] as const)
    for (const [key, amber] of cases)
      for (const maxRows of [7, 8, 9]) {
        const calm = open({ surface, maxRows, columns: 50 })
        const tree = open({ surface, maxRows, columns: 50, ...amber })
        const kept = byKey(tree, key, 'Box') !== undefined || byKey(calm, key, 'Box') !== undefined
        expect(`${surface} ${key} ${maxRows} ${kept}`).toBe(`${surface} ${key} ${maxRows} true`)
        expect(visualRows(tree, surface)).toBeLessThanOrEqual(maxRows)
      }
  // The calm Context does go short of rows, so the case above means something.
  expect(byKey(open({ surface: 'desktop', columns: 50, maxRows: 8 }), 'pulse:context', 'Box')).toBeUndefined()
  expect(byKey(open({ surface: 'desktop', columns: 50, maxRows: 8, context: NEAR_COMPACTION }), 'pulse:context', 'Box')).toBeDefined()
})

test('more amber than the body holds: the amber cards give way in pulse\'s order, the cache last, never the whole view', () => {
  // A desktop card's edge takes a row, so its least is a body of three.
  for (const [surface, over, rows] of [['desktop', { cache: LAST_MINUTE_CACHE, context: NEAR_COMPACTION }, [7, 8]], ['terminal', { ...AMBER_WEEK_LIMITS, cache: LAST_MINUTE_CACHE, context: NEAR_COMPACTION }, [6, 7]]] as const)
    for (const maxRows of rows) {
      const tree = open({ surface, columns: 50, maxRows, ...over })
      expect(`${surface} ${maxRows} ${byKey(tree, 'pulse:cache', 'Box') !== undefined}`).toBe(`${surface} ${maxRows} true`)
      expect(visualRows(tree, surface)).toBeLessThanOrEqual(maxRows)
    }
})

test("an amber card says so in words: its headline led by '! '", () => {
  const tree = open({ surface: 'terminal', cache: LAST_MINUTE_CACHE, context: NEAR_COMPACTION, ...AMBER_WEEK_LIMITS })
  expect(shown(byKey(cardOf(tree, 'cache'), 'head', 'Box'))).toMatch(/^CACHE! 0:30 left$/)
  expect(shown(byKey(cardOf(tree, 'context'), 'head', 'Box'))).toMatch(/^CONTEXT! 95% full$/)
  expect(shown(byKey(cardOf(tree, 'limits'), 'head', 'Box'))).toMatch(/^LIMITS! 5h 26% · 7d 85%$/)
  expect(shown(cardOf(tree, 'context'))).toMatch(/compacts in ~10k$/)
})

test('no limits: no Limits card, and Context keeps its place', () => {
  const tree = open({ surface: 'desktop', maxRows: 12, fiveHour: undefined, sevenDay: undefined })
  expect(present(tree)).toEqual(['pulse:cache', 'pulse:spend', 'pulse:context'])
})

test("no costs yet: Spend's trace flat and dim, only beside the note that says when costs show; a lone context reading flat at its level", () => {
  const none = { history: { costs: [], context: [76_000] }, costUsd: 0 }
  for (const surface of ['desktop', 'terminal'] as const)
    for (let columns = 40; columns <= 160; columns += 8) {
      const spend = cardOf(open({ surface, columns, maxRows: 40, ...none }), 'spend')
      if (spend === undefined) continue
      const traced = chartOf(spend) !== undefined
      expect(`${surface} ${columns} ${traced && !shown(spend).includes(EMPTY.costs) ? 'bare' : 'ok'}`).toBe(`${surface} ${columns} ok`)
    }
  const desk = open({ surface: 'desktop', maxRows: 40, ...none })
  const flat = chartOf(cardOf(desk, 'spend'))
  expect([flat?.props?.alt, /class="flat"[^>]* stroke="([^"]+)"/.exec(String(flat?.props?.source))?.[1]]).toEqual([EMPTY.costsAlt, DARK.label])
  const points = /<polyline points="([^"]+)"/.exec(String(chartOf(cardOf(desk, 'context'))?.props?.source))?.[1]?.split(' ').map(p => p.split(',')[1])
  expect(new Set(points).size).toBe(1)
  // In text it spans the card, two turns a cell.
  const term = open({ surface: 'terminal', maxRows: 40, ...none })
  const inner = Math.floor((94 - 1) / 2) - 2
  expect(shown(chartOf(cardOf(term, 'context')))).toHaveLength(inner)
})

test('too little to chart: the 5h and 7d without samples have no chart, only their facts', () => {
  const tree = open({ surface: 'desktop', maxRows: 40, samples: [] })
  expect(svgsOf(cardOf(tree, 'limits')).filter(s => s.props?.key === 'chart')).toHaveLength(0)
  expect(shown(cardOf(tree, 'limits'))).toMatch(/5h resets[\s\S]*7d resets/)
})

test("the context's compaction line sits inside its own chart, with air above it; the 5h chart keeps its now", () => {
  const tree = open({ surface: 'desktop', columns: 120, maxRows: 40 })
  const src = String(chartOf(cardOf(tree, 'context'))?.props?.source)
  const shift = Number(/translate\(0 ([\d.]+)\)/.exec(src)?.[1] ?? 0)
  const y = Number(/<line class="level"[^>]* y1="([\d.]+)"/.exec(src)?.[1]) + shift
  expect(y).toBeGreaterThanOrEqual(shift + 8)
  expect(y).toBeLessThan(Number(chartOf(cardOf(tree, 'context'))?.props?.height))
  const five = svgsOf(cardOf(tree, 'limits')).find(s => /^5h window/.test(String(s.props?.alt)))
  expect(String(five?.props?.source)).toMatch(/class="now"/)
})

test('every card keeps to its share of the line: no fact or chart wider than the card, at any width, amber or calm', () => {
  const amber = { cache: LAST_MINUTE_CACHE, context: NEAR_COMPACTION, fiveHour: { percentUsed: 50, resetsAt: 3 * HOUR, etaMs: 40 * MIN } }
  for (const surface of ['desktop', 'terminal'] as const)
    for (const columns of [40, 50, 60, 80, 94, 120, 160])
      for (const over of [{}, amber]) {
        const tree = open({ surface, columns, maxRows: 40, otherLimits: OTHER, workspace: WORKSPACE, zone: fixedZone(0), ...over })
        const lines = (byKey(tree, 'cards', 'Box')?.children ?? []) as Node[]
        for (const line of lines) {
          const cards = (line.children ?? []) as Node[]
          const share = Math.floor((columns - (cards.length - 1)) / cards.length)
          for (const card of cards) {
            const inner = share - (card.props?.borderStyle === undefined ? 0 : 2) - 2
            // The px inside a desktop card: its share of the line's px, less its padding and its edge's two 1 px lines.
            const sharePx = ((columns - (cards.length - 1)) * DESKTOP.pxPerCell) / cards.length - 2 * DESKTOP.pxPerCell - 2
            const fits = (row: Node, room: number, key: string) => {
              // A desktop chart in px: a desktop card's edge is a pixel's line either side, not a column.
              const ok = row?.type === 'Svg' ? Number(row.props?.width) <= (room === inner ? sharePx : (sharePx - 2 * DESKTOP.pxPerCell) / 2) : cellsOf(row as unknown as RenderChildren, surface === 'desktop' ? DESKTOP : TERMINAL) <= room
              expect(`${surface} ${columns} ${String(card.props?.key)} ${key} ${ok}`).toBe(`${surface} ${columns} ${String(card.props?.key)} ${key} true`)
            }
            for (const row of (card.children ?? []) as Node[]) {
              if (row?.props?.key !== 'halves') { fits(row, inner, String(row?.props?.key)); continue }
              // Limits' halves: each in its own room, side by side or one over the other; never none wide.
              const across = row.props?.flexDirection === 'row'
              for (const half of (row.children ?? []) as Node[]) {
                if (!across) expect(`${surface} ${columns} ${String(half.props?.key)} width ${String(half.props?.width)}`).not.toMatch(/width 0$/)
                for (const part of (half.children ?? []) as Node[]) fits(part, across ? Math.floor((inner - 2) / 2) : inner, `${String(half.props?.key)}/${String(part?.props?.key)}`)
              }
            }
          }
        }
      }
})

test('narrow, Limits stacks its halves, one over the other, each the card\'s width', () => {
  const halves = byKey(cardOf(open({ surface: 'terminal', columns: 40, maxRows: 40, zone: fixedZone(0) }), 'limits'), 'halves', 'Box')
  expect(halves?.props?.flexDirection).toBe('column')
  expect(((halves?.children ?? []) as Node[]).map(h => h.props?.width)).toEqual([undefined, undefined])
  expect(byKey(cardOf(open({ surface: 'terminal', maxRows: 40, zone: fixedZone(0) }), 'limits'), 'halves', 'Box')?.props?.flexDirection).toBe('row')
})

test('the terminal: cards are fills, not borders; plain draws no fill and borders them; braille for the charts, none in ascii', () => {
  const filled = cardOf(open({ surface: 'terminal' }), 'spend')
  expect([filled?.props?.backgroundColor, filled?.props?.borderStyle]).toEqual([DARK.cardBg, undefined])
  expect(shown(chartOf(filled))).toMatch(/^[⠀-⣿]+$/)
  const plain = cardOf(open({ surface: 'terminal', palette: PLAIN, maxRows: 40 }), 'spend')
  expect([plain?.props?.backgroundColor, plain?.props?.borderStyle]).toEqual([undefined, 'round'])
  const light = cardOf(open({ surface: 'terminal', palette: LIGHT }), 'spend')
  expect(light?.props?.backgroundColor).toBe(LIGHT.cardBg)
  const ascii = open({ surface: 'terminal', glyphs: 'ascii', maxRows: 40 })
  expect(CARDS.map(k => chartOf(byKey(ascii, k, 'Box')))).toEqual([undefined, undefined, undefined, undefined])
  // The desktop draws no day cells in text: desktop plain is text.
  expect(svgsOf(open({ surface: 'desktop', palette: PLAIN, maxRows: 40 }))).toHaveLength(0)
})

test("the cards' words: each figure from the readings, phrase by phrase", () => {
  const r = readingsOf(snapOf({ zone: fixedZone(0), history: { costs: [{ usd: 0.2, reWarm: false }, { usd: 0.21, reWarm: false }], context: [] } }))
  expect([r.cache.estimateLabel, readingsOf(snapOf({ cache: COLD_CACHE })).cache.estimateLabel]).toEqual(['re-warm if cold', 'next message'])
  expect(r.context.fact).toEqual({ label: 'in context', values: ['76k of 200k', 'compacts at 190k'] })
  expect(readingsOf(snapOf({ context: NEAR_COMPACTION })).context.fact.values).toEqual(['180k of 200k', 'compacts in ~10k'])
  expect(r.history().costFact).toEqual({ label: 'last message · avg', value: '$0.21 · ~$0.21' })
  expect(readingsOf(snapOf()).history().costFact).toBeUndefined()
  expect(r.fiveHour?.fact).toEqual({ label: '5h resets', value: '03:00' })
  expect(readingsOf(snapOf({ zone: fixedZone(0), fiveHour: { percentUsed: 50, resetsAt: 4 * HOUR, etaMs: 40 * MIN } })).fiveHour?.fact).toEqual({ label: '5h full in', value: '~40m' })
  expect(readingsOf(snapOf({ fiveHour: { percentUsed: 50, resetsAt: -HOUR, etaMs: null } })).fiveHour?.fact).toEqual({ label: '5h', value: 'reset' })
  expect(limitsHead(r.limits)).toEqual([['5h ', 'label'], ['4%', 'value'], [' · 7d ', 'label'], ['30%', 'value']])
  expect(markedHead([['93%', 'value']], 'amber')).toEqual([['! ', 'amber'], ['93%', 'value']])
  expect(markedHead([['38%', 'value']], 'calm')).toEqual([['38%', 'value']])
})

test("Limits says its reading is as of the last reply on a row of its own where the body has one to spare, and gives it up first, never overflowing", () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    const said = (maxRows: number, columns = 94) => /as of your last reply/.test(shown(cardOf(open({ surface, maxRows, columns, limitsAt: -12 * MIN }), 'limits') as Node))
    expect(said(40)).toBe(true)
    // Sooner than a chart steps down or a card gives way: the rows it would take are not the body's.
    let tight = 40
    while (said(tight - 1)) tight--
    expect(tight).toBeGreaterThan(5)
    for (let rows = 4; rows <= 40; rows++) expect(visualRows(open({ surface, maxRows: rows, limitsAt: -12 * MIN }), surface)).toBeLessThanOrEqual(Math.max(rows, visualRows(open({ surface, maxRows: rows }), surface)))
    // With the age said, the card says how long ago in its own words.
    expect(shown(cardOf(open({ surface, maxRows: 40, limitsAt: -12 * MIN }), 'limits') as Node)).toContain('as of your last reply, 12m ago')
  }
})
