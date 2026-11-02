// An old session reopened, or the band reloaded mid-session: the band has
// seen no reply yet, so it recalls when the last one was and what tokens
// cost on this model, and says whether the cache is cold and what the next
// message will cost.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BUILD_155K, FRESH, HOUR, LONG, MIN, START, TURN_DONE, TURN_START, USAGE, cardOf, cardText, costRecord, engine, fact, hoverCardOf, jsonl, pillOf, promptLine, replyLine, requestLines, resp, respond, shown, transcriptOf, usage, setup, mountBand } from './helpers'

const ENV = { ENABLE_PROMPT_CACHING_1H: '1', HOME: '/Users/me' }
const MODEL = 'claude-opus-5-5'
/** A round rate on Opus 5.5: $0.00001 a token. */
const RATE = 0.00001
/** Claude Haiku 5.5, whose prompts over 100k pay 5× every price, and the
 *  lower tier's rate, $0.10 per million. */
const HAIKU = 'claude-haiku-5-5'
const HAIKU_RATE = 0.0000001
/** A Haiku 5.5 session past 100k: 151k of context, and $0.1387 spent on two
 *  requests, writing for the pinned hour at 2×: a 20k prompt, 43k weighted,
 *  and a 150k one at 5×, 1,344k. */
const HAIKU_USAGE = { ...USAGE, cost: { usd: 0.1387 }, context: { tokens: 151_000, window: 1_000_000, percent: 15 } }
/** Its two requests, billed on Haiku 5.5. */
const haikuTurn = async ($: Engine) => {
  await respond($, resp(2_000, 0, 18_000, 1_000), { model: HAIKU })
  await respond($, resp(2_000, 18_000, 130_000, 1_000), { model: HAIKU })
  await $.turn.complete(TURN_DONE)
}
/** 151k written for an hour at the upper tier: 151k × 2 × $0.50 per million
 *  = $0.151. At the lower tier it would say ~$0.03. */
const HAIKU_COLD = /cache cold · next message ~\$0\.15\b/

const mounted = async ($: Engine, open = false) => {
  const ui = await mountBand($, 'terminal', 140)
  if (open) await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

test('reloaded ten minutes after a reply, the band counts down from that reply', async ($, on) => {
  setup(on, { env: ENV, store: { sessions: { s1: { lastAt: 0 } } }, now: 10 * MIN })
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 50m/)
})

test('a stored reply dated after now is unknown: the transcript says when it was, and the next write drops the entry', async ($, on) => {
  const clock = setup(on, { env: ENV, store: { sessions: { s1: { lastAt: 1e15 }, other: { lastAt: 6 * HOUR } } }, now: 10 * MIN })
  engine.transcript = transcriptOf(5 * MIN)
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 55m/)
  await $.turn.start(TURN_START)
  await respond($, BUILD_155K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const kept = engine.store.sessions as Record<string, { lastAt: number }>
  expect(kept.other).toBeUndefined()
  expect(kept.s1?.lastAt).toBeLessThanOrEqual(10 * MIN)
})

test('a stored reply dated after now, with no transcript to say better, draws no countdown', async ($, on) => {
  setup(on, { env: ENV, store: { sessions: { s1: { lastAt: 1e15 } } }, now: 10 * MIN })
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).not.toMatch(/\d{2,}h|cache \d/)
})

test('reopened two days later, the cache is cold and the next message has a price', async ($, on) => {
  setup(on, { env: ENV, store: { sessions: { s1: { lastAt: 0 } }, rates: { [MODEL]: RATE } }, now: 48 * HOUR })
  await $.session.start(START)
  // an hour's write, at 2×: 2 × 76k tokens × the rate
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold · next message ~\$1\.52/)
  const tree = await mounted($, true)
  expect(shown(cardOf(tree, 'cache'))).toMatch(/^CACHEcold/)
  expect(fact(tree, 'idle for')).toBe('2d 0h')
  expect(fact(tree, 'next message')).toMatch(/^~\$1\.52( · |$)/)
})

test('with no rate known for the model yet, it names the tokens instead of guessing a price', async ($, on) => {
  setup(on, { env: ENV, store: { sessions: { s1: { lastAt: 0 } }, rates: { 'claude-sonnet-5-5': RATE } }, now: 48 * HOUR })
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold · next message 76k tokens/)
})

