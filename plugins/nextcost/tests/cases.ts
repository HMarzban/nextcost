// The states every layout is drawn in, and the one way to draw them: one
// setup and one drive per test, then each mount drawn shut and open. Chips'
// frozen trees were drawn from these, so a case golden holds keeps its drive.

import type { On, SessionUsage } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { TTL_MS } from '../hooks/cache'
import type { Ttl } from '../hooks/prices'
import {
  BUILD_155K,
  DEFAULT_MAX_ROWS,
  FRESH,
  HOME,
  HOUR,
  HOUR_1,
  MIN,
  SPEND_LIMIT,
  START,
  SUMMARY,
  USAGE,
  breakdown,
  engine,
  mountBand,
  pacing,
  resp,
  respond,
  setup,
  turn,
  usageAt,
  type Node,
} from './helpers'

export type Appearance = 'dark' | 'light' | 'plain'
export type Surface = 'terminal' | 'desktop'
export type AmberReason = 'cacheLastMinute' | 'nearCompaction' | 'contextNoCompaction' | 'limit80' | 'fiveHourAhead' | 'otherLimit80'

export type Scenario = Readonly<{
  usage?: SessionUsage
  store?: Record<string, unknown>
  env?: Record<string, string>
  now?: number
  /** Changes to the fake engine before the session starts. */
  prepare?: () => void
  /** Drives the session into its state. `ttlMs` is the cache's lifetime, so a
   *  walk to the last minute or past it holds under either TTL. */
  drive: ($: Engine, clock: MockClock, ttlMs: number) => Promise<void>
  isWorking?: boolean
  amber: readonly AmberReason[]
}>

const started = async ($: Engine): Promise<void> => { await $.session.start(START) }
const replied = async ($: Engine): Promise<void> => {
  await started($)
  await respond($, BUILD_155K)
}
export const withLimits = (five: number, seven: number, fiveResetH = 3, sevenResetH = 67): SessionUsage['rateLimits'] => [
  { kind: 'five_hour', percentUsed: five, resetsAt: new Date(fiveResetH * HOUR).toISOString() },
  { kind: 'seven_day', percentUsed: seven, resetsAt: new Date(sevenResetH * HOUR).toISOString() },
]
/** The context at `tokens`, with auto-compaction at `compactAt`, or off. */
const contextAt = (tokens: number, compactAt: number | undefined): SessionUsage['context'] => ({
  tokens,
  window: 200_000,
  percent: tokens / 2000,
  breakdown: breakdown(compactAt === undefined ? { isAutoCompactEnabled: false } : { autoCompactThreshold: compactAt, isAutoCompactEnabled: true }),
})
/** A reply, then a measure: the band reads the compaction breakdown there. */
const measured = (context: SessionUsage['context']) => async ($: Engine): Promise<void> => {
  await replied($)
  await $.session.measure({ context, rateLimits: USAGE.rateLimits, cost: USAGE.cost, changed: ['context'] })
}
/** A reply, then the cache's lifetime and a minute more: cold. */
const cooled = async ($: Engine, clock: MockClock, ttlMs: number): Promise<void> => {
  await replied($)
  await clock.advance(ttlMs + MIN)
}
const NEAR = contextAt(150_000, 160_000)
const OFF = contextAt(170_000, undefined)
/** A conversation past idle compaction's 200k threshold, on a 1M window. */
const LONG_TALK: SessionUsage = { ...USAGE, context: { tokens: 250_000, window: 1_000_000, percent: 25 } }

export const SCENARIOS = {
  calm: { drive: replied, amber: [] },
  unmeasured: { drive: started, amber: [] },
  warming: { usage: FRESH, drive: started, amber: [] },
  // Its last reply 20 minutes ago, as the band remembered it; HOME lets it
  // look for the transcript's cost record too.
  recalled: { store: { sessions: { s1: { lastAt: 0 } } }, now: 20 * MIN, env: HOME, drive: started, amber: [] },
  cold: { drive: cooled, amber: [] },
  lastMinute: { drive: async ($, clock, ttlMs) => { await replied($); await clock.advance(ttlMs - 30_000) }, amber: ['cacheLastMinute'] },
  working: { drive: replied, isWorking: true, amber: [] },
  nearCompaction: { usage: { ...USAGE, context: NEAR }, drive: measured(NEAR), amber: ['nearCompaction'] },
  compactionOff: { usage: { ...USAGE, context: OFF }, drive: measured(OFF), amber: ['contextNoCompaction'] },
  limit80: { usage: { ...USAGE, rateLimits: withLimits(82, 30) }, drive: replied, amber: ['limit80'] },
  fiveHourAhead: { drive: async ($, clock) => { await pacing($, clock) }, amber: ['fiveHourAhead'] },
  sevenFullBeforeReset: { usage: { ...USAGE, rateLimits: withLimits(4, 79, 3, 50) }, drive: replied, amber: [] },
  noLimits: { usage: { ...USAGE, rateLimits: [] }, drive: replied, amber: [] },
  gatewaySpend: {
    usage: { ...USAGE, rateLimits: [...withLimits(4, 30), SPEND_LIMIT] },
    drive: replied,
    amber: ['otherLimit80'],
  },
  resetPassed: { now: 4 * HOUR, drive: replied, amber: [] },
  // A git read that never answers: the strip stays empty, as before the first read.
  noWorkspace: { prepare: () => { engine.hold = new Promise(() => undefined) }, drive: replied, amber: [] },
  notARepo: { prepare: () => { engine.git = 'none' }, drive: replied, amber: [] },
  gitFails: { prepare: () => { engine.git = 'fail' }, drive: replied, amber: [] },
  emptyHistory: { usage: FRESH, drive: started, amber: [] },
  fullHistory: {
    drive: async $ => {
      await replied($)
      // As the real ledger moves: each turn's bill lands in its step.
      for (let i = 1; i <= 30; i++) await turn($, `t${i}`, 2.41 + (i - 1) * 0.2, 2.41 + i * 0.2, { usage: resp(200, 155_000, 1_000, 500) })
    },
    amber: [],
  },
  // Golden's capture predates this one: a cold cache's calm price beside an amber limit.
  coldLimit80: { usage: { ...USAGE, rateLimits: withLimits(82, 30) }, drive: cooled, amber: ['limit80'] },
  // Idle on the hour's cache with a long conversation: Claude Code may compact it at ~54m.
  idleCompactSoon: { usage: LONG_TALK, drive: async ($, clock) => { await replied($); await clock.advance(10 * MIN) }, amber: [] },
  // Compacted while idle: the cache is given up, and the next message writes the summary.
  compactedIdle: {
    usage: LONG_TALK,
    drive: async ($, clock) => {
      await replied($)
      await clock.advance(54 * MIN)
      await $.session.compact({ trigger: 'auto', messages: SUMMARY })
    },
    amber: [],
  },
} as const satisfies Record<string, Scenario>

