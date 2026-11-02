// Chips' open view, mounted: it opens under a row left as it was; its four
// cards, their copy and their bars; the context toward compaction; honest
// early states; and a grid of cards that fits the rows it is given.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { DARK } from '../hooks/palette'
import { CALM_LIMITS, bandOf } from './matrix'
import {
  BUILD_100K,
  DESKTOP_START,
  READ_100K,
  SPEND_LIMIT,
  BUILD_155K,
  CLEAR,
  FRESH,
  HOUR,
  MIN,
  START,
  USAGE,
  breakdown,
  byKey,
  cardOf,
  fact,
  firstRow,
  hostClock,
  MODERN,
  usageAt,
  pillOf,
  resp,
  respond,
  shown,
  svgsOf,
  walk,
  type Node,
  setup,
  mountBand,
  turn,
} from './helpers'

const withCompaction = (tokens: number) => ({
  ...USAGE,
  context: { tokens, window: 200_000, percent: (tokens / 2000), breakdown: breakdown({ autoCompactThreshold: 160_000, isAutoCompactEnabled: true }) },
})
const measureContext = async ($: Engine, tokens: number) =>
  $.session.measure({ context: { tokens, window: 200_000, percent: tokens / 2000 }, rateLimits: USAGE.rateLimits, cost: USAGE.cost, changed: ['context'] })

// ── opening ────────────────────────────────────────────────────────────

test("opening leaves the chip row exactly as it was; only the toggle's icon turns from ▵ to ▿", async ($, on) => {
  setup(on, { usage: withCompaction(152_000) })
  await $.session.start(START)
  await respond($, BUILD_155K)
  await measureContext($, 152_000)
  const ui = await mountBand($, 'desktop', 95)
  const toggle = async () => byKey(firstRow(await ui.drawn()), 'more', 'Button')?.props?.label
  const before = shown(firstRow(await ui.drawn()))
  expect(await toggle()).toBe('▵')
  await ui.press({ key: 'more' })
  expect(shown(firstRow(await ui.drawn()))).toBe(before)
  expect(await toggle()).toBe('▿')
  await ui.unmount()
})

test('a gap separates the open view from the row of chips', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  // whatever comes first under the chips, the strip or, without it, the cards
  const under = ((await ui.drawn()) as Node).children?.filter(Boolean)[1] as Node | undefined
  expect(under?.props?.marginTop).toBe(1)
  await ui.unmount()
})

// ── the cards ──────────────────────────────────────────────────────────

test('the open view is four labelled cards', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  for (const [name, title] of [['cache', 'CACHE'], ['spend', 'SPEND'], ['context', 'CONTEXT'], ['limits', 'LIMITS']] as const) {
    expect(shown(cardOf(tree, name))).toMatch(new RegExp(`^${title}`))
  }
  await ui.unmount()
})

test('the spend card: session total, last message and the token split', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await turn($, 't1', 2.0, 2.41)
  await respond($, BUILD_100K)
  await respond($, READ_100K)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(shown(cardOf(tree, 'spend'))).toMatch(/^SPEND\$2\.41/)
  expect(fact(tree, 'last message')).toBe('$0.41')
  expect(fact(tree, 'input')).toBe('120k')
  expect(fact(tree, 'output')).toBe('5.0k')
  expect(fact(tree, 'cache reads')).toBe('100k')
  await ui.unmount()
})

test('the limits card: each window with its usage and reset', async ($, on) => {
  setup(on, {
    usage: usageAt(MODERN, {
      ...USAGE,
      rateLimits: [...USAGE.rateLimits, SPEND_LIMIT],
    }),
    now: MODERN,
  })
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(fact(tree, '5h')).toBe('4%')
  expect(fact(tree, '7d')).toBe('30%')
  expect(fact(tree, 'spend')).toBe('92%!') // past 80%: marked, never colour alone
  // The worst, spend, leads with its reset; no window length, so no pace.
  expect(fact(tree, 'resets')).toBe(hostClock(MODERN + 5 * HOUR, MODERN))
  expect(fact(tree, '5h pace')).toBe('5h resets 3h 00m · ~10% at avg pace')
  await ui.unmount()
})

// ── context toward compaction ──────────────────────────────────────────

