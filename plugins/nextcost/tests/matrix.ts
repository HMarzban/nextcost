// The checks every layout is held to, over the cases in cases.ts: the
// snapshot builder for pure tests and the parts they share, the invariant
// checks and the suite every layout runs. It passes cases.ts on, so a test
// imports both from here.

import type { RenderChildren } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'
import { DEFAULT_MAX_ROWS, HOUR, LONG, MIN, USAGE, fakeEl, firstRow, runCommand, shown, walk, wordsOf, type Node } from './helpers'
import { drawBand, layoutAt } from '../hooks/band'
import type { CacheView, Ttl } from '../hooks/cache'
import { makeKit, type Kit } from '../hooks/kit'
import { DESKTOP, ROW_SLACK, TERMINAL, cellsOf, isDrawn } from '../hooks/layout'
import { DARK } from '../hooks/palette'
import { snapshotOf } from '../hooks/snapshot'
import type { BandActions, BandSnapshot, Glyphs, LayoutName, LimitUse, SnapshotParts } from '../hooks/snapshot'
import { VIEWS } from '../hooks/views/index'
import { SPLIT_LABELS } from '../hooks/words'
import { rowsOf } from '../hooks/views/view'
import type { Workspace } from '../hooks/workspace'
import { SCENARIOS, SCENARIO_NAMES, caseKey, drawCases, drawMounts, type AmberReason, type Appearance, type CaseOptions, type Mount, type Scenario, type ScenarioName, type Surface } from './cases'

export * from './cases'

/** The band-layouts spec §7's all-amber: no scenario raises every reason at once, so the
 *  last minute stands for it. */
const ALL_AMBER = 'lastMinute' satisfies ScenarioName

/** A conversation with no message yet. */
export const NO_HISTORY: BandSnapshot['history'] = { costs: [], context: [] }

/** What a pure test's snapshot is built from: a calm session at 120
 *  columns, 52 minutes of cache left, 38% context with compaction at 190k,
 *  5h at 4% and 7d at 30%. */
export const SNAP_PARTS: SnapshotParts = {
  usage: USAGE,
  now: 0,
  mount: { surface: 'terminal', columns: 120, maxRows: 13, isWorking: false },
  expanded: false,
  band: { palette: DARK, layout: 'chips', glyphs: 'unicode', samples: [], workspace: undefined, compactAt: 190_000, autoCompactOff: false },
  cache: {
    requests: 1, leftMs: 52 * MIN, coldAt: null, ttl: '1h', ttlPinned: true, window: 155_000, hitRatio: 0.96, misses: 0, reWarmUsd: 1.66,
    savedUsd: 11.4, readShare: 0.05, fresh: true, compacted: false, idleCompacts: false, recalled: false, idleMs: null, recovered: false, tokens: { sent: 18_000, back: 9_000, cached: 198_000 },
    wake: undefined, notCaching: false, modelChanged: false, compactedIdle: false,
  },
  costUsd: 3.19,
  history: NO_HISTORY,
  etaMs: null,
  zone: undefined,
}

/** A snapshot for pure tests, built from SNAP_PARTS as register.tsx builds
 *  one; `over` replaces whole fields. */
export const snapOf = (over: Partial<BandSnapshot> = {}): BandSnapshot => ({ ...snapshotOf(SNAP_PARTS), ...over })

/** Actions for a draw outside a mount: one function each, so props compare equal. */
export const NO_ACT: BandActions = { toggleExpanded: async () => undefined, hide: async () => undefined }

/** The drawing kit outside a mount, from snapOf's snapshot with `over`. */
export const kitOf = (over: Partial<BandSnapshot> = {}): Kit => makeKit(fakeEl, snapOf(over))

/** The band drawn outside a mount, from snapOf's snapshot with `over`. */
export const bandOf = (over: Partial<BandSnapshot> = {}): Node => drawBand(fakeEl, snapOf(over), NO_ACT) as unknown as Node

// ── the pure tests' shared parts of a snapshot ─────────────────────────

