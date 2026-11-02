import { test, expect } from 'claude-code/testing'
import { barChart, braille, dayCells, dayCellsFit, flatBeats, heartbeat, meter, sparkline, splitBar, track } from '../hooks/charts'
import { CHIP_BAR } from '../hooks/views/chips'
import { byKey, expectNear, svgsOf, textOf, type Node } from './helpers'
import { bandOf, kitOf } from './matrix'

test('braille puts two values in a cell, four heights each', () => {
  expect(braille([0, 0], 4)).toBe('⠀')
  expect(braille([4, 4], 4)).toBe('⣿')
  expect(braille([1, 0], 4)).toBe('⡀')
  expect(braille([0, 1], 4)).toBe('⢀')
  expect(braille([4, 0, 2], 4)).toBe('⡇⡄')
  expect([...braille([1, 2, 3, 4, 3, 2], 4)].length).toBe(3)
})
test('braille is one column everywhere: every glyph is in U+2800–28FF', () => {
  for (const ch of braille([0, 1, 2, 3, 4, 3, 2, 1], 4)) expect((ch.codePointAt(0) ?? 0) >= 0x2800 && (ch.codePointAt(0) ?? 0) <= 0x28ff).toBe(true)
})

const desk = kitOf({ surface: 'desktop' })
const svg = (el: unknown) => el as Node & { props: { alt: string; width: number; source: string } }
for (const [name, el] of [
  ['sparkline', sparkline(desk, { key: 's', alt: '5h usage over the last hour', values: [1, 2, 3], color: '#7fcf8a', px: 90, height: 36 })],
  ['barChart', barChart(desk, { key: 'b', alt: 'cost of the last 3 messages', values: [1, 2, 9], marked: [false, false, true], color: '#888888', px: 18, height: 36 })],
  ['dayCells', dayCells(desk, { key: 'd', alt: 'weekly limit by day', values: [6, 9, 11, 4, 7, 7, 7], guess: [false, false, false, false, true, true, true], today: 3, color: '#a99cf0', cellPx: 16, height: 16 })],
  ['meter', meter(desk, { key: 'm', label: '5h', frac: 0.04, tone: 'calm', accent: '#7fcf8a', size: CHIP_BAR })],
] as const) {
  test(`${name} draws one Svg with alt, width and no ids`, () => {
    const n = svg(el)
    expect(n.type).toBe('Svg')
    expect(n.props.alt.length).toBeGreaterThan(0)
    expect(n.props.width).toBeGreaterThan(0)
    expect(n.props.source).not.toMatch(/\bid=|<clipPath|<linearGradient|<pattern/)
  })
}
test('a guessed day cell is dashed', () => {
  expect(svg(dayCells(desk, { key: 'd', alt: 'week', values: [6, 7], guess: [false, true], today: 0, color: '#a99cf0', cellPx: 16, height: 16 })).props.source).toMatch(/stroke-dasharray/)
})
/** Each day cell's marks, by class, as `<class> <attrs that draw it>`. */
const dayMarks = (source: string): string[] =>
  [...source.matchAll(/<rect class="(\w+)"([^>]*)\/>/g)].map(([, cls, attrs]) => `${cls}${[...(attrs ?? '').matchAll(/ (height|fill|stroke|stroke-dasharray|opacity)="([^"]+)"/g)].map(([, k, v]) => ` ${k}=${v}`).join('')}`)
