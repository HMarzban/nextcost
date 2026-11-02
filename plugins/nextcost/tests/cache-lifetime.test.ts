// The lifetime read off the transcript at a turn's end: what the cache was
// really written for, so the countdown and the rate don't rest on a guess.

import { test, expect } from 'claude-code/testing'
import { newCache } from '../hooks/cache'
import { BUILD_80K, LONG, MIN, START, TURN_DONE, engine, fact, jsonl, mountBand, pillOf, replyLine, resp, respond, setup, shown } from './helpers'

/** A main-loop reply's line that wrote to the cache for `ttl`. */
const wroteFor = (ms: number, ttl: '5m' | '1h') => {
  const line = replyLine(ms)
  const written = { ephemeral_5m_input_tokens: ttl === '5m' ? 80_000 : 0, ephemeral_1h_input_tokens: ttl === '1h' ? 80_000 : 0 }
  return { ...line, message: { ...line.message, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 80_000, cache_creation: written } } }
}

const HOME = { HOME: '/Users/me' }
const OPUS = { model: 'claude-opus-5-5' }

test('on an API key, the first turn counts down five minutes, not an assumed hour', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  engine.transcript = jsonl(wroteFor(0, '5m'))
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const ui = await mountBand($, 'terminal', 110)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/cache [45]:\d\d/)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'expires')).toBe('5m idle')
  await ui.unmount()
})

test('on a subscription, a read hour stops saying it is assumed', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  engine.transcript = jsonl(wroteFor(0, '1h'))
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'expires')).toBe('1h idle')
  await ui.unmount()
})

test('a subscription moving onto usage credits mid-session counts down five minutes after that turn', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  engine.transcript = jsonl(wroteFor(0, '1h'))
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  await clock.advance(2 * MIN)
  engine.transcript = jsonl(wroteFor(0, '1h'), wroteFor(2 * MIN, '5m'))
  await respond($, resp(1, 80_000, 2_000, 10))
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const ui = await mountBand($, 'terminal', 110)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/cache [45]:\d\d/)
  await ui.unmount()
})

test('a turn that reached no API reads nothing', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  await clock.settle()
  engine.ran.length = 0
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  expect(engine.ran.filter(argv => argv[0] === 'tail')).toEqual([])
})

test('a pinned lifetime reads nothing, and wins', LONG, async ($, on) => {
  const clock = setup(on, { env: { ...HOME, CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } })
  await $.session.start(START)
  engine.transcript = jsonl(wroteFor(0, '5m'))
  await clock.settle()
  engine.ran.length = 0
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  expect(engine.ran.filter(argv => argv[0] === 'tail')).toEqual([])
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'expires')).toBe('1h idle')
  await ui.unmount()
})

test('a transcript that cannot be read leaves the lifetime assumed, and the band drawn', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  engine.tailFails = true
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'expires')).toBe('1h idle · assumed')
  await ui.unmount()
})

const respondedOnce = (ledger: number) => {
  const c = newCache()
  c.turnStarted({ priceModel: undefined, ledger: 0 })
  c.responded({ ...resp(0, 0, 400_000, 0), ...OPUS }, MIN, true, { ledger })
  return c
}

test('a read of five minutes moves the turn\'s writes, so the re-warm is priced at what was billed', () => {
  // 400k written at 1.25x, $4 per million: $2.
  const c = respondedOnce(2)
  c.turnEnded(2)
  c.wroteFor('5m')
  const { cache } = c.view({ now: 2 * MIN, ledger: 2, contextTokens: 400_000, autoCompactOff: false })
  expect(cache.ttl).toBe('5m')
  expect(Math.abs((cache.reWarmUsd ?? 0) - 2)).toBeLessThan(1e-9)
})

test('a read of an hour leaves the rate as billed at 2x', () => {
  // 400k written at 2x, $4 per million: $3.20.
  const c = respondedOnce(3.2)
  c.turnEnded(3.2)
  c.wroteFor('1h')
  const { cache } = c.view({ now: 2 * MIN, ledger: 3.2, contextTokens: 400_000, autoCompactOff: false })
  expect(Math.abs((cache.reWarmUsd ?? 0) - 3.2)).toBeLessThan(1e-9)
})

test('a read made while the next turn is under way waits for that turn\'s', () => {
  const c = respondedOnce(2)
  c.turnEnded(2)
  c.turnStarted({ priceModel: undefined, ledger: 2 })
  c.wroteFor('5m')
  expect(c.view({ now: 2 * MIN, ledger: 2, contextTokens: 400_000, autoCompactOff: false }).cache.ttl).toBe('1h')
})

test('a read carries through a reload', () => {
  const c = respondedOnce(2)
  c.turnEnded(2)
  c.wroteFor('5m')
  const after = newCache(c.kept())
  const { cache } = after.view({ now: 2 * MIN, ledger: 2, contextTokens: 400_000, autoCompactOff: false })
  expect(cache.ttl).toBe('5m')
  expect(cache.ttlPinned).toBe(true)
})