/** SNAP_PARTS' cache with `over`. */
export const cacheWith = (over: Partial<CacheView>): CacheView => ({ ...SNAP_PARTS.cache, ...over })
/** A cache gone cold. */
export const COLD_CACHE = cacheWith({ leftMs: 0 })
/** The 5-minute cache in its last minute, 30 s left: amber. */
export const LAST_MINUTE_CACHE = cacheWith({ leftMs: 30_000, ttl: '5m' })

/** 180k of a 200k window with compaction at 190k: 95% of the way, ~10k left, amber. */
export const NEAR_COMPACTION: BandSnapshot['context'] = { tokens: 180_000, window: 200_000, percent: 90, compactAt: 190_000, autoCompactOff: false }

/** A window `pct` used, resetting `h` hours after `now`. */
export const limitAt = (pct: number, h: number, now = 0): LimitUse => ({ percentUsed: pct, resetsAt: now + h * HOUR })
/** Calm windows: the 5h at 26%, its reset in 3h and no fill in sight; the 7d at 41%, its reset in 67h. */
export const CALM_LIMITS = { fiveHour: { ...limitAt(26, 3), etaMs: null }, sevenDay: limitAt(41, 67) } as const satisfies Partial<BandSnapshot>
/** The same, but the 7d amber at 85%, as the three-layouts spec §3's scenario has it. */
export const AMBER_WEEK_LIMITS = { ...CALM_LIMITS, sevenDay: limitAt(85, 67) } as const satisfies Partial<BandSnapshot>
/** Two other windows, a gateway's spend at 40% and its credit at 20%, resetting
 *  5h and 9h after `now`: the three-layouts spec §5.3's count at 13 rows has two. */
export const otherLimits = (now = 0): BandSnapshot['otherLimits'] => [
  { kind: 'spend_limit', ...limitAt(40, 5, now) },
  { kind: 'credit_limit', ...limitAt(20, 9, now) },
]

/** Twenty-four messages, $0.20 each but a $0.84 re-warm seven from the end
 *  and a last of $0.21; the context at three turns. */
export const HISTORY: BandSnapshot['history'] = {
  costs: Array.from({ length: 24 }, (_, i) => ({ usd: i === 23 ? 0.21 : i === 17 ? 0.84 : 0.2, reWarm: i === 17 })),
  context: [40_000, 60_000, 76_000],
}

/** A project on main with nothing changed and no upstream. */
export const WORKSPACE: Workspace = {
  path: '/u/nextcost',
  repoName: undefined,
  git: { branch: 'main', commit: undefined, worktree: undefined, changed: 0, ahead: undefined, behind: undefined },
}

/** Every live layout's words for each amber trigger, and no others. An other
 *  limit, open only, is chips' LIMITS card's headline, marked as chips marks
 *  it: `spend 92%!`.
 *  Departures' board says each in its capitals, its item then its cell:
 *  `\W*` between them, since a terminal's flaps set their runs a gap apart,
 *  which the text does not hold, and plain brackets each run. */
const AMBER_WORDS: Readonly<Record<AmberReason, RegExp>> = {
  // Chips' and pulse's mark leads the reading's words: `! 30s left`, `! ctx 94%`.
  cacheLastMinute: /! \d+s( left)?|CACHE\W*(LAST CALL \d+S|! \d+S)/,
  nearCompaction: /! context\W*\d+%|! ctx\W*\d+%|CONTEXT\W*! (COMPACTS IN ~\d+K|\d+%)/,
  contextNoCompaction: /! context\W*\d+%|! ctx\W*\d+%|CONTEXT\W*! \d+%/,
  // The board's short form keeps the mark and the value: `5H ! 82%`. The
  // span after 5h's value stops at 7D's group, so 7D's amber is never 5h's.
  limit80: /! 5h|5H\W*\d+%(?:(?!7D)[^!])*! (NEAR LIMIT|FULL ~\d\d:\d\d|FULL IN ~)|5H\W*! \d+%/,
  fiveHourAhead: /! 5h|5H\W*\d+%(?:(?!7D)[^!])*! FULL (~\d\d:\d\d|IN ~)|5H\W*! \d+%/,
  // The board's row for it, open only: its name, then its status.
  otherLimit80: /! spend \d+%|spend \d+%!|SPEND LIMIT\W*! (NEAR LIMIT|\d+%)/,
}
/** Amber the collapsed part never shows: other limits are drawn only open (the band-layouts spec §2.7). */
const OPEN_ONLY: ReadonlySet<AmberReason> = new Set(['otherLimit80'])

