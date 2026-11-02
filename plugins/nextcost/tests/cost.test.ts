// Cost: last turn's cost and the baseline across /clear, resume and reload.

import { test, expect } from 'claude-code/testing'
import {
  BUILD_100K,
  BUILD_80K,
  TURN_DONE,
  TURN_START,
  BUILD_155K,
  LONG,
  USAGE,
  START,
  MIN,
  CLEAR,
  resp,
  respond,
  textOf,
  cardText,
  hoverCardOf,
  turn,
  setup,
  mountBand,
} from './helpers'

test("last turn's cost follows the main turn and ignores subagents'", async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await mountBand($, 'terminal', 110)
  const last = async () => textOf(await ui.drawn()).match(/\$(\d+\.\d\d) spent during your last message/)?.[1]
  expect(await last()).toBeUndefined()

  await turn($, 't1', 2.0, 2.41)
  expect(await last()).toBe('0.41')

  await turn($, 't2', 2.41, 3.0, { agentId: 'agent-1' })
  expect(await last()).toBe('0.41')

  await turn($, 't3', 3.0, 3.5, { isAborted: true, reason: 'aborted' })
  expect(await last()).toBe('0.50')
  await ui.unmount()
})

test("no cost ledger hides last turn's cost", async ($, on) => {
  setup(on, { usage: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } })
  await $.session.start(START)
  await $.turn.start(TURN_START)
  await $.turn.complete(TURN_DONE)

  const ui = await mountBand($, 'terminal', 110)
  // On a text surface the card covers its chip, so it carries the figure first.
  expect(cardText(hoverCardOf(await ui.drawn(), 'cost'))).toMatch(/^\$\d+\.\d\d so far this session$/)
  await ui.unmount()
})

test('/clear starts the band on a fresh conversation', async ($, on) => {
  setup(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await respond($, BUILD_155K)

  await $.session.end(CLEAR)

  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /cache warming/ })).toBeDefined()
  await ui.unmount()
})

test('spend before a /clear does not inflate the re-warm estimate', LONG, async ($, on) => {
  const clock = setup(on) // ledger at $2.41 when /clear runs
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await respond($, BUILD_155K)
  await $.session.end(CLEAR)

  // The ledger keeps counting: $0.59 is this conversation's.
  await respond($, BUILD_100K, { billsTo: 3.0 })
  await clock.advance(61 * 60_000)

  // writes for the pinned hour at 2×: rate = 0.59 / (10k + 2*100k + 5*2k);
  // re-warm = 2 * 112k * rate = 0.60
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$0\.60/ })).toBeDefined()
  await ui.unmount()
})

test('a ledger the engine reset on /clear is used as it stands', LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await respond($, BUILD_155K)
  await $.session.end(CLEAR)

  // Below the $2.41 baseline: reset.
  await respond($, BUILD_100K, { billsTo: 0.59 })
  await clock.advance(61 * 60_000)

  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$0\.60/ })).toBeDefined()
  await ui.unmount()
})

test('a ledger reset on /clear keeps the re-warm price right after the new conversation outspends the old', LONG, async ($, on) => {
  const clock = setup(on) // $2.41 when /clear runs
  await $.session.start(START)
  await respond($, BUILD_155K)
  await $.session.end(CLEAR)

  await respond($, BUILD_100K, { billsTo: 0.59 }) // the engine reset the ledger
  await respond($, resp(1_000, 112_000, 2_000, 1_000), { billsTo: 3.0 }) // now past the old $2.41
  await clock.advance(61 * MIN)

  // all $3.00 is this conversation's, writes at 2×, reads at Opus 5.5's 0.05×:
  // 11k + 2*102k + 0.05*112k + 5*3k = 235.6k; 2 * 116k * 3.00 / 235.6k = 2.95
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$2\.95/ })).toBeDefined()
  await ui.unmount()
})

test('a session resumed or reloaded with spend on the ledger prices the re-warm from spend since', LONG, async ($, on) => {
  const clock = setup(on, { usage: { ...USAGE, cost: { usd: 20 } } }) // the ledger carries an earlier run's $20
  await $.session.start(START)
  await $.turn.start(TURN_START)
  await respond($, BUILD_100K, { billsTo: 20.3 })
  await $.turn.complete(TURN_DONE)
  await clock.advance(61 * MIN)

  // $0.30 since start, writes at 2×: 2 * 112k * 0.30 / 220k = 0.31
  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /~\$0\.31/ })).toBeDefined()
  await ui.unmount()
})

test('/clear keeps a TTL the environment pinned', async ($, on) => {
  const clock = setup(on, { env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.end(CLEAR)
  await respond($, BUILD_80K)
  await clock.advance(6 * 60_000) // past 5m, well inside the 1h default

  const ui = await mountBand($, 'terminal', 110)
  expect(await ui.find({ type: 'Text', text: /cold/ })).toBeDefined()
  await ui.unmount()
})