test('with compaction known, the context chip measures toward it, with no tick', async ($, on) => {
  setup(on, { usage: withCompaction(100_000) })
  await $.session.start(DESKTOP_START)
  await measureContext($, 100_000)
  const ui = await mountBand($, 'desktop', 140)
  const ctx = pillOf(await ui.drawn(), 'ctx')
  expect(shown(ctx)).toMatch(/63% full$/)
  const bar = svgsOf(ctx).find(n => /used/.test(String(n.props?.alt)))
  expect(String(bar?.props?.alt)).toMatch(/^context 63% used/)
  expect(String(bar?.props?.source)).not.toContain('class="tick"')
  await ui.unmount()
})

test('near compaction the chip says how full and how far to go', async ($, on) => {
  setup(on, { usage: withCompaction(152_000) })
  await $.session.start(START)
  await measureContext($, 152_000)
  const ui = await mountBand($, 'terminal', 140)
  expect(shown(pillOf(await ui.drawn(), 'ctx'))).toMatch(/95% full · compacts in ~8\.0k/)
  await ui.unmount()
})

test('the context card leads with how full it is toward compaction', async ($, on) => {
  setup(on, { usage: withCompaction(152_000) })
  await $.session.start(START)
  await measureContext($, 152_000)
  const ui = await mountBand($, 'terminal', 140)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(shown(cardOf(tree, 'context'))).toMatch(/^CONTEXT95% full/)
  expect(fact(tree, 'in context')).toBe('152k')
  expect(fact(tree, 'auto-compacts at')).toBe('160k')
  expect(fact(tree, 'room left')).toBe('~8.0k')
  expect(fact(tree, 'model window')).toBe('200k')
  await ui.unmount()
})

// ── honest early states ────────────────────────────────────────────────

test('after a reload with spend on the ledger, the cache is not measured yet, not warming', async ($, on) => {
  setup(on) // $2.41 already spent
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 140)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/cache –/)
  await ui.press({ key: 'more' })
  const card = shown(cardOf(await ui.drawn(), 'cache'))
  expect(card).toMatch(/not measured yet/)
  expect(card).toMatch(/Countdown starts with Claude's next reply/)
  expect(shown(cardOf(await ui.drawn(), 'spend'))).toMatch(/Breakdown counts from your next message/)
  await ui.unmount()
})

test('a brand-new session, or one after /clear, is warming', async ($, on) => {
  setup(on, { usage: FRESH })
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 140)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/cache warming/)
  await ui.press({ key: 'more' })
  expect(shown(cardOf(await ui.drawn(), 'cache'))).toMatch(/First message builds the cache/)
  await ui.unmount()
})

test('after /clear the new conversation is warming even with spend on the ledger', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_155K)
  await $.session.end(CLEAR)
  const ui = await mountBand($, 'terminal', 140)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/cache warming/)
  await ui.unmount()
})

// ── card copy ──────────────────────────────────────────────────────────

test('the cache card leads with the stake: re-warm cost, savings, hit rate, expiry', async ($, on) => {
  setup(on)
  await $.session.start(START)
  await respond($, BUILD_100K)
  await respond($, READ_100K)
  const ui = await mountBand($, 'terminal', 140)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(shown(cardOf(tree, 'cache'))).toMatch(/^CACHE1h 00m left/)
  // writes for the pinned hour at 2×, reads at Opus 5.5's 0.05×:
  // rate = 2.41 / (14k + 2*106k + 0.05*100k + 5*5k) = 2.41 / 256k
  expect(fact(tree, 're-warm if cold')).toBe('~$2.13 · cache rewrite, not your reply') // 2 * 113k * rate, and what it covers
  expect(fact(tree, 'saved on cache reads')).toBe('~$0.89') // 0.95 * 100k * rate
  expect(fact(tree, 'hit rate')).toBe('45%')
  expect(fact(tree, 'expires')).toBe('1h idle')
  expect(fact(tree, 'unexpected rebuilds')).toBeUndefined() // shown only when there is one
  await ui.unmount()
})

/** The spend card's split, input then output then cache reads, as a
 *  terminal draws it: each part's fill, and the mark its legend row leads with. */