/** A row's height on the desktop. */
const ROW_PX = 24

/** Height in lines (terminal) or px (desktop): a Text or Button is a row, an
 *  Svg its height (none on the terminal), a column sums with its gaps, a row
 *  takes its tallest; a top margin adds its rows. */
const heightOf = (n: unknown, px: boolean): number => {
  const unit = px ? ROW_PX : 1
  if (typeof n === 'string' || typeof n === 'number') return unit
  if (n === null || typeof n !== 'object') return 0
  const node = n as Node
  if (node.props?.position === 'absolute' || node.props?.display === 'none') return 0
  const margin = (typeof node.props?.marginTop === 'number' ? node.props.marginTop : 0) * unit
  if (node.type === 'Svg') return px ? Number(node.props?.height ?? ROW_PX) + margin : 0
  if (node.type === 'Text' || node.type === 'Button') return unit + margin
  const kids = (node.children ?? []).filter(isDrawn)
  if (kids.length === 0) return margin
  const sizes = kids.map(k => heightOf(k, px))
  if (node.props?.flexDirection !== 'column') return Math.max(...sizes) + margin
  const gap = (typeof node.props?.rowGap === 'number' ? node.props.rowGap : 0) * (kids.length - 1) * unit
  return sizes.reduce((a, b) => a + b, 0) + gap + margin
}
/** Rows a drawn tree takes: lines on the terminal; on the desktop its height
 *  over ROW_PX, to the nearest row. */
export const visualRows = (tree: unknown, surface: Surface): number =>
  surface === 'desktop' ? Math.round(heightOf(tree, true) / ROW_PX) : heightOf(tree, false)

/** The most nodes a band may draw, shut and open (the band-layouts spec §9). */
export const NODE_BUDGET = { shut: 400, open: 1500 } as const

export type InvariantContext = Readonly<{
  layout: LayoutName
  surface: Surface
  appearance: Appearance
  cols: number
  maxRows: number
  scenario: ScenarioName
  glyphs: Glyphs
  expanded: boolean
}>

