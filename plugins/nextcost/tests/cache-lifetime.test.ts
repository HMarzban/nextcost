// The lifetime read off the transcript at a turn's end: what the cache was
// really written for, so the countdown and the rate don't rest on a guess.

import { test, expect } from 'claude-code/testing'
import { newCache } from '../hooks/cache'
import { BUILD_80K, LONG, MIN, START, TURN_DONE, engine, fact, jsonl, mountBand, pillOf, replyLine, requestLines, resp, respond, setup, shown } from './helpers'

/** A main-loop reply's line that wrote to the cache for `ttl`. */
const wroteFor = (ms: number, ttl: '5m' | '1h') => {
  const line = replyLine(ms)
  const written = { ephemeral_5m_input_tokens: ttl === '5m' ? 80_000 : 0, ephemeral_1h_input_tokens: ttl === '1h' ? 80_000 : 0 }
  return { ...line, message: { ...line.message, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 80_000, cache_creation: written } } }
}

/** Past the band's first look for a turn's line. */
const LOOK = 600
const HOME = { HOME: '/Users/me' }
const OPUS = { model: 'claude-opus-5-5' }

test('on an API key, the first turn counts down five minutes, not an assumed hour', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  // Its line lands about 100ms on, as the real engine's write queue flushes.
  await clock.advance(100)
  engine.transcript = jsonl(wroteFor(clock.now(), '5m'))
  await clock.advance(LOOK)
  const ui = await mountBand($, 'terminal', 110)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/cache [45]:\d\d/)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'expires')).toBe('5m idle')
  await ui.unmount()
})

test("a turn whose request logged 2 MB of blobs before its reply is still read: the reply is in the last megabyte", LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.advance(100)
  engine.transcript = jsonl(...requestLines(clock.now() - 3_000, 2 * 1024 * 1024), wroteFor(clock.now(), '5m'), ...requestLines(clock.now() + 1, 0))
  await clock.advance(LOOK)
  const ui = await mountBand($, 'terminal', 110)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/cache [45]:\d\d/)
  await ui.unmount()
})

test('on a subscription, a read hour stops saying it is assumed', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  await respond($, BUILD_80K)
  engine.transcript = jsonl(wroteFor(clock.now(), '1h'))
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'expires')).toBe('1h idle')
  await ui.unmount()
})

test('a subscription moving onto usage credits mid-session counts down five minutes after that turn', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  await respond($, BUILD_80K)
  const first = wroteFor(clock.now(), '1h')
  engine.transcript = jsonl(first)
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
  await clock.advance(2 * MIN)
  await respond($, resp(1, 80_000, 2_000, 10))
  engine.transcript = jsonl(first, wroteFor(clock.now(), '5m'))
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
  const ui = await mountBand($, 'terminal', 110)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/cache [45]:\d\d/)
  await ui.unmount()
})

test('a turn whose last step only read still reads the lifetime of its earlier write', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  await respond($, BUILD_80K)
  const written = wroteFor(clock.now(), '5m')
  await clock.advance(MIN)
  await respond($, resp(1, 80_000, 0, 10))
  engine.transcript = jsonl(written)
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'expires')).toBe('5m idle')
  await ui.unmount()
})

test('a turn that wrote nothing runs no read', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  await respond($, BUILD_80K)
  engine.transcript = jsonl(wroteFor(clock.now(), '1h'))
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
  await respond($, resp(1, 80_000, 0, 10))
  engine.ran.length = 0
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
  expect(engine.ran.filter(argv => argv[0] === 'tail')).toEqual([])
})

test('a pin taken away after a read leaves the lifetime assumed again', () => {
  const c = respondedOnce(2)
  c.turnEnded(2)
  c.wroteFor('5m')
  c.configured({ ttl: '1h', idleCompactFrom: undefined })
  c.configured({ ttl: undefined, idleCompactFrom: undefined })
  expect(c.view({ now: 2 * MIN, ledger: 2, contextTokens: 400_000, autoCompactOff: false }).cache.ttlPinned).toBe(false)
})