export type ScenarioName = keyof typeof SCENARIOS
export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[]

export type Mount = Readonly<{ surface: Surface; cols: number; maxRows?: number }>
type State = 'shut' | 'open'
export type CaseOptions = Readonly<{
  scenario: ScenarioName
  appearance: Appearance
  env?: Record<string, string>
  /** A layout to store before the session starts; none, as a new user. */
  layout?: string
  /** The cache's lifetime: 5m walks a twelfth of the clock 1h does. */
  ttl?: Ttl
  /** How far on the scenario starts, its clock and windows moved together:
   *  MODERN, for a case that reads the host's clock. */
  now?: number
  /** The usage to start from, in place of the scenario's: a case's own limits. */
  usage?: SessionUsage
}>

/** Where a drawn case was mounted, and whether it was open. */
export const caseKey = (m: Mount, state: State): string => `${m.surface}|${m.cols}|${m.maxRows ?? DEFAULT_MAX_ROWS}|${state}`

/** Each mount drawn, always in this order: shut, then ▵ pressed and open,
 *  then ▿ pressed and the mount let go. */
export const drawMounts = async ($: Engine, mounts: readonly Mount[], isWorking?: boolean): Promise<Readonly<Record<string, Node>>> => {
  const trees: Record<string, Node> = {}
  for (const m of mounts) {
    const ui = await mountBand($, m.surface, m.cols, { maxRows: m.maxRows, isWorking })
    trees[caseKey(m, 'shut')] = (await ui.drawn()) as Node
    await ui.press({ key: 'more' })
    trees[caseKey(m, 'open')] = (await ui.drawn()) as Node
    await ui.press({ key: 'more' })
    await ui.unmount()
  }
  return trees
}

/** One setup and one drive, then each mount drawn shut and open. */
export const drawCases = async ($: Engine, on: On, o: CaseOptions, mounts: readonly Mount[]): Promise<Readonly<Record<string, Node>>> => {
  const s: Scenario = SCENARIOS[o.scenario]
  const ttl = o.ttl ?? '1h'
  const env = {
    ...HOUR_1,
    ...(o.appearance === 'dark' ? {} : { NEXTCOST_APPEARANCE: o.appearance }),
    // Forcing 5m wins over HOUR_1 (resolveTtl reads it first).
    ...(ttl === '5m' ? { FORCE_PROMPT_CACHING_5M: '1' } : {}),
    ...s.env,
    ...o.env,
  }
  const store = { ...(s.store ?? {}), ...(o.layout === undefined ? {} : { layout: o.layout }) }
  const base = o.usage ?? s.usage
  const usage = o.now === undefined ? base : usageAt(o.now, base)
  const clock = setup(on, { usage, store, env, now: o.now === undefined ? s.now : o.now + (s.now ?? 0) })
  s.prepare?.()
  await s.drive($, clock, TTL_MS[ttl])
  await clock.settle()
  return drawMounts($, mounts, s.isWorking)
}

/** Golden's grid: the 20 scenarios its capture froze (the one added since has
 *  no hashes), on two surfaces at three widths, each drawn shut and open, in
 *  dark and plain. 20 scenarios × 2 appearances × 6 mounts × 2 = 480 cases. */
// Frozen: golden's capture holds these. A scenario added later is never golden.
export const GOLDEN_SCENARIOS: readonly ScenarioName[] = [
  'calm', 'unmeasured', 'warming', 'recalled', 'cold', 'lastMinute', 'working', 'nearCompaction', 'compactionOff', 'limit80',
  'fiveHourAhead', 'sevenFullBeforeReset', 'noLimits', 'gatewaySpend', 'resetPassed', 'noWorkspace', 'notARepo', 'gitFails', 'emptyHistory', 'fullHistory',
]
export const GOLDEN_APPEARANCES: readonly Appearance[] = ['dark', 'plain']
export const GOLDEN_MOUNTS: readonly Mount[] = (['terminal', 'desktop'] as const).flatMap(surface => [40, 95, 200].map(cols => ({ surface, cols })))
export const goldenKey = (scenario: ScenarioName, appearance: Appearance, drawn: string): string => `${scenario}|${appearance}|${drawn}`