/** A colour prop, at the top of a node's props or inside its `hover`. */
const COLOUR_PROPS: ReadonlySet<string> = new Set(['color', 'backgroundColor', 'borderColor'])
/** A paint in an Svg's source, as an attribute or a style: a hex, an `rgb()` or a name. */
const SVG_PAINT = /\b(?:fill|stroke|stop-color|color)\s*[=:]\s*["']?\s*(#[0-9a-f]{3,8}|rgb\([^)]*\)|[a-z]+)/gi
/** The red names: the theme's error key and Ink's red keywords. */
const RED_NAME = /^(error|red|redBright)$/i
/** A hex colour, `fff` to `ffffff80`. */
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i

/** Whether a colour's hue lies within 15° of pure red at more than half
 *  saturation. Amber sits near 40°. */
const isRed = (r: number, g: number, b: number): boolean => {
  const max = Math.max(r, g, b)
  const chroma = max - Math.min(r, g, b)
  // With red the largest, the hue is 60° × (g − b) / chroma, either side of 0°.
  return max === r && chroma > max / 2 && Math.abs((60 * (g - b)) / chroma) <= 15
}
/** A colour's red, green and blue, when it is written in hex or `rgb()`. */
const channelsOf = (colour: string): readonly [number, number, number] | undefined => {
  const hex = colour.match(HEX)?.[1]
  if (hex !== undefined) {
    const pairs = hex.length <= 4 ? [...hex.slice(0, 3)].map(c => c + c) : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
    const [r = 0, g = 0, b = 0] = pairs.map(pair => parseInt(pair, 16))
    return [r, g, b]
  }
  const rgb = colour.match(RGB)
  return rgb === null ? undefined : [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
}
/** Whether a colour is red: a red name, or a hex or `rgb()` of a red hue. */
const isRedColour = (colour: string): boolean => {
  const channels = channelsOf(colour)
  return RED_NAME.test(colour) || (channels !== undefined && isRed(...channels))
}
/** The colour props' values, at the top and one level into an object-valued
 *  prop such as `hover`. */
const colourProps = (props: Readonly<Record<string, unknown>>, nested = true): string[] =>
  Object.entries(props).flatMap(([key, value]) => {
    if (typeof value === 'string') return COLOUR_PROPS.has(key) ? [value] : []
    return nested && typeof value === 'object' && value !== null ? colourProps(value as Record<string, unknown>, false) : []
  })
/** Every colour a node paints: its colour props, and an Svg's paints. */
const coloursOf = (n: Node): string[] => {
  const source = n.type === 'Svg' && typeof n.props?.source === 'string' ? n.props.source : ''
  return [...colourProps(n.props ?? {}), ...[...source.matchAll(SVG_PAINT)].map(m => m[1] ?? '')]
}

/** What each glyph tier may draw (the band-layouts spec §3.2): the unicode tier's glyphs, rings' quarters and braille, or ASCII alone. */
const UNICODE_TIER = /^[\x20-\x7e▁▂▃▄▅▆▇█▓░▒│╌╸▏·›↻Σ◷○◔◑◕▿▵…±●■–↑↓\u2800-\u28ff]*$/
/** Printable ascii alone: what the ascii tier draws. */
export const ASCII_TIER = /^[\x20-\x7e]*$/
/** What a value missing from a phrase leaves drawn (the band-layouts spec §2.8), in any case. */
const NOTHING = /\b(NaN|undefined|null)\b/i
/** What the band-layouts spec §2.9 bars from any Svg's markup: an id, a gradient, a pattern, a clipPath. */
const SVG_BARRED = /<(linearGradient|radialGradient|pattern|clipPath)\b|\bid=/
/** An alt that misstates its reading (the band-layouts spec §2.13): a share said as used or
 *  left, or a landing without its figure. */
const MISSTATED = new RegExp(`\\b(hit rate|${SPLIT_LABELS.join('|')}) \\d+% (used|left)|(?<!\\d percent) at its reset`)
/** A price or a fill time drawn without its `~` (the band-layouts spec §2.4). */
const UNMARKED = /re-warm \$|next message \$|full (in |at )?\d|on pace for \d/i

/** Whether a Text leaves its cut to the surface, which ends it with `…`:
 *  East-Asian-Ambiguous, so the ascii tier never may (the band-layouts spec §3.2). */
export const cutBySurface = (n: Node): boolean => n.type === 'Text' && typeof n.props?.wrap === 'string' && n.props.wrap !== 'wrap'

/** The rows chips' open view of its cards takes at its floor, which a
 *  band shorter than that scrolls: the rows its view declares, then what it
 *  opens with each card cut to its head and one body row, and the footer to
 *  its one row. Undefined without the cards. */
const cardsFloor = (tree: Node, declared: number, surface: Surface): number | undefined => {
  let cards = 0
  const atFloor = (n: unknown): unknown => {
    if (n === null || typeof n !== 'object') return n
    const node = n as Node
    const key = node.props?.key
    if (key === 'actions') return { type: 'Text', props: { marginTop: node.props?.marginTop }, children: [] }
    if (typeof key === 'string' && key.startsWith('card:')) {
      cards++
      return { ...node, children: (node.children ?? []).filter(isDrawn).slice(0, 2) }
    }
    return { ...node, children: node.children?.map(atFloor) }
  }
  const opened = { type: 'Box', props: { flexDirection: 'column' }, children: (tree.children ?? []).slice(1).map(atFloor) }
  return cards === 0 ? undefined : declared + visualRows(opened, surface)
}

/** The readings' one order on the collapsed row (the three-layouts spec §2.1). */
const ONE_ORDER = ['cache', 'spend', 'context', '5h', '7d'] as const

/** The one order's errors on a collapsed row: its readings' Box keys, in
 *  document order, must be a subsequence of ONE_ORDER; the cache is always
 *  there, and the 7d whenever it is reported. */
export const orderErrors = (row: unknown, o: Readonly<{ has7d: boolean }>): string[] => {
  const keys: string[] = []
  walk(row, n => {
    const key = n.props?.key
    if (n.type === 'Box' && typeof key === 'string' && (ONE_ORDER as readonly string[]).includes(key)) keys.push(key)
  })
  const errors: string[] = []
  for (let i = 1; i < keys.length; i++) {
    const [a, b] = [keys[i - 1] ?? '', keys[i] ?? '']
    if (ONE_ORDER.indexOf(a as (typeof ONE_ORDER)[number]) >= ONE_ORDER.indexOf(b as (typeof ONE_ORDER)[number])) errors.push(`order: ${a} before ${b}`)
  }
  if (!keys.includes('cache')) errors.push('order: no cache')
  if (o.has7d && !keys.includes('7d')) errors.push('order: no 7d')
  return errors
}

/** What a flap's alt never says: the board's capitals, or `↻`. */
const BOARD_SAID = /↻|\b[A-Z]{2,}\b/
/** Scenarios whose drive measures limits of its own, without a 7d. */
const DRIVEN_WITHOUT_SEVEN_DAY: ReadonlySet<ScenarioName> = new Set(['fiveHourAhead'])
/** Whether a scenario reports a 7d window, which the collapsed row then always shows. */
const hasSevenDay = (scenario: ScenarioName): boolean => {
  const s: Scenario = SCENARIOS[scenario]
  return !DRIVEN_WITHOUT_SEVEN_DAY.has(scenario) && (s.usage ?? USAGE).rateLimits.some(l => l.kind === 'seven_day')
}

/** Each failed check as `<check>: <why>`; none when the tree keeps the
 *  band-layouts spec's §2 contract: the checks its §7 lists, §9's node budget
 *  and §2.6's open height. */
export const invariantErrors = (tree: Node, ctx: InvariantContext): string[] => {
  const errors: string[] = []
  const fail = (check: string, why: string): void => {
    errors.push(`${check}: ${why}`)
  }
  const collapsed = firstRow(tree)
  const svgDraws = ctx.surface === 'desktop' && ctx.appearance !== 'plain'
  const ascii = ctx.glyphs === 'ascii' && ctx.surface === 'terminal'
  const amber: readonly AmberReason[] = SCENARIOS[ctx.scenario].amber

  const declared = rowsOf(VIEWS[ctx.layout], { Svg: svgDraws })
  const rows = visualRows(collapsed, ctx.surface)
  if (rows !== declared) fail('rows', `${rows} drawn, ${declared} declared`)

  const mark = ctx.expanded ? (ascii ? 'v' : '▿') : ascii ? '^' : '▵'
  let toggles = 0
  walk(collapsed, n => {
    if (n.type === 'Button' && n.props?.label === mark) toggles++
  })
  if (toggles !== 1) fail('toggle', `${toggles} ${mark} in the collapsed part`)
  // Pulse and departures pin ▵ at the row's end, where a clipped row still shows it.
  if (ctx.layout !== 'chips') {
    let last: Node | undefined
    walk(collapsed, n => {
      if (n.type === 'Text' || n.type === 'Button' || n.type === 'Svg') last = n
    })
    if (last?.type !== 'Button' || last.props?.label !== mark) fail('toggle', `${mark} is not the row's last piece`)
  }

  // Below 60 columns chips' all-amber row, which lastMinute stands for, may
  // not fit: calm pieces go first, then amber turns short, and past that the
  // row clips, ▵ pinned at its end (the band-layouts spec's §2.6). Pulse and
  // departures never clip: once their calm pieces have gone and amber is
  // short, the row fits, ▵ in view (departures draws chips below its 60
  // columns). On the terminal it fits the row less its slack, as each line
  // is squeezed to; the desktop's estimate keeps the row's width.
  const clipsByDesign = ctx.cols < 60 && ctx.layout === 'chips' && ctx.scenario === ALL_AMBER
  const width = cellsOf(collapsed as RenderChildren, ctx.surface === 'desktop' ? DESKTOP : TERMINAL)
  const room = ctx.surface === 'terminal' ? ctx.cols - ROW_SLACK : ctx.cols
  if (!clipsByDesign && width > room) fail('width', `${width} columns at ${ctx.cols}`)

  if (ctx.layout !== 'chips') for (const e of orderErrors(collapsed, { has7d: hasSevenDay(ctx.scenario) })) errors.push(e)

  let nodes = 0
  const svgs: Node[] = []
  walk(tree, n => {
    nodes++
    if (n.type === 'Svg') svgs.push(n)
    for (const colour of coloursOf(n)) if (isRedColour(colour)) fail('colour', `red ${colour}`)
    if (ctx.surface === 'desktop') {
      for (const k of n.children ?? [])
        if (typeof k === 'string' && /^\s+$/.test(k)) fail('whitespace', `a whitespace-only child of a ${n.type}`)
    }
  })
  if (!svgDraws && svgs.length > 0) fail('svgPlacement', `${svgs.length} Svg where none draws`)
  for (const s of svgs) {
    const alt = s.props?.alt
    // Chips' cards' bars stretch to their slot, which caps them: they alone have no width.
    const stretched = /preserveAspectRatio="none"/.test(typeof s.props?.source === 'string' ? s.props.source : '')
    if (typeof alt !== 'string' || alt === '' || (typeof s.props?.width !== 'number' && !stretched)) fail('svgProps', 'an Svg without an alt or a width')
    if (s.props?.id !== undefined || SVG_BARRED.test(typeof s.props?.source === 'string' ? s.props.source : ''))
      fail('svgProps', 'an Svg with an id, a gradient, a pattern or a clipPath')
    if (typeof alt === 'string' && NOTHING.test(alt)) fail('empty', `an alt reads "${alt}"`)
    if (typeof alt === 'string' && MISSTATED.test(alt)) fail('alt', `an alt reads "${alt}"`)
    // A flap's alt says its reading in words, never the board's capitals or ↻.
    if (ctx.layout === 'departures' && typeof alt === 'string' && BOARD_SAID.test(alt.replace(/5h|7d/g, ''))) fail('alt', `an alt reads "${alt}"`)
  }

  // A desktop board's words are its flaps' tiles, which no Text holds.
  const text = wordsOf(tree)
  if (/send|keep (it )?warm/i.test(text)) fail('wording', 'suggests sending a message')
  for (const reason of amber)
    if ((ctx.expanded || !OPEN_ONLY.has(reason)) && !AMBER_WORDS[reason].test(text)) fail('amber', `no words for ${reason}`)
  if (UNMARKED.test(text)) fail('estimate', 'an estimate without ~')
  // A landing of 100% or more says `full before reset` (the band-layouts spec §2.1).
  if (/~\d{3,}%/.test(text)) fail('projection', 'a landing of 100% or more')
  // No scenario holds an empty context, so 0% is only ever an unreported one.
  if (/\b(context|ctx) 0%/i.test(text)) fail('unknown', 'context 0% where it is unknown')
  if (NOTHING.test(text)) fail('empty', 'NaN, undefined or null drawn')
  // In the ascii tier a glyph-only Text, such as an icon's `↻ `, maps to nothing.
  if (!ascii) {
    walk(collapsed, n => {
      if (n.type === 'Text' && shown(n) === '') fail('empty', 'an empty Text in the collapsed part')
    })
  }
  if (!(ascii ? ASCII_TIER : UNICODE_TIER).test(text)) fail('glyphs', 'a glyph outside the tier')
  if (ascii)
    walk(tree, n => {
      if (cutBySurface(n)) fail('glyphs', 'a Text the surface would cut with …')
    })

  // Open, a body short of rows keeps a calm section's title, so an empty
  // state is never said without its section's name.
  const body = (tree.children ?? []).slice(1).map(shown).join('')
  if (ctx.expanded && /(?<!context\W*)not reported|(?<!limits\W*)none reported/i.test(body)) fail('emptyState', 'an empty state without its section\'s name')

  if (nodes > NODE_BUDGET[ctx.expanded ? 'open' : 'shut']) fail('size', `${nodes} nodes`)
  if (ctx.expanded) {
    const tall = visualRows(tree, ctx.surface)
    const most = Math.max(ctx.maxRows, cardsFloor(tree, declared, ctx.surface) ?? 0)
    if (tall > most) fail('height', `${tall} rows at maxRows ${ctx.maxRows}, ${most} at most`)
  }
  return errors
}

type SuiteCase = Readonly<{ name: string; options: CaseOptions; mounts: readonly Mount[] }>

const SUITE_WIDTHS = [40, 41, 50, 60, 67, 68, 80, 95, 120, 160, 200] as const
/** A mount on each surface, at the same width and height. */
const bothSurfaces = (cols: number, maxRows?: number): Mount[] => [{ surface: 'terminal', cols, maxRows }, { surface: 'desktop', cols, maxRows }]
/** The rows that leave an open view a body of `bodyRows`: its own rows, the
 *  air above the body and the buttons, the buttons, and the body, the strip
 *  in the footer. At two, each section title keeps a fact under it. */
const rowsForBody = (layout: LayoutName, surface: Surface, bodyRows: number): number => VIEWS[layout].rows[surface] + 3 + bodyRows
/** The long walks take the 5-minute cache, a twelfth of the hour's ticks. Golden keeps the hour. */
const LONG_WALKS: ReadonlySet<ScenarioName> = new Set(['lastMinute', 'cold', 'coldLimit80'])
export const ttlOf = (scenario: ScenarioName): Ttl => (LONG_WALKS.has(scenario) ? '5m' : '1h')

/** The suite's 101 cases, one setup each: every scenario at 120 columns,
 *  and at 40 and 50 in dark, light and plain, and either side of a
 *  layout's own fewest columns; calm and the last minute in
 *  light, plain and the ascii tier, and at every width; the other amber
 *  scenarios narrow; calm, the open-only amber and the empty states short
 *  of rows. */
export const suiteCases = (layout: LayoutName): SuiteCase[] => {
  const optionsOf = (scenario: ScenarioName, appearance: Appearance = 'dark', env?: Record<string, string>): CaseOptions =>
    ({ layout, scenario, appearance, ttl: ttlOf(scenario), env })
  return [
    ...SCENARIO_NAMES.map(scenario => ({ name: `${layout}: ${scenario}`, options: optionsOf(scenario), mounts: bothSurfaces(120) })),
    ...(['calm', ALL_AMBER] as const).flatMap(scenario => [
      { name: `${layout}: ${scenario}, light`, options: optionsOf(scenario, 'light'), mounts: bothSurfaces(120) },
      { name: `${layout}: ${scenario}, plain`, options: optionsOf(scenario, 'plain'), mounts: bothSurfaces(120) },
      { name: `${layout}: ${scenario}, ascii`, options: optionsOf(scenario, 'dark', { NEXTCOST_GLYPHS: 'ascii' }), mounts: bothSurfaces(120) },
      ...(['terminal', 'desktop'] as const).map(surface => ({
        name: `${layout}: ${scenario}, every width, ${surface}`,
        options: optionsOf(scenario),
        mounts: SUITE_WIDTHS.map(cols => ({ surface, cols })),
      })),
    ]),
    ...(['fiveHourAhead', 'limit80', 'nearCompaction', 'coldLimit80'] as const).map(scenario => ({
      name: `${layout}: ${scenario}, narrow`,
      options: optionsOf(scenario),
      mounts: [40, 50, 60].flatMap(cols => bothSurfaces(cols)),
    })),
    // Every scenario at its narrowest, in each appearance: once every calm
    // piece has gone and amber is short, the row fits its room, ▵ in view.
    // A layout with fewest columns of its own is drawn either side of them.
    ...(['dark', 'light', 'plain'] as const).flatMap(appearance => SCENARIO_NAMES.map(scenario => ({
      name: `${layout}: ${scenario}, narrow, ${appearance}`,
      options: optionsOf(scenario, appearance),
      mounts: [...new Set([40, 50, ...edgeOf(layout)])].flatMap(cols => bothSurfaces(cols)),
    }))),
    { name: `${layout}: calm, short of rows`, options: optionsOf('calm'), mounts: [4, 8, 13, 40].flatMap(maxRows => bothSurfaces(120, maxRows)) },
    // The open-only amber short of rows, on both grids, from a body of one
    // row, which has no room under its titles, and of two, which keeps a fact
    // under each.
    {
      name: `${layout}: gatewaySpend, short of rows`,
      options: optionsOf('gatewaySpend'),
      mounts: [80, 120].flatMap(cols => (['terminal', 'desktop'] as const).flatMap(surface =>
        [...new Set([rowsForBody(layout, surface, 1), rowsForBody(layout, surface, 2), 7, 8, 10])].map((maxRows): Mount => ({ surface, cols, maxRows })))),
    },
    // The empty states from a body of one row, where each title stays alone,
    // and of two, which says each under its title.
    {
      name: `${layout}: warming, short of rows`,
      options: optionsOf('warming'),
      mounts: (['terminal', 'desktop'] as const).flatMap(surface => [1, 2].map((bodyRows): Mount => ({ surface, cols: 120, maxRows: rowsForBody(layout, surface, bodyRows) }))),
    },
  ]
}

/** A layout's own fewest columns, and the width just under them. */
const edgeOf = (layout: LayoutName): number[] => {
  const least = VIEWS[layout].minColumns
  return least === undefined ? [] : [least - 1, least]
}

/** The mounts drawn again as chips, after `/nextcost layout chips`, each
 *  shut and open as drawCases draws them; then the layout chosen again. */
const drawnAsChips = async ($: Engine, layout: LayoutName, mounts: readonly Mount[], isWorking?: boolean): Promise<Readonly<Record<string, Node>>> => {
  await runCommand($, 'layout chips')
  const trees = await drawMounts($, mounts, isWorking)
  await runCommand($, `layout ${layout}`)
  return trees
}

/** Whether two drawn trees are the same, each press's handle aside: every
 *  mount hands its Buttons new ones. */
const drawnAlike = (a: unknown, b: unknown): boolean => {
  const bare = (n: unknown) => JSON.stringify(n, (k, v: unknown) => (k === 'handle' ? undefined : v))
  return bare(a) === bare(b)
}

/** Registers one LONG test per case: one drawCases call, every tree checked
 *  shut and open, each failure named by its mount. Where the layout draws
 *  chips (layoutAt), the tree must be chips' own on that mount. */
export const viewSuite = (layout: LayoutName): void => {
  for (const c of suiteCases(layout)) {
    test(c.name, LONG, async ($, on) => {
      const trees = await drawCases($, on, c.options, c.mounts)
      const asChips = c.mounts.filter(m => layoutAt(layout, m.cols) !== layout)
      const chips = asChips.length === 0 ? {} : await drawnAsChips($, layout, asChips, (SCENARIOS[c.options.scenario] as Scenario).isWorking)
      const glyphs: Glyphs = c.options.env?.NEXTCOST_GLYPHS === 'ascii' ? 'ascii' : 'unicode'
      for (const m of c.mounts) {
        for (const state of ['shut', 'open'] as const) {
          const key = caseKey(m, state)
          const tree = trees[key]
          const chipsTree = chips[key]
          if (chipsTree !== undefined) {
            expect(`${key} ${drawnAlike(tree, chipsTree) ? 'chips' : 'not chips'}`).toBe(`${key} chips`)
            continue
          }
          const errors = tree === undefined
            ? ['missing: not drawn']
            : invariantErrors(tree, {
                layout, surface: m.surface, appearance: c.options.appearance, cols: m.cols, maxRows: m.maxRows ?? DEFAULT_MAX_ROWS,
                scenario: c.options.scenario, glyphs, expanded: state === 'open',
              })
          expect(`${key} ${errors.join('; ')}`).toBe(`${key} `)
        }
      }
    })
  }
}