test("a line not yet written isn't taken for this turn's: the band looks again", LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  const before = wroteFor(clock.now() - 10 * MIN, '1h')
  engine.transcript = jsonl(before)
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  expect(fact(await ui.drawn(), 'expires')).toBe('1h idle · assumed')
  await ui.unmount()
  engine.transcript = jsonl(before, wroteFor(clock.now(), '5m'))
  await clock.advance(2_000)
  const later = await mountBand($, 'terminal', 110)
  expect(shown(pillOf(await later.drawn(), 'cache'))).toMatch(/cache [45]:\d\d/)
  await later.unmount()
})

test('a turn that reached no API reads nothing', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await $.session.start(START)
  // A line to find, so a read that wrongly ran would tail it.
  engine.transcript = jsonl(wroteFor(clock.now(), '1h'))
  await clock.settle()
  engine.ran.length = 0
  await $.turn.complete(TURN_DONE)
  // Past the first wait: the read is scheduled on a timer, not run in the hook.
  await clock.advance(LOOK)
  expect(engine.ran.filter(argv => argv[0] === 'tail')).toEqual([])
})

test('a pinned lifetime reads nothing, and wins', LONG, async ($, on) => {
  const clock = setup(on, { env: { ...HOME, CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } })
  await $.session.start(START)
  await clock.settle()
  engine.ran.length = 0
  await respond($, BUILD_80K)
  engine.transcript = jsonl(wroteFor(clock.now(), '5m'))
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
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
  await clock.advance(LOOK)
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


// ---- a short read, once the lifetime has been read --------------------------

/** A turn that wrote 157k, its hour read off the transcript. */
const readAnHour = async ($: Parameters<typeof respond>[0], clock: { now: () => number; advance: (ms: number) => Promise<unknown> }) => {
  await $.session.start(START)
  await respond($, resp(2_000, 0, 157_000, 500), { messageCount: 40 })
  engine.transcript = jsonl(wroteFor(clock.now(), '1h'))
  await $.turn.complete(TURN_DONE)
  await clock.advance(LOOK)
}

const openFacts = async ($: Parameters<typeof mountBand>[0]) => {
  const ui = await mountBand($, 'terminal', 110)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  await ui.unmount()
  return { expires: fact(tree, 'expires'), rebuilds: fact(tree, 'unexpected rebuilds') }
}

test('a read hour stands against a short read 12 minutes on: a /rewind is no five-minute cache', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await readAnHour($, clock)
  await clock.advance(12 * MIN)
  await respond($, resp(1_000, 60_000, 97_000, 500), { messageCount: 20 })
  expect(await openFacts($)).toEqual({ expires: '1h idle', rebuilds: undefined })
})

test('a /rewind inside five minutes is no unexpected rebuild', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await readAnHour($, clock)
  await clock.advance(2 * MIN)
  await respond($, resp(1_000, 60_000, 97_000, 500), { messageCount: 20 })
  expect((await openFacts($)).rebuilds).toBeUndefined()
})

test('with the conversation still growing, a short read of a read hour is one unexpected rebuild, and the hour stands', LONG, async ($, on) => {
  const clock = setup(on, { env: HOME })
  await readAnHour($, clock)
  await clock.advance(12 * MIN)
  await respond($, resp(1_000, 60_000, 97_000, 500), { messageCount: 42 })
  expect(await openFacts($)).toEqual({ expires: '1h idle', rebuilds: '1' })
})

// With no read to go by: the inference, only on a read of near nothing.
const unread = (hit: number, messages = 42) => {
  const c = newCache()
  c.responded({ ...resp(2_000, 0, 157_000, 500), ...OPUS }, 0, true, { messages: 40 })
  c.responded({ ...resp(1_000, hit, 157_000 - hit, 500), ...OPUS }, 12 * MIN, true, { messages })
  return c.view({ now: 12 * MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false }).cache.ttl
}

test('no read yet: a request 12 minutes on that read near nothing means five minutes', () => {
  expect(unread(0)).toBe('5m')
  expect(unread(45_000)).toBe('5m')
})

test('no read yet: a partial read beyond the shared system prompt infers nothing', () => {
  expect(unread(60_000)).toBe('1h')
})

test('no read yet: a /rewind infers nothing, even reading near nothing', () => {
  expect(unread(0, 20)).toBe('1h')
})
