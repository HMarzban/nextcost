// A turn the user didn't type: a background task's notification, another
// session's message, a schedule. It restarts the countdown as any turn does,
// so the Cache card says who started it, and whether it re-warmed the cache.

import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelUsage, PromptOrigin } from 'claude-code'
import { newCache, wakerOf } from '../hooks/cache'
import { readingsOf } from '../hooks/reading'
import { cacheWith, snapOf } from './matrix'
import { BUILD_100K, LONG, MIN, READ_100K, START, endTurn, fact, mountBand, respond, setup, startTurn } from './helpers'

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
  expect(await wakeRows($)).toEqual({ reWarmed: undefined, keptWarm: 'another session' })
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
  c.turnStarted({ priceModel: undefined, ledger: undefined, wokenBy: 'task' })
  c.responded(BUILD_100K, 0, true)
  c.turnEnded(undefined)
  expect(c.view({ now: MIN, ledger: undefined, contextTokens: 0, autoCompactOff: false }).cache.wake).toEqual({ by: 'task', reWarm: false })
})

test("chips' hover says who re-warmed the cache, and its words are the card's", () => {
  const r = readingsOf(snapOf({ cache: cacheWith({ wake: { by: 'task', reWarm: true } }) }))
  expect(r.cache.wakeRow).toEqual({ label: 're-warmed by', value: 'background task' })
  expect(r.chips.cache.hover).toMatch(/; a background task re-warmed it$/)
  const kept = readingsOf(snapOf({ cache: cacheWith({ wake: { by: 'session', reWarm: false } }) }))
  expect(kept.chips.cache.hover).toMatch(/; another session kept it warm$/)
})

test('once the cache has gone cold again, the card and hover say only whose turn was last', () => {
  const r = readingsOf(snapOf({ cache: cacheWith({ leftMs: 0, wake: { by: 'session', reWarm: false } }) }))
  expect(r.cache.mood).toBe('cold')
  expect(r.cache.wakeRow).toEqual({ label: 'last turn by', value: 'another session' })
  expect(r.chips.cache.hover).toMatch(/; last turn by another session$/)
})
