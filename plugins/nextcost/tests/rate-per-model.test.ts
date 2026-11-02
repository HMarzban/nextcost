// The base rate after a model switch and under subagents on another model: each
// model solves its own, from what the ledger grew by across its own steps. The
// ledger here bills as Anthropic lists it.

import { test, expect } from 'claude-code/testing'
import { newCache, type CacheModel } from '../hooks/cache'
import { HOUR, LONG, MIN, START, TURN_DONE, TURN_START, USAGE, engine, expectNear, ledgerGrows, listBill, mountBand, resp, respond, setup, shown, pillOf, usage } from './helpers'
import { cacheView } from './matrix'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'

type Usage = ReturnType<typeof resp>

/** A session pinned to the hour's cache, its subagents on five minutes, on a ledger of its own. */
const session = () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: undefined })
  c.turnStarted({ priceModel: undefined, ledger: 0 })
  let ledger = 0
  return {
    c,
    /** A step: the ledger read as it is sent, and again after it billed. */
    step: (model: string, u: Usage, at: number, isMain = true, mult = isMain ? 2 : 1.25): void => {
      const ledgerBefore = ledger
      ledger += listBill(u, model, mult)
      c.responded({ ...u, model }, at, isMain, { ledger, ledgerBefore })
    },
    /** Growth no step accounts for: a compaction's request, a fee. */
    grows: (usd: number): void => {
      ledger += usd
    },
    ledger: (): number => ledger,
  }
}

/** Turns on `model`, each reading the window so far and adding to it; the
 *  first reads nothing, its cache its own. Returns the clock and the window. */
const turns = (s: ReturnType<typeof session>, model: string, count: number, from: Readonly<{ at: number; prefix: number }>): Readonly<{ at: number; prefix: number }> => {
  let { at, prefix } = from
  s.step(model, resp(500, 0, prefix, 800), at)
  prefix += 500 + 800
  for (let i = 1; i < count; i++) {
    at += MIN
    s.step(model, resp(500, prefix, 5_000, 800), at)
    prefix += 500 + 5_000 + 800
  }
  return { at: at + MIN, prefix }
}

/** The re-warm true of `window` tokens on `model`, written for the hour. */
const trueReWarm = (model: string, window: number): number => listBill(resp(0, 0, window, 0), model, 2)

test('after a switch the re-warm is priced at the new model alone, and it remembers that rate', () => {
  const s = session()
  let at = turns(s, OPUS, 40, { at: 0, prefix: 100_000 })
  at = turns(s, SONNET, 3, at)
  const sonnet = cacheView(s.c, at.at, { ledger: s.ledger() })
  expectNear(sonnet.reWarmUsd, trueReWarm(SONNET, sonnet.window), 0.005)
  at = turns(s, HAIKU, 3, at)
  const haiku = cacheView(s.c, at.at, { ledger: s.ledger() })
  expectNear(haiku.reWarmUsd, trueReWarm(HAIKU, haiku.window), 0.005)
  // What a reopened session recalls under Haiku's name: its lower tier's rate.
  const rate = s.c.turnEnded(s.ledger()).remember?.rate ?? 0
  expectNear(rate, 1e-7, 1e-9)
})

test('a switch before the new model has a bill of its own remembers no blended rate', () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: undefined })
  c.turnStarted({ priceModel: undefined, ledger: 0 })
  c.responded({ ...resp(500, 0, 100_000, 800), model: OPUS }, 0, true, { ledger: 0.8 + 0.018, ledgerBefore: 0 })
  c.responded({ ...resp(500, 0, 100_000, 800), model: HAIKU }, MIN, true, { ledger: undefined })
  // The bill leaves about $0.02 over Haiku's steps, but it's no rate of its own.
  expect(c.turnEnded(0.84).remember?.rate).toBe(null)
})

