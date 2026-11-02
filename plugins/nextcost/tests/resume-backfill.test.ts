// A past session resumed (`claude --resume`, /resume, or opened again in the
// desktop app): its ledger may read $0, but the conversation didn't start
// here. The engine's SessionStart says how long it sat idle and what
// re-caching costs; its transcript says what it has spent.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'
import { BUILD_155K, BUILD_80K, CLEAR, HOUR, LONG, MIN, START, TURN_DONE, TURN_START, USAGE, breakdown, cardOf, engine, fact, toasts, jsonl, pillOf, resp, respond, setup, shown, startTurn, endTurn, svgAlts, turn, mountBand, usage } from './helpers'

const ENV = { ENABLE_PROMPT_CACHING_1H: '1', HOME: '/Users/me' }
const BUILT_PATH = '/Users/me/.claude/projects/-Users-me-workspace-nextcost/s1.jsonl'
const PATH = '/Users/me/.claude/projects/-Users-me-elsewhere/s1.jsonl'
/** A resumed session whose ledger starts again at $0. */
const RESUMED: SessionUsage = { ...USAGE, cost: { usd: 0 } }

const mounted = async ($: Engine, open = false) => {
  const ui = await mountBand($, 'terminal', 140)
  if (open) await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

/** One reply, logged once per content block, each line with the same usage. */
const reply = (id: string, blocks: number, usage: Record<string, unknown>, model = 'claude-opus-5-5') =>
  Array.from({ length: blocks }, (_, i) => ({
    type: 'assistant',
    timestamp: new Date(i).toISOString(),
    isSidechain: false,
    message: { id, role: 'assistant', model, content: [{ type: 'text', text: `block ${i}` }], usage },
  }))

/** $30 over 1M uncached + 1.25 × 400k written + 0.05 × 20M read + 5 × 100k
 *  output = 3M weighted tokens: $0.00001 a token on Opus 5.5. */
const RECORD = {
  type: 'cost-state',
  totalCostUSD: 30,
  startTime: 0,
  modelUsage: {
    'claude-opus-5-5': { inputTokens: 1_000_000, cacheCreationInputTokens: 400_000, cacheReadInputTokens: 20_000_000, outputTokens: 100_000, costUSD: 30 },
  },
}

/** 1,000 + 2 × 2,000 written for an hour + 0.05 × 100,000 + 5 × 1,000 =
 *  15,000 weighted tokens: $0.15 at the record's rate. */
const REPLY_USAGE = {
  input_tokens: 1_000,
  cache_creation_input_tokens: 2_000,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2_000 },
  cache_read_input_tokens: 100_000,
  output_tokens: 1_000,
}

/** An older record, then the last one, then two replies logged after it,
 *  the first over three content blocks. */
const TRANSCRIPT = jsonl(
  { type: 'user', message: { role: 'user', content: 'hi' } },
  { ...RECORD, totalCostUSD: 12 },
  ...reply('msg_old', 1, REPLY_USAGE),
  RECORD,
  ...reply('msg_1', 3, REPLY_USAGE),
  ...reply('msg_2', 1, REPLY_USAGE),
)

/** The engine resuming a conversation last answered `idleMs` ago: by
 *  default the session's own, as at launch. */
const resume = (
  $: Engine,
  idleMs: number,
  fields: { expired?: boolean; reWarmUsd?: number; path?: string; source?: 'resume' | 'fork'; sessionId?: string } = {},
) =>
  $.classic.SessionStart({
    source: fields.source ?? 'resume',
    session_id: fields.sessionId ?? engine.sessionId,
    transcript_path: fields.path ?? PATH,
    seconds_since_last_response: idleMs / 1000,
    context_tokens: 76_000,
    prompt_cache_likely_expired: fields.expired ?? idleMs > HOUR,
    estimated_cache_write_usd: fields.reWarmUsd ?? 0.95,
  })

test('resumed two days on with a $0 ledger, the cache is cold at the price the engine names', async ($, on) => {
  setup(on, { usage: RESUMED, env: ENV, now: 48 * HOUR })
  await $.session.start(START)
  await resume($, 48 * HOUR, { reWarmUsd: 1.23 })
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold · next message ~\$1\.23/)
  const tree = await mounted($, true)
  expect(fact(tree, 'idle for')).toBe('2d 0h')
  expect(fact(tree, 'next message')).toMatch(/^~\$1\.23( · |$)/)
})

