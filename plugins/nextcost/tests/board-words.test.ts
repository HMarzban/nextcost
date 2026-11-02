// The departures board's words, read through the readings: each row's
// STATUS, TIME, cell and REMARKS, in each state, zone known or not.

import { test, expect } from 'claude-code/testing'
import { fixedZone } from '../hooks/format'
import { readingsOf } from '../hooks/reading'
import { HOUR, MIN } from './helpers'
import { snapOf } from './matrix'

const UTC = fixedZone(0)
const cacheAt = (over: object) => ({ ...snapOf().cache, ...over })
const board = (over: object = {}) => readingsOf(snapOf({ zone: UTC, ...over })).board()
const row = (over: object, key: string) => board(over).rows.find(r => r.key === key)
const limit = (pct: number, resetH: number) => ({ percentUsed: pct, resetsAt: resetH * HOUR, etaMs: null })
const CLOCK = /\d\d:\d\d/

test('rows run in the one order', () => {
  expect(board({ fiveHour: limit(26, 3), sevenDay: limit(41, 67) }).rows.map(r => r.key)).toEqual(['cache', 'spend', 'context', '5h', '7d'])
})
test('a warm cache departs at its cold-at clock; the countdown is measured, so no ~', () => {
  const r = row({ cache: cacheAt({ requests: 1, leftMs: 38 * MIN, coldAt: 38 * MIN }) }, 'cache')
  expect([r?.status, r?.time, r?.cell, r?.cellShort, r?.tone]).toEqual(['DEPARTS', '00:38', 'DEPARTS 00:38', '00:38', 'calm'])
  expect(r?.remarks).toMatch(/^IN 38 MIN · RE-WARM ~\$\d/)
  expect(r?.alt).not.toMatch(/[A-Z]{2,}|↻/)
})
test('an hour out, the countdown is IN 1H 04M', () => {
  expect(row({ zone: undefined, cache: cacheAt({ requests: 1, leftMs: 64 * MIN, coldAt: 64 * MIN }) }, 'cache')?.time).toBe('IN 1H 04M')
})
test('a calm last call names its clock; the last minute is amber seconds', () => {
  const calm = row({ cache: cacheAt({ requests: 1, ttl: '1h', leftMs: 5 * MIN, coldAt: 5 * MIN }) }, 'cache')
  expect([calm?.cell, calm?.tone]).toEqual(['LAST CALL 00:05', 'calm'])
  const amber = row({ cache: cacheAt({ requests: 1, leftMs: 47_000, coldAt: 47_000 }) }, 'cache')
  expect([amber?.cell, amber?.cellShort, amber?.tone]).toEqual(['! LAST CALL 47S', '! 47S', 'amber'])
})
test('cold has departed: at its time when known, without it when not', () => {
  expect(row({ now: HOUR, cache: cacheAt({ requests: 1, leftMs: 0, coldAt: 10 * MIN }) }, 'cache')?.cell).toMatch(/^DEPARTED 00:10 · RE-WARM ~\$/)
  expect(row({ cache: cacheAt({ requests: 1, leftMs: 0, coldAt: null }) }, 'cache')?.cell).toMatch(/^DEPARTED · RE-WARM ~\$/)
})
test('working boards; unmeasured and warming check in; recalled carries ~', () => {
  expect(row({ isWorking: true, cache: cacheAt({ requests: 1, leftMs: 38 * MIN, coldAt: 38 * MIN }) }, 'cache')?.cell).toBe('BOARDING')
  expect(row({ cache: cacheAt({ requests: 0, recalled: false, fresh: false }) }, 'cache')?.cell).toBe('CHECK-IN')
  expect(row({ cache: cacheAt({ requests: 0, recalled: false, fresh: true }) }, 'cache')?.cell).toBe('CHECK-IN')
  expect(row({ cache: cacheAt({ requests: 0, recalled: true, leftMs: 38 * MIN, coldAt: 38 * MIN }) }, 'cache')?.cell).toBe('DEPARTS ~00:38')
})
test('a cache gone cold or compacted mid-turn says so, as chips and pulse do', () => {
  const cold = row({ isWorking: true, now: HOUR, cache: cacheAt({ requests: 1, leftMs: 0, coldAt: 10 * MIN }) }, 'cache')
  expect(cold?.status).toBe('DEPARTED')
  const compacted = row({ isWorking: true, now: HOUR, cache: cacheAt({ requests: 1, leftMs: 0, coldAt: 10 * MIN, compacted: true }) }, 'cache')
  expect(compacted?.status).toBe('COMPACTED')
})
test('not caching and a pending model switch have their own lines, working or not', () => {
  for (const isWorking of [false, true]) {
    const off = row({ isWorking, cache: cacheAt({ requests: 1, leftMs: 0, notCaching: true }) }, 'cache')
    expect([off?.status, off?.time, off?.remarks]).toEqual(['NOT CACHING', undefined, ''])
    const moved = row({ isWorking, cache: cacheAt({ requests: 1, leftMs: 38 * MIN, modelChanged: true }) }, 'cache')
    expect([moved?.status, moved?.time]).toEqual(['MODEL CHANGED', undefined])
    expect(moved?.remarks).toBe('NEXT 155K TOKENS')
  }
})
test('context: USED when calm; amber says COMPACTS IN, its short form the mark and value; never CTX', () => {
  expect(row({}, 'context')?.status).toMatch(/^\d+% USED$/)
  const near = row({ context: { ...snapOf().context, tokens: 150_000, window: 200_000, compactAt: 160_000 } }, 'context')
  expect(near?.cell).toMatch(/^! COMPACTS IN ~\d+K$/)
  // The group's ITEM already says CONTEXT: its cell never says it again.
  expect(near?.cellShort).toBe('! 94%')
  const off = row({ context: { ...snapOf().context, tokens: 170_000, window: 200_000, compactAt: undefined } }, 'context')
  expect([off?.cell, off?.cellShort, off?.status]).toEqual(['! 85%', '! 85%', '! 85%'])
  expect(`${near?.cell}${near?.cellShort}${near?.status}${off?.cell}`).not.toMatch(/CTX|CONTEXT/)
})
test('limits: the reset stays, an amber remark replaces a calm one, cellNoReset drops only the reset', () => {
  const seven = row({ sevenDay: limit(85, 67) }, '7d')
  // The flap face has no ↻: the board says RESET.
  expect(seven?.cell).toMatch(/^85% RESET \S+ \d\d:\d\d ! NEAR LIMIT$/)
  expect(seven?.cellNoReset).toBe('85% ! NEAR LIMIT')
  expect(seven?.tone).toBe('amber')
})
test('a 5h pace that fills says when, by clock or, with no zone, by countdown', () => {
  const pace = { fiveHour: { ...limit(20, 3), etaMs: 40 * MIN } }
  expect(row(pace, '5h')?.cell).toMatch(/! FULL ~\d\d:\d\d$/)
  expect(row({ ...pace, zone: undefined }, '5h')?.cell).toMatch(/! FULL IN ~40 MIN$/)
})
test('a 5h fill on the board says its clock as its ETA is rounded', () => {
  const now = Date.UTC(2026, 9, 9, 13, 40)
  const r = row({ now, fiveHour: { percentUsed: 84, resetsAt: now + 4 * HOUR, etaMs: 43 * MIN } }, '5h')
  expect(r?.status).toBe('! FULL ~14:25')
})
test('a 5h past 80% with a measured fill says when, as every layout does; without one, that it is near', () => {
  const pace = { fiveHour: { ...limit(84, 3), etaMs: 40 * MIN } }
  for (const zone of [UTC, undefined]) {
    const r = row({ ...pace, zone }, '5h')
    expect(r?.status).toMatch(/^! FULL (~\d\d:\d\d|IN ~40 MIN)$/)
    expect(r?.remarks).toBe('84%')
    expect(r?.cellShort).toBe('! 84%')
  }
  expect(row({ fiveHour: limit(84, 3) }, '5h')?.status).toBe('! NEAR LIMIT')
})
test('a 5h amber from its pace says the fill once: STATUS has it, REMARKS keeps the value alone', () => {
  const pace = { fiveHour: { ...limit(20, 3), etaMs: 40 * MIN } }
  for (const zone of [UTC, undefined]) {
    const r = row({ ...pace, zone }, '5h')
    expect(r?.status).toMatch(/^! FULL (~\d\d:\d\d|IN ~40 MIN)$/)
    expect(r?.remarks).toBe('20%')
  }
  // A limit amber from its value keeps its calm remark beside the value.
  expect(row({ sevenDay: limit(85, 67) }, '7d')?.remarks).toMatch(/^85%( · .+)?$/)
})
test('a passed reset says RESET PASSED once, never RESET twice, zone known or not', () => {
  for (const zone of [UTC, undefined]) {
    const r = row({ zone, now: 4 * HOUR, fiveHour: limit(4, 3) }, '5h')
    // Open: STATUS says it reset, TIME that it passed, REMARKS nothing.
    expect([r?.item, r?.status, r?.time, r?.remarks, r?.tone]).toEqual(['5H', 'RESET', 'PASSED', '', 'calm'])
    // Collapsed: the long form, and the short ones the value, which is RESET.
    expect(r?.cell).toBe('RESET PASSED')
    expect(r?.cellNoReset).toBe('RESET')
    expect(r?.cellShort).toBe('RESET')
  }
})
test('no board form draws ↻, which the flap face lacks: RESET says it', () => {
  const pace = { fiveHour: { ...limit(20, 3), etaMs: 40 * MIN }, sevenDay: limit(85, 67), otherLimits: [{ kind: 'spend_limit', percentUsed: 40, resetsAt: 5 * HOUR }] }
  for (const zone of [UTC, undefined])
    for (const r of board({ ...pace, zone }).rows) for (const text of [r.status, r.time ?? '', r.remarks, r.cell, r.cellShort, r.cellNoReset ?? '']) expect(text).not.toMatch(/↻/)
  expect(row({ fiveHour: limit(26, 3) }, '5h')?.cell).toMatch(/^26% RESET 03:00/)
})
test('an unknown zone: no clock anywhere on the board, and no empty time', () => {
  for (const r of board({ zone: undefined, fiveHour: limit(26, 3), sevenDay: limit(85, 67) }).rows) {
    for (const text of [r.time ?? '', r.cell, r.remarks, r.alt]) expect(text).not.toMatch(CLOCK)
    expect(r.time).not.toBe('')
    expect(`${r.cell}${r.remarks}`).not.toMatch(/undefined|NaN/)
  }
})
test('a calm context row\'s remarks name the room and where compaction falls', () => {
  const calm = row({ context: { ...snapOf().context, tokens: 76_000, window: 200_000, compactAt: 190_000 } }, 'context')
  expect(calm?.remarks).toMatch(/^TOWARD COMPACTION AT 190K · ~?\d+K LEFT$/)
})
test("an amber limit's short form keeps its mark: ! and its value; a calm one its value alone", () => {
  expect(row({ fiveHour: limit(82, 3) }, '5h')?.cellShort).toBe('! 82%')
  expect(row({ sevenDay: limit(85, 67) }, '7d')?.cellShort).toBe('! 85%')
  expect(row({ sevenDay: limit(41, 67) }, '7d')?.cellShort).toBe('41%')
})
test("an other limit's ITEM names it a limit, so it never reads as the session's SPEND", () => {
  const others = (kind: string) => board({ otherLimits: [{ kind, percentUsed: 40, resetsAt: 5 * HOUR }] }).rows.filter(r => r.key === 'other').map(r => r.item)
  expect(others('spend_limit')).toEqual(['SPEND LIMIT'])
  expect(others('credit_limit')).toEqual(['CREDIT LIMIT'])
})
test("with no zone, a reset under ten minutes off reads the same minute on the board as in the limit's words", () => {
  const r = readingsOf(snapOf({ fiveHour: { percentUsed: 4, resetsAt: 4 * MIN + 30_000, etaMs: null } }))
  expect(r.fiveHour?.resetWhen).toBe('in 5m')
  expect(r.board().rows.find(row => row.key === '5h')?.time).toBe('IN 5 MIN')
})