test('a step whose ledger read failed leaves the rest told: its model solves from what is left over', () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: undefined })
  c.turnStarted({ priceModel: undefined, ledger: 0 })
  const opus = resp(500, 0, 100_000, 800)
  const sonnet = resp(500, 0, 100_000, 800)
  const opusBill = listBill(opus, OPUS, 2)
  const whole = opusBill + listBill(sonnet, SONNET, 2)
  c.responded({ ...opus, model: OPUS }, 0, true, { ledger: opusBill, ledgerBefore: 0 })
  c.responded({ ...sonnet, model: SONNET }, MIN, true, { ledger: undefined, ledgerBefore: undefined })
  const cache = cacheView(c, 2 * MIN, { ledger: whole })
  expectNear(cache.reWarmUsd, trueReWarm(SONNET, cache.window), 0.005)
})

test("subagents on another model neither move the main model's rate nor book its price on their reads", () => {
  const plain = session()
  const end = turns(plain, OPUS, 5, { at: 0, prefix: 150_000 })
  const withAgents = session()
  turns(withAgents, OPUS, 5, { at: 0, prefix: 150_000 })
  for (let i = 0; i < 20; i++) withAgents.step(HAIKU, resp(1_000, 90_000, 0, 200), i * MIN, false)

  const without = cacheView(plain.c, end.at, { ledger: plain.ledger() })
  const beside = cacheView(withAgents.c, end.at, { ledger: withAgents.ledger() })
  expectNear(beside.reWarmUsd, trueReWarm(OPUS, without.window), 0.005)
  // 1.8M reads at $0.01 per million rather than $0.10: 1.8M × 0.9 × $0.10 per million.
  expectNear((beside.savedUsd ?? 0) - (without.savedUsd ?? 0), 0.162, 0.005)
})

test('what the cache saved never falls at a switch to a cheaper model', () => {
  const s = session()
  const at = turns(s, OPUS, 10, { at: 0, prefix: 100_000 })
  const before = cacheView(s.c, at.at, { ledger: s.ledger() }).savedUsd
  expect(before).toBeGreaterThan(0)
  turns(s, HAIKU, 2, at)
  expect(cacheView(s.c, at.at + MIN, { ledger: s.ledger() }).savedUsd).toBeGreaterThanOrEqual(before ?? Infinity)
})

/** Keeps `c`'s counts as a reload does: through JSON. */
const reloaded = (c: CacheModel): CacheModel => newCache(JSON.parse(JSON.stringify(c.kept())))

test('a reload carries each model\'s own books', () => {
  const s = session()
  const at = turns(s, OPUS, 5, { at: 0, prefix: 100_000 })
  turns(s, SONNET, 2, at)
  const then = cacheView(s.c, HOUR, { ledger: s.ledger() })
  const now = cacheView(reloaded(s.c), HOUR, { ledger: s.ledger() })
  // Both figures are there to carry, and Sonnet's, the model it ended on.
  expectNear(then.reWarmUsd, trueReWarm(SONNET, then.window), 0.005)
  expect(then.savedUsd).toBeGreaterThan(0)
  expect(now.reWarmUsd).toBe(then.reWarmUsd)
  expect(now.savedUsd).toBe(then.savedUsd)
})

test('/clear starts the books again: the conversation after it solves from its own bill', () => {
  const s = session()
  turns(s, OPUS, 5, { at: 0, prefix: 100_000 })
  s.c.conversationEnded(s.ledger(), false)
  s.c.turnStarted({ priceModel: undefined, ledger: s.ledger() })
  const end = turns(s, HAIKU, 2, { at: HOUR, prefix: 20_000 })
  const { reWarmUsd, window } = cacheView(s.c, end.at, { ledger: s.ledger() })
  expectNear(reWarmUsd, trueReWarm(HAIKU, window), 0.0005)
  expect(Object.keys(s.c.kept().books)).toEqual([HAIKU])
})