test('resumed ten minutes after its last reply, the cache counts down from that reply', async ($, on) => {
  setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  await resume($, 10 * MIN)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 50m/)
})

test('a forked session resumes the same way', async ($, on) => {
  setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  await resume($, 10 * MIN, { source: 'fork' })
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 50m/)
})

test('a cache the engine calls expired is cold, however recent the reply', async ($, on) => {
  setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: true })
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold/)
})

test('an idle time below zero is no idle time: the last reply is recalled, as when the engine says nothing', async ($, on) => {
  setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = jsonl({ type: 'assistant', timestamp: new Date(3 * HOUR - 10 * MIN).toISOString(), message: { role: 'assistant', model: 'claude-opus-5-5', content: [] } })
  await $.session.start(START)
  await resume($, -6 * HOUR)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 50m/)
})

test('an idle time below zero with nothing to recall draws no countdown', async ($, on) => {
  setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  await resume($, -6 * HOUR)
  expect(shown(pillOf(await mounted($), 'cache'))).not.toMatch(/cache \d/)
})

test("without the engine's idle time, the band's own memory of the last reply stands in", async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, store: { sessions: { s1: { lastAt: 3 * HOUR - 10 * MIN } } }, now: 3 * HOUR })
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: PATH })
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 50m/)
})

test("without the engine's idle time, a session named by an alias is priced at the model its remembered reply was billed under", async ($, on) => {
  // Haiku 5.5's 151k context re-warms for the pinned hour at its upper tier:
  // 151k × 2 × $0.50 per million = $0.151.
  const haiku = { ...RESUMED, context: { tokens: 151_000, window: 1_000_000, percent: 15 } }
  const store = { sessions: { s1: { lastAt: HOUR, billed: 'claude-haiku-5-5' } }, rates: { 'claude-haiku-5-5': 0.0000001 } }
  const clock = setup(on, { usage: haiku, env: ENV, store, now: 3 * HOUR })
  engine.model = 'haiku'
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: PATH })
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold · next message ~\$0\.15\b/)
})

test("a resumed session's spend and tokens start from its last cost record, each later reply counted once", async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(engine.ran).toContainEqual(['grep', '-a', '-b', '-F', '"type":"cost-state"', PATH])
  // $30 + 2 × $0.15
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
  const tree = await mounted($, true)
  expect(shown(cardOf(tree, 'spend'))).toMatch(/^SPEND\$30\.30/)
  expect(shown(cardOf(tree, 'spend'))).not.toMatch(/Breakdown counts/)
  // 1M + 400k sent, 100k back and 20M read, then 3k, 1k and 100k for each reply
  expect(fact(tree, 'input')).toBe('1.4M')
  expect(fact(tree, 'output')).toBe('102k')
  expect(fact(tree, 'cache reads')).toBe('20.2M')
})

test('the transcript the engine names is read; without one, the band finds it by the project', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN, { path: '' })
  await clock.settle()
  expect(engine.ran.find(argv => argv[0] === 'grep')?.at(-1)).toBe(BUILT_PATH)
})

test('a ledger that already counts the conversation is never added to it', async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 31 } }, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$31\.00/)
})

test('a ledger that counts less than the transcript shows the transcript, and grows from there', async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 5 } }, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
  await startTurn($, 't1', 5)
  await endTurn($, 't1', 6)
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$31\.30/)
})

test('with no transcript, a resume shows the ledger and no breakdown, as before', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$0\.00/)
  expect(shown(cardOf(await mounted($, true), 'spend'))).toMatch(/Breakdown counts from your next message/)
})

test('malformed lines are passed over, a record cut short included', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = `${TRANSCRIPT}{"type":"assistant","message":{"id":"msg_3"\n${JSON.stringify(RECORD).slice(0, 40)}\n`
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
})

test("a grep that gives the match's offset, not its line's, still counts the record and every reply after it", async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.grepMatchOffsets = true
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
})

test('without grep, a transcript small enough to read is read whole', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.grepFails = true
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
})