const splitOf = (tree: unknown) => {
  let bar: { children?: unknown[] } | undefined
  walk(cardOf(tree, 'spend'), n => {
    if (bar === undefined && n.type === 'Text' && (n.children ?? []).length > 1 && /^[█▓▒#=+:]+$/.test(shown(n))) bar = n
  })
  const fills = ((bar?.children ?? []) as unknown[]).map(seg => shown(seg)).filter(Boolean).map(seg => [...new Set(seg)].join(''))
  const marks = ['input', 'output', 'cache reads'].map(label => shown(byKey(tree, `fact:${label}`, 'Box')).trim().slice(0, 1))
  return { fills, marks }
}

// WCAG 1.4.1: the parts' inks sit 1.0 to 1.3:1 apart in lightness and merge
// under every colour-vision simulation, so each part has its own fill too.
for (const [tier, fills] of [['unicode', ['█', '▓', '▒']], ['ascii', ['#', '=', '+']]] as const) {
  test(`the token split tells its parts apart by fill, not hue alone, its legend marked alike: ${tier}`, async ($, on) => {
    setup(on, { env: { NEXTCOST_GLYPHS: tier } })
    await $.session.start(START)
    await respond($, BUILD_100K)
    await respond($, READ_100K)
    const ui = await mountBand($, 'terminal', 140)
    await ui.press({ key: 'more' })
    expect(splitOf(await ui.drawn())).toEqual({ fills, marks: fills })
    await ui.unmount()
  })
}

/** Each drawn segment's [start, end) in px, from a split Svg's source: a
 *  rect's x and width, or an end path's straight edges (its round end is
 *  6px, the bar's radius, past them). */
const segmentsOf = (source: string): Array<readonly [number, number]> =>
  [...source.matchAll(/<rect x="([\d.]+)" y="1" width="([\d.]+)"|<path d="M([\d.]+) 1H([\d.]+)(V7|A)/g)].map(m =>
    m[1] !== undefined
      ? [Number(m[1]), Number(m[1]) + Number(m[2])]
      : m[5] === 'V7'
        ? [Number(m[3]) - 6, Number(m[4])]
        : [Number(m[3]), Number(m[4]) + 6],
  )

test('on the desktop each part of the token split ends a pixel short of the next, so the ground divides them', async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_100K)
  await respond($, READ_100K)
  const ui = await mountBand($, 'desktop', 140)
  await ui.press({ key: 'more' })
  const split = svgsOf(cardOf(await ui.drawn(), 'spend')).find(n => /token split/.test(String(n.props?.alt)))
  const segments = segmentsOf(String(split?.props?.source))
  expect(segments).toHaveLength(3)
  for (let i = 1; i < segments.length; i++) expect(Number(((segments[i]?.[0] ?? 0) - (segments[i - 1]?.[1] ?? 0)).toFixed(1))).toBe(1)
  await ui.unmount()
})

test('the limits card puts each value beside its bar and says the pace in words', async ($, on) => {
  setup(on, { usage: usageAt(MODERN), now: MODERN }) // 5h 4%, 2h of 5h gone; 7d 30%, 101h of 168h gone
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 140)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  expect(shown(cardOf(tree, 'limits'))).toMatch(/^LIMITS7d 30%/) // the window closest to trouble
  expect(fact(tree, '5h')).toBe('4%')
  expect(fact(tree, '5h pace')).toBe('5h resets 3h 00m · ~10% at avg pace')
  // The worst window, 7d, leads the card with its reset at its clock time and its pace.
  expect(fact(tree, 'resets')).toBe(`${hostClock(MODERN + 67 * HOUR, MODERN)} · ~50% at avg pace`)
  expect(fact(tree, '7d pace')).toBeUndefined()
  await ui.unmount()
})

// ── the grid and the bars ──────────────────────────────────────────────

test('cards sit in lines that share the width equally: four across when they fit, else two by two', async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_155K)
  const lines = async (cols: number) => {
    const ui = await mountBand($, 'desktop', cols)
    const grid = byKey(await ui.drawn(), 'cards', 'Box')
    await ui.unmount()
    return ((grid?.children ?? []) as Node[]).map(line => {
      expect(line.props?.flexWrap).not.toBe('wrap') // a line never wraps a card away
      return ((line.children ?? []) as Node[]).map(k => {
        expect(k.props?.flexGrow).toBe(1)
        expect(k.props?.width).toBe(0) // equal shares, whatever the text
        return String(k.props?.key).replace('card:', '')
      })
    })
  }
  await (async () => {
    const ui = await mountBand($, 'desktop', 95)
    await ui.press({ key: 'more' })
    await ui.unmount()
  })()
  expect(await lines(95)).toEqual([['cache', 'spend'], ['context', 'limits']])
  expect(await lines(140)).toEqual([['cache', 'spend', 'context', 'limits']])
})