test("a resumed conversation's earlier spend stays out of the books; its reads count in what was saved", () => {
  const s = session()
  s.c.resumed({ cache: undefined, transcript: { spend: { usd: 5, tokens: { uncached: 0, written: 0, writtenHour: 0, read: 1_000_000, output: 0 } }, ttl: undefined } })
  const at = turns(s, OPUS, 2, { at: 0, prefix: 100_000 })
  const end = turns(s, SONNET, 2, at)
  const look = cacheView(s.c, end.at, { ledger: s.ledger() })
  expectNear(look.reWarmUsd, trueReWarm(SONNET, look.window), 0.005)
  // 1M reads of the record's at the rate in force, Sonnet's: 1M × 0.95 × $2 per million.
  const unresumed = session()
  const a2 = turns(unresumed, OPUS, 2, { at: 0, prefix: 100_000 })
  const e2 = turns(unresumed, SONNET, 2, a2)
  expectNear((look.savedUsd ?? 0) - (cacheView(unresumed.c, e2.at, { ledger: unresumed.ledger() }).savedUsd ?? 0), 1.9, 0.005)
})

test("Haiku's upper tier holds in its own book: the rate stays the lower tier's beside another model", () => {
  const s = session()
  const at = turns(s, OPUS, 3, { at: 0, prefix: 100_000 })
  const end = turns(s, HAIKU, 3, { at: at.at, prefix: 150_000 })
  const rate = s.c.turnEnded(s.ledger()).remember?.rate ?? 0
  expectNear(rate, 1e-7, 1e-9)
  expectNear(cacheView(s.c, end.at, { ledger: s.ledger() }).reWarmUsd, trueReWarm(HAIKU, cacheView(s.c, end.at, { ledger: s.ledger() }).window), 0.005)
})

test("what a turn's end reads of the lifetime moves a model's own writes", () => {
  const c = newCache()
  c.turnStarted({ priceModel: undefined, ledger: 0 })
  const opus = resp(500, 0, 100_000, 800)
  // The ledger bills the writes at five minutes' 1.25×; the band assumed the hour's 2×.
  const opusBill = listBill(opus, OPUS, 1.25)
  c.responded({ ...opus, model: OPUS }, 0, true, { ledger: opusBill, ledgerBefore: 0 })
  c.turnEnded(opusBill)
  const sonnet = resp(500, 0, 100_000, 800)
  const whole = opusBill + listBill(sonnet, SONNET, 1.25)
  c.turnStarted({ priceModel: undefined, ledger: opusBill })
  c.responded({ ...sonnet, model: SONNET }, MIN, true, { ledger: whole, ledgerBefore: opusBill })
  c.turnEnded(whole)
  // The read lands after the turn's end; the rate is read at the next turn's, which sent nothing.
  c.wroteFor('5m')
  c.turnStarted({ priceModel: undefined, ledger: whole })
  const rate = c.turnEnded(whole).remember?.rate ?? 0
  expectNear(rate, 2e-6, 1e-9)
})

// ---- growth outside a step --------------------------------------------------

test("growth between steps, a compaction's request or a fee, stays off a one-model session's rate", () => {
  const s = session()
  s.step(HAIKU, resp(500, 0, 50_000, 800), 0)
  s.grows(0.002) // the compaction's own request, which raises no step
  s.step(HAIKU, resp(500, 0, 20_000, 800), MIN)
  const rate = s.c.turnEnded(s.ledger()).remember?.rate ?? 0
  expectNear(rate, 1e-7, 1e-10)
})

test('growth since the last step, at a redraw, a turn\'s end or the next turn\'s start, stays off the rate', () => {
  const s = session()
  s.step(HAIKU, resp(500, 0, 50_000, 800), 0)
  s.grows(0.002)
  expectNear(s.c.turnEnded(s.ledger()).remember?.rate, 1e-7, 1e-10)
  const cache = cacheView(s.c, MIN, { ledger: s.ledger() })
  expectNear(cache.reWarmUsd, trueReWarm(HAIKU, cache.window), 1e-6)
  s.c.turnStarted({ priceModel: undefined, ledger: s.ledger() })
  s.step(HAIKU, resp(500, 50_000, 1_000, 800), 2 * MIN)
  expectNear(s.c.turnEnded(s.ledger()).remember?.rate, 1e-7, 1e-10)
})

