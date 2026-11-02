// The base rate after a model switch, under subagents on another model, and on
// a provider's model ids: each model solves its own, from what the ledger grew
// by across its own steps. The ledger here bills as Anthropic lists it.

import { test, expect } from 'claude-code/testing'
import { newCache, type CacheModel } from '../hooks/cache'
import { readMultiplier, tierFactor } from '../hooks/prices'
import { recallOf, fromStore } from '../hooks/memory'
import { rateFromTranscript, transcriptSpend } from '../hooks/transcript'
import { HOUR, LONG, MIN, START, TURN_DONE, TURN_START, USAGE, engine, ledgerGrows, mountBand, resp, respond, setup, shown, pillOf, usage } from './helpers'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const BASE: Readonly<Record<string, number>> = { [OPUS]: 4e-6, [SONNET]: 2e-6, [HAIKU]: 1e-7 }
const READ: Readonly<Record<string, number>> = { [OPUS]: 0.05, [SONNET]: 0.05, [HAIKU]: 0.1 }

type Usage = ReturnType<typeof resp>

/** What the list bills `u` on `model`, its writes at `writeMult`. */
const billOf = (u: Usage, model: string, writeMult: number): number => {
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const tier = model === HAIKU && prompt > 100_000 ? 5 : 1
  return (BASE[model] ?? 0) * tier * (u.input_tokens + writeMult * u.cache_creation_input_tokens + (READ[model] ?? 0.1) * u.cache_read_input_tokens + 5 * u.output_tokens)
}

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
      ledger += billOf(u, model, mult)
      c.responded({ ...u, model }, at, isMain, { ledger, ledgerBefore })
    },
    /** Growth no step accounts for: a compaction's request, a fee. */
    grows: (usd: number): void => {
      ledger += usd
    },
    ledger: (): number => ledger,
    look: (at: number) => c.view({ now: at, ledger, contextTokens: 0, autoCompactOff: false }).cache,
  }
}

const near = (a: number | null | undefined, b: number, within = 0.005): boolean => a !== null && a !== undefined && Math.abs(a - b) < within

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
const trueReWarm = (model: string, window: number): number => 2 * window * (BASE[model] ?? 0) * (model === HAIKU && window > 100_000 ? 5 : 1)

test('after a switch the re-warm is priced at the new model alone, and it remembers that rate', () => {
  const s = session()
  let at = turns(s, OPUS, 40, { at: 0, prefix: 100_000 })
  at = turns(s, SONNET, 3, at)
  const sonnet = s.look(at.at)
  expect(near(sonnet.reWarmUsd, trueReWarm(SONNET, sonnet.window))).toBe(true)
  at = turns(s, HAIKU, 3, at)
  const haiku = s.look(at.at)
  expect(near(haiku.reWarmUsd, trueReWarm(HAIKU, haiku.window))).toBe(true)
  // What a reopened session recalls under Haiku's name: its lower tier's rate.
  const rate = s.c.turnEnded(s.ledger()).remember?.rate ?? 0
  expect(Math.abs(rate - 1e-7) < 1e-9).toBe(true)
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
  const opusBill = billOf(opus, OPUS, 2)
  const whole = opusBill + billOf(sonnet, SONNET, 2)
  c.responded({ ...opus, model: OPUS }, 0, true, { ledger: opusBill, ledgerBefore: 0 })
  c.responded({ ...sonnet, model: SONNET }, MIN, true, { ledger: undefined, ledgerBefore: undefined })
  const { cache } = c.view({ now: 2 * MIN, ledger: whole, contextTokens: 0, autoCompactOff: false })
  expect(near(cache.reWarmUsd, trueReWarm(SONNET, cache.window))).toBe(true)
})

test("subagents on another model neither move the main model's rate nor book its price on their reads", () => {
  const plain = session()
  const end = turns(plain, OPUS, 5, { at: 0, prefix: 150_000 })
  const withAgents = session()
  turns(withAgents, OPUS, 5, { at: 0, prefix: 150_000 })
  for (let i = 0; i < 20; i++) withAgents.step(HAIKU, resp(1_000, 90_000, 0, 200), i * MIN, false)

  const without = plain.look(end.at)
  const beside = withAgents.look(end.at)
  expect(near(beside.reWarmUsd, trueReWarm(OPUS, without.window))).toBe(true)
  // 1.8M reads at $0.01 per million rather than $0.10: 1.8M × 0.9 × $0.10 per million.
  expect(near((beside.savedUsd ?? 0) - (without.savedUsd ?? 0), 0.162)).toBe(true)
})