test("day cells as forecast's board draws them: a measured day solid, its share filled against the cap; today dashed in value ink on a lighter ground; days to come dashed and dim on the track, filled dimmed toward their guess", () => {
  const { palette: p } = desk
  const source = svg(dayCells(desk, { key: 'd', alt: 'week', values: [60, 6, 50], guess: [false, false, true], today: 1, max: 100, color: p.trackStroke, cellPx: 13, height: 14 })).props.source
  expect(dayMarks(source)).toEqual([
    // 60 of 100 fills 60% of the 12px inside its edge.
    `fill height=7.2 fill=${p.trackStroke}`,
    `edge height=13 fill=none stroke=${p.trackStroke}`,
    `ground height=14 fill=${p.trackStroke} opacity=0.45`,
    `fill height=0.7 fill=${p.trackStroke}`,
    `edge height=13 fill=none stroke=${p.value} stroke-dasharray=2 1.6`,
    `ground height=14 fill=${p.meterTrack}`,
    // 50 of 100, guessed: half the 12px, dimmed.
    `guess height=6 fill=${p.trackStroke} opacity=0.45`,
    `edge height=13 fill=none stroke=${p.trackStroke} stroke-dasharray=2 2 opacity=0.75`,
  ])
})
test("day cells: a measured day filled, an empty one a solid edge on the track", () => {
  const { palette: p } = desk
  const cells = svg(dayCells(desk, { key: 'd', alt: 'week', values: [undefined, 10, undefined], color: p.trackStroke, cellPx: 20, height: 14 }))
  expect(dayMarks(cells.props.source)).toEqual([
    `edge height=13 fill=none stroke=${p.trackInk}`,
    `fill height=12 fill=${p.trackStroke}`,
    `edge height=13 fill=none stroke=${p.trackStroke}`,
    `edge height=13 fill=none stroke=${p.trackInk}`,
  ])
  // 3px apart, each 3px round.
  const xs = [...cells.props.source.matchAll(/class="edge" x="([\d.]+)"/g)].map(([, x]) => Number(x))
  expect([xs[1]! - xs[0]!, /class="edge"[^>]* rx="3"/.test(cells.props.source)]).toEqual([23, true])
})
// A chart drawn stretched has no width of its own, so the host squashes its
// marks into whatever slot it gets. Pulse and departures draw none.
test('no chart pulse or departures draws stretches: every Svg has its own width and keeps its aspect', () => {
  for (const layout of ['pulse', 'departures'] as const) for (const expanded of [false, true]) {
    const tree = bandOf({ layout, surface: 'desktop', columns: 160, maxRows: 13, expanded })
    // The board's rules are no chart: a solid line a pixel high, which spans
    // its board by stretching and has no marks to squash.
    for (const s of svgsOf(tree).filter(s => !/class="rule"/.test(String(s.props?.source)))) {
      expect(typeof s.props?.width).toBe('number')
      expect(String(s.props?.source)).not.toMatch(/preserveAspectRatio="none"/)
    }
  }
})
// Pulse's open bands are whole rows of 24 px: a chart 40 px tall takes two
// with 8 px of air above it, inside its own Svg, the desktop's only unit finer than a row.
test('air: a chart drawn below its air, the Svg as tall as both, its marks as they were', () => {
  const charts = [
    (air?: number) => sparkline(desk, { key: 's', alt: 'a', values: [1, 2, 3], color: '#7fcf8a', px: 90, height: 40, nowAt: 1, air }),
    (air?: number) => barChart(desk, { key: 'b', alt: 'b', values: [1, 2, 9], marked: [false, false, true], color: '#888888', px: 18, height: 40, air }),
    (air?: number) => dayCells(desk, { key: 'd', alt: 'd', values: [6, 9], today: 1, color: '#a99cf0', cellPx: 18, height: 38, air }),
  ]
  for (const chart of charts) {
    const [bare, aired] = [svg(chart()), svg(chart(8))]
    expect(Number(aired.props.height)).toBe(Number(bare.props.height) + 8)
    expect(aired.props.width).toBe(bare.props.width)
    const marks = (source: string) => source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
    expect(marks(aired.props.source)).toBe(`<g transform="translate(0 8)">${marks(bare.props.source)}</g>`)
  }
})
test('a guessed day is filled toward its guess, dimmed, behind its dashed edge; a measured one solid', () => {
  const source = svg(dayCells(desk, { key: 'd', alt: 'w', values: [50, 50, undefined], guess: [false, true, true], max: 100, color: '#a99cf0', cellPx: 10, height: 16 })).props.source
  const tall = (cls: string) => [...source.matchAll(new RegExp(`<rect class="${cls}"[^>]* height="([\\d.]+)"`, 'g'))].map(([, h]) => Number(h))
  expect([tall('fill'), tall('guess')]).toEqual([[7], [7]])
  expect(source).toMatch(/<rect class="guess"[^>]*opacity="0.45"/)
})
test('dayCellsFit: the widest cell, up to its most, that keeps the cells within px; none under 6', () => {
  // Seven 18 px cells, 3 apart, and the outline's 1 either side: 146 px.
  expect(dayCellsFit(146, 7, 18)).toBe(18)
  expect(dayCellsFit(400, 7, 18)).toBe(18)
  expect(dayCellsFit(100, 7, 18)).toBe(11)
  expect(dayCellsFit(60, 7, 18)).toBeUndefined()
  for (const px of [60, 100, 146]) {
    const cell = dayCellsFit(px, 7, 18)
    if (cell !== undefined) expect(Number(svg(dayCells(desk, { key: 'd', alt: 'w', values: [1, 2, 3, 4, 5, 6, 7], color: '#fff', cellPx: cell, height: 16 })).props.width)).toBeLessThanOrEqual(px)
  }
})
// Guard for the day cells pulse reuses: each fill sits in its own cell and is as tall as its value.
for (const [cellPx, height] of [[18, 56], [4, 14]] as const) {
  test(`day cells at ${cellPx}x${height}: each fill lies inside its own cell's edge and is as tall as its value`, () => {
    const values = [50, 100]
    const source = svg(dayCells(desk, { key: 'd', alt: 'week', values, today: 1, max: 100, color: '#a99cf0', cellPx, height })).props.source
    const num = (tag: string, attr: string): number[] => [...source.matchAll(new RegExp(`<rect class="${tag}"[^>]* ${attr}="([\\d.]+)"`, 'g'))].map(([, v]) => Number(v))
    const [edgeX, edgeW, fillX, fillW, fillH] = [num('edge', 'x'), num('edge', 'width'), num('fill', 'x'), num('fill', 'width'), num('fill', 'height')]
    expect(fillX).toHaveLength(2)
    values.forEach((v, i) => {
      expect(fillX[i]!).toBeGreaterThanOrEqual(edgeX[i]! - 0.01)
      expect(fillX[i]! + fillW[i]!).toBeLessThanOrEqual(edgeX[i]! + edgeW[i]! + 0.01)
      expectNear(fillH[i]!, (v / 100) * (height - 2), 0.1)
    })
  })
}
const term = kitOf()
test('a builder drawn outside a mount keeps its key and its children', () => {
  const n = meter(term, { label: 'context', frac: 0.5, tone: 'calm', accent: '#b8b8c2', size: CHIP_BAR }) as Node
  const half = Math.round(CHIP_BAR.cells / 2)
  expect(n.type).toBe('Text')
  expect(n.props?.key).toBe('meter')
  expect(byKey(n, 'track', 'Text')).toBeDefined()
  expect(textOf(n)).toBe(`${'█'.repeat(half)}${'░'.repeat(CHIP_BAR.cells - half)}`)
})
test('a stretched meter has no width of its own, its marks scaled to the slot', () => {
  const n = svg(meter(desk, { label: 'cache', frac: 0.5, tone: 'calm', accent: '#7fcf8a', size: CHIP_BAR, stretch: true }))
  expect(n.props.width).toBeUndefined()
  expect(n.props.source).toMatch(/preserveAspectRatio="none"/)
  expect(n.props.source).toMatch(/vector-effect="non-scaling-stroke"/)
})
test('in text, a line or bar chart is braille on its floor', () => {
  expect(textOf(sparkline(term, { key: 's', alt: '5h', values: [0, 4, 2, 4], color: '#7fcf8a', px: 90, height: 36 }))).toBe(braille([1, 4, 2, 4], 4))
  expect(textOf(barChart(term, { key: 'b', alt: 'cost', values: [1, 2], marked: [false, true], color: '#888888', px: 12, height: 36 }))).toBe(braille([1, 2], 2))
})
test("a sparkline's max sets the top of its scale, and it ends bare", () => {
  const source = svg(sparkline(desk, { key: 's', alt: '5h', values: [20, 50], color: '#7fcf8a', px: 90, height: 36, max: 100 })).props.source
  expect(/<polyline points="[^"]*,([\d.]+)"/.exec(source)?.[1]).toBe('18')
  expect(source).not.toMatch(/<circle/)
  expect(textOf(sparkline(term, { key: 's', alt: '5h', values: [20, 50], color: '#7fcf8a', px: 90, height: 36, max: 100 }))).toBe(braille([20, 50], 100, 1))
})
test("in text, day cells are a braille height each, a guess is a dot, and today is in brackets", () => {
  const cells = dayCells(term, { key: 'd', alt: 'week', values: [4, 2, undefined, 4], guess: [false, false, false, true], today: 1, color: '#a99cf0', cellPx: 16, height: 16 })
  expect(textOf(cells)).toBe(` ${braille([4, 0], 4)}[${braille([2, 0], 4)}]· · `)
})
test('in text, day cells keep one width wherever today falls', () => {
  const values = [4, 2, 3, 4]
  const widths = values.map((_, today) => textOf(dayCells(term, { key: 'd', alt: 'week', values, today, color: '#a99cf0', cellPx: 16, height: 16 })).length)
  expect(widths).toEqual(values.map(() => 2 * values.length + 1))
})
const deskKit = () => kitOf({ surface: 'desktop' })
test('beats: one path; no NaN with one value, all re-warms, or all zero', () => {
  for (const [values, marked] of [[[0.2], [false]], [[0.8, 0.9], [true, true]], [[0, 0], [false, false]]] as const) {
    const src = String(svgsOf(barChart(deskKit(), { key: 'b', alt: 'a', values, marked, color: '#fff', px: 84, height: 20 }))[0]?.props?.source)
    expect(src).toMatch(/<path class="beats"/)
    expect(src).not.toMatch(/NaN|Infinity/)
  }
})
test('beats: a re-warm is capped flat, a warm beat peaks to a point', () => {
  const tops = (marked: boolean) => {
    const d = String(svgsOf(barChart(deskKit(), { key: 'b', alt: 'a', values: [0.5], marked: [marked], color: '#fff', px: 20, height: 20, max: 1 }))[0]?.props?.source).match(/ d="([^"]+)"/)?.[1] ?? ''
    const ys = [...d.matchAll(/L([\d.]+),([\d.]+)/g)].map(m => Number(m[2]))
    return ys.filter(y => y === Math.min(...ys)).length
  }
  expect(tops(true)).toBe(2)
  expect(tops(false)).toBe(1)
})
test('sparkline: nowAt draws a now rule and the points after it dashed; level, a dashed rule', () => {
  const src = String(svgsOf(sparkline(deskKit(), { key: 's', alt: 'a', values: [1, 2, 3, 4, 5], color: '#fff', px: 60, height: 16, max: 10, nowAt: 2, levelFrac: 0.8 }))[0]?.props?.source)
  expect(src).toMatch(/class="now"/)
  expect(src).toMatch(/class="ahead"[^>]*stroke-dasharray/)
  expect(src).toMatch(/class="level"[^>]*stroke-dasharray/)
})
test('sparkline: from leaves the points before it undrawn, on the same x scale; in text, blank cells', () => {
  const o = { key: 's', alt: 'a', values: [0, 0, 20, 26, 37], color: '#fff', px: 60, height: 16, max: 100, nowAt: 3 } as const
  const pointsOf = (src: string, cls: string) => (new RegExp(`<polyline ${cls}points="([^"]+)"`).exec(src)?.[1] ?? '').split(' ').map(p => Number(p.split(',')[0]))
  const whole = String(svgsOf(sparkline(deskKit(), o))[0]?.props?.source)
  const from = String(svgsOf(sparkline(deskKit(), { ...o, from: 2 }))[0]?.props?.source)
  // The solid run starts at the third point, at the x it has drawn whole.
  expect(pointsOf(from, '')).toEqual(pointsOf(whole, '').slice(2))
  expect(pointsOf(from, 'class="ahead" ')).toEqual(pointsOf(whole, 'class="ahead" '))
  // From 0, the line is as it was.
  expect(String(svgsOf(sparkline(deskKit(), { ...o, from: 0 }))[0]?.props?.source)).toBe(whole)
  // In text the hours before it are blank, so the chart keeps its width.
  expect(textOf(sparkline(term, { ...o, values: [10, 10, 20, 26], from: 2 }))).toBe(`${braille([0, 0], 100)}${braille([20, 26], 100, 1)}`)
})
test('heartbeat per state; the beat ships still: no animation, never interactive', () => {
  const of = (state: 'beat' | 'flat' | 'hollow') => svgsOf(heartbeat(deskKit(), { key: 'h', alt: 'cache warm', state, color: '#F5B14C' }))[0]
  expect(String(of('flat')?.props?.source)).toMatch(/<line/)
  expect(String(of('hollow')?.props?.source)).toMatch(/fill="none"/)
  expect(of('beat')?.props?.isInteractive).toBeUndefined()
  expect(String(of('beat')?.props?.source)).not.toMatch(/animation|<style/)
  expect(String(of('beat')?.props?.source)).toMatch(/fill="#F5B14C"/)
  expect(heartbeat(kitOf({ surface: 'terminal' }), { key: 'h', alt: 'a', state: 'beat', color: '#fff' })).toBeNull()
})
test('beats: the average rule is dotted', () => {
  const src = String(svgsOf(barChart(deskKit(), { key: 'b', alt: 'a', values: [0.5, 0.7], marked: [false, false], color: '#fff', px: 40, height: 20, max: 1, levelValue: 0.6 }))[0]?.props?.source)
  expect(src).toMatch(/class="level"[^>]*stroke-dasharray/)
})
test('beats: a zero or tiny value is a flat tick, never a notch below the baseline', () => {
  for (const v of [0, 0.001]) {
    const src = String(svgsOf(barChart(deskKit(), { key: 'b', alt: 'a', values: [v], marked: [false], color: '#fff', px: 20, height: 20, max: 1 }))[0]?.props?.source)
    const d = src.match(/ d="([^"]+)"/)?.[1] ?? ''
    const ys = [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => Number(m[2]))
    expect(ys[1]).toBeLessThanOrEqual(16)
  }
})
test("the beats' empty state: a flat line on the beats' baseline, dim, in the ink given; in text braille's floor", () => {
  const n = svg(flatBeats(deskKit(), { key: 'b', alt: 'no costs yet', beats: 14, color: '#9a9aa4', px: 84, height: 20 }))
  expect([n.props.alt, n.props.width]).toEqual(['no costs yet', 84])
  const line = /<line class="flat" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"([^>]*)\/>/.exec(n.props.source)
  // Where every beat starts and ends, 4 px above the bottom, across the width.
  expect([line?.[2], line?.[4]]).toEqual(['16', '16'])
  expect(Number(line?.[3]) - Number(line?.[1])).toBeGreaterThan(80)
  expect(line?.[5]).toMatch(/stroke="#9a9aa4"[^>]*opacity="0\.\d+"/)
  expect(n.props.source).not.toMatch(/<path/)
  // Seven cells for fourteen beats, each on the floor.
  const text = flatBeats(term, { key: 'b', alt: 'no costs yet', beats: 14, color: '#9a9aa4', px: 84, height: 20 })
  expect(textOf(text)).toBe('⣀'.repeat(7))
  expect((text as Node).props?.color).toBe('#9a9aa4')
})
test("the cache's track: the hour gone filled from the left, now a rule across it, its own width; text braille, gone cells raised", () => {
  const src = (frac: number) => svg(track(desk, { key: 't', alt: 'cache 52 minutes left, warm', frac, color: '#7fcf8a', px: 400, height: 40, air: 8, cells: 40 }))
  const at = src(0.25)
  expect([at.props.width, at.props.height, at.props.alt]).toEqual([400, 48, 'cache 52 minutes left, warm'])
  expect(at.props.source).not.toMatch(/preserveAspectRatio/)
  expect(Number(/<rect class="fill"[^>]* width="([\d.]+)"/.exec(at.props.source)?.[1])).toBe(100)
  expect(Number(/<line class="now" x1="([\d.]+)"/.exec(at.props.source)?.[1])).toBe(100)
  // Nothing gone, no fill; now's rule stays inside the chart at either end.
  expect(src(0).props.source).not.toMatch(/class="fill"/)
  expect(Number(/<line class="now" x1="([\d.]+)"/.exec(src(1).props.source)?.[1])).toBeLessThan(400)
  const text = textOf(track(term, { key: 't', alt: 'a', frac: 0.25, color: '#7fcf8a', px: 80, height: 20, cells: 8 }))
  expect(text).toBe('⣤⣤⣀⣀⣀⣀⣀⣀')
})
test("a line's headroom keeps its scale's top, and a level drawn there, below the chart's own top", () => {
  const src = svg(sparkline(desk, { key: 's', alt: 'context', values: [10, 20], color: '#888888', px: 90, height: 40, max: 20, levelFrac: 1, air: 8, headroom: 8 })).props.source
  const y = Number(/<line class="level" x1="0" y1="([\d.]+)"/.exec(src)?.[1])
  // Inside the air's translate: 8 of air, then 2 + 8 of the plot's own.
  expect(y).toBe(10)
  expect(src).toMatch(/translate\(0 8\)/)
})
test('day cells drawn at a set width, left-aligned, the rest of it empty', () => {
  const n = svg(dayCells(desk, { key: 'd', alt: 'weekly limit by day', values: [6, 9, 11, 4, 7, 7, 7], today: 3, color: '#a99cf0', cellPx: 16, height: 16, px: 240 }))
  expect(n.props.width).toBe(240)
})
test("the flat line keeps its chart's air above it", () => {
  const n = svg(flatBeats(desk, { key: 'b', alt: 'a', beats: 24, color: '#9a9aa4', px: 240, height: 40, air: 8 }))
  expect([n.props.width, (n as Node).props?.height]).toEqual([240, 48])
  expect(n.props.source).toMatch(/translate\(0 8\)/)
})

