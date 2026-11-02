// Shared fixtures and helpers for the band's tests: the engine beneath the
// plugin, canned usage, and readers for the drawn tree.

import type {
  ElementTable,
  ModelUsage,
  On,
  SessionCompactResult,
  SessionContextBreakdown,
  SessionRateLimit,
  SessionUsage,
  TurnStepInput,
  TurnStopReason,
} from 'claude-code'
import { mock, type Engine, type MockClock } from 'claude-code/testing'
import type { Sample } from '../hooks/memory'
import { CHIP_BAR } from '../hooks/views/chips'
import { textCells } from '../hooks/layout'
import { READ_LIMIT } from '../hooks/transcript'
import { DARK } from '../hooks/palette'

export const PLUGIN = 'nextcost'

/** The height a mount gets when it names none. */
export const DEFAULT_MAX_ROWS = 40

export const props = (cols: number, isWorking = false, maxRows = DEFAULT_MAX_ROWS) => ({
  hasSurvey: false,
  isWorking,
  maxRows,
  bodyColumns: cols,
  scroll: { offset: 0, bodyRows: maxRows - 1 },
  view: {},
})

export const MIN = 60_000
export const HOUR = 60 * MIN
/** The 7d window measured across yesterday, 20% to 30%. */
export const SAMPLES: Sample[] = [-30 * HOUR, -HOUR].map((at, i) => ({ at, fivePct: 4, sevenPct: 20 + 10 * i, fiveResetAt: 3 * HOUR, sevenResetAt: 67 * HOUR }))

export const USAGE: SessionUsage = {
  startedAt: 0,
  context: { tokens: 76_000, window: 200_000, percent: 38 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 4, resetsAt: new Date(3 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 30, resetsAt: new Date(67 * HOUR).toISOString() },
  ],
  cost: { usd: 2.41 },
}

export const FRESH: SessionUsage = {
  startedAt: 0,
  context: { window: 200_000 },
  rateLimits: [],
  cost: { usd: 0 },
}

/** How the usage read fails, if it does: `breakdownFails` makes the context
 *  breakdown read throw, `fails` every usage read. Neither, to start. */
const USAGE_FLAGS = { breakdownFails: false, fails: false }

/** What the engine reports right now; a test swaps `current` to move cost or
 *  limits, or sets one of USAGE_FLAGS to make a read throw. */
export const usage: { current: SessionUsage } & typeof USAGE_FLAGS = { current: USAGE, ...USAGE_FLAGS }

/** The size the engine reports for the conversation after a compaction. */
export const COMPACTED_TO = 20_000

/** A compacted conversation: the summary message alone. */
export const SUMMARY = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

/** The project the tests run in, and git's answers for it. */
export const PROJECT = '/Users/me/workspace/nextcost'
export const GIT_CLEAN = '# branch.oid 1a2b3c4d5e6f\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n'
export const GIT_MAIN_TREE = `${PROJECT}/.git\n${PROJECT}/.git\n${PROJECT}\n`

/** What git answers: its two outputs, `none` outside a repository, or
 *  `fail` when it can't run at all. */
type GitAnswer = { status: string; dirs: string } | 'none' | 'fail'

/** How the engine beneath answers, for tests that need it otherwise: what a
 *  compaction returns, why a step stops, a gate that holds a step open, the
 *  project root, and git, with every command the plugin ran. */
