// A turn the user didn't type: a background task's notification, another
// session's message, a schedule. It restarts the countdown as any turn does,
// so the Cache card says who started it, and whether it re-warmed the cache.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelUsage, PromptOrigin } from 'claude-code'
import { newCache, wakerOf } from '../hooks/cache'
import { readingsOf } from '../hooks/reading'
import { cacheWith, snapOf } from './matrix'
import { BUILD_100K, DESKTOP_START, LONG, MIN, READ_100K, START, cardHead, endTurn, fact, mountBand, respond, setup, shown, startTurn } from './helpers'

/** One main-loop turn started by a prompt from `origin`, its one step
 *  billed as `u`, the ledger moving from `from` to `to`. */
const turnFrom = async ($: Engine, id: string, origin: PromptOrigin, u: ModelUsage, from: number, to: number): Promise<void> => {
  await $.prompt.submit({ text: 'x', wait: false, origin })
  await startTurn($, id, from)
  await respond($, u, { turnId: id })
  await endTurn($, id, to)
}

/** The Cache card's wake row, as the open chips view reads it. */
const wakeRows = async ($: Engine): Promise<Readonly<{ reWarmed: string | undefined; keptWarm: string | undefined }>> => {
  const ui = await mountBand($, 'terminal', 200)
  await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  await ui.unmount()
  return { reWarmed: fact(tree, 're-warmed by'), keptWarm: fact(tree, 'kept warm by') }
}

test('a background task that re-warmed a cold cache is named on the Cache card', LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await turnFrom($, 't1', { kind: 'composer' }, BUILD_100K, 0, 1)
  await clock.advance(61 * MIN)
  await turnFrom($, 't2', { kind: 'task-notification' }, BUILD_100K, 1, 2.5)
  expect(await wakeRows($)).toEqual({ reWarmed: 'background task', keptWarm: undefined })
})

test("another session's message within the hour kept the cache warm", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await turnFrom($, 't1', { kind: 'composer' }, BUILD_100K, 0, 1)
  await clock.advance(20 * MIN)
  await turnFrom($, 't2', { kind: 'peer' }, READ_100K, 1, 1.1)
  expect(await wakeRows($)).toEqual({ reWarmed: undefined, keptWarm: 'message' })
})

test("the user's own next turn takes the line away", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await turnFrom($, 't1', { kind: 'composer' }, BUILD_100K, 0, 1)
  await clock.advance(61 * MIN)
  await turnFrom($, 't2', { kind: 'scheduled-trigger' }, BUILD_100K, 1, 2.5)
  await clock.advance(MIN)
  // The desktop app's typed prompts come from its SDK host.
  await turnFrom($, 't3', { kind: 'sdk' }, READ_100K, 2.5, 2.6)
  expect(await wakeRows($)).toEqual({ reWarmed: undefined, keptWarm: undefined })
})

test('a notification delivered into a running turn names no later turn', LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await startTurn($, 't1', 0)
  await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'task-notification' }, turnId: 't1' })
  await respond($, BUILD_100K, { turnId: 't1' })
  await endTurn($, 't1', 1)
  await clock.advance(MIN)
  await startTurn($, 't2', 1)
  await respond($, READ_100K, { turnId: 't2' })
  await endTurn($, 't2', 1.1)
  expect(await wakeRows($)).toEqual({ reWarmed: undefined, keptWarm: undefined })
})

test("who started a turn: the user's own gestures, or what woke the session", () => {
  for (const typed of ['composer', 'bridge', 'sdk', 'unclassified']) expect(wakerOf(typed)).toBeUndefined()
  expect(wakerOf('task-notification')).toBe('task')
  expect(wakerOf('scheduled-trigger')).toBe('schedule')
  for (const kind of ['peer', 'peer-send-message', 'projects-relay', 'coordinator']) expect(wakerOf(kind)).toBe('session')
  expect(wakerOf('channel')).toBe('channel')
  expect(wakerOf('plugin')).toBe('plugin')
  expect(wakerOf('a kind from a newer engine')).toBeUndefined()
})

test('the model keeps what started its last turn, and whether that turn rebuilt the cache', () => {
  const c = newCache()
  c.turnStarted({ namedModel: undefined, ledger: undefined, wokenBy: 'task' })
  c.responded(BUILD_100K, 0, true)
  c.turnEnded(undefined)
  expect(c.view({ now: MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false }).cache.wake).toEqual({ by: 'task', reWarm: false })
})