/** A text split bar's cells for parts of `ns`, `cells` long, each part's fill its index. */
const splitCells = (ns: readonly number[], cells: number): string =>
  textOf(splitBar(term, { alt: 'split', parts: ns.map((n, i) => ({ n, color: '#888888', mark: String(i) })), size: { px: 8 * cells, cells } }))
test('a text split bar fills its width exactly: a zero last part takes no cell', () => {
  expect(splitCells([1, 1, 0], 31)).toBe(`${'0'.repeat(16)}${'1'.repeat(15)}`)
  for (const ns of [[1, 1, 0], [1, 1, 1], [0, 3, 1], [5, 0, 5], [1, 2, 3], [998, 1, 1], [0, 0, 7]])
    for (const cells of [3, 6, 7, 23, 31, 46]) expect(`${ns} ${cells}: ${splitCells(ns, cells).length}`).toBe(`${ns} ${cells}: ${cells}`)
})
test('in a text split bar every part with any share keeps a cell where there are cells for each', () => {
  for (const cells of [3, 6, 23]) {
    const drawn = splitCells([998, 1, 1], cells)
    expect(`${cells}: ${['0', '1', '2'].map(i => drawn.includes(i))}`).toBe(`${cells}: true,true,true`)
  }
  expect(splitCells([998, 1, 1], 2)).toBe('00')
})