type EngineFake = {
  /** What `$.settings.read()` answers, merged as the engine reads it. */
  settings: Record<string, unknown>
  settingsFails: boolean
  compact: SessionCompactResult
  stop: TurnStopReason
  gate: Promise<void> | undefined
  /** How many tool calls the API ran itself in the next step (the advisor):
   *  its usage is then summed over that many rounds and one more. */
  serverTools: number
  root: string
  repoRoot: string | undefined
  git: GitAnswer
  /** While set, git and grep answers wait on it: each answer is the one at the call. */
  hold: Promise<void> | undefined
  ran: string[][]
  /** The session's id and model, as the engine names them. */
  sessionId: string
  model: string
  /** When set, the engine can't say the session's id. */
  sessionIdFails: boolean
  /** The session's transcript as Claude Code writes it; undefined when it isn't there. */
  transcript: string | undefined
  /** Its size on disk, when a test needs it larger than its text. */
  transcriptBytes: number | undefined
  /** When set, `tail` can't run, as where the host has none. */
  tailFails: boolean
  /** While set, `tail` answers wait on it, as a slow read of a transcript does. */
  tailHold: Promise<void> | undefined
  /** When set, `grep` can't run, as where the host has none. */
  grepFails: boolean
  /** When set, `grep -b` gives each match's byte offset, as ugrep does, not
   *  its line's. */
  grepMatchOffsets: boolean
  /** The command whose output runs past what one read holds, if any. */
  truncates: 'grep' | 'tail' | undefined
  /** Every path the plugin asked the file system about. */
  statted: string[]
  /** The plugin's own store, JSON in and out as the engine keeps it. */
  store: Record<string, unknown>
  /** Every key the plugin read from its store, in order. */
  storeGets: string[]
  /** Every key the plugin asked to write to its store, refused writes included, in order. */
  storeSets: string[]
  /** When true, every store write rejects, as an unavailable store would. */
  storeFails: boolean
  /** When true, every store read rejects, as a store that fails for a moment would. */
  storeReadFails: boolean
  /** How many times the plugin asked for a redraw (`$.ui.invalidate`). */
  invalidates: number
  /** Every slash command the plugin registered, by name, in order. */
  commands: string[]
}

/** Each test's engine, as `base` restores it: every default written once, so
 *  a field added to EngineFake can't be left out of the reset. */
const ENGINE_INITIAL: Readonly<EngineFake> = {
  settings: {},
  settingsFails: false,
  store: {},
  storeGets: [],
  storeSets: [],
  storeFails: false,
  storeReadFails: false,
  invalidates: 0,
  commands: [],
  hold: undefined,
  sessionId: 's1',
  model: 'claude-opus-5-5',
  sessionIdFails: false,
  transcript: undefined,
  transcriptBytes: undefined,
  tailFails: false,
  tailHold: undefined,
  grepFails: false,
  grepMatchOffsets: false,
  truncates: undefined,
  statted: [],
  root: PROJECT,
  repoRoot: PROJECT,
  git: { status: GIT_CLEAN, dirs: GIT_MAIN_TREE },
  ran: [],
  compact: { messages: SUMMARY, tokensAfter: COMPACTED_TO },
  stop: 'end_turn',
  gate: undefined,
  serverTools: 0,
}

// Cloned, not spread: `ran`, `statted` and the store logs are pushed to, and
// a shallow copy would carry one test's pushes into the defaults.
// structuredClone keeps the undefined fields too, which a JSON round-trip
// would drop from the reset.
export const engine: EngineFake = structuredClone(ENGINE_INITIAL)

/** Every toast the plugin raised since `base` ran. */
export const toasts: string[] = []

let nextUsage: ModelUsage | null = null