test('a session from before the band reads its last reply off its transcript, never the file time', async ($, on) => {
  setup(on, { env: ENV, now: 3 * HOUR })
  engine.transcript = transcriptOf(0)
  await $.session.start(START)
  expect(engine.ran.find(argv => argv[0] === 'tail')?.at(-1)).toBe('/Users/me/.claude/projects/-Users-me-workspace-nextcost/s1.jsonl')
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold/)
})

test("a transcript with 2 MB of the request's blobs before its last reply is read all the same", async ($, on) => {
  setup(on, { env: ENV, now: 3 * HOUR })
  engine.transcript = jsonl(promptLine(-5_000), ...requestLines(-3_000, 2 * 1024 * 1024), replyLine(0), costRecord('claude-opus-5-5'))
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold · next message ~\$/)
})

test("its price comes from the transcript's own cost record, per model", async ($, on) => {
  setup(on, { env: ENV, now: 3 * HOUR })
  // Opus 5.5 reads its cache at 0.05× input: $20 over 1M input + 1.25 × 400k
  // written (the record doesn't split its writes by lifetime) + 0.05 × 20M
  // read + 5 × 100k output = 3M weighted tokens
  engine.transcript = transcriptOf(0, {
    'claude-opus-5-5': { inputTokens: 1_000_000, cacheCreationInputTokens: 400_000, cacheReadInputTokens: 20_000_000, outputTokens: 100_000, costUSD: 20 },
  })
  await $.session.start(START)
  // an hour's re-warm, at 2×: 2 × 76k × $20 / 3M
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/next message ~\$1\.01/)
})

test("reopened under an alias, the price is read for the model the last reply was billed under", async ($, on) => {
  setup(on, { env: ENV, now: 3 * HOUR })
  engine.model = 'opus[1m]'
  engine.transcript = transcriptOf(0, {
    'claude-opus-5-5': { inputTokens: 1_000_000, cacheCreationInputTokens: 400_000, cacheReadInputTokens: 20_000_000, outputTokens: 100_000, costUSD: 20 },
  })
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/next message ~\$1\.01/)
})

test('a transcript of any size is read from its end, the last megabyte alone', async ($, on) => {
  setup(on, { env: ENV, now: 3 * HOUR })
  engine.transcript = transcriptOf(0)
  engine.transcriptBytes = 40 * 1024 * 1024
  await $.session.start(START)
  expect(engine.ran).toContainEqual(['tail', '-c', String(1024 * 1024), '/Users/me/.claude/projects/-Users-me-workspace-nextcost/s1.jsonl'])
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold/)
})

test('without tail, a small transcript is read whole', async ($, on) => {
  setup(on, { env: ENV, now: 3 * HOUR })
  engine.tailFails = true
  engine.transcript = transcriptOf(0)
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold/)
})

test('without tail, a transcript too big to read leaves the cache unmeasured', async ($, on) => {
  setup(on, { env: ENV, now: 3 * HOUR })
  engine.tailFails = true
  engine.transcript = transcriptOf(0)
  engine.transcriptBytes = 5 * 1024 * 1024
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache –/)
})

test('with nothing to recall, the cache stays unmeasured', async ($, on) => {
  setup(on, { env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache –/)
})

test('a brand-new session ignores anything remembered', async ($, on) => {
  setup(on, { usage: FRESH, env: ENV, store: { sessions: { s1: { lastAt: 0 } } }, now: 10 * MIN })
  await $.session.start(START)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache warming/)
})