test('without grep, a transcript too big to read leaves the ledger as it is', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.grepFails = true
  engine.transcript = TRANSCRIPT
  engine.transcriptBytes = 5 * 1024 * 1024
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$0\.00/)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 50m/)
})

test('a grep whose output runs past one read leaves the ledger as it is', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.truncates = 'grep'
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$0\.00/)
})

test('a tail past the record that runs past one read counts the record alone', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.truncates = 'tail'
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.00/)
  const tree = await mounted($, true)
  expect(fact(tree, 'input')).toBe('1.4M')
  expect(fact(tree, 'output')).toBe('100k')
  expect(fact(tree, 'cache reads')).toBe('20.0M')
})

test('a /clear while the transcript is read leaves the new conversation alone', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  let release = (): void => undefined
  engine.hold = new Promise<void>(resolve => {
    release = resolve
  })
  await $.session.start(START)
  await resume($, 10 * MIN)
  await $.session.end(CLEAR)
  release()
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$0\.00/)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache warming/)
})

/** An in-process /resume of s2 from s1: the engine names s2 in its
 *  SessionStart, and switches the process to it only after the hooks ran. */
const RESUME_S2 = { reason: 'resume', sessionId: 's1', resume: { id: 's2' } } as const

test('/resume inside a running session resumes the conversation it names', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  // s2 forked from s1, so s1's record, copied, comes before its own.
  engine.transcript = jsonl(
    { ...RECORD, sessionId: 's1', totalCostUSD: 12 },
    ...reply('msg_old', 1, REPLY_USAGE),
    { ...RECORD, sessionId: 's2' },
    ...reply('msg_1', 3, REPLY_USAGE),
    ...reply('msg_2', 1, REPLY_USAGE),
  )
  await $.session.start(START)
  await $.session.end(RESUME_S2)
  // Until the engine says more, the band knows only that it isn't new.
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache –/)
  await resume($, 48 * HOUR, { sessionId: 's2' })
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold/)
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
})

test("/resume without the engine's idle time recalls the resumed session's last reply, not the one left", async ($, on) => {
  const sessions = { s1: { lastAt: 3 * HOUR - MIN }, s2: { lastAt: 3 * HOUR - 10 * MIN } }
  const clock = setup(on, { usage: RESUMED, env: ENV, store: { sessions }, now: 3 * HOUR })
  await $.session.start(START)
  await $.session.end(RESUME_S2)
  await $.classic.SessionStart({ source: 'resume', session_id: 's2', transcript_path: PATH })
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 50m/)
})

test('a recall still out when /resume moves on never lands on the conversation resumed', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, store: { sessions: { s1: { lastAt: 3 * HOUR - MIN } } }, now: 3 * HOUR })
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: PATH })
  await $.session.end(RESUME_S2)
  await $.classic.SessionStart({ source: 'resume', session_id: 's2', transcript_path: PATH })
  await clock.settle()
  // s2 has nothing to recall, so its cache is unknown, not s1's.
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache –/)
})

test('a new session and a /clear read nothing and stay warming', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'startup', transcript_path: PATH })
  await $.session.end(CLEAR)
  await $.classic.SessionStart({ source: 'clear', transcript_path: PATH })
  await clock.settle()
  expect(engine.ran.filter(argv => argv[0] === 'grep' || argv[0] === 'tail')).toEqual([])
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache warming/)
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$0\.00/)
})

test("a subagent's SessionStart reads nothing and leaves the conversation warming", async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'resume', agent_id: 'a1', session_id: 's1', transcript_path: PATH })
  await clock.settle()
  expect(engine.ran.filter(argv => argv[0] === 'grep' || argv[0] === 'tail')).toEqual([])
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache warming/)
})

test('a SessionStart whose session the engine cannot name still lets the session start', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  engine.sessionIdFails = true
  await $.classic.SessionStart({ source: 'resume', session_id: '' })
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$0\.00/)
})

test('a SessionStart that comes before session.start still resumes the conversation', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await resume($, 48 * HOUR)
  await $.session.start(START)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold/)
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
})

test('a SessionStart while session.start runs still resumes the conversation', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await Promise.all([resume($, 48 * HOUR), $.session.start(START)])
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold/)
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
})

