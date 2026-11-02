// When a toast speaks and what it says: once per threshold crossed, again
// only after the figure has fallen back below the re-arm share.

import { test, expect } from 'claude-code/testing'
import { NO_WARNINGS, contextToasts, forgetConversation, limitToasts } from '../hooks/toast'
import type { ContextNow, Toasts, Warned } from '../hooks/toast'

/** The 5-hour limit at each percent in turn: what each step says. */
const fiveHourSays = (percents: readonly number[], from: Warned = NO_WARNINGS): string[][] => {
  let warned = from
  return percents.map(percentUsed => {
    const t: Toasts = limitToasts(warned, [{ kind: 'five_hour', percentUsed }])
    warned = t.warned
    return [...t.say]
  })
}

/** The context at each step in turn, on a 200k window unless the step says otherwise: what each step says. */
const contextSays = (steps: ReadonlyArray<Partial<ContextNow>>, from: Warned = NO_WARNINGS): string[][] => {
  let warned = from
  return steps.map(step => {
    const t = contextToasts(warned, { used: undefined, window: 200_000, compactAt: undefined, autoCompactOff: false, ...step })
    warned = t.warned
    return [...t.say]
  })
}

test('crossing a threshold speaks once, at the level reached', () => {
  expect(fiveHourSays([50, 82, 85, 96])).toEqual([[], ["You've used 82% of your 5-hour limit."], [], ["You've used 96% of your 5-hour limit."]])
})

test('a toast speaks at the figure the chip shows: 79.6% is 80%', () => {
  expect(fiveHourSays([79.4, 79.6])).toEqual([[], ["You've used 80% of your 5-hour limit."]])
  expect(contextSays([{ used: 158_000 }, { used: 159_200 }])).toEqual([[], ['Context is 80% full.']])
})

test('jumping two thresholds at once speaks once, at the higher', () => {
  expect(fiveHourSays([97])).toEqual([["You've used 97% of your 5-hour limit."]])
})

test('falling back holds the level until under the re-arm share, then re-arms', () => {
  expect(fiveHourSays([96, 78, 81, 70, 81])).toEqual([["You've used 96% of your 5-hour limit."], [], [], [], ["You've used 81% of your 5-hour limit."]])
})

test('the weekly limit and a gateway spend limit speak where their chips turn amber, each once per crossing on its own count', () => {
  const says = (limits: ReadonlyArray<{ kind: string; percentUsed: number }>, from: Warned = NO_WARNINGS) => limitToasts(from, limits)
  const week = says([{ kind: 'seven_day', percentUsed: 82 }])
  expect(week.say).toEqual(["You've used 82% of your weekly limit."])
  expect(says([{ kind: 'seven_day', percentUsed: 84 }], week.warned).say).toEqual([])
  expect(says([{ kind: 'seven_day', percentUsed: 96 }], week.warned).say).toEqual(["You've used 96% of your weekly limit."])
  const spend = says([{ kind: 'spend_limit', percentUsed: 92 }])
  expect(spend.say).toEqual(["You've used 92% of your spend limit."])
  // One count each: the week at 82% leaves the 5 hours to speak at 82% too.
  expect(says([{ kind: 'five_hour', percentUsed: 82 }, { kind: 'seven_day', percentUsed: 82 }, { kind: 'spend_limit', percentUsed: 82 }]).say).toHaveLength(3)
  expect(says([{ kind: 'five_hour', percentUsed: 82 }], week.warned).say).toEqual(["You've used 82% of your 5-hour limit."])
  // Under the line they say nothing; a window the band doesn't name, nothing at any level.
  expect(says([{ kind: 'seven_day', percentUsed: 79 }]).say).toEqual([])
  expect(says([{ kind: 'something_else', percentUsed: 99 }]).say).toEqual([])
})

test("a conversation's end leaves the weekly and spend limits' levels alone", () => {
  const warned = limitToasts(NO_WARNINGS, [{ kind: 'seven_day', percentUsed: 85 }, { kind: 'spend_limit', percentUsed: 85 }]).warned
  const forgot = forgetConversation(warned)
  expect(limitToasts(forgot, [{ kind: 'seven_day', percentUsed: 86 }, { kind: 'spend_limit', percentUsed: 86 }]).say).toEqual([])
})

test('the context speaks its fill toward the window, and that compaction is off when it is', () => {
  expect(contextSays([{ used: 164_000 }])).toEqual([['Context is 82% full.']])
  expect(contextSays([{ used: 164_000, autoCompactOff: true }])).toEqual([
    ['Context is 82% full and auto-compaction is off, so the conversation will run out of room.'],
  ])
})

test('near compaction the context speaks the room before it', () => {
  expect(contextSays([{ used: 176_000, compactAt: 190_000 }])).toEqual([['Auto-compaction in ~14k tokens.']])
})

test('a context the engine reports none of says nothing and keeps the levels', () => {
  const t = contextToasts(NO_WARNINGS, { used: undefined, window: 200_000, compactAt: undefined, autoCompactOff: false })
  expect(t).toEqual({ warned: NO_WARNINGS, say: [] })
})

test("a conversation's end forgets the context's level, not the 5-hour limit's", () => {
  const five = limitToasts(NO_WARNINGS, [{ kind: 'five_hour', percentUsed: 85 }]).warned
  const both = contextToasts(five, { used: 170_000, window: 200_000, compactAt: undefined, autoCompactOff: false }).warned
  const forgot = forgetConversation(both)
  expect(contextSays([{ used: 170_000 }], forgot)).toEqual([['Context is 85% full.']])
  expect(fiveHourSays([86], forgot)).toEqual([[]])
})

test('a warning toward the window leaves the warning toward compaction to speak', () => {
  expect(contextSays([{ used: 170_000 }, { used: 172_000, compactAt: 190_000 }])).toEqual([['Context is 85% full.'], ['Auto-compaction in ~18k tokens.']])
})

test('each scale keeps its own level across a change of scale, and re-arms only while it is the one measured', () => {
  expect(
    contextSays([
      { used: 176_000, compactAt: 190_000 },
      { used: 180_000, autoCompactOff: true },
      { used: 180_000, compactAt: 190_000 },
      { used: 120_000, compactAt: 190_000 },
      { used: 176_000, compactAt: 190_000 },
    ]),
  ).toEqual([
    ['Auto-compaction in ~14k tokens.'],
    ['Context is 90% full and auto-compaction is off, so the conversation will run out of room.'],
    [],
    [],
    ['Auto-compaction in ~14k tokens.'],
  ])
})

test('a compaction point the engine gives and drops by turns, at 85% of the window, speaks once', () => {
  const flips = Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? { used: 170_000 } : { used: 170_000, compactAt: 190_000 }))
  expect(contextSays(flips).flat()).toEqual(['Context is 85% full.'])
})

test('a window of 0 speaks no toast, never an Infinity%', () => {
  expect(contextSays([{ used: 76_000, window: 0 }])).toEqual([[]])
})