test('after each turn the band remembers the reply and the rate it solved', async ($, on) => {
  const clock = setup(on, { env: ENV })
  await $.session.start(START)
  await clock.advance(5 * MIN)
  await $.turn.start(TURN_START)
  usage.current = { ...usage.current, cost: { usd: 2.83 } } // the turn cost $0.42
  await respond($, BUILD_155K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  expect(engine.store.sessions).toEqual({ s1: { lastAt: 5 * MIN, billed: MODEL } })
  const rates = engine.store.rates as Record<string, number>
  expect(rates[MODEL]).toBeGreaterThan(0)
})

test('a rate solved on a 1M-context session is remembered under the model, for any window', async ($, on) => {
  const clock = setup(on, { env: ENV })
  engine.model = `${MODEL}[1m]`
  await $.session.start(START)
  await $.turn.start(TURN_START)
  usage.current = { ...usage.current, cost: { usd: 2.83 } }
  await respond($, BUILD_155K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  expect(Object.keys(engine.store.rates as Record<string, number>)).toEqual([MODEL])
})

test('a rate solved on a session named by an alias is remembered under the billed model, as an older version reads it', async ($, on) => {
  const clock = setup(on, { env: ENV })
  engine.model = 'opus[1m]'
  await $.session.start(START)
  await $.turn.start(TURN_START)
  usage.current = { ...usage.current, cost: { usd: 2.83 } }
  await respond($, BUILD_155K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  expect(Object.keys(engine.store.rates as Record<string, number>)).toEqual([MODEL])
  expect(engine.store.sessions).toEqual({ s1: { lastAt: 0, billed: MODEL } })
})

test('reloaded, a session named by an alias recalls its rate from the store, with no transcript to read', LONG, async ($, on) => {
  const clock = setup(on, { env: ENV })
  engine.model = 'opus[1m]'
  await $.session.start(START)
  await $.turn.start(TURN_START)
  usage.current = { ...usage.current, cost: { usd: 2.83 } }
  await respond($, BUILD_155K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  await clock.advance(2 * HOUR)
  engine.ran.length = 0
  await $.session.start(START)
  await clock.settle()
  expect(engine.ran.filter(argv => argv[0] === 'tail')).toEqual([])
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold · next message ~\$/)
})

test("reloaded with no transcript, a session named by an alias prices its re-warm at the billed model's tier", LONG, async ($, on) => {
  const clock = setup(on, { env: ENV, usage: HAIKU_USAGE })
  engine.model = 'haiku'
  await $.session.start(START)
  await haikuTurn($)
  await clock.settle()
  await clock.advance(61 * MIN)
  engine.ran.length = 0
  await $.session.start(START)
  await clock.settle()
  expect(engine.ran.filter(argv => argv[0] === 'tail')).toEqual([])
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(HAIKU_COLD)
})

test("reloaded with no transcript, a session named by an alias reads its cache at the billed model's share", async ($, on) => {
  const clock = setup(on, { env: ENV })
  engine.model = 'opus[1m]'
  await $.session.start(START)
  await $.turn.start(TURN_START)
  usage.current = { ...usage.current, cost: { usd: 2.83 } }
  await respond($, BUILD_155K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  await clock.advance(10 * MIN)
  await $.session.start(START)
  await clock.settle()
  const ui = await mountBand($, 'terminal', 140)
  // Opus 5.5 reads its cache at 0.05× input; an unknown model at 0.1×.
  expect(cardText(hoverCardOf(await ui.drawn(), 'cache'))).toMatch(/warm cache bills input at 5%/)
  await ui.unmount()
})

test('a session remembered without its billed model, as older versions kept it, recalls the model off its transcript', async ($, on) => {
  setup(on, { env: ENV, usage: HAIKU_USAGE, store: { sessions: { s1: { lastAt: 0 } }, rates: { [HAIKU]: HAIKU_RATE } }, now: 3 * HOUR })
  engine.model = 'haiku'
  engine.transcript = jsonl(promptLine(-5000), { type: 'assistant', timestamp: new Date(0).toISOString(), message: { role: 'assistant', model: HAIKU, content: [] } })
  await $.session.start(START)
  expect(engine.ran.filter(argv => argv[0] === 'tail')).toHaveLength(1)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(HAIKU_COLD)
})

test('the band remembers at most 50 sessions, the oldest replies going first', async ($, on) => {
  const older = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`old${i}`, { lastAt: -1000 + i }]))
  const clock = setup(on, { env: ENV, store: { sessions: older } })
  await $.session.start(START)
  await clock.advance(MIN)
  await $.turn.start(TURN_START)
  await respond($, BUILD_155K)
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  const kept = Object.keys(engine.store.sessions as Record<string, unknown>)
  expect(kept).toHaveLength(50)
  expect(kept).toContain('s1')
  expect(kept).not.toContain('old0')
})