/** Everything beneath the plugin: the engine's own answers. */
const base = (on: On, initial: SessionUsage = USAGE, store: Readonly<Record<string, unknown>> = {}): void => {
  Object.assign(usage, USAGE_FLAGS, { current: initial })
  toasts.length = 0
  nextUsage = null
  Object.assign(engine, structuredClone(ENGINE_INITIAL))
  engine.store = JSON.parse(JSON.stringify(store)) as Record<string, unknown>
  on('store.get', ($, e) => {
    engine.storeGets.push(e.key)
    if (engine.storeReadFails) throw new Error('store unavailable')
    return { value: engine.store[e.key] }
  })
  on('store.set', ($, e) => {
    engine.storeSets.push(e.key)
    if (engine.storeFails) throw new Error('store unavailable')
    engine.store[e.key] = JSON.parse(JSON.stringify(e.value)) as unknown
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete engine.store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(engine.store) }))
  on('session.id', () => {
    if (engine.sessionIdFails) throw new Error('session id unavailable')
    return { value: engine.sessionId }
  })
  on('session.model', () => ({ value: engine.model }))
  on('settings.read', () => {
    if (engine.settingsFails) throw new Error('settings unavailable')
    return { value: engine.settings }
  })
  on('fs.stat', ($, e) => {
    engine.statted.push(e.path)
    if (engine.transcript === undefined) throw new Error(`ENOENT: ${e.path}`)
    const size = engine.transcriptBytes ?? engine.transcript.length
    // Claude Code touches a transcript when it opens it, so its time says nothing.
    return { value: { kind: 'file' as const, size, mtimeMs: 9e15, isLink: false } }
  })
  on('fs.read', ($, e) => {
    if (engine.transcript === undefined) throw new Error(`ENOENT: ${e.path}`)
    if ((engine.transcriptBytes ?? 0) > READ_LIMIT) throw new Error('over the read limit')
    return { value: engine.transcript }
  })
  on('session.root', () => ({ value: engine.root }))
  on('session.repo', () => ({
    value: engine.repoRoot === undefined ? null : { root: engine.repoRoot, remote: null, internal: false, name: null },
  }))
  on('process.run', async ($, e) => {
    engine.ran.push([...e.argv])
    const quiet = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (e.argv[0] === 'tail') {
      if (engine.tailHold !== undefined) await engine.tailHold
      if (engine.tailFails || engine.transcript === undefined) return { value: { ...quiet, exitCode: 1, stdout: '', stderr: 'tail: no such file' } }
      // `-c N` is the last N bytes, `-c +N` everything from byte N on.
      const count = String(e.argv[2])
      const stdout = count.startsWith('+') ? engine.transcript.slice(Number(count.slice(1)) - 1) : engine.transcript.slice(-Number(count))
      return { value: { ...quiet, exitCode: 0, stdout, isStdoutTruncated: engine.truncates === 'tail' } }
    }
    const { git, transcript, grepFails, grepMatchOffsets, truncates, hold } = engine
    if (hold !== undefined) await hold
    if (e.argv[0] === 'grep') {
      // `grep -a -b -F pattern path`: each line holding the pattern, after its byte offset.
      if (grepFails) throw new Error('grep: command not found')
      if (transcript === undefined) return { value: { ...quiet, exitCode: 2, stdout: '', stderr: 'grep: no such file' } }
      const pattern = String(e.argv.at(-2))
      let offset = 0
      const found: string[] = []
      for (const line of transcript.split('\n')) {
        if (line.includes(pattern)) found.push(`${grepMatchOffsets ? offset + line.indexOf(pattern) : offset}:${line}\n`)
        offset += line.length + 1
      }
      return { value: { ...quiet, exitCode: found.length > 0 ? 0 : 1, stdout: found.join(''), isStdoutTruncated: truncates === 'grep' } }
    }
    if (git === 'fail') throw new Error('git: command not found')
    if (git === 'none') return { value: { ...quiet, exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } }
    return { value: { ...quiet, exitCode: 0, stdout: e.argv.includes('status') ? git.status : git.dirs } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('command.register', ($, e) => {
    engine.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.usage', ($, e) => {
    if (usage.fails) throw new Error('usage unavailable')
    if (e.breakdown !== undefined && usage.breakdownFails) throw new Error('breakdown unavailable')
    return { value: usage.current }
  })
  on('session.compact', () => engine.compact)
  on('prompt.submit', ($, e) => ({ text: e.text, origin: e.origin }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Box' as const, children: [] }))
  // A redraw asked for: counted, then passed on, so the redraw still happens.
  on('ui.invalidate', ($, e, next) => {
    engine.invalidates++
    return next(e)
  })
  on('turn.step', async function* ($, e) {
    if (engine.gate !== undefined) await engine.gate
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: engine.stop,
      usage: nextUsage === null ? null : { ...nextUsage, model: e.model },
      ...(engine.serverTools > 0 && {
        serverToolUses: Array.from({ length: engine.serverTools }, (_, i) => ({ id: `srv-${i}`, name: 'advisor', input: {}, startedAt: 0, endedAt: 1 })),
      }),
    }
  })
}

export const resp = (input: number, read: number, write: number, output: number): ModelUsage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

/** A step that builds a 155k cache, none read from it: 41k in, 12k out. */
export const BUILD_155K: ModelUsage = resp(41_000, 0, 155_000, 12_000)
/** A step that builds a 100k cache: 10k in, 2k out. */
export const BUILD_100K: ModelUsage = resp(10_000, 0, 100_000, 2_000)
/** The step after BUILD_100K, reading its 100k back: 4k in, 6k written, 3k out. */
export const READ_100K: ModelUsage = resp(4_000, 100_000, 6_000, 3_000)
/** A step that builds an 80k cache: 2k in, 500 out. */
export const BUILD_80K: ModelUsage = resp(2_000, 0, 80_000, 500)

/** One step of a main-loop turn on `$`, its reply billed as `u`; `over`
 *  makes it a subagent's (`{ agentId }`) or another model's. */
export const respond = async ($: Engine, u: ModelUsage, over: Partial<TurnStepInput> = {}): Promise<void> => {
  nextUsage = u
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...over })
  for await (const _chunk of stream) {
    // drain so the hook's result settles
  }
  await stream.result
}

export type Node = {
  type?: string
  props?: Record<string, unknown>
  hover?: Record<string, unknown>
  children?: unknown[]
}

/** Element constructors for drawing outside a mount: each returns the plain
 *  node a surface would, its children flattened. */
const plainNode = (type: string) => (p: Readonly<Record<string, unknown>> | null): Node => {
  const { children, ...props } = p ?? {}
  return { type, props, children: children === undefined ? [] : [children].flat(Infinity) }
}
export const fakeEl = { Box: plainNode('Box'), Text: plainNode('Text'), Button: plainNode('Button'), Svg: plainNode('Svg') } as unknown as ElementTable

/** Whether a node is a hover card: a Box placed out of the flow. */
export const isCard = (n: unknown): n is Node => (n as Node | null)?.props?.position === 'absolute'

/** All text beneath a node, hidden cards included. */
export const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number'
    ? String(n)
    : n !== null && typeof n === 'object'
      ? ((n as Node).children ?? []).map(textOf).join('')
      : ''

export const walk = (n: unknown, visit: (node: Node) => void): void => {
  if (n === null || typeof n !== 'object') return
  visit(n as Node)
  for (const k of (n as Node).children ?? []) walk(k, visit)
}

/** How many nodes a tree holds. */
export const nodeCount = (tree: unknown): number => {
  let n = 0
  walk(tree, () => {
    n++
  })
  return n
}

/** The first node beneath `tree`, in drawing order, whose key is `key` and,
 *  when `type` is given, whose type is `type`. */
export const byKey = (tree: unknown, key: string, type?: string): Node | undefined => {
  let found: Node | undefined
  walk(tree, n => {
    if (found === undefined && n.props?.key === key && (type === undefined || n.type === type)) found = n
  })
  return found
}

/** Rows of the band: the root Box's children. */
export const rowCount = (tree: unknown): number => {
  const t = tree as Node
  return t.type === 'Box' ? (t.children ?? []).length : 0
}

/** Cells a drawn row needs, as the terminal lays it out: text, padding, gaps
 *  and Button labels, a wide character two cells by layout.ts's one rule;
 *  hidden cards take none, nor a gap; an Svg takes a cell per 8px.
 *  Kept apart from band.tsx's own measure on purpose, so the fit tests check
 *  the drawing against an independent count rather than against itself. */
export const widthOf = (n: unknown): number => {
  if (typeof n === 'string' || typeof n === 'number') return textCells(String(n))
  if (n === null || typeof n !== 'object') return 0
  const node = n as Node
  if (node.props?.position === 'absolute') return 0
  if (node.type === 'Button') return textCells(String(node.props?.label ?? ''))
  if (node.type === 'Svg') return Math.ceil(Number(node.props?.width ?? 64) / 8)
  const kids = (node.children ?? []).filter(k => k !== null && k !== undefined && k !== false && !isCard(k))
  const pad = typeof node.props?.paddingX === 'number' ? 2 * node.props.paddingX : 0
  const gap = typeof node.props?.columnGap === 'number' ? node.props.columnGap * Math.max(0, kids.length - 1) : 0
  return kids.map(widthOf).reduce((a, b) => a + b, 0) + pad + gap
}

/** The band's first row: the pills. */
export const firstRow = (tree: unknown): unknown => ((tree as Node).children ?? [])[0]

// ── constants ──────────────────────────────────────────────────────────

export const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
/** START on the desktop. */
export const DESKTOP_START = { ...START, surface: 'desktop' } as const
/** Turn t1's start and its end, answered, with the ledger left as it stands. */
export const TURN_START = { text: 'hi', turnId: 't1' } as const
export const TURN_DONE = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
/** A gateway's spend limit as the engine reports it: 92% used, resetting 5 hours on. */
export const SPEND_LIMIT: SessionRateLimit = { kind: 'spend_limit', percentUsed: 92, resetsAt: new Date(5 * HOUR).toISOString() }
/** Pins the 1-hour TTL, so tests don't depend on the assumed one. */
export const HOUR_1 = { ENABLE_PROMPT_CACHING_1H: '1' }
/** Where a mounted test that reads a host's clock starts: never epoch 0,
 *  where a host's zone may have had an offset off the minute. */
export const MODERN = Date.UTC(2026, 0, 5)
/** `u`, USAGE when not given, with each reset moved on by `ms`: its windows
 *  as they stand for a clock started there. */
export const usageAt = (ms: number, u: SessionUsage = USAGE): SessionUsage => ({
  ...u,
  rateLimits: u.rateLimits.map(l => (l.resetsAt === undefined ? l : { ...l, resetsAt: new Date(ms + Date.parse(l.resetsAt)).toISOString() })),
})
/** The weekday a clock time at `ms`, drawn at `now`, leads with on this host:
 *  '' on the same local day, else `Thu `. The kit's zone is the host's, so it
 *  is read off the host's own calendar, not the band's formatters. */
const weekdayLead = (ms: number, now: number): string => {
  const day = new Date(ms).toDateString()
  return day === new Date(now).toDateString() ? '' : `${day.slice(0, 3)} `
}
/** A clock time at `ms`, drawn at `now`, as this host's band says it:
 *  `05:00`, or past today `Thu 05:00`, read off the host's own calendar. */
export const hostClock = (ms: number, now: number): string => `${weekdayLead(ms, now)}${new Date(ms).toTimeString().slice(0, 5)}`
/** The time budget of a test that walks the clock through many minutes, or
 *  draws the band at many widths. The band ticks every second, so an hour
 *  walked is 3,600 ticks: under a second on a laptop, but a shared CI runner
 *  runs it up to ten times slower, past the kit's default of 5 s. */
export const LONG = { timeoutMs: 30_000 } as const
export const CLEAR = { reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as const

// ── setting a test up ──────────────────────────────────────────────────

/** The world most tests start from: the clock at `now` (0 when not given),
 *  the environment (HOUR_1 when not given) and the engine beneath, reporting
 *  `usage` with `store` in the plugin's store. Returns the clock. */
export const setup = (
  on: On,
  opts: { usage?: SessionUsage; env?: Record<string, string>; store?: Record<string, unknown>; now?: number } = {},
): MockClock => {
  const clock = mock.clock(on, { now: opts.now ?? 0 })
  mock.env(on, opts.env ?? HOUR_1)
  base(on, opts.usage, opts.store)
  return clock
}

/** `/nextcost args`, or another command named, as typed at the prompt. */
export const runCommand = ($: Engine, args: string, command = 'nextcost') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 110 } })