test('the open band fits the rows it is given: cards drop their least facts first', async ($, on) => {
  setup(on, { usage: withCompaction(100_000) })
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_155K)
  await measureContext($, 100_000)
  const rowsOf = async (maxRows: number) => {
    const ui = await mountBand($, 'desktop', 95, { maxRows })
    if (maxRows === 40) await ui.press({ key: 'more' })
    const tree = await ui.drawn()
    await ui.unmount()
    // two lines of cards, each its tallest card plus its border, a row between
    // them; the chip row and the buttons, each with a row of air before the next
    const tallest = (names: string[]) => Math.max(...names.map(n => (cardOf(tree, n)?.children ?? []).filter(Boolean).length)) + 2
    const strip = byKey(tree, 'strip', 'Box') === undefined ? 0 : 1
    return { total: 5 + strip + tallest(['cache', 'spend']) + tallest(['context', 'limits']), tree }
  }
  const roomy = await rowsOf(40)
  expect(fact(roomy.tree, 'model window')).toBe('200k')
  const tight = await rowsOf(18)
  expect(tight.total).toBeLessThanOrEqual(18)
  expect(fact(tight.tree, 're-warm if cold')).toBeDefined() // the stake stays
  expect(fact(tight.tree, 'model window')).toBeUndefined() // the least goes first
})

test('desktop cards have a visible rounded border; terminal cards a fill only', async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  const desk = await mountBand($, 'desktop', 110)
  await desk.press({ key: 'more' })
  const d = cardOf(await desk.drawn(), 'cache')
  expect(d?.props?.borderStyle).toBe('round')
  expect(d?.props?.borderColor).toBe(DARK.cardBorder)
  expect(d?.props?.backgroundColor).toBe(DARK.cardBg)
  await desk.unmount()
  const term = await mountBand($, 'terminal', 110)
  const t = cardOf(await term.drawn(), 'cache')
  expect(t?.props?.borderStyle).toBeUndefined()
  expect(t?.props?.backgroundColor).toBe(DARK.cardBg)
  await term.unmount()
})

test('the desktop gets no whitespace-only strings, which it drops, so every gap is a spacer', async ($, on) => {
  setup(on, { usage: withCompaction(100_000) })
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_155K)
  await measureContext($, 100_000)
  const ui = await mountBand($, 'desktop', 160)
  await ui.press({ key: 'more' })
  const bare: string[] = []
  walk(await ui.drawn(), n => {
    for (const k of n.children ?? []) if (typeof k === 'string' && k.trim() === '') bare.push(`${n.type}:${String(n.props?.key)}`)
  })
  expect(bare).toEqual([])
  // and the icons and bars still have air beside them
  const five = pillOf(await ui.drawn(), '5h')
  expect(((five?.children ?? []) as Node[]).filter(k => k?.type === 'Box' && k.props?.width === 1).length).toBeGreaterThanOrEqual(2)
  await ui.unmount()
})

test('card lines have a row of air between them, and the buttons a row above', async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await mountBand($, surface, 95)
    if (surface === 'desktop') await ui.press({ key: 'more' })
    const tree = await ui.drawn()
    const grid = byKey(tree, 'cards', 'Box')
    const actions = byKey(tree, 'actions', 'Box')
    expect(grid?.props?.rowGap).toBe(1)
    expect(actions?.props?.marginTop).toBe(1)
    await ui.unmount()
  }
})

test('each desktop card title, and the hint, leads with an icon; terminal titles stay text', async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  const ui = await mountBand($, 'desktop', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  const headOf = (name: string) => ((cardOf(tree, name)?.children ?? []) as Node[]).find(k => k?.props?.key === 'head')
  const expected: Record<string, string> = { cache: 'cache', spend: 'cost', context: 'context', limits: 'limits' }
  for (const [name, alt] of Object.entries(expected)) {
    expect(svgsOf(headOf(name)).map(n => n.props?.alt)).toEqual([alt])
  }
  const actions = byKey(tree, 'actions', 'Box')
  expect(svgsOf(actions).map(n => n.props?.alt)).toEqual(['info'])
  await ui.unmount()

  const term = await mountBand($, 'terminal', 110)
  expect(shown(cardOf(await term.drawn(), 'cache'))).toMatch(/^CACHE/)
  await term.unmount()
})