/** A model after a turn from a background task that measured a request, its wake set. */
const wokenModel = () => {
  const c = newCache()
  c.turnStarted({ namedModel: undefined, ledger: undefined, wokenBy: 'task' })
  c.responded(BUILD_100K, 0, true)
  c.turnEnded(undefined)
  return c
}
const wakeOf = (c: ReturnType<typeof newCache>) => c.view({ now: MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false }).cache.wake
const NO_TOKENS: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** A turn that made no request: no usage at all (a limit hit, a lost connection), or one of all zeros. */
const NO_REQUEST: ReadonlyArray<readonly [string, (c: ReturnType<typeof newCache>) => void]> = [
  ['no usage', () => undefined],
  ['all-zero usage', c => c.responded(NO_TOKENS, MIN, true)],
]

for (const [name, step] of NO_REQUEST) {
  test(`a turn from a background task with ${name} never touched the cache, so it names no one`, () => {
    const c = newCache()
    c.turnStarted({ namedModel: undefined, ledger: undefined })
    c.responded(BUILD_100K, 0, true)
    c.turnEnded(undefined)
    c.turnStarted({ namedModel: undefined, ledger: undefined, wokenBy: 'task' })
    step(c)
    c.turnEnded(undefined)
    expect(wakeOf(c)).toBeUndefined()
  })
  test(`a turn with ${name} leaves the last wake as it was, and its waker doesn't outlive it`, () => {
    for (const wokenBy of ['session', undefined] as const) {
      const c = wokenModel()
      c.turnStarted({ namedModel: undefined, ledger: undefined, ...(wokenBy === undefined ? {} : { wokenBy }) })
      step(c)
      c.turnEnded(undefined)
      expect(wakeOf(c)).toEqual({ by: 'task', reWarm: false })
      // The user's next turn that reaches the API takes it away, naming neither.
      c.turnStarted({ namedModel: undefined, ledger: undefined })
      c.responded(READ_100K, 2 * MIN, true)
      c.turnEnded(undefined)
      expect(wakeOf(c)).toBeUndefined()
    }
  })
}

test("a subagent's request is no turn of the main loop's: it sets no wake", () => {
  const c = newCache()
  c.turnStarted({ namedModel: undefined, ledger: undefined, wokenBy: 'task' })
  c.responded(BUILD_100K, 0, false)
  c.turnEnded(undefined)
  expect(wakeOf(c)).toBeUndefined()
})

test("chips' hover says who re-warmed the cache, and its words are the card's", () => {
  const r = readingsOf(snapOf({ cache: cacheWith({ wake: { by: 'task', reWarm: true } }) }))
  expect(r.cache.woken?.row).toEqual({ label: 're-warmed by', value: 'background task' })
  expect(r.chips.cache.hover).toMatch(/; a background task re-warmed it$/)
  const kept = readingsOf(snapOf({ cache: cacheWith({ wake: { by: 'session', reWarm: false } }) }))
  expect(kept.chips.cache.hover).toMatch(/; a message kept it warm$/)
})

test('once the cache has gone cold again, the card and hover say only whose turn was last', () => {
  const r = readingsOf(snapOf({ cache: cacheWith({ leftMs: 0, wake: { by: 'session', reWarm: false } }) }))
  expect(r.cache.mood).toBe('cold')
  expect(r.cache.woken?.row).toEqual({ label: 'last turn by', value: 'message' })
  expect(r.chips.cache.hover).toMatch(/; last turn by a message$/)
})

/** The open Cache card on the desktop at `maxRows`, 95 columns, after a turn
 *  from a background task: its head as it reads, and its two facts. */
const desktopCard = async ($: Engine, maxRows: number, open = true) => {
  const ui = await mountBand($, 'desktop', 95, { maxRows })
  if (open) await ui.press({ key: 'more' })
  const tree = await ui.drawn()
  await ui.unmount()
  return { head: shown(cardHead(tree, 'cache')), reWarm: fact(tree, 're-warm if cold'), kept: fact(tree, 'kept warm by') }
}

test("at the desktop's height the card has room for one fact, so the head says who kept it warm", LONG, async ($, on) => {
  const clock = setup(on)
  await $.session.start(DESKTOP_START)
  await turnFrom($, 't1', { kind: 'composer' }, BUILD_100K, 0, 1)
  await clock.advance(20 * MIN)
  await turnFrom($, 't2', { kind: 'task-notification' }, READ_100K, 1, 1.1)
  const short = await desktopCard($, 13)
  expect(short.head).toMatch(/1h 00m left · by background task/)
  expect(short.reWarm).toBeDefined() // the price keeps its row
  expect(short.kept).toBeUndefined()
  // With room for the row, it is said once, there.
  const tall = await desktopCard($, 40, false) // the cards are open from above
  expect(tall.head).not.toMatch(/background task/)
  expect(tall.kept).toBe('background task')
})

test('a head says nothing of a turn the user typed', LONG, async ($, on) => {
  setup(on)
  await $.session.start(DESKTOP_START)
  await turnFrom($, 't1', { kind: 'sdk' }, BUILD_100K, 0, 1)
  expect((await desktopCard($, 13)).head).not.toMatch(/ · by /)
})