test('a resume of another session said before the load never counts its spend in this one', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await resume($, 48 * HOUR, { sessionId: 's9' })
  await $.session.start(START)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache warming/)
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$0\.00/)
})

test('a ledger the host restores after the transcript is read is never added to it', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  // The host restores the record's total only once the band has read the transcript.
  usage.current = { ...RESUMED, cost: { usd: 30 } }
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
  await startTurn($, 't1', 30)
  await endTurn($, 't1', 31)
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$31\.30/)
})

test('a reply this process logs before the transcript read lands is counted once, by the ledger', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD)
  let release = (): void => undefined
  engine.hold = new Promise<void>(resolve => {
    release = resolve
  })
  await $.session.start(START)
  await resume($, 10 * MIN)
  await turn($, 't1', 0, 0.15)
  // The turn's reply is logged before the tail past the record is read.
  engine.transcript += jsonl(...reply('msg_new', 1, REPLY_USAGE).map(line => ({ ...line, timestamp: new Date(3 * HOUR).toISOString() })))
  release()
  await clock.settle()
  // $30 + the ledger's $0.15
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.15/)
  expect(fact(await mounted($, true), 'output')).toBe('100k')
})

test('a fork counts its own cost record, not one its parent wrote', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = jsonl(
    { ...RECORD, sessionId: 's1' },
    ...reply('msg_1', 3, REPLY_USAGE),
    ...reply('msg_2', 1, REPLY_USAGE),
    { ...RECORD, sessionId: 'parent', totalCostUSD: 50 },
  )
  await $.session.start(START)
  await resume($, 10 * MIN, { source: 'fork' })
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cost'))).toMatch(/\$30\.30/)
})

/** No TTL pinned, so the band has only the transcript to go by. */
const UNPINNED = { HOME: '/Users/me' }

/** A reply that wrote its cache at `ttl`. */
const wroteAt = (id: string, ttl: '5m' | '1h') =>
  reply(id, 1, {
    ...REPLY_USAGE,
    cache_creation: { ephemeral_5m_input_tokens: ttl === '5m' ? 2_000 : 0, ephemeral_1h_input_tokens: ttl === '1h' ? 2_000 : 0 },
  })

test("a resumed session's cache lasts as long as its last main-loop cache write said", async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  // A subagent's reply after it, written for an hour, says nothing of the main loop's cache.
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '5m'), ...wroteAt('msg_2', '1h').map(line => ({ ...line, isSidechain: true })))
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 3:00/)
  expect(fact(await mounted($, true), 'expires')).toBe('5m idle')
})

test('an hour seen on the last cache write is no longer assumed', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '1h'))
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 58m/)
  expect(fact(await mounted($, true), 'expires')).toBe('1h idle')
})

test('an hour seen on the transcript speaks only until the first reply, so inference can still correct it', LONG, async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '1h'))
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  await respond($, BUILD_80K)
  await clock.advance(12 * MIN)
  await respond($, resp(82_500, 0, 82_500, 300))
  expect(fact(await mounted($, true), 'expires')).toBe('5m idle · assumed')
})

test('a TTL read off the transcript after the first reply is no longer news', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '5m'))
  let release = (): void => undefined
  engine.hold = new Promise<void>(resolve => {
    release = resolve
  })
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: false })
  await respond($, BUILD_80K)
  release()
  await clock.settle()
  expect(fact(await mounted($, true), 'expires')).toBe('1h idle · assumed')
})

test('a TTL seen on the last resume is forgotten when the same session is resumed again', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '5m'))
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  // Read again, the transcript shows no cache write.
  engine.transcript = jsonl(RECORD)
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  expect(fact(await mounted($, true), 'expires')).toBe('1h idle · assumed')
})

test("a recall that lands after the first reply leaves that reply's billed model alone", async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...reply('msg_1', 1, REPLY_USAGE, 'claude-sonnet-4-6'))
  let release = (): void => undefined
  engine.hold = new Promise<void>(resolve => {
    release = resolve
  })
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: PATH })
  await $.turn.start(TURN_START)
  await respond($, BUILD_155K, { billsTo: 2.83 })
  release()
  await clock.settle()
  await $.turn.complete(TURN_DONE)
  await clock.settle()
  expect(Object.keys(engine.store.rates as Record<string, number>)).toEqual(['claude-opus-5-5'])
})