test('what the session has cost still counts every dollar, off the rate or on it', () => {
  const s = session()
  s.step(HAIKU, resp(500, 0, 50_000, 800), 0)
  s.grows(0.002)
  s.step(HAIKU, resp(500, 50_000, 1_000, 800), MIN)
  expect(s.c.view({ now: 2 * MIN, ledger: s.ledger(), contextTokens: 0, autoCompactOff: false }).costUsd).toBe(s.ledger())
})

test('two steps under way at once each take their own bill', () => {
  const c = newCache()
  c.configured({ ttl: '1h', idleCompactFrom: undefined, subagentTtl: '1h' })
  c.turnStarted({ priceModel: undefined, ledger: 0 })
  const main = resp(500, 0, 100_000, 800)
  const agent = resp(500, 0, 50_000, 800)
  const mainBill = listBill(main, OPUS, 2)
  const agentBill = listBill(agent, HAIKU, 2)
  // Both sent at $0; the subagent's comes back first, inside the main step's window.
  c.responded({ ...agent, model: HAIKU }, MIN, false, { ledger: agentBill, ledgerBefore: 0 })
  c.responded({ ...main, model: OPUS }, 0, true, { ledger: agentBill + mainBill, ledgerBefore: 0 })
  const rate = c.turnEnded(agentBill + mainBill).remember?.rate ?? 0
  expectNear(rate, 4e-6, 1e-9)
})

// ---- through the hooks ------------------------------------------------------

test('through the hooks: a ledger that moves inside a step and between steps solves Haiku at its true rate', LONG, async ($, on) => {
  // Measured on 2.1.316: a compaction's request raises no step and adds to the
  // ledger; a Haiku session's rate read 33% high with it in.
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 0 } }, env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } })
  engine.model = HAIKU
  await $.session.start(START)
  await $.turn.start(TURN_START)
  const first = resp(500, 0, 50_000, 800)
  await respond($, first, { model: HAIKU, billsTo: listBill(first, HAIKU, 2) })
  ledgerGrows(0.002)
  const second = resp(500, 0, 20_000, 800)
  await respond($, second, { model: HAIKU, billsTo: (usage.current.cost?.usd ?? 0) + listBill(second, HAIKU, 2) })
  ledgerGrows(0.0005)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const rate = (engine.store.rates as Record<string, number>)[HAIKU] ?? 0
  expectNear(rate, 1e-7, 1e-10)
})

test('through the hooks: after a switch the store keeps the new model its own rate, and a reopened session recalls it', LONG, async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 0 } }, env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } })
  await $.session.start(START)
  await $.turn.start(TURN_START)
  const opus = resp(500, 0, 200_000, 800)
  await respond($, opus, { billsTo: listBill(opus, OPUS, 2) })
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  await $.turn.start(TURN_START)
  const sonnet = resp(500, 0, 200_000, 800)
  usage.current = { ...usage.current, context: { tokens: 201_300, window: 1_000_000, percent: 20 } }
  await respond($, sonnet, { model: SONNET, billsTo: (usage.current.cost?.usd ?? 0) + listBill(sonnet, SONNET, 2) })
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const rates = engine.store.rates as Record<string, number>
  expectNear(rates[OPUS], 4e-6, 1e-9)
  expectNear(rates[SONNET], 2e-6, 1e-9)

  await clock.advance(2 * HOUR)
  await $.session.start(START)
  await clock.settle()
  // 201,300 written for an hour at $2 per million: $0.81, where a blend says more.
  const ui = await mountBand($, 'terminal', 160)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/next message ~\$0\.81\b/)
  await ui.unmount()
})