/** The band drawn above the prompt on `surface`, `cols` wide. */
export const mountBand = <S extends 'terminal' | 'desktop'>(
  $: Engine,
  surface: S,
  cols: number,
  opts: { maxRows?: number; isWorking?: boolean } = {},
) => $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: props(cols, opts.isWorking, opts.maxRows) })

// ── readers for the drawn tree ─────────────────────────────────────────

/** The pill Box drawn under `key` in the first row. */
export const pillOf = (tree: unknown, key: string): Node | undefined => byKey(firstRow(tree), key, 'Box')

/** A node's visible text: hover cards, at any depth, left out. */
export const shown = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number'
    ? String(n)
    : n !== null && typeof n === 'object' && (n as Node).props?.position !== 'absolute'
      ? ((n as Node).children ?? []).map(shown).join('')
      : ''

/** A text battery's segments: its own Texts that carry a background. */
export const segments = (pill: Node | undefined): Array<{ text: string; bg: unknown }> =>
  ((pill?.children ?? []) as Node[])
    .filter(k => k?.type === 'Text' && k.props?.backgroundColor !== undefined)
    .map(k => ({ text: textOf(k), bg: k.props?.backgroundColor }))

export const svgsOf = (n: unknown): Node[] => {
  const out: Node[] = []
  walk(n, k => {
    if (k.type === 'Svg') out.push(k)
  })
  return out
}