test('what the cache saved never falls at a switch to a cheaper model', () => {
  const s = session()
  const at = turns(s, OPUS, 10, { at: 0, prefix: 100_000 })
  const before = s.look(at.at).savedUsd ?? 0
  turns(s, HAIKU, 2, at)
  expect((s.look(at.at + MIN).savedUsd ?? 0) >= before).toBe(true)
})

test("a provider's id for a model prices as the model", () => {
  for (const id of ['us.anthropic.claude-opus-5-5-v1:0', 'global.anthropic.claude-opus-5-5-v1:0', 'anthropic.claude-opus-5-5-v1:0', 'claude-opus-5-5@20261001', 'claude-opus-5-5-20261001', 'us.anthropic.claude-opus-5-5-20261001-v1:0', 'us.anthropic.claude-opus-5-5-v1:0[1m]', 'claude-opus-5-5']) {
    expect(readMultiplier(id)).toBe(0.05)
  }
  for (const id of ['us.anthropic.claude-haiku-5-5-v1:0', 'claude-haiku-5-5@20261001', 'claude-haiku-5-5-20261001']) {
    expect(tierFactor(id, 100_001)).toBe(5)
    expect(tierFactor(id, 100_000)).toBe(1)
  }
  expect(readMultiplier('us.anthropic.claude-fable-5-1-v1:0')).toBe(0.025)
})

test("a name that isn't a provider's form stays as it is", () => {
  expect(readMultiplier('claude-opus-5-5-preview')).toBe(0.1)
  expect(readMultiplier('claude-opus-5-5-2026')).toBe(0.1)
  expect(readMultiplier('my-opus-gateway')).toBe(0.1)
  expect(tierFactor('claude-opus-5-5@20261001', 900_000)).toBe(1)
})

/** Keeps `c`'s counts as a reload does: through JSON. */
const reloaded = (c: CacheModel): CacheModel => newCache(JSON.parse(JSON.stringify(c.kept())))

test('a reload carries each model\'s own books', () => {
  const s = session()
  const at = turns(s, OPUS, 5, { at: 0, prefix: 100_000 })
  turns(s, SONNET, 2, at)
  const look = (c: CacheModel) => c.view({ now: HOUR, ledger: s.ledger(), contextTokens: 0, autoCompactOff: false }).cache
  const then = look(s.c)
  const now = look(reloaded(s.c))
  expect(now.reWarmUsd).toBe(then.reWarmUsd)
  expect(now.savedUsd).toBe(then.savedUsd)
})

test('/clear starts the books again: the conversation after it solves from its own bill', () => {
  const s = session()
  turns(s, OPUS, 5, { at: 0, prefix: 100_000 })
  s.c.conversationEnded(s.ledger(), false)
  s.c.turnStarted({ priceModel: undefined, ledger: s.ledger() })
  const end = turns(s, HAIKU, 2, { at: HOUR, prefix: 20_000 })
  const { reWarmUsd, window } = s.look(end.at)
  expect(near(reWarmUsd, trueReWarm(HAIKU, window), 0.0005)).toBe(true)
  expect(Object.keys(s.c.kept().books)).toEqual([HAIKU])
})

test("a resumed conversation's earlier spend stays out of the books; its reads count in what was saved", () => {
  const s = session()
  s.c.resumed({ cache: undefined, transcript: { spend: { usd: 5, tokens: { uncached: 0, written: 0, writtenHour: 0, read: 1_000_000, output: 0 } }, ttl: undefined } })
  const at = turns(s, OPUS, 2, { at: 0, prefix: 100_000 })
  const end = turns(s, SONNET, 2, at)
  const look = s.look(end.at)
  expect(near(look.reWarmUsd, trueReWarm(SONNET, look.window))).toBe(true)
  // 1M reads of the record's at the rate in force, Sonnet's: 1M × 0.95 × $2 per million.
  const unresumed = session()
  const a2 = turns(unresumed, OPUS, 2, { at: 0, prefix: 100_000 })
  const e2 = turns(unresumed, SONNET, 2, a2)
  expect(near((look.savedUsd ?? 0) - (unresumed.look(e2.at).savedUsd ?? 0), 1.9)).toBe(true)
})

