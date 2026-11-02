// Idle compaction: Claude Code compacts a long conversation left idle on the
// hour's cache about 54 minutes on, before the cache runs out.
import { test, expect, type Engine, type MockClock } from 'claude-code/testing'
import { newCache } from '../hooks/cache'
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

test('idle compaction runs from 200k tokens, unless turned off', () => {
  const on = { setting: undefined, disableAuto: undefined, disableAll: undefined, minTokens: undefined }
  expect(idleCompactFrom(on)).toBe(200_000)
  expect(idleCompactFrom({ ...on, setting: false })).toBeUndefined()
  expect(idleCompactFrom({ ...on, setting: true })).toBe(200_000)
  expect(idleCompactFrom({ ...on, disableAuto: '1' })).toBeUndefined()
  expect(idleCompactFrom({ ...on, disableAll: 'true' })).toBeUndefined()
  expect(idleCompactFrom({ ...on, disableAuto: '0' })).toBe(200_000)
})

test('the threshold takes a positive whole number, raised to 100k', () => {
  const on = { setting: undefined, disableAuto: undefined, disableAll: undefined }
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

const NOT_IDLE = (said: string) => {
  expect(said).toContain('cache compacted')
  expect(said).not.toMatch(/while idle/)
  expect(said).not.toMatch(/\d+m left/)
}

test('/compact reads compacted, in no words of idling', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  NOT_IDLE(await afterIdle($, clock, $ => $.session.compact({ trigger: 'manual', messages: SUMMARY })))
})

test('a compaction in a turn under way reads compacted, in no words of idling', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  const inTurn = async ($: Engine) => {
    await startTurn($, 'main-1', 2.41)
    await autoCompact($)
  }
  NOT_IDLE(await afterIdle($, clock, inTurn))
})

test('a compaction five minutes after a request reads compacted, in no words of idling', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  NOT_IDLE(await afterIdle($, clock, autoCompact, 5 * MIN))
})

for (const layout of ['chips', 'pulse', 'departures'])
  test(`${layout}: /compact stops the old countdown until the next reply`, LONG, async ($, on) => {
    const clock = setup(on, { store: { layout } })
    await $.session.start(START)
    await respond($, resp(2_000, 0, 240_000, 5_000))
    await clock.advance(5 * MIN)
    await $.session.compact({ trigger: 'manual', messages: SUMMARY })
    await clock.advance(MIN)
    const said = await drawnText($)
    expect(said).toMatch(COMPACTED)
    expect(said).not.toMatch(/\d+m left|DEPARTS|re-warm/i)
    await respond($, resp(500, 0, 20_000, 300))
    expect(await drawnText($)).not.toMatch(COMPACTED)
  })

test('a compaction with no size told still reads compacted, never at the old size, and needs no context', LONG, async ($, on) => {
  const clock = setup(on, { usage: { ...LONG_TALK, context: { window: 1_000_000 } as typeof LONG_TALK.context } })
  await $.session.start(START)
  await respond($, resp(2_000, 0, 240_000, 5_000))
  engine.compact = { messages: SUMMARY }
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  await clock.advance(MIN)
  const said = await drawnText($)
  expect(said).toContain('cache compacted')
  expect(said).toContain('next summary')
  expect(said).not.toMatch(/next 24\dk/)
})

test('a compaction a resumed conversation makes before its first reply reads compacted at the summary', () => {
  const c = newCache()
  c.resumed({ cache: { lastAt: 0, expired: false, reWarmUsd: 9 }, transcript: undefined })
  c.compacted({ now: 5 * MIN, sizeAfter: 20_000, manual: true })
  const { cache } = c.view({ now: 6 * MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false })
  expect([cache.compacted, cache.leftMs, cache.window, cache.recalled]).toEqual([true, 0, 20_000, false])
})

// ---- where it runs ----------------------------------------------------------

test('on the desktop too, per the docs: the card says it may be compacted', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  await $.session.start({ ...START, surface: 'desktop' })
  await respond($, resp(2_000, 0, 240_000, 5_000))
  await clock.advance(10 * MIN)
  expect(await cacheCard($, 'desktop')).toMatch(/may be compacted at ~54m idle/)
})

test('an SDK host, as the desktop is, starts with no surface and no person at the prompt: it still may', LONG, async ($, on) => {
  const clock = setup(on, { usage: LONG_TALK })
  await $.session.start({ ...START, surface: null, isInteractive: false })
  await respond($, resp(2_000, 0, 240_000, 5_000))
  await clock.advance(10 * MIN)
  expect(await cacheCard($, 'desktop')).toMatch(/may be compacted at ~54m idle/)
})

test('the VS Code panel may, the mobile app is not on the docs\' list', () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: 200_000 })
  c.responded(resp(2_000, 0, 240_000, 5_000), 0, true)
  const at = (surface: 'vscode' | 'mobile') => c.view({ now: MIN, ledger: undefined, contextTokens: 250_000, autoCompactOff: false, surface }).cache.idleCompacts
  expect([at('vscode'), at('mobile')]).toEqual([true, false])
})
