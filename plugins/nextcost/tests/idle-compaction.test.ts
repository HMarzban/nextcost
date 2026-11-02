// Idle compaction: Claude Code compacts a long conversation left idle on the
// hour's cache about 54 minutes on, before the cache runs out.
import { test, expect, type Engine, type MockClock } from 'claude-code/testing'
import { idleCompactFrom } from '../hooks/cache-settings'
import {
  LONG,
  MIN,
  SUMMARY,
  START,
  USAGE,
  cardText,
  engine,
  hoverCardOf,
  mountBand,
  resp,
  respond,
  setup,
  startTurn,
  textOf,
} from './helpers'

/** A conversation of 250k tokens: past idle compaction's 200k threshold. */
const LONG_TALK = { ...USAGE, context: { tokens: 250_000, window: 1_000_000, percent: 25 } }

const cacheCard = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> => {
  const ui = await mountBand($, surface, 160)
  const text = cardText(hoverCardOf(await ui.drawn(), 'cache'))
  await ui.unmount()
  return text
}

/** Everything the band says shut, then open, at 160 columns. */
const drawnText = async ($: Engine): Promise<string> => {
  const ui = await mountBand($, 'terminal', 160)
  const shut = textOf(await ui.drawn())
  await ui.press({ key: 'more' })
  const open = textOf(await ui.drawn())
  await ui.unmount()
  return `${shut}\n${open}`
}

test('idle compaction runs from 200k tokens in an interactive terminal, unless turned off', () => {
  const on = { terminal: true, setting: undefined, disableAuto: undefined, disableAll: undefined, minTokens: undefined }
  expect(idleCompactFrom(on)).toBe(200_000)
  expect(idleCompactFrom({ ...on, terminal: false })).toBeUndefined()
  expect(idleCompactFrom({ ...on, setting: false })).toBeUndefined()
  expect(idleCompactFrom({ ...on, setting: true })).toBe(200_000)
  expect(idleCompactFrom({ ...on, disableAuto: '1' })).toBeUndefined()
  expect(idleCompactFrom({ ...on, disableAll: 'true' })).toBeUndefined()
  expect(idleCompactFrom({ ...on, disableAuto: '0' })).toBe(200_000)
})

test('the threshold takes a positive whole number, raised to 100k', () => {
  const on = { terminal: true, setting: undefined, disableAuto: undefined, disableAll: undefined }
  expect(idleCompactFrom({ ...on, minTokens: '300000' })).toBe(300_000)
  expect(idleCompactFrom({ ...on, minTokens: '50000' })).toBe(100_000)
  for (const ignored of ['0', '-5', '1.5e5', 'lots', '']) expect(idleCompactFrom({ ...on, minTokens: ignored })).toBe(200_000)
})

test('idle on the hour with a long conversation, the card says it may be compacted, until the 54-minute mark', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  await $.session.start(START)
  await respond($, resp(2_000, 0, 240_000, 5_000))
  await clock.advance(10 * MIN)
  expect(await cacheCard($)).toBe('50m left; may be compacted at ~54m idle, before it goes cold')

  // Past the mark, no compaction came: the card says what it always says.
  await clock.advance(45 * MIN)
  expect(await cacheCard($)).toMatch(/expires 1h after a request$/)
})

const WARM_CARD = /warm cache bills input at 5%, expires 1h after a request$/

for (const [name, usage, surface, settings] of [
  ['on the desktop', LONG_TALK, 'desktop', {}],
  ['with idleCompaction off', LONG_TALK, 'terminal', { idleCompaction: false }],
  ['below the threshold', USAGE, 'terminal', {}],
] as const)
  test(`no idle compaction is expected ${name}`, LONG, async ($, on) => {
    const clock = setup(on, { usage })
    engine.settings = settings
    await $.session.start({ ...START, surface })
    await respond($, resp(2_000, 0, 240_000, 5_000))
    await clock.advance(10 * MIN)
    expect(await cacheCard($, surface)).toMatch(WARM_CARD)
  })

test('compacted while idle, the cache reads compacted at the summary, calm, until the next reply', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  await $.session.start(START)
  await respond($, resp(2_000, 0, 240_000, 5_000))
  await clock.advance(54 * MIN)
  await $.session.compact({ trigger: 'auto', messages: SUMMARY })

  const ui = await mountBand($, 'terminal', 160)
  const tree = await ui.drawn()
  expect(textOf(tree)).toContain('cache compacted · next')
  expect(cardText(hoverCardOf(tree, 'cache'))).toMatch(/^Compacted while idle: ~\$[\d.]+ rewrites the 20k summary, plus your reply$/)
  await ui.unmount()

  // The countdown is over: no amber in what was the cache's last minute.
  await clock.advance(5 * MIN + 30_000)
  expect(await drawnText($)).not.toContain('left')

  await respond($, resp(500, 0, 20_000, 300))
  expect(await cacheCard($)).toMatch(/^1h 00m left/)
})

/** A reply, then 54 minutes on, `compact`: what the band then says. */
const afterIdle = async ($: Engine, clock: MockClock, compact: ($: Engine) => Promise<unknown>, wait = 54 * MIN): Promise<string> => {
  await $.session.start(START)
  await respond($, resp(2_000, 0, 240_000, 5_000))
  await clock.advance(wait)
  await compact($)
  return drawnText($)
}

/** The compacted state's own words, in any layout. */
const COMPACTED = /cache compacted|compacted while idle|COMPACTED/

const autoCompact = ($: Engine) => $.session.compact({ trigger: 'auto', messages: SUMMARY })

for (const layout of ['chips', 'pulse', 'departures'])
  test(`${layout} says the cache was compacted`, LONG, async ($, on) => {
    const clock = setup(on, { usage: LONG_TALK, store: { layout } })
    expect(await afterIdle($, clock, autoCompact)).toMatch(COMPACTED)
  })

test('/compact is no idle compaction', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  expect(await afterIdle($, clock, $ => $.session.compact({ trigger: 'manual', messages: SUMMARY }))).not.toMatch(COMPACTED)
})

test('a compaction in a turn under way is no idle one', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  const inTurn = async ($: Engine) => {
    await startTurn($, 'main-1', 2.41)
    await autoCompact($)
  }
  expect(await afterIdle($, clock, inTurn)).not.toMatch(COMPACTED)
})

test('a compaction five minutes after a request is no idle one', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  expect(await afterIdle($, clock, autoCompact, 5 * MIN)).not.toMatch(COMPACTED)
})