test("Haiku's upper tier holds in its own book: the rate stays the lower tier's beside another model", () => {
  const s = session()
  const at = turns(s, OPUS, 3, { at: 0, prefix: 100_000 })
  const end = turns(s, HAIKU, 3, { at: at.at, prefix: 150_000 })
  const rate = s.c.turnEnded(s.ledger()).remember?.rate ?? 0
  expect(Math.abs(rate - 1e-7) < 1e-9).toBe(true)
  expect(near(s.look(end.at).reWarmUsd, trueReWarm(HAIKU, s.look(end.at).window))).toBe(true)
})

test("what a turn's end reads of the lifetime moves a model's own writes", () => {
  const c = newCache()
  c.turnStarted({ priceModel: undefined, ledger: 0 })
  const opus = resp(500, 0, 100_000, 800)
  // The ledger bills the writes at five minutes' 1.25×; the band assumed the hour's 2×.
  const opusBill = billOf(opus, OPUS, 1.25)
  c.responded({ ...opus, model: OPUS }, 0, true, { ledger: opusBill, ledgerBefore: 0 })
  c.turnEnded(opusBill)
  const sonnet = resp(500, 0, 100_000, 800)
  const whole = opusBill + billOf(sonnet, SONNET, 1.25)
  c.turnStarted({ priceModel: undefined, ledger: opusBill })
  c.responded({ ...sonnet, model: SONNET }, MIN, true, { ledger: whole, ledgerBefore: opusBill })
  c.turnEnded(whole)
  c.wroteFor('5m')
  const rate = c.turnEnded(whole).remember?.rate ?? 0
  expect(Math.abs(rate - 2e-6) < 1e-9).toBe(true)
})

// ---- growth outside a step --------------------------------------------------

test("growth between steps, a compaction's request or a fee, stays off a one-model session's rate", () => {
  const s = session()
  s.step(HAIKU, resp(500, 0, 50_000, 800), 0)
  s.grows(0.002) // the compaction's own request, which raises no step
  s.step(HAIKU, resp(500, 0, 20_000, 800), MIN)
  const rate = s.c.turnEnded(s.ledger()).remember?.rate ?? 0
  expect(Math.abs(rate - 1e-7) < 1e-10).toBe(true)
})

test('growth since the last step, at a redraw, a turn\'s end or the next turn\'s start, stays off the rate', () => {
  const s = session()
  s.step(HAIKU, resp(500, 0, 50_000, 800), 0)
  s.grows(0.002)
  expect(Math.abs((s.c.turnEnded(s.ledger()).remember?.rate ?? 0) - 1e-7) < 1e-10).toBe(true)
  const { cache } = s.c.view({ now: MIN, ledger: s.ledger(), contextTokens: 0, autoCompactOff: false })
  expect(near(cache.reWarmUsd, trueReWarm(HAIKU, cache.window), 1e-6)).toBe(true)
  s.c.turnStarted({ priceModel: undefined, ledger: s.ledger() })
  s.step(HAIKU, resp(500, 50_000, 1_000, 800), 2 * MIN)
  expect(Math.abs((s.c.turnEnded(s.ledger()).remember?.rate ?? 0) - 1e-7) < 1e-10).toBe(true)
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
  const mainBill = billOf(main, OPUS, 2)
  const agentBill = billOf(agent, HAIKU, 2)
  // Both sent at $0; the subagent's comes back first, inside the main step's window.
  c.responded({ ...agent, model: HAIKU }, MIN, false, { ledger: agentBill, ledgerBefore: 0 })
  c.responded({ ...main, model: OPUS }, 0, true, { ledger: agentBill + mainBill, ledgerBefore: 0 })
  const rate = c.turnEnded(agentBill + mainBill).remember?.rate ?? 0
  expect(Math.abs(rate - 4e-6) < 1e-9).toBe(true)
})

// ---- fast mode --------------------------------------------------------------