/** The words a flap Svg's tiles spell: each Svg's `<text>` runs joined,
 *  spaces too, the Svgs a space apart. Its words, for the checks that read
 *  text, since a desktop board draws none in a Text. */
export const flapWords = (n: unknown): string =>
  svgsOf(n)
    .map(s => [...String(s.props?.source ?? '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1] ?? '').join(''))
    .filter(w => w !== '')
    .join(' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** A tree's words: its visible text, then a desktop board's flaps'. */
export const wordsOf = (n: unknown): string => `${shown(n)} ${flapWords(n)}`

export const svgAlts = (tree: unknown): string[] => svgsOf(tree).map(n => String(n.props?.alt))

/** The desktop battery icon in the cache pill. */
export const batteryOf = (tree: unknown): Node | undefined =>
  svgsOf(pillOf(tree, 'cache')).find(n => /battery|warming/.test(String(n.props?.alt)))

/** The first `<rect>` of class `cls` in an SVG's source: its numeric
 *  attributes by name, read in whatever order they are written; undefined
 *  when no rect has the class. */
export const svgRect = (source: string, cls: string): Readonly<Record<string, number>> | undefined => {
  for (const [rect] of source.matchAll(/<rect\b[^>]*>/g)) {
    const attrs = [...rect.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [String(name), String(value)] as const)
    if (!attrs.some(([name, value]) => name === 'class' && value.split(/\s+/).includes(cls))) continue
    return Object.fromEntries(attrs.filter(([, value]) => value.trim() !== '' && Number.isFinite(Number(value))).map(([name, value]) => [name, Number(value)]))
  }
  return undefined
}

/** The battery icon's charge bar width, in px. */
export const fillWidth = (svg: Node | undefined): number => svgRect(String(svg?.props?.source), 'charge')?.width ?? 0

/** Each hidden hover card, as [key, card] pairs in drawing order: the key of
 *  the first keyed Box in the card's row that shares its hover scope, or ''
 *  when none does. */
export const cards = (tree: unknown): Array<[string, Node]> => {
  const out: Array<[string, Node]> = []
  walk(tree, row => {
    for (const card of (row.children ?? []).filter(isCard)) {
      const scope = card.hover?.scope
      // The desktop's card is inside the piece it explains, with no scope.
      let key = scope === undefined ? String(row.props?.key ?? '') : ''
      walk(row, n => {
        if (key === '' && scope !== undefined && n !== card && n.props?.key !== undefined && n.hover?.scope === scope) key = String(n.props.key)
      })
      out.push([key, card])
    }
  })
  return out
}

/** The hover card that `key`'s piece reveals. */
export const hoverCardOf = (tree: unknown, key: string): Node | undefined => cards(tree).find(([k]) => k === key)?.[1]

/** The words a hover card says, without the end caps a text surface draws
 *  either side of its ground. */
export const cardText = (card: unknown): string => {
  const kids = ((card as Node | undefined)?.children ?? []) as unknown[]
  return textOf(kids.length === 3 ? kids[1] : card)
}

/** The value a card row shows for `label` in the expanded view. */
export const fact = (tree: unknown, label: string): string | undefined => {
  const row = byKey(tree, `fact:${label}`, 'Box')
  return row === undefined ? undefined : textOf((row.children ?? []).at(-1))
}

/** A card of the expanded view: cache, spend, context or limits. */
export const cardOf = (tree: unknown, name: string): Node | undefined => byKey(tree, `card:${name}`, 'Box')

/** A card's head: its title and the layout's lens. */
export const cardHead = (tree: unknown, name: string): Node | undefined => byKey(cardOf(tree, name), 'head')

/** A card's first body row, past its head, as it reads. */
export const cardFirstRow = (tree: unknown, name: string): string => shown(((cardOf(tree, name)?.children ?? []) as Node[]).filter(Boolean)[1])

/** The bold Texts beneath a node, as they read. */
export const boldOf = (n: unknown): string[] => {
  const out: string[] = []
  walk(n, k => {
    if (k.type === 'Text' && k.props?.bold === true) out.push(shown(k))
  })
  return out
}

/** A row's pills by key, in order: its keyed pieces that never shrink. */
export const pillKeys = (row: unknown): unknown[] =>
  (((row as Node | undefined)?.children ?? []) as Array<Node | null>).filter(k => k?.props?.flexShrink === 0 && k.props?.key !== undefined).map(k => k?.props?.key)

/** The cache card's rebuild count, 0 when the row is absent. */
export const rebuilds = (tree: unknown): number => Number(fact(tree, 'unexpected rebuilds') ?? 0)

/** Text meters drawn: CHIP_BAR's cells of █ and ░. An empty meter's
 *  inner track Text is as many cells too, so it's told apart by its colour. */
const METER = new RegExp(`^[█░]{${CHIP_BAR.cells}}$`)
export const textMeters = async (ui: {
  findAll: (q: { type: string; text: RegExp }) => Promise<Array<{ props?: Record<string, unknown> }>>
}): Promise<number> => (await ui.findAll({ type: 'Text', text: METER })).filter(t => t.props?.color !== DARK.trackInk).length

// ── driving the engine ─────────────────────────────────────────────────

type TurnEnd = { agentId?: string; isAborted?: boolean; reason?: 'answer' | 'aborted' | 'error' }

/** A turn's `turn.start` (with `agentId`, a subagent's), with the ledger at `at`. */
export const startTurn = async ($: Engine, id: string, at: number, agentId?: string): Promise<void> => {
  usage.current = { ...usage.current, cost: { usd: at } }
  // Since 2.1.299 a subagent's turn raises turn.start too, with its agentId.
  const start = agentId === undefined ? { ...TURN_START, turnId: id } : { ...TURN_START, turnId: id, agentId }
  await $.turn.start(start)
}

/** A turn's `turn.complete` (with `agentId`, a subagent's), with the ledger at `at`. */
export const endTurn = async ($: Engine, id: string, at: number, extra: TurnEnd = {}): Promise<void> => {
  usage.current = { ...usage.current, cost: { usd: at } }
  await $.turn.complete({ ...TURN_DONE, turnId: id, ...extra })
}

/** One main-loop turn (or, with `agentId`, a subagent's) that moves the
 *  ledger from `from` to `to`. */
export const turn = async ($: Engine, id: string, from: number, to: number, extra: TurnEnd = {}): Promise<void> => {
  await startTurn($, id, from, extra.agentId)
  await endTurn($, id, to, extra)
}

/** Starts the session and feeds a 5h pace: 40% then 50% twelve minutes on,
 *  with 4h to the reset, at 60% context. */
export const pacing = async ($: Engine, clock: MockClock): Promise<void> => {
  const resetsAt = new Date(4 * HOUR).toISOString()
  const at = (pct: number): SessionUsage => ({
    ...USAGE,
    context: { tokens: 120_000, window: 200_000, percent: 60 },
    rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt }],
  })
  usage.current = at(40)
  await $.session.start(START)
  for (const [pct, wait] of [
    [40, 12 * MIN],
    [50, 0],
  ] as const) {
    usage.current = at(pct)
    const u = usage.current
    await $.session.measure({ context: u.context, rateLimits: u.rateLimits, cost: u.cost, changed: ['rateLimits'] })
    await clock.advance(wait)
  }
}

/** A context breakdown carrying only what the band reads. The full type holds
 *  the grid and every category, which no test here needs. */
export const breakdown = (fields: Pick<SessionContextBreakdown, 'isAutoCompactEnabled'> & { autoCompactThreshold?: number }): SessionContextBreakdown =>
  fields as SessionContextBreakdown

/** A transcript of `lines`, one to a line: an object as its JSON, a string
 *  as it is, so a test can write a line cut short. */
export const jsonl = (...lines: unknown[]): string => lines.map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n'
/** A main-loop reply's line, logged at `ms`, billed under Opus 5.5. */
export const replyLine = (ms: number) => ({ type: 'assistant', timestamp: new Date(ms).toISOString(), message: { role: 'assistant', model: 'claude-opus-5-5', content: [] } })
/** A prompt's line, logged at `ms`. */
export const promptLine = (ms: number) => ({ type: 'user', timestamp: new Date(ms).toISOString(), message: { role: 'user', content: 'hi' } })
/** A cost record as Claude Code writes one: $20 over 1M input, 400k written,
 *  20M read and 100k output, per model named. */
export const costRecord = (...models: string[]) => ({
  type: 'cost-state',
  totalCostUSD: 20,
  modelUsage: Object.fromEntries(
    models.map(model => [model, { inputTokens: 1_000_000, cacheCreationInputTokens: 400_000, cacheReadInputTokens: 20_000_000, outputTokens: 100_000, costUSD: 20 }]),
  ),
})
/** Whether a rate solved from a transcript is `b`, to within float error. */
export const rateNear = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < 1e-15

/** A transcript as Claude Code writes one: a user line, an assistant reply at
 *  `replyAt`, and the cost-state line it adds when a session is opened. */
export const transcriptOf = (replyAt: number, modelUsage: Record<string, Record<string, number>> = {}): string =>
  jsonl(promptLine(replyAt - 5000), replyLine(replyAt), { type: 'last-prompt', lastPrompt: 'hi' }, { type: 'cost-state', totalCostUSD: 1, modelUsage })

/** WCAG 2.x contrast ratio of two hex colours. */
export const contrast = (a: string, b: string): number => {
  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

/** Grounds a host paints behind the band: the desktop's dark one as measured
 *  from screenshots, common dark terminals, and light ones. */
export const DARK_HOSTS = ['#212121', '#1e1e1e', '#000000'] as const
export const LIGHT_HOSTS = ['#ffffff', '#faf9f5', '#f0eee6'] as const