test('an hour seen on a resumed transcript is assumed again after a /clear', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '1h'))
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  await $.session.end(CLEAR)
  expect(fact(await mounted($, true), 'expires')).toBe('1h idle · assumed')
})

test('five minutes seen on the transcript never outlive the first reply: the hour is assumed again', LONG, async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '5m'))
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  await respond($, BUILD_80K)
  await clock.advance(10 * MIN)
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 50m/)
  expect(fact(await mounted($, true), 'expires')).toBe('1h idle · assumed')
})

test('five minutes seen on a resumed transcript are forgotten at a /clear', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '5m'))
  await $.session.start(START)
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  await $.session.end(CLEAR)
  expect(fact(await mounted($, true), 'expires')).toBe('1h idle · assumed')
})

test('the TTL the environment pins wins over one seen on the transcript, even one seen first', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '5m'))
  await resume($, 2 * MIN, { expired: false })
  await clock.settle()
  await $.session.start(START)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache 58m/)
  expect(fact(await mounted($, true), 'expires')).toBe('1h idle')
})

test('a TTL seen on another session resumed before the load is never this one', async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '5m'))
  await resume($, 2 * MIN, { expired: false, sessionId: 's9' })
  await $.session.start(START)
  await clock.settle()
  expect(fact(await mounted($, true), 'expires')).toBe('1h idle · assumed')
})

/** Whether `argv` reads a transcript's last megabyte. */
const isEndRead = (argv: string[]): boolean => argv[0] === 'tail' && argv[2] === String(1024 * 1024)

test("a resume without the engine's idle time reads its transcript's end once, for the recall and the TTL alike", async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: UNPINNED, now: 3 * HOUR })
  engine.transcript = jsonl(RECORD, ...wroteAt('msg_1', '5m'))
  await $.session.start(START)
  const before = engine.ran.length
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: PATH })
  await clock.settle()
  expect(engine.ran.slice(before).filter(isEndRead)).toEqual([['tail', '-c', String(1024 * 1024), PATH]])
  // The recall found the reply logged at the epoch, and the TTL its write.
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache cold/)
  expect(fact(await mounted($, true), 'expires')).toBe('5m idle')
})

test("the first reply after a resume the engine calls expired is pulse's re-warm", async ($, on) => {
  setup(on, { usage: RESUMED, env: ENV, now: 48 * HOUR, store: { layout: 'pulse' } })
  await $.session.start(START)
  await resume($, 48 * HOUR, { expired: true, reWarmUsd: 1.23 })
  await startTurn($, 't1', 0)
  await respond($, BUILD_155K)
  await endTurn($, 't1', 1.5)
  const ui = await mountBand($, 'desktop', 160)
  await ui.press({ key: 'more' })
  const open = await ui.drawn()
  await ui.unmount()
  const costs = svgAlts(open).filter(a => a.startsWith('cost of'))
  expect(costs.length).toBeGreaterThan(0)
  expect(costs.filter(a => !a.endsWith('the newest a re-warm'))).toEqual([])
})

// A reload of the band's code (/reload-plugins, a worker respawn) raises
// session.start alone: same process, same ledger, same conversation. Whatever
// the band had counted carries on, held by the host in the session's state.

/** Two turns with the cache warm: 100k read, and the ledger at $3. */
const beforeReload = async ($: Engine) => {
  await startTurn($, 't1', 2)
  await respond($, BUILD_80K, { billsTo: 2.5 })
  await endTurn($, 't1', 2.5)
  await startTurn($, 't2', 2.5)
  await respond($, resp(1_000, 80_000, 1_000, 1_000), { billsTo: 3 })
  await endTurn($, 't2', 3)
}