test('a speed change is no unexpected rebuild, and the re-warm follows the new speed', () => {
  const s = session()
  const end = turns(s, OPUS, 3, { at: 0, prefix: 100_000 })
  // Fast mode: twice every price, and a cache of its own, so it reads nothing.
  const window = end.prefix
  const fast = resp(500, 0, window, 800)
  const bill = 2 * billOf(fast, OPUS, 2)
  const was = s.ledger()
  s.grows(bill)
  s.c.responded({ ...fast, model: OPUS }, end.at, true, { ledger: s.ledger(), ledgerBefore: was })
  const look = s.look(end.at + MIN)
  expect(look.misses).toBe(0)
  expect(near(look.reWarmUsd, 2 * trueReWarm(OPUS, look.window))).toBe(true)
  // A rate at fast prices isn't kept for the model's other sessions.
  expect(s.c.turnEnded(s.ledger()).remember?.rate).toBe(null)
})

test('a short read billed at the usual rate is still an unexpected rebuild', () => {
  const s = session()
  const end = turns(s, OPUS, 3, { at: 0, prefix: 100_000 })
  s.step(OPUS, resp(500, 0, end.prefix, 800), end.at)
  expect(s.look(end.at).misses).toBe(1)
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
  usage.current = { ...USAGE, cost: { usd: billOf(first, HAIKU, 2) } }
  await respond($, first, { model: HAIKU })
  ledgerGrows(0.002)
  const second = resp(500, 0, 20_000, 800)
  usage.current = { ...USAGE, cost: { usd: (usage.current.cost?.usd ?? 0) + billOf(second, HAIKU, 2) } }
  await respond($, second, { model: HAIKU })
  ledgerGrows(0.0005)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const rate = (engine.store.rates as Record<string, number>)[HAIKU] ?? 0
  expect(Math.abs(rate - 1e-7) < 1e-10).toBe(true)
})

test('through the hooks: after a switch the store keeps the new model its own rate, and a reopened session recalls it', LONG, async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 0 } }, env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } })
  await $.session.start(START)
  await $.turn.start(TURN_START)
  const opus = resp(500, 0, 200_000, 800)
  usage.current = { ...USAGE, cost: { usd: billOf(opus, OPUS, 2) } }
  await respond($, opus)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  await $.turn.start(TURN_START)
  const sonnet = resp(500, 0, 200_000, 800)
  usage.current = { ...USAGE, cost: { usd: (usage.current.cost?.usd ?? 0) + billOf(sonnet, SONNET, 2) }, context: { tokens: 201_300, window: 1_000_000, percent: 20 } }
  await respond($, sonnet, { model: SONNET })
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const rates = engine.store.rates as Record<string, number>
  expect(Math.abs((rates[OPUS] ?? 0) - 4e-6) < 1e-9).toBe(true)
  expect(Math.abs((rates[SONNET] ?? 0) - 2e-6) < 1e-9).toBe(true)

  await clock.advance(2 * HOUR)
  await $.session.start(START)
  await clock.settle()
  // 201,300 written for an hour at $2 per million: $0.81, where a blend says more.
  const ui = await mountBand($, 'terminal', 160)
  expect(shown(pillOf(await ui.drawn(), 'cache'))).toMatch(/next message ~\$0\.81\b/)
  await ui.unmount()
})

test('a stored rate under a provider id is found again under that id', () => {
  const id = 'us.anthropic.claude-opus-5-5-v1:0'
  const stored = fromStore({ sessions: { s1: { lastAt: 5, billed: id } }, rates: { [id]: 4e-6 } }, 's1', 'opus')
  expect(recallOf(stored, undefined).rate).toBe(4e-6)
})

// ---- the cost record's split ------------------------------------------------

const record = (m: Record<string, unknown>): string =>
  JSON.stringify({ type: 'cost-state', sessionId: 's1', totalCostUSD: 1, modelUsage: { [OPUS]: { costUSD: 1, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 100_000, ...m } } })

test("a cost record that splits its writes by lifetime is solved at each's price; one that doesn't, as five minutes'", () => {
  // $1 on 100k written: at the hour's 2×, $5 per million; at 1.25×, $8.
  const split = record({ cacheCreationEphemeral5mInputTokens: 0, cacheCreationEphemeral1hInputTokens: 100_000 })
  expect(Math.abs((rateFromTranscript(split, OPUS) ?? 0) - 5e-6) < 1e-12).toBe(true)
  expect(Math.abs((rateFromTranscript(record({}), OPUS) ?? 0) - 8e-6) < 1e-12).toBe(true)
  expect(transcriptSpend(split, 's1', 0)?.tokens.writtenHour).toBe(100_000)
  expect(transcriptSpend(record({}), 's1', 0)?.tokens.writtenHour).toBe(0)
})