test('a card short of rows gives up its bar before a fact, since the chips already show it', async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_155K)
  const contextAt = async (maxRows: number) => {
    const ui = await mountBand($, 'desktop', 95, { maxRows })
    const open = byKey(await ui.drawn(), 'cards', 'Box') !== undefined
    if (!open) await ui.press({ key: 'more' })
    const tree = await ui.drawn()
    await ui.unmount()
    return tree
  }
  // 13 rows, as the desktop gives: one body row a card
  const short = await contextAt(13)
  expect(svgsOf(cardOf(short, 'context')).filter(n => /used/.test(String(n.props?.alt)))).toHaveLength(0)
  expect(fact(short, 'in context')).toBe('76k')
  expect(svgsOf(cardOf(short, 'spend')).filter(n => /token split/.test(String(n.props?.alt)))).toHaveLength(0)
  // with rows to spare the bar is back, above the facts
  const tall = await contextAt(40)
  expect(svgsOf(cardOf(tall, 'context')).filter(n => /used/.test(String(n.props?.alt)))).toHaveLength(1)
})

test("the cache card's bar reads as the time left, as its battery does", async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_155K)
  const ui = await mountBand($, 'desktop', 95)
  await ui.press({ key: 'more' })
  const alts = svgsOf(cardOf(await ui.drawn(), 'cache')).map(n => String(n.props?.alt))
  expect(alts).toContain('cache 100% left')
  expect(alts.some(alt => /used/.test(alt))).toBe(false)
  await ui.unmount()
})

test("a card's bar stretches across the card", async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await respond($, BUILD_155K)
  const ui = await mountBand($, 'desktop', 95)
  await ui.press({ key: 'more' })
  // no fixed width: the slot caps the drawing, so it spans whatever the card gets
  const bar = svgsOf(cardOf(await ui.drawn(), 'cache')).find(n => /left/.test(String(n.props?.alt)))
  expect(bar?.props?.width).toBeUndefined()
  expect(String(bar?.props?.source)).toContain('preserveAspectRatio="none"')
  await ui.unmount()

  // still expanded: the open view is the session's, not the mount's
  const term = await mountBand($, 'terminal', 120)
  const meter = shown(cardOf(await term.drawn(), 'cache')).match(/[█░┃]+/)?.[0] ?? ''
  expect(meter.length).toBeGreaterThan(12)
  await term.unmount()
})

test('the token split shows cache reads in the warm colour, so the bar never looks empty', async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await respond($, resp(1_000, 0, 10_000, 200))
  await respond($, resp(500, 900_000, 1_000, 200)) // nearly all from cache
  const ui = await mountBand($, 'desktop', 95)
  await ui.press({ key: 'more' })
  const split = svgsOf(cardOf(await ui.drawn(), 'spend')).find(n => /token split/.test(String(n.props?.alt)))
  expect(String(split?.props?.source)).toContain(DARK.warm)
  expect(String(split?.props?.source)).not.toContain(`fill="${DARK.meterTrack}"`)
  await ui.unmount()
})

test('Limits ends on that its reading is as of the last reply, and drops it first when the card is short of rows', () => {
  const open = (maxRows: number, columns = 120) => bandOf({ layout: 'chips', surface: 'terminal', columns, maxRows, expanded: true, ...CALM_LIMITS, limitsAt: -12 * MIN })
  const rows = (maxRows: number, columns?: number) => shown(cardOf(open(maxRows, columns), 'limits') as Node)
  expect(rows(40)).toMatch(/as of your last reply, 12m ago$/)
  // At 40 columns the line is cut to the card, never past it.
  expect(rows(40, 40)).toContain('as of your last reply')
  // Short of rows, its facts stay and it goes.
  for (let maxRows = 4; maxRows <= 40; maxRows++) {
    const text = rows(maxRows)
    if (text !== '' && !/as of your last reply/.test(text)) expect(text).toMatch(/resets|\d%/)
  }
})