/** The figures a reload must leave as they were, the view left shut. */
const figures = async ($: Engine) => {
  const shut = await mounted($)
  const ui = await mountBand($, 'terminal', 140)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  await ui.press({ key: 'more' })
  await ui.unmount()
  return {
    input: fact(tree, 'input'),
    output: fact(tree, 'output'),
    reads: fact(tree, 'cache reads'),
    hit: fact(tree, 'hit rate'),
    saved: fact(tree, 'saved on cache reads'),
    rebuilds: fact(tree, 'rebuilds'),
    // Whether the counts began with the conversation is not what a reload changes: after /clear the fixture's ledger isn't 0, so the two runs differ in it alone.
    spend: shown(cardOf(tree, 'spend')).replace('counted since the band loaded', ''),
    cost: shown(pillOf(shut, 'cost')),
    cache: shown(pillOf(shut, 'cache')),
  }
}

test('a reload leaves every count as it was: tokens, hit rate, saved, price and cost', async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 2 } }, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  await beforeReload($)
  await clock.advance(61 * MIN)
  const before = await figures($)
  expect(before.reads).toBe('80k')
  expect(before.saved).toMatch(/\$/)
  expect(before.cost).toMatch(/\$3\.00/)
  expect(before.cache).toMatch(/cache cold · next message ~\$/)
  await $.session.start(START)
  expect(await figures($)).toEqual(before)
})

test('a reply after a reload counts once, and the re-warm price stays solved from the whole conversation', LONG, async ($, on) => {
  const run = async (reload: boolean) => {
    usage.current = { ...USAGE, cost: { usd: 2 } }
    await $.session.start(START)
    await beforeReload($)
    if (reload) await $.session.start(START)
    await startTurn($, 't3', 3)
    await respond($, resp(1_000, 81_000, 1_000, 1_000), { billsTo: 3.5 })
    await endTurn($, 't3', 3.5)
    await clock.advance(61 * MIN)
    return figures($)
  }
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 2 } }, env: ENV, now: 3 * HOUR })
  const reloaded = await run(true)
  await $.session.end(CLEAR)
  const straight = await run(false)
  expect(reloaded).toEqual(straight)
  expect(reloaded.reads).toBe('161k')
})

test('a reload mid-turn keeps the rate off the ledger of earlier turns, and the turn its cost', LONG, async ($, on) => {
  const run = async (reload: boolean) => {
    usage.current = { ...USAGE, cost: { usd: 2 } }
    await $.session.start(START)
    await startTurn($, 't1', 2)
    await respond($, BUILD_80K, { billsTo: 2.5 })
    if (reload) await $.session.start(START)
    await respond($, resp(1_000, 80_000, 1_000, 1_000), { billsTo: 3 })
    await endTurn($, 't1', 3)
    await clock.advance(61 * MIN)
    return figures($)
  }
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 2 } }, env: ENV, now: 3 * HOUR })
  const reloaded = await run(true)
  await $.session.end(CLEAR)
  const straight = await run(false)
  expect(reloaded).toEqual(straight)
  expect(reloaded.reads).toBe('80k')
  expect(reloaded.spend).toMatch(/last message\$1\.00/)
})

test("a reload keeps a resumed conversation's earlier spend and tokens, read once", async ($, on) => {
  const clock = setup(on, { usage: RESUMED, env: ENV, now: 3 * HOUR })
  engine.transcript = TRANSCRIPT
  await $.session.start(START)
  await resume($, 10 * MIN)
  await clock.settle()
  await turn($, 't1', 0, 1)
  const before = await figures($)
  expect(before.cost).toMatch(/\$31\.30/)
  expect(before.reads).toBe('20.2M')
  await $.session.start(START)
  await clock.settle()
  expect(await figures($)).toEqual(before)
})

test('a reload after /clear stays the new conversation: nothing of the old one comes back', async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 2 } }, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  await beforeReload($)
  await $.session.end(CLEAR)
  await $.session.start(START)
  await clock.settle()
  expect(shown(pillOf(await mounted($), 'cache'))).toMatch(/cache warming/)
  expect(fact(await mounted($, true), 'cache reads')).toBeUndefined()
})

test("another session's counts never come back on a reload", async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 2 } }, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  await beforeReload($)
  engine.sessionId = 's2'
  await $.session.start(START)
  await clock.settle()
  expect(fact(await mounted($, true), 'cache reads')).toBeUndefined()
})

test("a reload keeps pulse's trails and the last message's cost", async ($, on) => {
  setup(on, { usage: { ...USAGE, cost: { usd: 2 } }, env: ENV, now: 3 * HOUR, store: { layout: 'pulse' } })
  await $.session.start(START)
  await beforeReload($)
  const open = async () => {
    const ui = await mountBand($, 'desktop', 160)
    await ui.press({ key: 'more' })
    const tree = await ui.drawn()
    await ui.press({ key: 'more' })
    await ui.unmount()
    return svgAlts(tree)
  }
  const before = await open()
  expect(before.filter(a => a.startsWith('cost of')).length).toBeGreaterThan(0)
  await $.session.start(START)
  expect(await open()).toEqual(before)
})

test('a toast spoken before a reload is not spoken again at the same level', async ($, on) => {
  // Auto-compaction off, so the context's scale is known from the start, before and after the reload.
  const context = { tokens: 164_000, window: 200_000, percent: 82, breakdown: breakdown({ isAutoCompactEnabled: false }) }
  setup(on, { usage: { ...USAGE, context, cost: { usd: 2 } }, env: ENV, now: 3 * HOUR })
  await $.session.start(START)
  const measure = () => $.session.measure({ context, rateLimits: [], changed: [] })
  await measure()
  expect(toasts.length).toBe(1)
  await $.session.start(START)
  await measure()
  expect(toasts.length).toBe(1)
})

test('a write of the counts held up by the host never lands on a newer one', async ($, on) => {
  setup(on, { usage: { ...USAGE, cost: { usd: 2 } }, env: ENV, now: 3 * HOUR })
  let release = (): void => undefined
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  let hold = false
  let writing = 0
  let overlapped = false
  on('state.set', async ($, e, next) => {
    if (e.key !== 'kept') return next(e)
    overlapped ||= writing > 0
    writing++
    if (hold) {
      hold = false
      await held
    }
    const result = await next(e)
    writing--
    return result
  })
  await $.session.start(START)
  hold = true
  const started = startTurn($, 't1', 2)
  const replied = respond($, BUILD_80K)
  // A whole draw through the engine: time for a second write to start, if it would.
  await mounted($)
  release()
  await Promise.all([started, replied])
  expect(overlapped).toBe(false)
  await $.session.start(START)
  expect(fact(await mounted($, true), 'input')).toBeDefined()
})

// ---- a fork, whose file gains its lines only after its first prompt ----------

const FORK_PATH = '/Users/me/.claude/projects/-Users-me-elsewhere/f1.jsonl'
const FORKED = { source: 'fork', session_id: 'f1', transcript_path: FORK_PATH, seconds_since_last_response: 60 } as const

test('a fork whose file is empty at its start reads it again after the first turn, and its tokens come back', LONG, async ($, on) => {
  const clock = setup(on, { env: ENV, usage: RESUMED, now: 3 * HOUR })
  engine.transcript = undefined
  await $.session.start(START)
  await $.classic.SessionStart(FORKED)
  await clock.settle()
  // Open once, as pressing again would shut it.
  expect(shown(pillOf(await mounted($), 'cost'))).not.toMatch(/\$30/)
  await $.turn.start(TURN_START)
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  engine.transcript = jsonl(RECORD)
  await clock.advance(MIN)
  // 20M read of 21.4M before this process, with this reply's 82k on top.
  const tree = await mounted($, true)
  expect(fact(tree, 'hit rate')).toBe('93%')
  expect(shown(pillOf(tree, 'cost'))).toMatch(/\$30/)
})

test('a fork whose file stays empty looks a few times, then stops', LONG, async ($, on) => {
  const clock = setup(on, { env: ENV, usage: RESUMED, now: 3 * HOUR })
  engine.transcript = undefined
  await $.session.start(START)
  await $.classic.SessionStart(FORKED)
  await clock.settle()
  await $.turn.start(TURN_START)
  await respond($, BUILD_80K)
  await $.turn.complete(TURN_DONE)
  await clock.advance(MIN)
  engine.ran.length = 0
  await clock.advance(MIN)
  await $.turn.start(TURN_START)
  await respond($, resp(100, 80_000, 100, 10))
  await $.turn.complete(TURN_DONE)
  await clock.advance(MIN)
  expect(engine.ran.filter(argv => argv[0] === 'grep')).toEqual([])
})
